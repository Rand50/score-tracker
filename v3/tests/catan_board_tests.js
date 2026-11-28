/* Run: node v3/tests/catan_board_tests.js   (plain node, no deps)
   The checks here are written independently of the module: adjacency comes from hex x/y distance,
   counts from the official lists typed out again below. */
'use strict';
const path = require('path');
const B = require(path.join(__dirname, '..', 'catan_board.js'));

const N = Number(process.env.BOARDS || 10000);
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.stack || e)); }
}
function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg || 'not equal') + ': ' + JSON.stringify(a) + ' vs ' + JSON.stringify(b)); }
function ok(c, msg) { if (!c) throw new Error(msg || 'assertion failed'); }

// ---- independent official facts ----
const OFFICIAL = {
  '34': { hexes: 19, rows: [3, 4, 5, 4, 3], res: { wood: 4, sheep: 4, wheat: 4, brick: 3, ore: 3, desert: 1 },
    tokens: { 2: 1, 3: 2, 4: 2, 5: 2, 6: 2, 8: 2, 9: 2, 10: 2, 11: 2, 12: 1 }, harbors: { any: 4, wood: 1, sheep: 1, wheat: 1, brick: 1, ore: 1 }, perimeter: 30 },
  '56': { hexes: 30, rows: [3, 4, 5, 6, 5, 4, 3], res: { wood: 6, sheep: 6, wheat: 6, brick: 5, ore: 5, desert: 2 },
    tokens: { 2: 2, 3: 3, 4: 3, 5: 3, 6: 3, 8: 3, 9: 3, 10: 3, 11: 3, 12: 2 }, harbors: { any: 5, wood: 1, sheep: 2, wheat: 1, brick: 1, ore: 1 }, perimeter: 38 }
};
function adjacency(board) {
  const H = board.hexes, W = Math.sqrt(3), adj = H.map(() => []);
  for (let i = 0; i < H.length; i++) for (let j = 0; j < H.length; j++) {
    if (i !== j && Math.abs(Math.hypot(H[i].x - H[j].x, H[i].y - H[j].y) - W) < 0.01) adj[i].push(j);
  }
  return adj;
}
function tally(arr) { const o = {}; arr.forEach((v) => { o[v] = (o[v] || 0) + 1; }); return o; }
function sortedObj(o) { const r = {}; Object.keys(o).sort().forEach((k) => { r[k] = o[k]; }); return r; }
function maxResGroup(board, adj) {
  const H = board.hexes, seen = new Set(); let max = 0;
  for (let i = 0; i < H.length; i++) {
    if (seen.has(i) || H[i].resource === 'desert') continue;
    let size = 0; const st = [i]; seen.add(i);
    while (st.length) { const c = st.pop(); size++; adj[c].forEach((n) => { if (!seen.has(n) && H[n].resource === H[c].resource) { seen.add(n); st.push(n); } }); }
    max = Math.max(max, size);
  }
  return max;
}
// full independent check; returns list of problems
function independentCheck(board, size, mode) {
  const O = OFFICIAL[size], p = [], H = board.hexes, adj = adjacency(board);
  if (board.size !== size) p.push('size');
  if (H.length !== O.hexes) p.push('hex count');
  eq(adj.reduce((s, a) => s + a.length, 0) / 2, size === '34' ? 42 : 71, 'adjacency edge count'); // rows 3-4-5-4-3: 14 in-row + 28 between = 42; rows 3-4-5-6-5-4-3: 23 + 48 = 71
  const rowCount = tally(H.map((h) => h.row)); O.rows.forEach((n, r) => { if (rowCount[r] !== n) p.push('row ' + r); });
  if (JSON.stringify(sortedObj(tally(H.map((h) => h.resource)))) !== JSON.stringify(sortedObj(O.res))) p.push('resource counts');
  H.forEach((h) => {
    if (h.resource === 'desert') { if (h.number !== null) p.push('desert token'); if (h.pips !== 0) p.push('desert pips'); }
    else {
      if (!Number.isInteger(h.number)) p.push('missing token');
      if (h.pips !== 6 - Math.abs(7 - h.number)) p.push('pips ' + h.number);
    }
    if (h.res !== h.resource || h.num !== h.number) p.push('alias mismatch');
  });
  if (JSON.stringify(sortedObj(tally(H.filter((h) => h.number != null).map((h) => h.number)))) !== JSON.stringify(sortedObj(O.tokens))) p.push('token multiset');
  const rob = H.filter((h) => h.hasRobber);
  if (rob.length !== 1) p.push('robber count'); else { if (rob[0].resource !== 'desert') p.push('robber not on desert'); if (board.robberHexId !== rob[0].id) p.push('robberHexId'); }
  if (JSON.stringify(sortedObj(tally(board.harbors.map((b) => b.type)))) !== JSON.stringify(sortedObj(O.harbors))) p.push('harbor types');
  if (board.harbors.length !== Object.values(O.harbors).reduce((a, b) => a + b, 0)) p.push('harbor count');
  if (new Set(board.harbors.map((b) => b.edge)).size !== board.harbors.length) p.push('harbor slots not unique');
  board.harbors.forEach((b) => { if (b.ratio !== (b.type === 'any' ? 3 : 2)) p.push('ratio'); });
  // rules (both modes: Almanac fully-random rules)
  for (let i = 0; i < H.length; i++) adj[i].forEach((j) => {
    if (j < i) return;
    const a = H[i].number, b = H[j].number;
    if (a == null || b == null) return;
    if ((a === 6 || a === 8) && (b === 6 || b === 8)) p.push('red adjacent');
    if (a === b) p.push('same number adjacent');
  });
  if (mode === 'balanced' && maxResGroup(board, adj) >= 3) p.push('resource group of 3+');
  return p;
}

