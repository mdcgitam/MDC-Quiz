// Runs supabase-setup.sql + hackoween-setup.sql in an in-memory Postgres (PGlite) and exercises the RPCs.
// Optional: skipped unless @electric-sql/pglite can be loaded, e.g.
//   npm i --no-save @electric-sql/pglite && node --test tests/
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const H = require('../hackoween-core.js')

let PGlite, pgcrypto
try {
  ({ PGlite } = require('@electric-sql/pglite'))
  ;({ pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto'))
} catch (e) { /* not installed */ }

const ROOT = path.join(__dirname, '..')
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8')

test('SQL: quiz join with HackerRank username, live quiz round, scoreboard save/load', { skip: !PGlite && 'PGlite not installed' }, async () => {
  const db = new PGlite({ extensions: { pgcrypto } })
  await db.exec(`create role anon; create role authenticated; create schema extensions;`)
  await db.exec(read('supabase-setup.sql').replace("pw text := 'MDC26'", "pw text := 'a-long-test-password'"))
  await db.exec(read('hackoween-setup.sql'))
  await db.exec(read('hackoween-setup.sql')) // safe to run twice

  const rpc = async (fn, args) => {
    const keys = Object.keys(args)
    const r = await db.query(`select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as v`, keys.map(k => args[k]))
    return r.rows[0].v
  }
  const fails = async (p, re) => { await assert.rejects(p, e => re.test(e.message)) }

  const s = (await rpc('quiz_admin_login', { p_password: 'a-long-test-password' })).session
  assert.ok(s)
  const code = await rpc('quiz_admin_create_room', { p_session: s, p_secs: 30 })
  const join = (n, reg, hr, tok) => rpc('quiz_join', { p_code: code, p_name: n, p_email: n.toLowerCase().replace(/ /g, '.') + '@x.edu', p_reg: reg, p_year: '2nd Year', p_dept: 'CS', p_token: tok.padEnd(40, 'x'), p_hr: hr })
  await join('Asha Rao', 'REG0001', 'asha_r', 'tokA')
  await join('Kiran Das', 'REG0002', 'KiranD', 'tokB')
  await join('Guest One', 'REG0003', 'guesty', 'tokC')
  await fails(join('Copy Cat', 'REG0004', 'ASHA_R', 'tokD'), /HackerRank username has already joined/)
  await fails(join('No Handle', 'REG0005', '', 'tokE'), /HackerRank username/)
  await fails(rpc('quiz_join', { p_code: code, p_name: 'Old Client', p_email: 'o@x.edu', p_reg: 'REG0006', p_year: '2nd Year', p_dept: 'CS', p_token: 'tokF'.padEnd(40, 'x') }), /HackerRank username/)
  await join('Asha Rao', 'REG0001', 'asha_r', 'tokA') // rejoining on the same device still works

  await rpc('quiz_admin_set_status', { p_session: s, p_code: code, p_status: 'live' })
  for (const t of ['tokA', 'tokB', 'tokC']) {
    const tok = t.padEnd(40, 'x')
    const q = await rpc('quiz_question', { p_token: tok })
    const right = (await db.query(`select (questions->0->>'a')::int a from quiz_rooms where code=$1`, [code])).rows[0].a
    await rpc('quiz_answer', { p_token: tok, p_index: q.index, p_choice: t === 'tokB' ? (right + 1) % 4 : right })
  }

  const board = await rpc('quiz_room_board', { p_code: code })
  assert.equal(board.players.length, 3)
  assert.ok(board.players[0].score > 0)
  const dash = await rpc('quiz_admin_dashboard', { p_session: s, p_code: code })
  assert.ok(dash.players.some(p => p.hr === 'KiranD'))

  // scoreboard: link the quiz room and save participants (Kiran only by HackerRank username, different email)
  const got = await rpc('hw_admin_get', { p_session: s })
  assert.equal(got.rev, 0)
  const doc = H.defaultState()
  doc.config.quizRoom = code
  doc.people = {
    p1: { id: 'p1', name: 'Asha Rao', email: 'asha.rao@x.edu', ext: '', dq: false },
    p2: { id: 'p2', name: 'K. Das', email: 'kd@other.edu', ext: 'kirand', dq: false },
    p3: { id: 'p3', name: 'Hidden', email: 'h@x.edu', ext: '', dq: true }
  }
  doc.scores.r1 = { p1: { raw: 100, time: 704 } }
  doc.bonus = [{ id: 'b1', pid: 'p1', delta: 20, note: 'secret note', ts: 1, void: false }]
  const rev = await rpc('hw_admin_save', { p_session: s, p_doc: JSON.stringify(doc), p_rev: 0, p_label: 'Before test' })
  assert.equal(Number(rev), 1)
  await fails(rpc('hw_admin_save', { p_session: s, p_doc: JSON.stringify(doc), p_rev: 0 }), /HW_STALE/)
  await fails(rpc('hw_admin_save', { p_session: 'nope', p_doc: '{}', p_rev: 1 }), /ADMIN_SESSION/)

  const adm = await rpc('hw_admin_get', { p_session: s })
  assert.equal(adm.snapshots.length, 1)
  assert.equal(adm.quiz.unmatched.length, 1)
  assert.equal(adm.quiz.unmatched[0].hr, 'guesty')
  assert.deepEqual(Object.keys(adm.quiz.scores).sort(), ['p1', 'p2'])
  assert.equal(adm.quiz.max, (await db.query(`select sum(coalesce((q->>'p')::int,1))*1000 m from quiz_rooms, jsonb_array_elements(questions) q where code=$1`, [code])).rows[0].m * 1)
  assert.deepEqual(await rpc('hw_admin_snapshot', { p_session: s, p_id: adm.snapshots[0].id }), {})

  const pub = await rpc('hw_public', {})
  const text = JSON.stringify(pub)
  assert.ok(!/@/.test(text), 'no emails in public data')
  assert.ok(!/secret note|kirand/.test(text), 'no notes or usernames in public data')
  assert.equal(pub.doc.people.p3, undefined)
  const eff = H.withQuiz(H.normalizeState(pub.doc), pub.quiz)
  const b = H.computeBoard(eff)
  assert.equal(b.rows.length, 2)
  assert.equal(b.rows[0].id, 'p1')
  assert.ok(b.rows[0].r2.pts > 0)

  assert.equal((await rpc('hw_my', { p_token: 'tokB'.padEnd(40, 'x') })).pid, 'p2')
  assert.equal((await rpc('hw_my', { p_token: 'tokC'.padEnd(40, 'x') })).pid, null)
  await db.close()
})
