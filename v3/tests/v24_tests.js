const assert = require('assert');
const Q = require('../qwirkle_scoring.js');
const HR = require('../house_rules.js');
const L = require('../player_linking.js');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };

console.log('Qwirkle');
t('init: 108 minus opening hands, rotation from startingPlayer', () => {
  const s = Q.initState(['Rand', 'Audrey', 'Zach'], { startingPlayer: 1 });
  assert.strictEqual(s.tilesInBag, 108 - 18);
  assert.strictEqual(s.currentPlayerIndex, 1);
  assert.deepStrictEqual(s.rules, { qwirkleBonus: 6, wentOutBonus: 6, targetScore: 0, trackBag: true, lowWins: false });
});
t('scoring: line points, +6 per Qwirkle, rotation, bag draws', () => {
  const s = Q.initState(['Rand', 'Audrey']);
  let r = Q.scoreTurn(s, 0, 5, { tilesPlayed: 2 });
  assert.ok(r.ok); assert.strictEqual(s.players[0].score, 5); assert.strictEqual(s.currentPlayerIndex, 1); assert.strictEqual(s.tilesInBag, 94);
  r = Q.scoreTurn(s, null, 12, { qwirkles: 1, tilesPlayed: 3 }); // current player = Audrey
  assert.strictEqual(r.turn.total, 18); assert.strictEqual(s.players[1].score, 18); assert.strictEqual(s.tilesInBag, 91);
  r = Q.scoreTurn(s, 0, 24, { qwirkles: 2 });
  assert.strictEqual(r.turn.total, 36);
});
t('validation: negative pts, too few pts for qwirkles, turn order, going out with tiles left', () => {
  const s = Q.initState(['A', 'B']);
  assert.strictEqual(Q.scoreTurn(s, 0, -1).ok, false);
  assert.strictEqual(Q.scoreTurn(s, 0, 5, { qwirkles: 1 }).ok, false);
  assert.strictEqual(Q.scoreTurn(s, 1, 5, { enforceTurnOrder: true }).ok, false);
  const out = Q.scoreTurn(s, 0, 5, { wentOut: true });
  assert.strictEqual(out.ok, false); assert.ok(/bag is empty/.test(out.error));
});
t('going out: +6 bonus, ends game, highest wins, blocks further turns', () => {
  const s = Q.initState(['A', 'B'], { tilesInBag: 3 });
  Q.scoreTurn(s, 0, 10, { tilesPlayed: 3 });
  assert.strictEqual(s.tilesInBag, 0);
  Q.scoreTurn(s, 1, 8);
  const r = Q.scoreTurn(s, 0, 4, { wentOut: true });
  assert.strictEqual(r.turn.wentOutBonus, 6); assert.strictEqual(s.players[0].score, 20);
  assert.ok(s.isGameOver); assert.strictEqual(s.endReason, 'went_out'); assert.deepStrictEqual(s.winnerNames, ['A']);
  assert.strictEqual(Q.scoreTurn(s, 1, 3).ok, false);
});
t('undo restores scores, bag, rotation, and reopens a finished game', () => {
  const s = Q.initState(['A', 'B'], { tilesInBag: 0 });
  Q.scoreTurn(s, 0, 7, { qwirkles: 1 });
  Q.scoreTurn(s, 1, 3, { wentOut: true });
  assert.ok(s.isGameOver);
  let u = Q.undoLastTurn(s);
  assert.ok(u.ok); assert.strictEqual(s.isGameOver, false); assert.strictEqual(s.players[1].score, 0); assert.strictEqual(s.currentPlayerIndex, 1);
  u = Q.undoLastTurn(s);
  assert.strictEqual(s.players[0].qwirkles, 0); assert.strictEqual(s.history.length, 0);
  assert.strictEqual(Q.undoLastTurn(s).ok, false);
});
t('history, standings with ties, stats (best turn, total Qwirkles)', () => {
  const s = Q.initState(['A', 'B', 'C']);
  Q.scoreTurn(s, 0, 6, { qwirkles: 1 }); // 12
  Q.scoreTurn(s, 1, 12);                 // 12
  Q.passTurn(s, 2);                      // 0
  Q.scoreTurn(s, 0, 15, { qwirkles: 1 }); // 21 -> A 33
  const h = Q.getHistory(s); assert.strictEqual(h.length, 4); assert.ok(!('_snapshot' in h[0]));
  const st = Q.getStandings(s);
  assert.deepStrictEqual(st.map((r) => [r.name, r.rank]), [['A', 1], ['B', 2], ['C', 3]]);
  const stats = Q.getStats(s);
  assert.strictEqual(stats.totalQwirkles, 2); assert.strictEqual(stats.bestTurn.total, 21); assert.strictEqual(stats.bestTurn.playerName, 'A');
  const s2 = Q.initState(['X', 'Y']); Q.scoreTurn(s2, 0, 5); Q.scoreTurn(s2, 1, 5);
  assert.deepStrictEqual(Q.getStandings(s2).map((r) => r.rank), [1, 1]);
});
t('house rules: schema, overrides, target score end, bag tracking off', () => {
  assert.deepStrictEqual(HR.getDefaultRules('qwirkle'), { wentOutBonus: 6, qwirkleBonus: 6, targetScore: 0, trackBag: true });
  const so = HR.buildScoringOverrides('qwirkle', { wentOutBonus: 10, qwirkleBonus: 12, targetScore: 50, trackBag: false });
  const s = Q.initState({ players: ['A', 'B'], scoringOverrides: so });
  assert.strictEqual(s.rules.wentOutBonus, 10); assert.strictEqual(s.rules.qwirkleBonus, 12); assert.strictEqual(s.tilesInBag, null);
  Q.scoreTurn(s, 0, 30, { qwirkles: 1 }); // 42
  assert.ok(!s.isGameOver);
  Q.scoreTurn(s, 1, 6, { wentOut: true }); // bag off -> allowed, 16
  assert.ok(s.isGameOver); assert.deepStrictEqual(s.winnerNames, ['A']);
  const s3 = Q.initState(['A', 'B'], { houseRules: { targetScore: 20 } });
  Q.scoreTurn(s3, 0, 22); assert.strictEqual(s3.endReason, 'target');
  assert.ok(HR.describeDifferences('qwirkle', { wentOutBonus: 10 })[0].includes('+10'));
});
t('toGameRecord feeds SocialScoring winners', () => {
  const S = require('../social_scoring.js');
  const s = Q.initState(['A', 'B'], { tilesInBag: 0 }); Q.scoreTurn(s, 0, 4); Q.scoreTurn(s, 1, 9, { wentOut: true });
  const rec = Q.toGameRecord(s);
  assert.deepStrictEqual(S.computeWinnersForGame(rec).winnerNames, ['B']);
});

