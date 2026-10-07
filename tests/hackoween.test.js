// Acceptance tests for the Hack-O-Ween scoring core. Run: node --test tests/
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const H = require('../hackoween-core.js')

const ROOT = path.join(__dirname, '..')
const person = (id, name, email = '', ext = '') => ({ id, name, email, ext, dq: false })
function stateWith(people, patch) {
  const s = H.defaultState()
  people.forEach(p => { s.people[p.id] = p })
  if (patch) patch(s)
  return s
}
const codingCfg = s => Object.assign(s.config.r1, { weight: 400, max: 100, mode: 'max', timePct: 10, timeLimit: 120 })
const rowOf = (board, id) => board.rows.find(r => r.id === id)
const table = text => { const rows = H.parseCSV(text); return { headers: rows[0], rows: rows.slice(1) } }

test('core logic is a verbatim copy of the reference prototype', () => {
  const block = s => s.slice(s.indexOf('// <LOGIC>'), s.indexOf('// </LOGIC>'))
  const ref = fs.readFileSync(path.join(ROOT, 'docs/reference/hackoween-scoreboard.html'), 'utf8')
  const core = fs.readFileSync(path.join(ROOT, 'hackoween-core.js'), 'utf8')
  assert.equal(block(core), block(ref))
})

test('1. coding points with a 10% speed penalty over 120 minutes', () => {
  const s = stateWith([person('a', 'A'), person('b', 'B'), person('c', 'C')], s => {
    codingCfg(s)
    s.scores.r1 = { a: { raw: 100, time: H.parseTime('11:44') }, b: { raw: 100, time: H.parseTime('1:59:16') }, c: { raw: 77.78, time: H.parseTime('15:54') } }
  })
  const b = H.computeBoard(s)
  assert.equal(rowOf(b, 'a').r1.pts, 396.1)
  assert.equal(rowOf(b, 'b').r1.pts, 360.2)
  assert.equal(rowOf(b, 'c').r1.pts, 307.0)
  assert.equal(rowOf(b, 'a').rank, 1)
  assert.equal(rowOf(b, 'b').rank, 2)
})

test('2. penalty is skipped without a limit or a time, and is full beyond the limit', () => {
  const pts = (limit, time) => {
    const s = stateWith([person('a', 'A')], s => { codingCfg(s); s.config.r1.timeLimit = limit; s.scores.r1 = { a: { raw: 100, time } } })
    return rowOf(H.computeBoard(s), 'a').r1.pts
  }
  assert.equal(pts(null, 3600), 400)
  assert.equal(pts(120, null), 400)
  assert.equal(pts(120, 10 * 3600), 360)
})

test('3. logo awards are capped at the maximum and voided awards are ignored', () => {
  const s = stateWith([person('a', 'A')], s => {
    s.config.bonus.cap = 200
    s.bonus = [{ id: '1', pid: 'a', delta: 150 }, { id: '2', pid: 'a', delta: 100 }, { id: '3', pid: 'a', delta: 500, void: true }]
  })
  assert.equal(rowOf(H.computeBoard(s), 'a').bonus.pts, 200)
  s.bonus[1].void = true
  assert.equal(rowOf(H.computeBoard(s), 'a').bonus.pts, 150)
})

test('3b. negative logo totals have no floor', () => {
  const s = stateWith([person('a', 'A')], s => { s.bonus = [{ id: '1', pid: 'a', delta: -5 }, { id: '2', pid: 'a', delta: -5 }] })
  assert.equal(rowOf(H.computeBoard(s), 'a').total, -10)
})

test('4. equal totals: faster coding time ranks first, identical times share a rank', () => {
  const s = stateWith([person('a', 'Zed'), person('b', 'Amy'), person('c', 'Bob')], s => {
    Object.assign(s.config.r1, { weight: 400, max: 100, timePct: 0 })
    s.scores.r1 = { a: { raw: 50, time: 600 }, b: { raw: 50, time: 900 }, c: { raw: 50, time: 900 } }
  })
  const b = H.computeBoard(s)
  assert.deepEqual(b.rows.map(r => [r.id, r.rank]), [['a', 1], ['b', 2], ['c', 2]])
})

