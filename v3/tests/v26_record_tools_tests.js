const assert = require('assert');
const RT = require('../v26_record_tools.js');
const Hearts = require('../hearts_scoring.js');
const OhHell = require('../ohhell_scoring.js');
const Spoons = require('../spoons_scoring.js');
const Qw = require('../qwirkle_scoring.js');
const Social = require('../social_scoring.js');
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('PASS', name); } catch (e) { fail++; console.log('FAIL', name, '-', e.stack.split('\n').slice(0, 2).join(' | ')); } }
const r = (deltas, extra) => ({ ts: 't', by: null, mode: 'pad', deltas, ...(extra || {}) });

t('generic (flip7) describe rounds + reset handling', () => {
  const rec = { type: 'flip7', players: [{ name: 'Rand', score: 30 }, { name: 'Audrey', score: 12 }],
    rounds: [r([50, 10]), r([0, 0], { mode: 'reset' }), r([30, 12])] };
  const d = RT.describeRecord(rec);
  assert.strictEqual(d.mode, 'rounds'); assert.strictEqual(d.rounds.length, 3);
  assert.deepStrictEqual(d.rounds[1].deltas, [-50, -10]); assert.deepStrictEqual(d.rounds[2].running, [30, 12]);
  assert.strictEqual(d.rounds[1].label, 'Scores reset'); assert.deepStrictEqual(d.winnerNames, ['Rand']); assert.deepStrictEqual(d.notes, []);
});
t('generic edit round -> scores, winner, placements, prev rebuilt', () => {
  const rec = { type: 'carcassonne', players: [{ name: 'A', score: 20 }, { name: 'B', score: 15 }, { name: 'C', score: 5 }],
    rounds: [r([10, 10, 5]), r([10, 5, 0])], winner: 'A' };
  const out = RT.recomputeRecord(rec, { rounds: [{ index: 1, deltas: [0, 20, 0] }] });
  assert.ok(out.ok, out.errors.join());
  assert.deepStrictEqual(out.record.players.map((p) => [p.score, p.place, p.isWinner]), [[10, 2, false], [30, 1, true], [5, 3, false]]);
  assert.strictEqual(out.record.winner, 'B'); assert.deepStrictEqual(out.record.rounds[1].prev, [10, 10, 5]);
  assert.strictEqual(rec.players[0].score, 20, 'input untouched'); assert.strictEqual(out.record.meta.edited.count, 1);
});
t('ties share a place; delete/add rounds', () => {
  const rec = { type: 'other', players: [{ name: 'A', score: 5 }, { name: 'B', score: 3 }, { name: 'C', score: 1 }], rounds: [r([5, 3, 1])] };
  const out = RT.recomputeRecord(rec, { rounds: [{ index: 0, delete: true }], addRounds: [{ deltas: [4, 4, 2] }] });
  assert.deepStrictEqual(out.record.players.map((p) => p.place), [1, 1, 3]); assert.strictEqual(out.record.winner, 'A, B');
});
t('legacy final-only record: describe falls back, score edit works', () => {
  const rec = { type: 'catan', players: ['x'].length && [{ name: 'Rand', score: 10 }, { name: 'Zach', score: 8 }] };
  const d = RT.describeRecord(rec);
  assert.strictEqual(d.mode, 'final_only'); assert.ok(/final scores only/.test(d.notes[0])); assert.deepStrictEqual(d.totals, [10, 8]);
  const out = RT.recomputeRecord(rec, { players: [{ index: 1, score: 11 }] });
  assert.strictEqual(out.record.winner, 'Zach');
  const bad = RT.recomputeRecord(rec, { rounds: [{ index: 0, deltas: [1, 1] }] });
  assert.ok(!bad.ok && /no round data/.test(bad.errors[0]));
});
t('partial/garbage rounds treated as final-only', () => {
  const rec = { type: 'flip7', players: [{ name: 'A', score: 9 }, { name: 'B', score: 4 }], rounds: [{ foo: 1 }, r([1, 2])] };
  const d = RT.describeRecord(rec); assert.strictEqual(d.mode, 'final_only'); assert.ok(/incomplete/.test(d.notes[0]));
});
t('score edit on a game with rounds adds correction round', () => {
  const rec = { type: 'flip7', players: [{ name: 'A', score: 10 }, { name: 'B', score: 20 }], rounds: [r([10, 20])] };
  const out = RT.recomputeRecord(rec, { players: [{ index: 0, score: 25 }] });
  assert.strictEqual(out.record.rounds.length, 2); assert.strictEqual(out.record.rounds[1].mode, 'edit_adjustment');
  assert.strictEqual(out.record.players[0].score, 25); assert.strictEqual(out.record.winner, 'A'); assert.ok(out.warnings.length);
  assert.strictEqual(RT.describeRecord(out.record).rounds[1].label, 'Score correction');
});
t('hearts: low wins, describe hands, entry edit replays module (moon shot)', () => {
  let st = Hearts.initState(['A', 'B', 'C', 'D']);
  Hearts.scoreHand(st, [{ hearts: 13, queenOfSpades: true }, { hearts: 0 }, { hearts: 0 }, { hearts: 0 }]);
  Hearts.scoreHand(st, [{ hearts: 5 }, { hearts: 8, queenOfSpades: true }, { hearts: 0 }, { hearts: 0 }]);
  const rec = { type: 'hearts', players: st.players.map((p) => ({ name: p.name, score: p.score })), rounds: st.rounds };
  const d = RT.describeRecord(rec);
  assert.ok(d.lowWins); assert.ok(/^Hand 1/.test(d.rounds[0].label)); assert.ok(d.rounds[0].detail.entries);
  const before = rec.players.map((p) => p.score);
  const out = RT.recomputeRecord(rec, { rounds: [{ index: 1, entries: [{ hearts: 0 }, { hearts: 13, queenOfSpades: true }, { hearts: 0 }, { hearts: 0 }] }] });
  assert.ok(out.ok, out.errors.join());
  assert.notDeepStrictEqual(out.record.players.map((p) => p.score), before);
  const min = Math.min(...out.record.players.map((p) => p.score));
  assert.ok(out.record.players.filter((p) => p.isWinner).every((p) => p.score === min));
  assert.strictEqual(out.record.players[1].moonShots, 1);
});
t('oh hell: replay bid/tricks edit through module', () => {
  const st = OhHell.initState(['A', 'B', 'C']);
  const res1 = OhHell.scoreRound(st, [{ bid: 1, tricksWon: 1 }, { bid: 0, tricksWon: 0 }, { bid: 1, tricksWon: 0 }], { enforceScrewTheDealer: false, cardsDealt: 1 });
  assert.ok(res1.ok !== false, res1.error);
  const rec = { type: 'ohhell', players: st.players.map((p) => ({ name: p.name, score: p.score })), rounds: st.rounds };
  const d = RT.describeRecord(rec); assert.ok(/^Round 1 \(\d+ cards/.test(d.rounds[0].label), d.rounds[0].label);
  const out = RT.recomputeRecord(rec, { rounds: [{ index: 0, entries: [{ bid: 1, tricksWon: 0 }, { bid: 0, tricksWon: 0 }, { bid: 1, tricksWon: 1 }] }] });
  assert.ok(out.ok, out.errors.join()); assert.strictEqual(out.record.winner.includes('C'), true);
  assert.ok(out.record.players[2].score > out.record.players[0].score);
});
t('spoons: describe eliminations + edit order', () => {
  let s = Spoons.initState(['A', 'B', 'C']); s = Spoons.eliminate(s, 'C'); s = Spoons.eliminate(s, 'A');
  const rec = Spoons.toGameRecord(s);
  const d = RT.describeRecord(rec);
  assert.strictEqual(d.mode, 'eliminations'); assert.deepStrictEqual(d.placements.map((p) => p.names[0]), ['B', 'A', 'C']);
  const out = RT.recomputeRecord(rec, { eliminationOrder: ['B', 'C'] });
  assert.ok(out.ok, out.errors.join()); assert.strictEqual(out.record.winner, 'A');
  assert.deepStrictEqual(out.record.players.map((p) => p.place), [1, 3, 2]); assert.deepStrictEqual(out.record.players.map((p) => p.score), [2, 0, 1]);
  assert.ok(!RT.recomputeRecord(rec, { eliminationOrder: ['A', 'B', 'C'] }).ok);
  assert.ok(!RT.recomputeRecord(rec, { players: [{ index: 0, score: 9 }] }).ok);
});
t('7 wonders: categories, coin tiebreak, category edit', () => {
  const pl = (name, scores) => ({ name, scores, science: { tablets: 0, compasses: 0, gears: 0, wilds: 0 } });
  const rec = { type: '7wonders', expansions: {}, players: [pl('A', { military: 10, treasury: 9, wonder: 5 }), pl('B', { military: 10, treasury: 6, wonder: 6 })] };
  const d = RT.describeRecord(rec);
  assert.strictEqual(d.mode, 'categories'); assert.deepStrictEqual(d.totals, [18, 18]); assert.deepStrictEqual(d.winnerNames, ['A']);
  const out = RT.recomputeRecord(rec, { categories: [{ index: 1, key: 'wonder', value: 10 }] });
  assert.strictEqual(out.record.players[1].score, 22); assert.strictEqual(out.record.winner, 'B');
});
t('catan: breakdown categories + edit adds correction round', () => {
  const rec = { type: 'catan', players: [{ name: 'A', score: 4, breakdown: { settlements: 2, cities: 1 } }, { name: 'B', score: 3, breakdown: { settlements: 3 } }],
    rounds: [r([4, 3])] };
  const d = RT.describeRecord(rec); assert.ok(d.categories && d.categories[1].key === 'cities');
  const out = RT.recomputeRecord(rec, { categories: [{ index: 1, key: 'longestRoad', value: 1 }, { index: 1, key: 'cities', value: 1 }] });
  assert.ok(out.ok, out.errors.join()); assert.strictEqual(out.record.players[1].score, 7); assert.strictEqual(out.record.winner, 'B');
  assert.ok(!RT.recomputeRecord(rec, { categories: [{ index: 0, key: 'longestRoad', value: 1 }, { index: 1, key: 'longestRoad', value: 1 }] }).ok);
});
t('qwirkle: module-style rounds and engine rounds both describe', () => {
  let s = Qw.initState(['A', 'B']); Qw.scoreTurn(s, 0, 12, { qwirkles: 1 }); Qw.scoreTurn(s, 1, 5);
  const rec = Qw.toGameRecord(s);
  const d = RT.describeRecord(rec);
  assert.strictEqual(d.mode, 'rounds'); assert.deepStrictEqual(d.totals.slice(), rec.players.map((p) => p.score));
  assert.ok(/Turn 1 \(A\)/.test(d.rounds[0].label));
  const out = RT.recomputeRecord(rec, { rounds: [{ index: 1, deltas: [0, 30] }] });
  assert.strictEqual(out.record.winner, 'B');
});
t('rummikub low by scoring mode; nertz teams credit members', () => {
  const rk = { type: 'rummikub', rkScoringMode: 'points_up', low: true, players: [{ name: 'A', score: 10 }, { name: 'B', score: 4 }], rounds: [r([10, 4])] };
  assert.strictEqual(RT.describeRecord(rk).winner, 'B');
  const nz = { type: 'nertz', meta: { mode: 'teams' }, players: [
    { name: 'Team 1', score: 0, members: [{ name: 'Rand', userId: 'u1' }, { name: 'Audrey', userId: null }] },
    { name: 'Team 2', score: 0, members: [{ name: 'Zach', userId: 'u3' }, { name: 'Kim' }] }],
    rounds: [r([10, 5], { detail: { entries: [{ idx: 0, name: 'Team 1', delta: 10, net: 10 }, { idx: 1, name: 'Team 2', delta: 5, net: 5 }] } })],
    participants: [{ name: 'Rand', user_id: 'u1', score: 10 }, { name: 'Audrey', score: 10 }, { name: 'Zach', user_id: 'u3', score: 5 }, { name: 'Kim', score: 5 }] };
  const out = RT.recomputeRecord(nz, { rounds: [{ index: 0, deltas: [3, 9] }] });
  assert.strictEqual(out.record.winner, 'Team 2'); assert.strictEqual(out.record.rounds[0].detail.entries[1].delta, 9);
  assert.deepStrictEqual(out.record.participants.map((p) => [p.score, p.is_winner]), [[3, false], [3, false], [9, true], [9, true]]);
  const sh = RT.buildSharedEdit(nz, out.record);
  assert.strictEqual(sh.participants.length, 4); assert.ok(sh.participants[2].is_winner); assert.ok(sh.winnerChanged);
  const lb = Social.computeGroupLeaderboard([out.record], [], { gameType: 'nertz' });
  const rows = Array.isArray(lb) ? lb : (lb.rows || lb.leaderboard || []);
  assert.ok(rows.some((x) => /zach/i.test(x.name || x.display_name || '') && x.wins === 1));
});
t('renames: guests ok and propagate; linked accounts refused; duplicates refused', () => {
  const rec = { type: 'flip7', players: [{ name: 'Audry', score: 5 }, { name: 'Rand', userId: 'u1', score: 3 }], rounds: [r([5, 3], { detail: { entries: [{ idx: 0, name: 'Audry' }] } })] };
  const ok = RT.recomputeRecord(rec, { players: [{ index: 0, name: 'Audrey' }] });
  assert.strictEqual(ok.record.winner, 'Audrey'); assert.strictEqual(ok.record.rounds[0].detail.entries[0].name, 'Audrey');
  assert.ok(!RT.recomputeRecord(rec, { players: [{ index: 1, name: 'Randy' }] }).ok);
  assert.ok(!RT.recomputeRecord(rec, { players: [{ index: 0, name: 'rand' }] }).ok);
});
t('permissions: creator edits, linked player read-only, local editable', () => {
  const rec = { type: 'flip7', created_by: 'u1', players: [{ name: 'Rand', userId: 'u1', score: 1 }, { name: 'Zach', userId: 'u3', score: 0 }], rounds: [r([1, 0])] };
  assert.deepStrictEqual(RT.canEditRecord(rec, { id: 'u1' }), { canEdit: true, readOnly: false, reason: 'creator' });
  assert.deepStrictEqual(RT.canEditRecord(rec, 'u3'), { canEdit: false, readOnly: true, reason: 'linked_player' });
  assert.strictEqual(RT.canEditRecord(rec, 'u9').reason, 'not_creator');
  assert.strictEqual(RT.canEditRecord({ players: [] }, null).canEdit, true);
  const denied = RT.recomputeRecord(rec, { rounds: [{ index: 0, deltas: [0, 5] }] }, { user: 'u3' });
  assert.ok(!denied.ok && /creator/.test(denied.errors[0]));
  assert.ok(RT.recomputeRecord(rec, { rounds: [{ index: 0, deltas: [0, 5] }] }, { user: 'u1' }).ok);
});
t('all 11 game keys describe without throwing (final-only)', () => {
  ['flip7', '7wonders', 'carcassonne', 'catan', 'ohhell', 'hearts', 'nertz', 'rummikub', 'qwirkle', 'spoons', 'other'].forEach((k) => {
    const d = RT.describeRecord({ type: k, players: [{ name: 'A', score: 3 }, { name: 'B', score: 1 }] });
    assert.strictEqual(d.gameKey, k); assert.strictEqual(d.players.length, 2);
  });
  assert.strictEqual(RT.gameKeyOf({ type: 'seven_wonders' }), '7wonders'); assert.strictEqual(RT.gameKeyOf({ type: 'custom' }), 'other');
});
t('shared row (participants) + leaderboard after edit', () => {
  const rec = { id: 'g1', type: 'flip7', created_by: 'u1', players: [{ name: 'Rand', user_id: 'u1', score: 5 }, { name: 'Zach', user_id: 'u3', score: 9 }],
    rounds: [r([5, 9])], winner: 'Zach' };
  const out = RT.recomputeRecord(rec, { rounds: [{ index: 0, deltas: [12, 9] }] }, { user: 'u1' });
  const sh = RT.buildSharedEdit(rec, out.record);
  assert.deepStrictEqual(sh.participants.map((p) => [p.user_id, p.score, p.is_winner]), [['u1', 12, true], ['u3', 9, false]]);
  assert.strictEqual(sh.game.winner, 'Rand'); assert.strictEqual(sh.game_id, 'g1');
  const lb = Social.computeGroupLeaderboard([out.record], [], { gameType: 'flip7' });
  const rows = Array.isArray(lb) ? lb : (lb.rows || lb.leaderboard || []);
  assert.ok(rows.some((x) => x.wins === 1 && /rand/i.test(x.name || x.display_name || '')));
});
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