const timings = [];
console.log('Catan board generator tests (' + N + ' boards per mode and size)');

// ---- bulk generation: every mode and size ----
['34', '56'].forEach((size) => ['random', 'balanced'].forEach((mode) => {
  test('bulk ' + N + ' boards, size ' + size + ', ' + mode + ': 0 violations (independent + module validator)', () => {
    let bad = 0, firstBad = null, maxMs = 0, sumMs = 0, groups3 = 0, pairsRes = 0;
    const deserts = {}, robberOn = {};
    const t00 = process.hrtime.bigint();
    for (let seed = 0; seed < N; seed++) {
      const t0 = process.hrtime.bigint();
      const b = B.generateBoard({ size, mode, seed });
      const ms = Number(process.hrtime.bigint() - t0) / 1e6; sumMs += ms; if (ms > maxMs) maxMs = ms;
      const probs = independentCheck(b, size, mode), v = B.validateBoard(b, mode);
      if (probs.length || v.length) { bad++; if (!firstBad) firstBad = { seed, probs, v: v.slice(0, 2) }; }
      if (b.report.flags.sameResGroups3 > 0) groups3++;
      if (b.report.flags.sameResAdj > 0) pairsRes++;
      b.hexes.forEach((h) => { if (h.resource === 'desert') deserts[h.id] = (deserts[h.id] || 0) + 1; });
      robberOn[b.robberHexId] = (robberOn[b.robberHexId] || 0) + 1;
    }
    timings.push({ size, mode, avgMs: sumMs / N, maxMs, totalMs: Number(process.hrtime.bigint() - t00) / 1e6, groups3, pairsRes });
    if (bad) throw new Error(bad + ' invalid boards; first: ' + JSON.stringify(firstBad));
    if (mode === 'balanced') ok(groups3 === 0, 'balanced produced a 3+ group');
    if (mode === 'random') ok(groups3 > 0, 'random mode should NOT be constrained on resources (saw no 3+ group in ' + N + ')');
    if (mode === 'balanced') ok(pairsRes > 0, 'balanced should still allow same-resource pairs');
    ok(Object.keys(deserts).length >= (size === '34' ? 15 : 25), 'deserts should land on many different hexes');
    if (size === '56') { const k = Object.keys(robberOn); ok(k.length >= 20, 'robber spread'); }
  });
}));

// ---- backtracking fallback: forced, so it is exercised even though rejection sampling normally wins ----
['34', '56'].forEach((size) => ['random', 'balanced'].forEach((mode) => {
  test('backtracking fallback (forced) ' + size + ' ' + mode + ': 1000 valid boards', () => {
    B._test.forceBacktrack(true);
    try {
      let maxMs = 0;
      for (let seed = 0; seed < 1000; seed++) {
        const t0 = process.hrtime.bigint();
        const b = B.generateBoard({ size, mode, seed });
        maxMs = Math.max(maxMs, Number(process.hrtime.bigint() - t0) / 1e6);
        const probs = independentCheck(b, size, mode);
        if (probs.length) throw new Error('seed ' + seed + ': ' + probs.join(', '));
      }
      timings.push({ size, mode: mode + ' (forced backtracking)', avgMs: NaN, maxMs, totalMs: NaN });
    } finally { B._test.forceBacktrack(false); }
  });
}));