console.log('Player linking');
const rand = { userId: 'u-rand', displayName: 'Rand Wilkinson' };
const audrey = { userId: 'u-aud', displayName: 'Audrey Wilkinson' };
const local1 = { id: 'g1', type: 'catan', endTime: '2026-11-01T00:00:00Z', players: [{ name: 'Rand Wilkinson', userId: 'u-rand', score: 10 }, { name: 'audrey', score: 8 }], winnerNames: ['Rand Wilkinson'] };
const local2 = { id: 'g2', type: 'flip7', endTime: '2026-11-05T00:00:00Z', players: ['Audry', 'Zach'], winnerNames: ['Audry'] };
const shared1 = { id: 's1', game_type: 'hearts', played_at: '2026-11-10T00:00:00Z', winner_names: ['Audrey W.'], participants: [{ user_id: 'u-rand', display_name: 'Rand Wilkinson', score: 60, is_winner: false }, { user_id: null, display_name: 'Audrey W.', score: 40, is_winner: true, meta: { is_guest: true } }] };
const nertz = { id: 's2', game_type: 'nertz', played_at: '2026-11-12T00:00:00Z', winner_names: ['Rand & Audrey'], participants: [{ display_name: 'Rand & Audrey', score: 120, is_winner: true, members: [{ user_id: 'u-rand', display_name: 'Rand Wilkinson' }, { user_id: null, display_name: 'Audrey' }] }, { display_name: 'Zach & Sam', score: 90, is_winner: false, members: [{ display_name: 'Zach' }, { display_name: 'Sam' }] }] };
const other = { id: 'g3', type: 'catan', endTime: '2026-11-15T00:00:00Z', players: [{ name: 'Bob', score: 10 }, { name: 'Zach', score: 4 }] };
const all = [local1, local2, shared1, nertz, other];

