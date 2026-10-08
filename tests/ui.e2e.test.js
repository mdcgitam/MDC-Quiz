// End-to-end run of hackoween.html in jsdom, with fetch() answered by an in-memory Postgres (PGlite)
// that has supabase-setup.sql, hackoween-setup.sql and samples/quiz-rehearsal.sql loaded.
// Optional: skipped unless jsdom and @electric-sql/pglite can be loaded, e.g.
//   npm i --no-save jsdom @electric-sql/pglite && node --test tests/
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const H = require('../hackoween-core.js')

let JSDOM, PGlite, pgcrypto
try {
  ({ JSDOM } = require('jsdom'))
  ;({ PGlite } = require('@electric-sql/pglite'))
  ;({ pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto'))
} catch (e) { /* not installed */ }

const ROOT = path.join(__dirname, '..')
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8')
const PW = 'a-long-test-password'

async function makeDb() {
  const db = new PGlite({ extensions: { pgcrypto } })
  await db.exec(`create role anon; create role authenticated; create schema extensions;`)
  await db.exec(read('supabase-setup.sql').replace("pw text := 'MDC26'", `pw text := '${PW}'`))
  await db.exec(read('hackoween-setup.sql'))
  await db.exec(read('samples/quiz-rehearsal.sql'))
  const call = async (fn, args) => {
    const keys = Object.keys(args)
    const vals = keys.map(k => (args[k] !== null && typeof args[k] === 'object') ? JSON.stringify(args[k]) : args[k])
    const r = await db.query(`select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as v`, vals)
    return r.rows[0].v
  }
  return { db, call }
}

const windows = []
function openPage(file, hash, call) {
  const html = read(file).replace(/<script src="hackoween-core.js"><\/script>/, () => `<script>${read('hackoween-core.js')}</script>`)
  const dom = new JSDOM(html, {
    url: 'http://localhost/' + file + (hash || ''), runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      w.fetch = async (url, opts) => {
        const fn = url.split('/rpc/')[1]
        try {
          const v = await call(fn, JSON.parse(opts.body || '{}'))
          return { ok: true, status: 200, text: async () => JSON.stringify(v) }
        } catch (e) {
          return { ok: false, status: 400, text: async () => JSON.stringify({ message: e.message }) }
        }
      }
      w.HTMLDialogElement.prototype.showModal = function () { this.open = true }
      w.HTMLDialogElement.prototype.close = function () { this.open = false }
      w.scrollTo = () => {}
      w.Element.prototype.scrollIntoView = () => {}
    }
  })
  windows.push(dom.window)
  return dom.window
}

async function until(fn, what, ms = 8000) {
  const t0 = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - t0 > ms) throw new Error('Timed out waiting for: ' + what)
    await new Promise(r => setTimeout(r, 25))
  }
}