test('4b. competition ranking skips after a tie (1,2,2,4)', () => {
  const s = stateWith(['a', 'b', 'c', 'd'].map(id => person(id, id)), s => {
    s.config.r1.timePct = 0
    s.scores.r1 = { a: { raw: 90, time: 1 }, b: { raw: 80, time: 5 }, c: { raw: 80, time: 5 }, d: { raw: 70, time: 1 } }
  })
  assert.deepEqual(H.computeBoard(s).rows.map(r => r.rank), [1, 2, 2, 4])
})

test('5. percentile mode: a raw score of 0 earns 0', () => {
  const s = stateWith([person('a', 'A'), person('b', 'B')], s => {
    s.config.r1.mode = 'pct'; s.config.r1.timePct = 0
    s.scores.r1 = { a: { raw: 0, time: null }, b: { raw: 0, time: null } }
  })
  const b = H.computeBoard(s)
  assert.equal(rowOf(b, 'a').r1.pts, 0)
  assert.equal(rowOf(b, 'b').r1.pts, 0)
})

test('5b. disqualified people are hidden and ignored when scaling', () => {
  const s = stateWith([person('a', 'A'), Object.assign(person('b', 'B'), { dq: true })], s => {
    s.config.r1.mode = 'top'; s.config.r1.timePct = 0
    s.scores.r1 = { a: { raw: 50 }, b: { raw: 100 } }
  })
  const b = H.computeBoard(s)
  assert.equal(b.rows.length, 1)
  assert.equal(rowOf(b, 'a').r1.pts, 400)
})

test('6. column guessing for HackerRank and Google-Form headers', () => {
  const g = H.guessColumns(['HACKER', 'RANK', 'COUNTRY', 'SCORE', 'TIME'])
  assert.equal(g.id, 0); assert.equal(g.score, 3); assert.equal(g.time, 4)
  const f = H.guessColumns(['Timestamp', 'Full name', 'Email address', 'Your HackerRank username (exact)'])
  assert.equal(f.id, 3); assert.equal(f.name, 1); assert.equal(f.email, 2)
})

test('6b. a tab-separated HackerRank paste parses, with a BOM and h:mm:ss times', () => {
  const t = table('﻿HACKER\tRANK\tCOUNTRY\tSCORE\tTIME\nakarri4\t01\t\t100.00\t11:44\nskatrag1\t01\t\t100.00\t1:59:16\n')
  assert.deepEqual(t.headers, ['HACKER', 'RANK', 'COUNTRY', 'SCORE', 'TIME'])
  assert.equal(t.rows[1][0], 'skatrag1')
  assert.equal(H.parseTime(t.rows[1][4]), 7156)
  assert.deepEqual(H.parseCSV('a;b\n"x;1";2'), [['a', 'b'], ['x;1', '2']])
  assert.equal(H.parseCSV('just one column\nfoo')[0].length, 1) // the UI rejects this with a clear error
})