t('nameSimilarity: exact, first-name, initial, typo, unrelated', () => {
  assert.strictEqual(L.nameSimilarity('AUDREY', 'audrey').score, 1);
  assert.strictEqual(L.nameSimilarity('Audrey', 'Audrey Wilkinson').reason, 'first_name');
  assert.strictEqual(L.nameSimilarity('Audrey W.', 'Audrey Wilkinson').score, 0.9);
  assert.ok(L.nameSimilarity('Audry', 'Audrey').score >= 0.8);
  assert.ok(L.nameSimilarity('Bob', 'Audrey').score < 0.5);
});
t('suggestMatchingGames finds guest slots across local, shared, Nertz team members', () => {
  const s = L.suggestMatchingGames(audrey, all);
  assert.deepStrictEqual(s.map((x) => x.recordId).sort(), ['g1', 'g2', 's1', 's2']);
  const nz = s.find((x) => x.recordId === 's2');
  assert.strictEqual(nz.matches[0].memberIndex, 1); assert.strictEqual(nz.source, 'shared');
  assert.ok(!s.some((x) => x.recordId === 'g3'));
  // Already-linked games are skipped for that user
  assert.strictEqual(L.suggestMatchingGames(rand, all).length, 0);
});
t('linkParticipant (local): case-insensitive, pure, renames winners', () => {
  const r = L.linkParticipant(local1, 'AUDREY', audrey);
  assert.ok(r.ok); assert.notStrictEqual(r.record, local1); assert.strictEqual(local1.players[1].userId, undefined);
  assert.deepStrictEqual([r.record.players[1].name, r.record.players[1].userId, r.record.players[1].linkedFromGuest], ['Audrey Wilkinson', 'u-aud', 'audrey']);
  const r2 = L.linkParticipant(local2, 'Audrey', audrey, { fuzzy: true });
  assert.ok(r2.ok); assert.deepStrictEqual(r2.record.players[0], { name: 'Audrey Wilkinson', userId: 'u-aud', isGuest: false, linkedFromGuest: 'Audry' });
  assert.deepStrictEqual(r2.record.winnerNames, ['Audrey Wilkinson']);
  assert.strictEqual(L.linkParticipant(local2, 'Audrey', audrey).ok, false); // not fuzzy -> no exact match
});
t('linkParticipant (shared + Nertz member): sets user_id/display_name/meta, updates team label', () => {
  const r = L.linkParticipant(shared1, { index: 1 }, audrey);
  const p = r.record.participants[1];
  assert.deepStrictEqual([p.user_id, p.display_name, p.meta.is_guest, p.meta.linked_from_guest], ['u-aud', 'Audrey Wilkinson', false, 'Audrey W.']);
  assert.deepStrictEqual(r.record.winner_names, ['Audrey Wilkinson']);
  const n2 = L.linkParticipant(nertz, { index: 0, memberIndex: 1 }, audrey);
  assert.ok(n2.ok);
  assert.strictEqual(n2.record.participants[0].members[1].user_id, 'u-aud');
  assert.strictEqual(n2.record.participants[0].display_name, 'Rand & Audrey Wilkinson');
  assert.strictEqual(L.linkParticipant(nertz, { index: 0 }, audrey).ok, false); // team row itself
});
t('linkParticipant guards: already linked elsewhere, user already in game, missing ids', () => {
  assert.ok(/already linked/.test(L.linkParticipant(local1, 'Rand Wilkinson', audrey).error));
  assert.ok(/already a participant/.test(L.linkParticipant(local1, 'audrey', rand).error));
  assert.strictEqual(L.linkParticipant(local1, 'audrey', { displayName: 'X' }).ok, false);
  assert.strictEqual(L.linkParticipant(local1, 'nobody', audrey).ok, false);
});
t('linkAcrossRecords + recomputeAfterLink: leaderboard merges guest history into the account', () => {
  const before = L.recomputeAfterLink(all);
  const audBefore = before.leaderboard.filter((r) => /aud/i.test(r.name));
  assert.ok(audBefore.length >= 2); // split across guest spellings
  const sugg = L.suggestMatchingGames(audrey, all);
  const res = L.linkAcrossRecords(all, sugg, audrey);
  assert.strictEqual(res.linked.length, 4); assert.strictEqual(res.errors.length, 0);
  assert.strictEqual(all[1].players[0], 'Audry'); // originals untouched
  const after = L.recomputeAfterLink(res.records);
  const st = after.playerStats('u-aud');
  assert.strictEqual(st.name, 'Audrey Wilkinson'); assert.strictEqual(st.gamesPlayed, 4); assert.strictEqual(st.wins, 3);
  assert.strictEqual(after.leaderboard.filter((r) => /aud/i.test(r.name)).length, 1);
  assert.strictEqual(st.perGame.nertz.wins, 1); assert.strictEqual(st.perGame.catan.gamesPlayed, 1);
  const upd = L.buildSharedLinkUpdates(res.linked.filter((l) => l.recordId.startsWith('s')), audrey);
  assert.deepStrictEqual(upd.map((u) => [u.game_id, u.participant_index, u.member_index]).sort(), [['s1', 1, null], ['s2', 0, 1]]);
});

console.log(`\nALL ${n} v24 TESTS PASSED`);