test('hackoween.html end to end', { skip: !(JSDOM && PGlite) && 'jsdom or PGlite not installed', timeout: 90000 }, async () => {
  const { db, call } = await makeDb()
  const doc = async () => (await call('hw_admin_get', { p_session: adminSession })).doc
  let adminSession = (await call('quiz_admin_login', { p_password: PW })).session

  const W = openPage('hackoween.html', '', call)
  const $ = s => W.document.querySelector(s)
  const $$ = s => [...W.document.querySelectorAll(s)]
  const fire = (el, type) => el.dispatchEvent(new W.Event(type, { bubbles: true, cancelable: true }))
  const key = (el, k) => el.dispatchEvent(new W.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
  const setVal = (el, v, type = 'input') => { el.value = v; fire(el, type) }

  // login
  const pw = await until(() => $('#pw'), 'login form')
  pw.value = 'wrong'; fire($('#lf'), 'submit')
  await until(() => /isn't right/.test($('#lmsg').textContent), 'wrong password message')
  pw.value = PW; fire($('#lf'), 'submit')
  await until(() => $('#tabs'), 'admin tabs')

  // participants from a list
  $('[data-act="openRoster"]').click()
  setVal($('#rosterText'), read('samples/participants.csv'))
  assert.match($('#rosterInfo').textContent, /12 new/)
  $('#rosterGo').click()
  await until(async () => Object.keys((await doc()).people || {}).length === 12, '12 participants saved')

  // link the quiz room; one quiz player is not registered
  setVal($('input[data-chg="quizRoom"]'), 'hwtst', 'change')
  await until(() => /Guest Player/.test($('#lbQuiz').textContent), 'unmatched quiz player listed')
  assert.match($('#lbQuiz').textContent, /8 matched/)
  $('[data-act="addUnmatched"]').click()
  await until(async () => Object.keys((await doc()).people).length === 13, 'quiz guest added')
  await until(() => /9 matched/.test($('#lbQuiz').textContent), '9 matched after adding')

  // coding round: paste the HackerRank table
  W.location.hash = '#import'
  await until(() => $('#paste'), 'import page')
  // two leaderboard pages pasted one after another: the repeated header row is dropped
  const pages = read('samples/hackerrank-paste.tsv').trim().split('\n')
  setVal($('#paste'), pages.slice(0, 5).join('\n') + '\n' + pages[0] + '\n' + pages.slice(5).join('\n') + '\n')
  $('[data-act="usePaste"]').click()
  await until(() => $('[data-act="impReview"]'), 'column mapping')
  assert.equal($('select[data-field="id"]').selectedOptions[0].textContent, 'HACKER')
  assert.equal($('select[data-field="score"]').selectedOptions[0].textContent, 'SCORE')
  assert.equal($('select[data-field="time"]').selectedOptions[0].textContent, 'TIME')
  setVal($('input[data-key="timeLimit"]'), '120', 'change')
  $('[data-act="impReview"]').click()
  await until(() => $('table.imp'), 'review table')

  const commit = () => $('[data-act="impCommit"]')
  assert.equal(commit().disabled, true, 'commit blocked by red rows')
  const rowsByText = t => $$('table.imp tr.r').find(tr => tr.textContent.includes(t))
  assert.ok(rowsByText('priya_sha').classList.contains('bad'))
  assert.ok(rowsByText('randomcoder99').classList.contains('bad'))
  assert.ok(rowsByText('vikramrao7').classList.contains('warn'), 'unreadable time is amber')
  // problem rows are pinned to the top
  assert.ok($$('table.imp tr.r')[0].classList.contains('bad'))

  const chip = await until(() => rowsByText('priya_sha').querySelector('[data-act="impPick"]'), 'suggestion chip')
  assert.equal(chip.textContent, 'Priya Sharma')
  chip.click()
  const rid = rowsByText('randomcoder99').dataset.row // once it becomes "new", the name is in an <input>
  const sel = $(`tr[data-row="${rid}"] select[data-chg="assign"]`)
  sel.value = 'new'; fire(sel, 'change')
  assert.ok($(`tr[data-row="${rid}"]`).classList.contains('isnew'))
  // a registered person missing from the paste can be typed in
  const missing = $$('.missing tr').find(tr => tr.textContent.includes('Harsh Gupta'))
  setVal(missing.querySelector('input'), '10')
  assert.equal(commit().disabled, false)
  assert.match($('#rvSide').textContent, /Top 8 after this import/)
  commit().click()
  await until(async () => Object.keys((await doc()).scores.r1).length === 10, 'coding scores saved')

  const d1 = await doc()
  const pidOf = n => Object.values(d1.people).find(p => p.name === n).id
  assert.equal(d1.people[pidOf('Priya Sharma')].ext, 'priya_sh')
  assert.ok(Object.values(d1.people).some(p => p.ext === 'randomcoder99'))
  const quiz1 = (await call('hw_admin_get', { p_session: adminSession })).quiz
  const b1 = H.computeBoard(H.withQuiz(H.normalizeState(d1), quiz1))
  const row = n => b1.rows.find(r => r.name === n)
  assert.equal(row('Akash Karri').r1.pts, 396.1)
  assert.equal(row('Srinivas Katragadda').r1.pts, 360.2)
  assert.equal(row('Meera Iyer').r1.pts, 307)
  assert.equal(row('Kiran Das').r2.raw, 18760, 'Kiran matched to his quiz score by username')
  const snaps1 = (await call('hw_admin_get', { p_session: adminSession })).snapshots
  assert.ok(snaps1.some(s => /Before importing the Coding round/.test(s.label)))

  // logo round: search, Enter picks the first match, number key 1 awards +20
  W.location.hash = '#final'
  const search = await until(() => $('#fSearch'), 'logo round page')
  setVal(search, 'meera')
  key(search, 'Enter')
  await until(() => /Meera Iyer/.test($('#fSelected').textContent), 'Meera picked')
  key($('#fSearch'), '1')
  await until(async () => ((await doc()).bonus || []).length === 1, 'award saved')
  const d2 = await doc()
  assert.equal(d2.bonus[0].delta, 20)
  assert.equal(d2.bonus[0].pid, pidOf('Meera Iyer'))
  assert.equal(d2.last.pid, pidOf('Meera Iyer'))
  assert.ok(Object.keys(d2.checkpoint).length > 0, 'checkpoint set before the first award')
  assert.equal($('#fSearch').value, '')
  assert.match($('#fSelected').textContent, /No one picked/)

  // projector screen (no login), then a +10 award should pulse there
  const D = openPage('hackoween.html', '#display', call)
  await until(() => D.document.querySelectorAll('#screenRoot .rw').length === 10, 'screen shows top 10')
  const screenText = D.document.getElementById('screenRoot').textContent
  assert.ok(!/@/.test(screenText))
  assert.match(screenText, /Logo round: points are live/)

  // someone else saves in between: the next award is re-applied on top, nothing is lost
  const cur = await call('hw_admin_get', { p_session: adminSession })
  await call('hw_admin_save', { p_session: adminSession, p_doc: Object.assign({}, cur.doc, { config: Object.assign({}, cur.doc.config, { stageOverride: 'Changed elsewhere' }) }), p_rev: cur.rev })
  setVal($('#fSearch'), 'kiran'); key($('#fSearch'), 'Enter')
  await until(() => /Kiran Das/.test($('#fSelected').textContent), 'Kiran picked')
  key($('#fSearch'), '2')
  await until(async () => ((await doc()).bonus || []).length === 2, 'second award saved after conflict')
  const d3 = await doc()
  assert.equal(d3.config.stageOverride, 'Changed elsewhere')
  assert.equal(d3.bonus[1].delta, 10)

  await until(() => D.document.querySelector('#screenRoot .rw.pulse'), 'pulse on the screen')
  await until(() => /Changed elsewhere/.test(D.document.querySelector('#screenRoot .stage').textContent), 'subtitle override on screen')

  // undo last
  $('[data-act="undoLast"]').click()
  await until(async () => (await doc()).bonus[1].void === true, 'undo saved')

  // reveal mode
  $('[data-act="revealStart"]').click()
  await until(() => D.document.querySelectorAll('#screenRoot .rw.veiled').length === 10, 'top 10 veiled')
  $('[data-act="revealNext"]').click()
  await until(() => D.document.querySelectorAll('#screenRoot .rw.veiled').length === 9, 'one uncovered from the bottom')
  assert.ok(!D.document.querySelectorAll('#screenRoot .rw')[9].classList.contains('veiled'))

  await db.close()
})
test('quiz.html: HackerRank username on the join form, and the projector leaderboard', { skip: !(JSDOM && PGlite) && 'jsdom or PGlite not installed', timeout: 60000 }, async () => {
  const { db, call } = await makeDb()
  const s = (await call('quiz_admin_login', { p_password: PW })).session
  const code = await call('quiz_admin_create_room', { p_session: s, p_secs: 30 })

  async function join(name, email, hr, reg, gender = 'Male') {
    const W = openPage('quiz.html', '', call)
    const $ = q => W.document.querySelector(q)
    await until(() => $('#jf'), 'join form')
    const set = (id, v) => { $('#' + id).value = v }
    set('nm', name); set('em', email); set('rn', reg); set('yr', '2nd Year'); set('dp', 'CS'); set('rc', code); set('hr', hr); set('gd', gender)
    $('#jf').dispatchEvent(new W.Event('submit', { bubbles: true, cancelable: true }))
    return { W, $ }
  }
  const a = await join('Asha Rao', 'asha@x.edu', '', 'REG00001')
  await until(() => /HackerRank username/.test(a.$('#msg').textContent), 'username required in the browser')
  assert.ok(a.$('#hr').classList.contains('inv'))
  a.$('#hr').value = '@asha_r'
  a.$('#jf').dispatchEvent(new a.W.Event('submit', { bubbles: true, cancelable: true }))
  await until(() => /You're in/.test(a.W.document.body.textContent), 'lobby after joining')
  const g = await join('No Gender', 'ng@x.edu', 'ngender', 'REG00003', '')
  await until(() => /select your gender/.test(g.$('#msg').textContent), 'gender required in the browser')
  assert.ok(g.$('#gd').classList.contains('inv'))
  const b = await join('Copy Cat', 'cc@x.edu', 'ASHA_R', 'REG00002')
  await until(() => /already joined this room/.test(b.$('#msg').textContent), 'duplicate username rejected')
  assert.ok(b.$('#hr').classList.contains('inv'))
  assert.deepEqual((await db.query(`select hr, gender from quiz_players where room_code=$1`, [code])).rows[0], { hr: 'asha_r', gender: 'Male' })

  const B = openPage('quiz.html', '?board=' + code.toLowerCase(), call)
  await until(() => B.document.querySelectorAll('#qb li').length === 1, 'projector board lists the player')
  assert.match(B.document.getElementById('qbMeta').textContent, /Waiting to start · 1 player$/)

  // Hack-O-Ween standings on the player's results screen
  const tok = a.W.localStorage.getItem('mdc_tok_' + code)
  await call('quiz_admin_set_status', { p_session: s, p_code: code, p_status: 'live' })
  const q = await call('quiz_question', { p_token: tok })
  await call('quiz_answer', { p_token: tok, p_index: q.index, p_choice: 0 })
  const hw = H.defaultState()
  hw.config.quizRoom = code
  hw.people = { p1: { id: 'p1', name: 'Asha Rao', email: 'asha@x.edu', ext: '', dq: false }, p2: { id: 'p2', name: 'Bo Chen', email: 'bo@x.edu', ext: 'boc', dq: false } }
  hw.scores.r1 = { p1: { raw: 40, time: null }, p2: { raw: 90, time: null } }
  let rev = Number(await call('hw_admin_save', { p_session: s, p_doc: hw, p_rev: 0 }))
  await call('quiz_admin_set_status', { p_session: s, p_code: code, p_status: 'ended' })
  const box = await until(() => { const e = a.$('#hw'); return e && !e.hidden && /#2/.test(e.textContent) && e }, 'player sees their combined rank', 15000)
  assert.match(box.textContent, /Asha Rao \(you\)/)
  assert.match(box.textContent, /Bo Chen/)
  assert.match(box.textContent, /of 2/)
  hw.reveal = { on: true, count: 0 }
  rev = Number(await call('hw_admin_save', { p_session: s, p_doc: hw, p_rev: rev }))
  await until(() => /revealed on the big screen/.test(a.$('#hw').textContent) && !/Bo Chen/.test(a.$('#hw').textContent), 'standings hidden during reveal', 15000)
  await db.close()
})

// close every page even when an assertion fails, so their polling timers don't keep the process alive
test.after(() => windows.forEach(w => w.close()))
