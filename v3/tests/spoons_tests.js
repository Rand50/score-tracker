const assert = require('assert');
const S = require('../spoons_scoring.js');
global.window = undefined;
const Social = require('../social_scoring.js');
const VC = require('../variations_catalog.js');
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('PASS', name); } catch (e) { fail++; console.log('FAIL', name, '-', e.message); } }

t('initState shape', () => {
  const s = S.initState(['Rand', 'Audrey', 'Zach', 'Kim']);
  assert.strictEqual(s.round, 1); assert.deepStrictEqual(s.active, ['Rand', 'Audrey', 'Zach', 'Kim']);
  assert.deepStrictEqual(s.eliminations, []); assert.strictEqual(s.gameKey, 'spoons');
  assert.throws(() => S.initState(['Solo'])); assert.throws(() => S.initState(['A', 'a']));
});
t('eliminate is pure, advances round, records {player, round}', () => {
  const s0 = S.initState(['Rand', 'Audrey', 'Zach']);
  const s1 = S.eliminate(s0, 'zach');
  assert.deepStrictEqual(s0.active.length, 3);
  assert.deepStrictEqual(s1.active, ['Rand', 'Audrey']); assert.strictEqual(s1.round, 2);
  assert.strictEqual(s1.eliminations[0].player, 'Zach'); assert.strictEqual(s1.eliminations[0].round, 1);
  assert.throws(() => S.eliminate(s1, 'Zach'), /already out/); assert.throws(() => S.eliminate(s1, 'Bob'), /Unknown/);
});
t('auto-finish when one remains; no more eliminations', () => {
  let s = S.initState(['Rand', 'Audrey', 'Zach']);
  s = S.eliminate(s, 2); s = S.eliminate(s, 'Rand');
  assert.ok(s.isGameOver); assert.deepStrictEqual(s.winnerNames, ['Audrey']); assert.deepStrictEqual(s.winnerIndices, [1]);
  assert.strictEqual(s.round, 2); assert.ok(s.finishedAt);
  assert.throws(() => S.eliminate(s, 'Audrey'), /over/); assert.ok(!S.canEliminate(s, 'Audrey'));
});
t('placement is reverse elimination order', () => {
  let s = S.initState(['A', 'B', 'C', 'D']);
  s = S.eliminate(s, 'C'); s = S.eliminate(s, 'A'); s = S.eliminate(s, 'D');
  const st = S.getStandings(s);
  assert.deepStrictEqual(st.map((r) => [r.name, r.place, r.score]), [['B', 1, 3], ['D', 2, 2], ['A', 3, 1], ['C', 4, 0]]);
  assert.ok(st[0].isWinner);
});
t('mid-game standings: active players tied at 1st', () => {
  let s = S.initState(['A', 'B', 'C', 'D']); s = S.eliminate(s, 'B');
  assert.deepStrictEqual(S.getStandings(s).map((r) => [r.name, r.place]), [['A', 1], ['C', 1], ['D', 1], ['B', 4]]);
});
t('undo restores seat order, round, and un-finishes the game; full history kept', () => {
  let s = S.initState(['A', 'B', 'C']);
  s = S.eliminate(s, 'A'); s = S.eliminate(s, 'C');
  assert.ok(s.isGameOver);
  s = S.undoLastElimination(s);
  assert.ok(!s.isGameOver); assert.deepStrictEqual(s.winnerNames, []); assert.strictEqual(s.round, 2);
  assert.deepStrictEqual(s.active, ['B', 'C']);
  s = S.undoLastElimination(s);
  assert.deepStrictEqual(s.active, ['A', 'B', 'C']); assert.strictEqual(s.round, 1);
  assert.throws(() => S.undoLastElimination(s), /Nothing/);
  assert.deepStrictEqual(S.getHistory(s).map((h) => h.action + ':' + h.player), ['eliminate:A', 'eliminate:C', 'undo:C', 'undo:A']);
});
t('toGameRecord matches shared format and feeds leaderboard', () => {
  let s = S.initState([{ name: 'Rand', userId: 'u1' }, 'Audrey', 'Zach']);
  s = S.eliminate(s, 'Zach'); s = S.eliminate(s, 'Audrey');
  const rec = S.toGameRecord(s, { id: 'g1' });
  assert.strictEqual(rec.type, 'spoons'); assert.strictEqual(rec.game_key, 'spoons'); assert.strictEqual(rec.id, 'g1');
  assert.deepStrictEqual(rec.winnerNames, ['Rand']); assert.strictEqual(rec.players[0].userId, 'u1');
  assert.deepStrictEqual(rec.rounds, [{ round: 1, eliminated: 'Zach' }, { round: 2, eliminated: 'Audrey' }]);
  const lb = Social.computeGroupLeaderboard([rec], [], { gameType: 'spoons' });
  const rows = Array.isArray(lb) ? lb : (lb.rows || lb.leaderboard || []);
  const rand = rows.find((r) => /rand/i.test(r.name || r.display_name || ''));
  assert.ok(rand, 'Rand on leaderboard'); assert.strictEqual(rand.wins, 1);
});
t('game key registered', () => {
  assert.strictEqual(VC.normalizeGameKey('spoons'), 'spoons');
});
t('player linking works on spoons record', () => {
  const L = require('../player_linking.js');
  let s = S.initState(['Rand', 'Audry', 'Zach']); s = S.eliminate(s, 'Zach'); s = S.eliminate(s, 'Rand');
  const rec = S.toGameRecord(s, { id: 'g2' });
  const out = L.linkParticipant(rec, 'Audry', { id: 'u2', name: 'Audrey Wilkinson' }, { fuzzy: true });
  const r = out.record || out;
  assert.ok(JSON.stringify(r).includes('u2')); assert.ok(JSON.stringify(r.winnerNames).includes('Audrey Wilkinson'));
});