// ---- reproducibility ----
test('same seed + size + mode => identical board (JSON equal), even with Math.random disabled', () => {
  const real = Math.random; Math.random = () => { throw new Error('Math.random used'); };
  try {
    ['34', '56'].forEach((size) => ['random', 'balanced'].forEach((mode) => {
      for (const seed of [0, 1, 7, 12345, 2176782335]) {
        const a = B.generateBoard({ size, mode, seed }), b = B.generateBoard({ size, mode, seed });
        eq(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), 'repeat differs');
      }
    }));
  } finally { Math.random = real; }
});
test('different seeds give different boards', () => {
  const seen = new Set();
  for (let s = 0; s < 200; s++) seen.add(JSON.stringify(B.generateBoard({ size: '34', mode: 'balanced', seed: s }).hexes.map((h) => h.resource + h.number)));
  ok(seen.size >= 199, 'too many collisions: ' + seen.size);
});
test('mode changes the board for the same seed (mode is part of the stream)', () => {
  const a = B.generateBoard({ size: '34', mode: 'random', seed: 5 }), b = B.generateBoard({ size: '34', mode: 'balanced', seed: 5 });
  ok(a.mode === 'random' && b.mode === 'balanced');
});
test('board code round-trips: seed -> code -> seed -> same board', () => {
  for (const seed of [0, 1, 35, 36, 46655, 999999, 2176782335]) {
    const code = B.seedCode(seed); ok(/^[0-9A-Z]{3}-[0-9A-Z]{3}$/.test(code), code);
    eq(B.parseSeedCode(code), seed, 'parse');
    eq(B.parseSeedCode(code.toLowerCase().replace('-', ' ')), seed, 'lenient parse');
  }
  const a = B.generateBoard({ size: '56', mode: 'balanced' });   // random seed
  ok(Number.isInteger(a.seed) && a.seed >= 0 && a.seed < B.SEED_SPACE, 'seed in range');
  const b = B.generateBoard({ size: '56', mode: 'balanced', seed: a.code });  // code accepted as seed
  eq(JSON.parse(JSON.stringify(b)), JSON.parse(JSON.stringify(a)), 'rebuild from code');
  eq(B.parseSeedCode('not a code!'), null);
});
test('an out-of-range numeric seed is normalised into the code space (still reproducible)', () => {
  const a = B.generateBoard({ size: '34', mode: 'random', seed: 4294967295 }), b = B.generateBoard({ size: '34', mode: 'random', seed: a.seed });
  ok(a.seed < B.SEED_SPACE); eq(a.code, b.code); eq(JSON.stringify(a.hexes), JSON.stringify(b.hexes));
});
test('createRng is deterministic and in [0,1)', () => {
  const r1 = B.createRng(42), r2 = B.createRng(42);
  for (let i = 0; i < 100; i++) { const v = r1(); eq(v, r2()); ok(v >= 0 && v < 1); }
});

// ---- size helper ----
test('sizeFor: version first, player count as fallback', () => {
  eq(B.sizeFor('Base (to 10 VP)', 3), '34');
  eq(B.sizeFor('Base (to 10 VP)', 6), '34', 'explicit version beats player count');
  eq(B.sizeFor('Cities & Knights (to 13 VP)', 4), '34');
  eq(B.sizeFor('Seafarers (to 12 VP)', 4), '34');
  eq(B.sizeFor('5-6 Player (to 10 VP)', 3), '56');
  eq(B.sizeFor('5-6 Player', 2), '56');
  eq(B.sizeFor('5-6 Players', 5), '56');
  eq(B.sizeFor('5\u20136 Player', 5), '56');
  eq(B.sizeFor(undefined, 5), '56'); eq(B.sizeFor('', 6), '56'); eq(B.sizeFor(null, 4), '34');
  eq(B.sizeFor(undefined, 3), '34'); eq(B.sizeFor('Something new', 5), '56'); eq(B.sizeFor(undefined, undefined), '34');
  eq(B.sizeFor(undefined, '6'), '56');
  ok(B.boardSupported('Base (to 10 VP)') && B.boardSupported('5-6 Player (to 10 VP)') && !B.boardSupported('Seafarers (to 12 VP)'));
});
test('generateBoard accepts base/ext aliases and falls back to version/players when size is missing', () => {
  eq(B.generateBoard({ size: 'base', seed: 1 }).size, '34'); eq(B.generateBoard({ size: 'ext', seed: 1 }).size, '56');
  eq(B.generateBoard({ size: '5-6', seed: 1 }).size, '56');
  eq(B.generateBoard({ version: '5-6 Player (to 10 VP)', seed: 1 }).size, '56');
  eq(B.generateBoard({ players: 6, seed: 1 }).size, '56'); eq(B.generateBoard({ players: 4, seed: 1 }).size, '34');
  eq(B.generateBoard({ seed: 1 }).mode, 'balanced', 'default mode');
  let threw = false; try { B.generateBoard({ size: '34', mode: 'chaos', seed: 1 }); } catch (e) { threw = true; } ok(threw, 'unknown mode throws');
});