test('7. import matching and row statuses', () => {
  const s = stateWith([
    person('p1', 'Asha Rao', 'asha@x.edu', 'asha_r'),
    person('p2', 'Kiran Das', 'kiran@x.edu', 'kirand'),
    person('p3', 'Meera Iyer', 'meera@x.edu', ''),
    person('p4', 'Vikram Shah', 'vik@x.edu', 'vikram01'),
    person('p5', 'Dup Person', 'dup@x.edu', 'dupe')
  ])
  const t = table([
    'name,email,hacker,score,time',
    'Asha,ASHA@x.edu,,90,10:00', // email match
    ',,KIRAND,80,12:00', // username match, case-insensitive
    'Meera Iyer,,,70,', // unique exact name only -> amber
    ',,vikram10,60,', // typo'd username -> red with suggestions
    ',dup@x.edu,,50,', // duplicate pair -> both red
    ',,dupe,55,',
    ',,asha_r,,' // blank score -> amber, not recorded (and duplicates p1, so red)
  ].join('\n'))
  const map = H.guessColumns(t.headers)
  const rows = H.buildReviewRows(t, map, 'sec', s)
  const an = H.analyzeRows(rows, s, 100)
  assert.equal(rows[0].how, 'email'); assert.equal(rows[0].assign.pid, 'p1')
  assert.equal(rows[1].how, 'id'); assert.equal(rows[1].assign.pid, 'p2'); assert.equal(an.r1.sev, 'ok')
  assert.equal(rows[2].how, 'name'); assert.equal(an.r2.sev, 'warn')
  assert.equal(rows[3].assign.type, null); assert.equal(an.r3.sev, 'bad'); assert.equal(rows[3].sugg[0], 'p4')
  assert.equal(an.r4.sev, 'bad'); assert.equal(an.r5.sev, 'bad')
  assert.ok(an.r6.issues.some(i => i.sev === 'warn' && /blank/.test(i.text)))

  // a score above the maximum is red
  const t2 = table('hacker,score\nkirand,101\n')
  const r2 = H.buildReviewRows(t2, H.guessColumns(t2.headers), 'sec', s)
  assert.equal(H.analyzeRows(r2, s, 100).r0.sev, 'bad')

  // a blank score is amber on its own and is not recorded
  const t3 = table('hacker,score\nkirand,\nasha_r,40\n')
  const r3 = H.buildReviewRows(t3, H.guessColumns(t3.headers), 'sec', s)
  assert.equal(H.analyzeRows(r3, s, 100).r0.sev, 'warn')
  const after = H.applyImport(s, 'r1', r3, {}, {})
  assert.equal(after.scores.r1.p2, undefined)
  assert.equal(after.scores.r1.p1.raw, 40)
})

test('8. re-importing replaces the round, and commit is blocked while any row is red', () => {
  const s = stateWith([person('p1', 'Asha', 'asha@x.edu', 'asha_r'), person('p2', 'Kiran', 'kiran@x.edu', 'kirand')])
  const imp = (st, text) => { const t = table(text); return H.buildReviewRows(t, H.guessColumns(t.headers), 'sec', st) }
  const first = H.applyImport(s, 'r1', imp(s, 'hacker,score\nasha_r,50\nkirand,60\n'), {}, {})
  const second = H.applyImport(first, 'r1', imp(first, 'hacker,score\nasha_r,70\n'), {}, {})
  assert.equal(second.scores.r1.p1.raw, 70)
  assert.equal(second.scores.r1.p2, undefined)

  const bad = imp(s, 'hacker,score\nasha_r,50\nnobody_here,60\n')
  assert.equal(H.canCommit(bad, s, 100), false)
  bad[1].assign = { type: 'skip' }
  assert.equal(H.canCommit(bad, s, 100), true)
})

test('roster import creates people and fills missing fields on existing ones', () => {
  const s = stateWith([person('p1', 'Asha Rao', 'asha@x.edu', '')])
  const t = table('Name,Email,HackerRank username\nAsha Rao,asha@x.edu,asha_r\nKiran Das,kiran@x.edu,kirand\n')
  const r = H.rosterAdd(s, t, H.guessColumns(t.headers))
  assert.equal(r.added, 1); assert.equal(r.existing, 1)
  assert.equal(r.state.people.p1.ext, 'asha_r')
})

test('live quiz scores merge with hand edits, and quiz max defaults to the quiz total', () => {
  const s = stateWith([person('a', 'A'), person('b', 'B'), person('c', 'C')], s => {
    s.scores.r2 = { b: { raw: 1500, time: null, edited: true }, c: { raw: null, edited: true } }
  })
  const eff = H.withQuiz(s, { max: 2000, scores: { a: { raw: 1000, time: 30 }, b: { raw: 400, time: 20 }, c: { raw: 900, time: 9 } } })
  assert.equal(eff.config.r2.max, 2000)
  assert.equal(eff.scores.r2.a.raw, 1000)
  assert.equal(eff.scores.r2.b.raw, 1500)
  assert.equal(eff.scores.r2.c, undefined)
  const b = H.computeBoard(eff)
  assert.equal(rowOf(b, 'a').r2.pts, 200)
  assert.equal(s.scores.r2.c.raw, null) // input state is not changed
})