const asyncTests = [];
function ta(name, fn) { asyncTests.push([name, fn]); }
ta('UI contract: start/knockOut/undo/getState/finishAndSave + onChange', async () => {
  const store = {}; global.localStorage = { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } };
  let events = 0; const off = S.onChange(() => events++);
  let v = S.start(['Rand', 'Audrey', 'Zach']);
  assert.deepStrictEqual(v.players.map((p) => p.id), ['p0', 'p1', 'p2']); assert.strictEqual(v.winnerId, null);
  v = S.knockOut('p2');
  assert.strictEqual(v.players[2].outRound, 1); assert.deepStrictEqual(v.history, [{ round: 1, outPlayerId: 'p2' }]);
  assert.ok(store[S.LS_KEY]);
  v = S.undo(); assert.strictEqual(v.players[2].outRound, null); assert.strictEqual(v.round, 1);
  S.knockOut('p2'); v = S.knockOut('p0');
  assert.strictEqual(v.winnerId, 'p1'); assert.ok(v.isGameOver);
  let saved = null; const rec = await S.finishAndSave({ save: async (r) => { saved = r; } });
  assert.strictEqual(saved, rec); assert.strictEqual(rec.game_key, 'spoons'); assert.deepStrictEqual(rec.winnerNames, ['Audrey']);
  assert.strictEqual(S.getState(), null); assert.ok(!store[S.LS_KEY]);
  assert.strictEqual(events, 6); off();
});
ta('resume from localStorage', async () => {
  S.start(['A', 'B', 'C']); S.knockOut('p1');
  const raw = global.localStorage.getItem(S.LS_KEY); S.reset(); global.localStorage.setItem(S.LS_KEY, raw);
  const v = S.resume(); assert.strictEqual(v.players[1].outRound, 1);
  await assert.rejects(() => S.finishAndSave(), /not finished/); S.reset();
});
ta('restore() from getState() view and raw state', async () => {
  let events = 0; const off = S.onChange(() => events++);
  S.start(['A', 'B', 'C', 'D']); S.knockOut('p2'); S.knockOut('p0');
  const view = S.getState(), raw = S.getRawState(); S.reset();
  let v = S.restore(view);
  assert.deepStrictEqual(v.history, view.history); assert.strictEqual(v.round, 3); assert.ok(global.localStorage.getItem(S.LS_KEY));
  v = S.undo(); assert.strictEqual(v.players[0].outRound, null);
  S.reset(); v = S.restore(raw); assert.deepStrictEqual(v.history, view.history);
  assert.ok(events >= 6); off(); S.reset();
});
(async () => {
  for (const [n, fn] of asyncTests) { try { await fn(); pass++; console.log('PASS', n); } catch (e) { fail++; console.log('FAIL', n, '-', e.message); } }
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