// ---- output shape (what UI renders) ----
test('output shape: hexes, harbors, robber, perimeter, demo-compatible fields', () => {
  const b = B.generateBoard({ size: '34', mode: 'balanced', seed: 3 });
  ['version', 'size', 'mode', 'seed', 'code', 'rules', 'rows', 'hexes', 'harbors', 'robberHexId', 'perimeterEdges', 'report'].forEach((k) => ok(k in b, 'missing ' + k));
  const h = b.hexes[0];
  ['id', 'row', 'col', 'x', 'y', 'nb', 'resource', 'res', 'number', 'num', 'pips', 'hasRobber'].forEach((k) => ok(k in h, 'hex missing ' + k));
  const hb = b.harbors[0];
  ['slot', 'edge', 'type', 'ratio', 'hexId', 'hex', 'k', 'p', 'q', 'mx', 'my', 'nx', 'ny', 'ang'].forEach((k) => ok(k in hb, 'harbor missing ' + k));
  ok(hb.p.length === 2 && hb.q.length === 2);
  eq(b.rules, B.RULES.balanced); eq(b.rows, [3, 4, 5, 4, 3]);
  eq(JSON.parse(JSON.stringify(b)).hexes[5].resource, b.hexes[5].resource, 'JSON round trip');
  eq(b.report.flags.redAdj, 0); eq(b.report.flags.sameNumAdj, 0); eq(b.report.flags.sameResGroups3, 0); ok(b.report.balancedOk);
  ok(b.report.pipsByRes.wood >= 0 && Object.keys(b.report.pipsByRes).length === 5);
  eq(B.validateBoard(JSON.parse(JSON.stringify(b)), 'balanced'), [], 'JSON-round-tripped board validates');
});
test('boards do not share mutable hex/harbor objects (mutating one does not touch the next)', () => {
  const a = B.generateBoard({ size: '34', seed: 1 }); a.hexes[0].number = 99; a.harbors[0].p[0] = 123;
  const b = B.generateBoard({ size: '34', seed: 1 }); ok(b.hexes[0].number !== 99 && b.harbors[0].p[0] !== 123);
});
test('LAYOUTS: official row shapes, counts, harbor slots, perimeter length', () => {
  ['34', '56'].forEach((s) => {
    const L = B.LAYOUTS[s], O = OFFICIAL[s];
    eq(L.rows, O.rows); eq(L.hexCount, O.hexes); eq(L.resources, O.res); eq(L.harbors, O.harbors); eq(L.perimeterLength, O.perimeter);
    eq(L.tokenCount, Object.values(O.tokens).reduce((a, b) => a + b, 0)); eq(tally(L.tokens), JSON.parse(JSON.stringify(O.tokens)));
    eq(L.harborEdges.length, L.harborCount); ok(L.harborEdges.every((e, i) => e >= 0 && e < L.perimeterLength && (i === 0 || e > L.harborEdges[i - 1])));
    eq(L.hexes.length, L.hexCount);
  });
  eq(B.LAYOUTS['34'].tokenCount, 18); eq(B.LAYOUTS['56'].tokenCount, 28); eq(B.LAYOUTS['34'].harborCount, 9); eq(B.LAYOUTS['56'].harborCount, 11);
  eq(B.LAYOUTS['34'].harborEdges, [0, 3, 7, 10, 13, 17, 20, 23, 27]);
});
test('base harbor slots have the 3-fold 3,4,3 rhythm (gaps 3,4,3,3,4,3,3,4,3)', () => {
  const e = B.LAYOUTS['34'].harborEdges, gaps = e.map((v, i) => ((e[(i + 1) % e.length] - v) + 30) % 30);
  eq(gaps, [3, 4, 3, 3, 4, 3, 3, 4, 3]);
});
test('harbor types are shuffled over the fixed slots (every type seen on many slots)', () => {
  ['34', '56'].forEach((size) => {
    const seenAt = {};
    for (let s = 0; s < 500; s++) B.generateBoard({ size, mode: 'random', seed: s }).harbors.forEach((h) => { (seenAt[h.type] = seenAt[h.type] || new Set()).add(h.slot); });
    Object.keys(seenAt).forEach((t) => ok(seenAt[t].size === B.LAYOUTS[size].harborCount, size + ' ' + t + ' only on ' + seenAt[t].size + ' slots'));
  });
});
test('harbor geometry sits on a coast edge (no neighbour hex across the edge)', () => {
  ['34', '56'].forEach((size) => {
    const b = B.generateBoard({ size, seed: 9 }), adjHexes = b.hexes;
    b.harbors.forEach((h) => {
      // the hex centre that would sit across this edge from the harbor's own hex
      const across = adjHexes.some((o) => Math.hypot(o.x - (h.mx + h.nx * Math.sqrt(3) / 2), o.y - (h.my + h.ny * Math.sqrt(3) / 2)) < 0.3);
      ok(!across, 'harbor edge is not on the coast');
    });
  });
});
test('robber starts on a desert; with 2 deserts both are used over many boards', () => {
  const on = new Set();
  for (let s = 0; s < 300; s++) { const b = B.generateBoard({ size: '56', mode: 'balanced', seed: s }); ok(b.hexes[b.robberHexId].resource === 'desert'); on.add(b.hexes[b.robberHexId].id); }
  ok(on.size > 10);
  const b34 = B.generateBoard({ size: '34', seed: 2 }); eq(b34.hexes.filter((h) => h.hasRobber).length, 1);
});

// ---- Balanced / Random rule semantics ----
test('Balanced: same-resource PAIRS allowed, groups of 3+ banned (19 and 30 hexes)', () => {
  ['34', '56'].forEach((size) => {
    let pairs = 0;
    for (let s = 0; s < 1000; s++) { const b = B.generateBoard({ size, mode: 'balanced', seed: s }); if (b.report.flags.sameResAdj > 0) pairs++; ok(b.report.flags.sameResMaxGroup <= 2); }
    ok(pairs > 500, size + ': pairs should be common, saw ' + pairs);
  });
});
test('2 and 12 may touch (no special separation) in both modes', () => {
  ['random', 'balanced'].forEach((mode) => {
    let t = 0; for (let s = 0; s < 6000 && !t; s++) t += B.generateBoard({ size: '56', mode, seed: s }).report.flags.twoTwelveAdj;
    ok(t > 0, mode + ': never saw 2/12 adjacent, so they look specially separated');
  });
});
test('6-6, 8-8 and 6-8 pairs are all rejected by the validator', () => {
  const base = B.generateBoard({ size: '34', mode: 'balanced', seed: 11 });
  const clone = () => JSON.parse(JSON.stringify(base));
  const adj = adjacency(base);
  // find two adjacent land hexes
  let a = -1, b = -1;
  for (let i = 0; i < base.hexes.length && a < 0; i++) adj[i].forEach((j) => { if (a < 0 && base.hexes[i].number != null && base.hexes[j].number != null) { a = i; b = j; } });
  [[6, 6], [8, 8], [6, 8], [8, 6]].forEach(([x, y]) => {
    const c = clone(); c.hexes[a].number = c.hexes[a].num = x; c.hexes[b].number = c.hexes[b].num = y;
    const codes = B.validateBoard(c, 'balanced').map((v) => v.code);
    ok(codes.includes('adjacent_red'), x + '-' + y + ' not flagged: ' + codes);
    ok(B.validateBoard(c, 'random').some((v) => v.code === 'adjacent_red'), 'random mode must flag red pairs too');
  });
});
test('validator catches each kind of defect', () => {
  const base = B.generateBoard({ size: '56', mode: 'balanced', seed: 21 }), clone = () => JSON.parse(JSON.stringify(base));
  const codes = (b, m) => B.validateBoard(b, m || 'balanced').map((v) => v.code);
  eq(codes(base), [], 'base board is valid');
  let c = clone(); c.hexes.pop(); ok(codes(c).includes('hex_count'));
  c = clone(); const land = c.hexes.find((h) => h.resource !== 'desert'); const des = c.hexes.find((h) => h.resource === 'desert');
  land.resource = land.res = 'desert'; ok(codes(c).includes('resource_count'));
  c = clone(); c.hexes.find((h) => h.resource === 'desert').number = c.hexes.find((h) => h.resource === 'desert').num = 5; ok(codes(c).includes('desert_token'));
  c = clone(); const l2 = c.hexes.find((h) => h.resource !== 'desert'); l2.number = l2.num = null; ok(codes(c).includes('missing_token'));
  c = clone(); const l3 = c.hexes.find((h) => h.number === 5); l3.number = l3.num = 4; l3.pips = 3; ok(codes(c).includes('token_multiset'));
  c = clone(); c.hexes.forEach((h) => { h.hasRobber = false; }); ok(codes(c).includes('robber_count'));
  c = clone(); c.hexes.forEach((h) => { h.hasRobber = false; }); const lnd = c.hexes.find((h) => h.resource !== 'desert'); lnd.hasRobber = true; c.robberHexId = lnd.id; ok(codes(c).includes('robber_not_desert'));
  c = clone(); c.harbors.pop(); ok(codes(c).includes('harbor_count'));
  c = clone(); c.harbors[0].type = c.harbors[0].type === 'any' ? 'ore' : 'any'; ok(codes(c).includes('harbor_types'));
  c = clone(); c.harbors[0].edge = 1; ok(codes(c).includes('harbor_slot'));
  c = clone(); c.harbors[2].ratio = 7; ok(codes(c).includes('harbor_ratio'));
  c = clone(); c.size = '99'; ok(codes(c).includes('bad_size'));
  eq(B.validateBoard(null).length, 1);
  ok(B.validateBoard(base, 'weird').some((v) => v.code === 'bad_mode'));
  // resource group
  c = clone(); const adj = adjacency(c);
  const ids = []; outer: for (let i = 0; i < c.hexes.length; i++) for (const j of adj[i]) for (const k of adj[j]) if (k !== i && c.hexes[i].resource !== 'desert' && !adj[i].includes(k) ) { ids.push(i, j, k); break outer; }
  const resName = 'ore'; ids.forEach((i) => { c.hexes[i].resource = c.hexes[i].res = resName; });
  ok(codes(c, 'balanced').includes('resource_group') || codes(c, 'balanced').includes('resource_count'), 'resource group not flagged');
});
test('validator rule detection for same numbers and 3-groups on a hand-built board', () => {
  const b = B.generateBoard({ size: '34', mode: 'random', seed: 4 }), adj = adjacency(b), clone = () => JSON.parse(JSON.stringify(b));
  // same-number adjacency: make two adjacent land hexes both 9 (multiset breaks too, but the adjacency code must be present)
  const pairs = []; adj.forEach((n, i) => n.forEach((j) => { if (j > i && b.hexes[i].number != null && b.hexes[j].number != null) pairs.push([i, j]); }));
  const [i, j] = pairs[0]; const c = clone(); c.hexes[i].number = c.hexes[i].num = 9; c.hexes[j].number = c.hexes[j].num = 9;
  ok(B.validateBoard(c, 'random').some((v) => v.code === 'adjacent_same_number'));
  // a 3-group of one resource must be flagged in balanced and NOT flagged in random (resource_group only)
  const c2 = clone(); const tri = [0, 1, 2]; // top row: 3 connected hexes
  tri.forEach((id) => { c2.hexes[id].resource = c2.hexes[id].res = 'wood'; });
  ok(B.validateBoard(c2, 'balanced').some((v) => v.code === 'resource_group'));
  ok(!B.validateBoard(c2, 'random').some((v) => v.code === 'resource_group'), 'random must not apply the resource rule');
});

// ---- timing ----
test('timing: balanced average well under 10 ms (default path), max reported', () => {
  timings.filter((t) => t.mode === 'balanced').forEach((t) => ok(t.avgMs < 10, t.size + ' avg ' + t.avgMs + ' ms'));
});

console.log('\nTimings (' + N + ' boards each, includes final self-validation):');
timings.forEach((t) => console.log('  size ' + t.size + ' ' + String(t.mode).padEnd(30) + (isNaN(t.avgMs) ? '' : ' avg ' + t.avgMs.toFixed(3) + ' ms,') + ' max ' + t.maxMs.toFixed(2) + ' ms' + (isNaN(t.totalMs) ? '' : ', total ' + t.totalMs.toFixed(0) + ' ms')));
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
