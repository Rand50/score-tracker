/* ==========================================================================
   TallyIt v27 - Catan board generator (window.TallyItCatanBoard + module.exports)
   Pure logic: no DOM, no storage, no Date/Math.random except to pick a seed
   when the caller does not pass one. Same seed + size + mode => same board.

   OFFICIAL SOURCES (opened 28 Nov 2026)
   - Base rules + Almanac (catan.com 2021-06 catan_base_rules_2020_200707.pdf, 2024-01 Almanac):
       19 land hexes (4 wood/forest, 4 sheep/pasture, 4 wheat/fields, 3 brick/hills, 3 ore/mountains,
       1 desert), 18 number tokens (2, 3x2, 4x2, 5x2, 6x2, 8x2, 9x2, 10x2, 11x2, 12), 9 harbor pieces
       (4 generic 3:1 + one 2:1 per resource) "randomly placed, one on top of each harbor on the frame".
       Robber starts in the desert.
       Almanac, Set-up Variable Board, 4b "fully random": the red numbers (6 and 8) must never be on
       adjacent hexes, AND no two adjacent hexes may carry the same number.
   - 5-6 Player Extension (catan.com 2024-02 CATAN_5-6 Player Extension.pdf):
       +11 hexes (1 desert, 2 each resource) => 30 hexes, 2 deserts; ONLY the extension's 28 number
       tokens are used (2x2, 3x3, 4x3, 5x3, 6x3, 8x3, 9x3, 10x3, 11x3, 12x2); +2 harbor pieces
       (1 generic 3:1, 1 wool 2:1) => 11 harbors "randomly placed on each harbor on the frame";
       robber goes on any ONE desert. Illustration A shows rows 3-4-5-6-5-4-3.

   GEOMETRY (matches the mockup generator UI already renders)
   - Pointy-top hexes, rows laid out horizontally. Unit hex circumradius 1, centre-to-centre sqrt(3).
   - x = (col - (rowLen-1)/2) * sqrt(3);  y = (row - (rows-1)/2) * 1.5.  Hex ids are row-major from 0.
   - Perimeter edge k of a hex joins corner k and k+1 (corner angle -90 + 60k, clockwise on screen).
     Perimeter edges are ordered clockwise starting at the NW edge of hex 0 (edge index 0).
   - HARBOR SLOTS (perimeter edge indices; 1 harbor per edge, shown outside the coast):
       base 3-4: [0,3,7,10,13,17,20,23,27]  (30 edges; 3-fold symmetric rhythm 3,4,3 | 3,4,3 | 3,4,3),
                 measured from the ship positions on the frame in the base rules, Illustration R.
       ext  5-6: [0,3,7,12,15,17,21,24,27,29,33] (38 edges; gaps 3,4,5,3,2,4,3,3,2,4,5), traced from the
                 11 ships on the extension frame in Illustration A. Which TYPE sits on which slot is random
                 (the rules say so); the slot positions are traced by eye from a printed illustration, so
                 treat them as +-1 edge accurate.

   RULES BY MODE (see RULES)
   - random   : the Almanac's "fully random" method: no 6/8 adjacent (6-6, 8-8, 6-8) and no two equal
                numbers adjacent. Resources, harbors, desert and robber are otherwise fully random.
   - balanced : random + no connected group of 3 or more hexes of the same resource (pairs allowed).
                No pip cap, no special 2/12 rule. Deserts carry no token.
   ========================================================================== */
(function (global) {
  'use strict';

  var VERSION = 27;
  var RES = ['wood', 'sheep', 'wheat', 'brick', 'ore'];
  // Board codes drop 0/O/1/I/L. 31^6 still fits in a 6-char XXX-XXX code.
  // Seeds are 0..SEED_SPACE-1 so every seed round-trips. Legacy base-36 codes are not decoded.
  var CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  var SEED_SPACE = 887503681; // 31^6
  var SQRT3 = Math.sqrt(3);

  var RULES = {
    random:   ['noAdjacentRed', 'noAdjacentSameNumber'],
    balanced: ['noAdjacentRed', 'noAdjacentSameNumber', 'noSameResourceGroup']
  };
  var MODES = ['random', 'balanced'];

  // ---- official content ----------------------------------------------------
  var SPEC = {
    '34': {
      size: '34', label: '3-4 players', rows: [3, 4, 5, 4, 3],
      resources: { wood: 4, sheep: 4, wheat: 4, brick: 3, ore: 3, desert: 1 },
      tokens: [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12],
      harbors: { any: 4, wood: 1, sheep: 1, wheat: 1, brick: 1, ore: 1 },
      harborEdges: [0, 3, 7, 10, 13, 17, 20, 23, 27]
    },
    '56': {
      size: '56', label: '5-6 players', rows: [3, 4, 5, 6, 5, 4, 3],
      resources: { wood: 6, sheep: 6, wheat: 6, brick: 5, ore: 5, desert: 2 },
      tokens: [2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6, 8, 8, 8, 9, 9, 9, 10, 10, 10, 11, 11, 11, 12, 12],
      harbors: { any: 5, wood: 1, sheep: 2, wheat: 1, brick: 1, ore: 1 },
      harborEdges: [0, 3, 7, 12, 15, 17, 21, 24, 27, 29, 33]
    }
  };

  function sumVals(o) { var s = 0; for (var k in o) s += o[k]; return s; }

  // ---- seeded RNG (mulberry32) --------------------------------------------
  function createRng(seed) {
    var a = (seed >>> 0);
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, rand) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function shuffleInPlace(a, rand) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // ---- seeds & board codes -------------------------------------------------
  function seedCode(seed) {
    var n = (seed >>> 0) % SEED_SPACE;
    var c = '';
    for (var i = 0; i < 6; i++) {
      c = CODE_ALPHABET.charAt(n % 31) + c;
      n = Math.floor(n / 31);
    }
    return c.slice(0, 3) + '-' + c.slice(3);
  }
  function parseSeedCode(code) {
    // A raw integer still takes the old path: stringify, then parse if it is 1-6 base-36 digits.
    if (typeof code === 'number') {
      var raw = String(code).replace(/[\s-]/g, '').toUpperCase();
      if (!/^[0-9A-Z]{1,6}$/.test(raw)) return null;
      var parsed = parseInt(raw, 36);
      return isFinite(parsed) ? parsed : null;
    }
    var c = String(code == null ? '' : code).trim().replace(/[\s-]/g, '').toUpperCase();
    if (c.length < 1 || c.length > 6) return null;
    var n = 0;
    for (var i = 0; i < c.length; i++) {
      var d = CODE_ALPHABET.indexOf(c.charAt(i));
      if (d < 0) return null;
      n = n * 31 + d;
    }
    return n;
  }
  function normalizeSeed(seed) {
    if (typeof seed === 'string') {
      var p = parseSeedCode(seed);
      if (p != null) return p;
      return null;
    }
    if (typeof seed === 'number' && isFinite(seed)) return Math.floor(Math.abs(seed)) % SEED_SPACE;
    return null;
  }
  function randomSeed() { return Math.floor(Math.random() * SEED_SPACE); }

  // ---- size helper ---------------------------------------------------------
  function normalizeSize(size) {
    var s = String(size == null ? '' : size).toLowerCase().replace(/[\s_-]/g, '');
    if (s === '34' || s === 'base' || s === '3' || s === '4') return '34';
    if (s === '56' || s === 'ext' || s === 'extension' || s === '5' || s === '6') return '56';
    return null;
  }
  // Version picker labels: 'Base (to 10 VP)', 'Cities & Knights (to 13 VP)', 'Seafarers (to 12 VP)',
  // '5-6 Player (to 10 VP)'. A recognised version wins; otherwise 5+ players => 5-6 board.
  function sizeFor(version, playerCount) {
    var v = String(version == null ? '' : version).toLowerCase();
    if (/(^|[^0-9])5\s*[-\u2013 ]?\s*6/.test(v) || /extension/.test(v)) return '56';
    if (/base|cities|knights|seafarer|c\s*&\s*k/.test(v)) return '34';
    var n = Number(playerCount);
    return n >= 5 ? '56' : '34';
  }
  // Seafarers uses its own scenario frames; the 3-4 / 5-6 land board does not fit it.
  function boardSupported(version) { return !/seafarer/i.test(String(version == null ? '' : version)); }

  // ---- geometry (built once) ----------------------------------------------
  function buildGeometry(spec) {
    var rows = spec.rows, hexes = [], i, r;
    rows.forEach(function (n, row) {
      for (i = 0; i < n; i++) {
        hexes.push({ id: hexes.length, row: row, col: i,
          x: (i - (n - 1) / 2) * SQRT3, y: (row - (rows.length - 1) / 2) * 1.5, nb: [] });
      }
    });
    hexes.forEach(function (h) {
      hexes.forEach(function (o) {
        if (o !== h && Math.hypot(o.x - h.x, o.y - h.y) < SQRT3 * 1.05) h.nb.push(o.id);
      });
    });
    function corner(h, k) { var a = (-90 + 60 * k) * Math.PI / 180; return [h.x + Math.cos(a), h.y + Math.sin(a)]; }
    var raw = [];
    hexes.forEach(function (h) {
      for (var k = 0; k < 6; k++) {
        var na = (-60 + 60 * k) * Math.PI / 180, nx = h.x + Math.cos(na) * SQRT3, ny = h.y + Math.sin(na) * SQRT3;
        if (hexes.some(function (o) { return Math.hypot(o.x - nx, o.y - ny) < 0.3; })) continue;
        var p = corner(h, k), q = corner(h, (k + 1) % 6);
        var mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
        raw.push({ hex: h.id, k: k, p: p, q: q, mx: mx, my: my, nx: Math.cos(na), ny: Math.sin(na), ang: Math.atan2(my, mx) });
      }
    });
    function same(u, v) { return Math.hypot(u[0] - v[0], u[1] - v[1]) < 1e-6; }
    var cur = raw.filter(function (e) { return e.hex === 0 && e.k === 5; })[0] || raw[0];
    var ordered = [cur], left = raw.filter(function (e) { return e !== cur; });
    while (left.length) {
      var idx = -1;
      for (var j = 0; j < left.length; j++) if (same(left[j].p, cur.q)) { idx = j; break; }
      if (idx < 0) throw new Error('perimeter not contiguous');
      cur = left.splice(idx, 1)[0]; ordered.push(cur);
    }
    ordered.forEach(function (e, n) { e.edge = n; });
    // adjacency pairs (a < b) for fast checks
    var pairs = [];
    hexes.forEach(function (h) { h.nb.forEach(function (j) { if (j > h.id) pairs.push([h.id, j]); }); });
    return { hexes: hexes, perimeterEdges: ordered, pairs: pairs };
  }

  var GEO = {};
  var LAYOUTS = {};
  Object.keys(SPEC).forEach(function (key) {
    var s = SPEC[key], g = buildGeometry(s);
    if (sumVals(s.resources) !== g.hexes.length) throw new Error('layout ' + key + ': resource total != hex count');
    if (s.harborEdges.length !== sumVals(s.harbors)) throw new Error('layout ' + key + ': harbor slot count mismatch');
    GEO[key] = g;
    LAYOUTS[key] = {
      size: key, label: s.label, rows: s.rows.slice(), hexCount: g.hexes.length,
      resources: Object.assign({}, s.resources), tokens: s.tokens.slice(),
      tokenCount: s.tokens.length, harbors: Object.assign({}, s.harbors),
      harborCount: s.harborEdges.length, harborEdges: s.harborEdges.slice(),
      perimeterLength: g.perimeterEdges.length,
      hexes: g.hexes.map(function (h) { return { id: h.id, row: h.row, col: h.col, x: h.x, y: h.y, nb: h.nb.slice() }; })
    };
  });

  function pips(n) { return (n === 6 || n === 8) ? 5 : (n >= 2 && n <= 12 && n !== 7) ? 6 - Math.abs(7 - n) : 0; }
  function isRed(n) { return n === 6 || n === 8; }

  // ---- generation ---------------------------------------------------------
  var RES_TRIES = 4000, TOK_TRIES = 4000, BT_BUDGET = 20000, BT_RESTARTS = 400;
  var forceBacktrack = false; // test hook only: skip rejection sampling to exercise the backtracking fallback

  function resourceBag(spec) {
    var bag = [];
    Object.keys(spec.resources).forEach(function (k) { for (var i = 0; i < spec.resources[k]; i++) bag.push(k); });
    return bag;
  }

  // no hex may have 2+ same-resource neighbours  <=>  no connected same-resource group of 3+
  function resourcesOk(res, hexes) {
    for (var i = 0; i < hexes.length; i++) {
      var nb = hexes[i].nb, c = 0;
      for (var j = 0; j < nb.length; j++) if (res[nb[j]] === res[i] && ++c >= 2) return false;
    }
    return true;
  }
  function tokensOk(tok, pairs) {
    for (var i = 0; i < pairs.length; i++) {
      var a = tok[pairs[i][0]], b = tok[pairs[i][1]];
      if (a == null || b == null) continue;
      if (a === b || (isRed(a) && isRed(b))) return false;
    }
    return true;
  }

  // randomized complete backtracking over a random hex order (fallback when rejection sampling is unlucky)
  function backtrack(positions, bag, canPlace, rand) {
    for (var attempt = 0; attempt < BT_RESTARTS; attempt++) {
      var order = shuffle(positions, rand), counts = {}, keys = [];
      bag.forEach(function (v) { if (counts[v] == null) { counts[v] = 0; keys.push(v); } counts[v]++; });
      var assign = {}, steps = 0, n = order.length;
      var go = function (i) {
        if (i === n) return true;
        if (++steps > BT_BUDGET) return false;
        var cand = shuffle(keys.filter(function (k) { return counts[k] > 0; }), rand), h = order[i];
        for (var c = 0; c < cand.length; c++) {
          var k = cand[c];
          if (!canPlace(h, k, assign)) continue;
          assign[h] = k; counts[k]--;
          if (go(i + 1)) return true;
          counts[k]++; delete assign[h];
        }
        return false;
      };
      if (go(0)) return assign;
    }
    return null;
  }

  function placeResources(spec, geo, mode, rand) {
    var bag = resourceBag(spec), hexes = geo.hexes, res, t;
    if (mode !== 'balanced') return shuffle(bag, rand);
    for (t = 0; t < (forceBacktrack ? 0 : RES_TRIES); t++) {
      res = shuffleInPlace(bag.slice(), rand);
      if (resourcesOk(res, hexes)) return res;
    }
    var canPlace = function (h, v, assign) {
      var nb = hexes[h].nb, same = 0;
      for (var j = 0; j < nb.length; j++) {
        if (assign[nb[j]] === v) {
          if (++same >= 2) return false;
          var nn = hexes[nb[j]].nb;
          for (var m = 0; m < nn.length; m++) if (nn[m] !== h && assign[nn[m]] === v) return false;
        }
      }
      return true;
    };
    var as = backtrack(hexes.map(function (h) { return h.id; }), bag, canPlace, rand);
    if (!as) throw new Error('no resource layout found');
    return hexes.map(function (h) { return as[h.id]; });
  }

  function placeTokens(spec, geo, res, rand) {
    var hexes = geo.hexes, land = [], tok, t, i;
    for (i = 0; i < hexes.length; i++) if (res[i] !== 'desert') land.push(i);
    for (t = 0; t < (forceBacktrack ? 0 : TOK_TRIES); t++) {
      var s = shuffleInPlace(spec.tokens.slice(), rand);
      tok = new Array(hexes.length); for (i = 0; i < tok.length; i++) tok[i] = null;
      for (i = 0; i < land.length; i++) tok[land[i]] = s[i];
      if (tokensOk(tok, geo.pairs)) return tok;
    }
    var canPlace = function (h, v, assign) {
      var nb = hexes[h].nb;
      for (var j = 0; j < nb.length; j++) {
        var o = assign[nb[j]];
        if (o != null && (o === v || (isRed(o) && isRed(v)))) return false;
      }
      return true;
    };
    var as = backtrack(land, spec.tokens, canPlace, rand);
    if (!as) throw new Error('no number layout found');
    tok = new Array(hexes.length); for (i = 0; i < tok.length; i++) tok[i] = null;
    land.forEach(function (h) { tok[h] = as[h]; });
    return tok;
  }

  function harborTypes(spec) {
    var out = [];
    Object.keys(spec.harbors).forEach(function (k) { for (var i = 0; i < spec.harbors[k]; i++) out.push(k); });
    return out;
  }

  function buildHarbors(spec, geo, types) {
    return spec.harborEdges.map(function (ei, slot) {
      var e = geo.perimeterEdges[ei], type = types[slot];
      return { slot: slot, edge: ei, type: type, ratio: type === 'any' ? 3 : 2, hexId: e.hex, hex: e.hex, k: e.k,
        p: e.p.slice(), q: e.q.slice(), mx: e.mx, my: e.my, nx: e.nx, ny: e.ny, ang: e.ang };
    });
  }

  // generateBoard({size:'34'|'56'|'base'|'ext', mode:'random'|'balanced', seed?, version?, players?})
  function generateBoard(opts) {
    opts = opts || {};
    var size = normalizeSize(opts.size);
    if (!size) size = sizeFor(opts.version, opts.players);
    var mode = opts.mode == null ? 'balanced' : String(opts.mode).toLowerCase();
    if (MODES.indexOf(mode) < 0) throw new Error('Unknown mode: ' + opts.mode);
    var seed = normalizeSeed(opts.seed);
    if (seed == null) seed = randomSeed();
    var spec = SPEC[size], geo = GEO[size], rand = createRng(seed);

    var res = placeResources(spec, geo, mode, rand);
    var tok = placeTokens(spec, geo, res, rand);
    var types = shuffle(harborTypes(spec), rand);
    var deserts = []; res.forEach(function (r, i) { if (r === 'desert') deserts.push(i); });
    var robberHexId = deserts[Math.floor(rand() * deserts.length)];

    var hexes = geo.hexes.map(function (g, i) {
      var n = tok[i];
      return { id: g.id, row: g.row, col: g.col, x: g.x, y: g.y, nb: g.nb,
        resource: res[i], res: res[i], number: n, num: n, pips: n == null ? 0 : pips(n), hasRobber: i === robberHexId };
    });
    var board = {
      version: VERSION, size: size, mode: mode, seed: seed, code: seedCode(seed), rules: RULES[mode].slice(),
      rows: spec.rows.slice(), hexes: hexes, harbors: buildHarbors(spec, geo, types),
      robberHexId: robberHexId, perimeterEdges: geo.perimeterEdges
    };
    var viol = validateBoard(board, mode);
    if (viol.length) throw new Error('generated an invalid board: ' + viol[0].message);
    board.report = analyze(board);
    return board;
  }

  // ---- validation ---------------------------------------------------------
  function resOf(h) { return h.resource != null ? h.resource : h.res; }
  function numOf(h) { var n = h.number !== undefined ? h.number : h.num; return n === undefined ? null : n; }

  function sameResGroups(hexes, res, geo) {
    var seen = {}, groups = [];
    for (var i = 0; i < hexes.length; i++) {
      if (seen[i]) continue;
      var g = [i], stack = [i]; seen[i] = true;
      while (stack.length) {
        var c = stack.pop(), nb = geo.hexes[c].nb;
        for (var j = 0; j < nb.length; j++) if (!seen[nb[j]] && res[nb[j]] === res[i]) { seen[nb[j]] = true; g.push(nb[j]); stack.push(nb[j]); }
      }
      groups.push(g);
    }
    return groups;
  }

  // Facts about a board (no judgement): used for board.report and by the UI.
  function analyze(board) {
    var geo = GEO[board.size], spec = SPEC[board.size];
    var H = board.hexes, res = H.map(resOf), num = H.map(numOf);
    var redAdj = 0, sameNumAdj = 0, twoTwelveAdj = 0, sameResAdj = 0, i;
    geo.pairs.forEach(function (pr) {
      var a = num[pr[0]], b = num[pr[1]];
      if (a != null && b != null) {
        if (isRed(a) && isRed(b)) redAdj++;
        if (a === b) sameNumAdj++;
        if ((a === 2 || a === 12) && (b === 2 || b === 12)) twoTwelveAdj++;
      }
      if (res[pr[0]] === res[pr[1]] && res[pr[0]] !== 'desert') sameResAdj++;
    });
    var maxGroup = 0, groupsOf3 = 0;
    sameResGroups(H, res, geo).forEach(function (g) {
      if (res[g[0]] === 'desert') return;
      if (g.length > maxGroup) maxGroup = g.length;
      if (g.length >= 3) groupsOf3++;
    });
    var pipsByRes = {}; RES.forEach(function (r) { pipsByRes[r] = 0; });
    for (i = 0; i < H.length; i++) if (res[i] !== 'desert' && num[i] != null) pipsByRes[res[i]] += pips(num[i]);
    var flags = { redAdj: redAdj, sameNumAdj: sameNumAdj, sameResAdj: sameResAdj, sameResMaxGroup: maxGroup,
      sameResGroups3: groupsOf3, twoTwelveAdj: twoTwelveAdj };
    var randomOk = redAdj === 0 && sameNumAdj === 0;
    return { flags: flags, pipsByRes: pipsByRes, officialRandomOk: randomOk,
      balancedOk: randomOk && groupsOf3 === 0, hexCount: spec ? sumVals(spec.resources) : H.length,
      errors: [] };
  }

  function V(code, message, ids) { var v = { code: code, message: message }; if (ids) v.ids = ids; return v; }

  // Returns [] when the board is valid, else a list of {code, message, ids?}.
  // mode defaults to board.mode. Adjacency is recomputed from the official layout, never trusted from the board.
  function validateBoard(board, mode) {
    var out = [];
    if (!board || typeof board !== 'object') return [V('not_a_board', 'Not a board')];
    var size = normalizeSize(board.size);
    if (!size || (board.size !== '34' && board.size !== '56')) { out.push(V('bad_size', 'Unknown board size: ' + board.size)); if (!size) return out; }
    mode = mode == null ? board.mode : mode;
    if (MODES.indexOf(mode) < 0) out.push(V('bad_mode', 'Unknown mode: ' + mode));
    var spec = SPEC[size], geo = GEO[size], H = board.hexes, i;
    if (!Array.isArray(H) || H.length !== geo.hexes.length) { out.push(V('hex_count', 'Expected ' + geo.hexes.length + ' hexes')); return out; }
    // layout identity
    for (i = 0; i < H.length; i++) {
      var g = geo.hexes[i];
      if (H[i].id !== i || H[i].row !== g.row || H[i].col !== g.col) { out.push(V('layout', 'Hex ' + i + ' is not at its official row/col', [i])); break; }
    }
    // resources
    var res = H.map(resOf), cnt = {};
    res.forEach(function (r) { cnt[r] = (cnt[r] || 0) + 1; });
    Object.keys(spec.resources).forEach(function (k) {
      if ((cnt[k] || 0) !== spec.resources[k]) out.push(V('resource_count', 'Resource ' + k + ': ' + (cnt[k] || 0) + ' != ' + spec.resources[k]));
    });
    Object.keys(cnt).forEach(function (k) { if (spec.resources[k] == null) out.push(V('resource_unknown', 'Unknown resource ' + k)); });
    // tokens
    var num = H.map(numOf), want = spec.tokens.slice().sort(function (a, b) { return a - b; }), got = [];
    for (i = 0; i < H.length; i++) {
      if (res[i] === 'desert') { if (num[i] != null) out.push(V('desert_token', 'Desert ' + i + ' has a token', [i])); }
      else if (num[i] == null) out.push(V('missing_token', 'Hex ' + i + ' has no token', [i]));
      else got.push(num[i]);
      if (num[i] != null && H[i].pips !== undefined && H[i].pips !== pips(num[i])) out.push(V('pips', 'Hex ' + i + ' pips do not match its number', [i]));
    }
    got.sort(function (a, b) { return a - b; });
    if (got.length !== want.length || got.some(function (v, j) { return v !== want[j]; })) out.push(V('token_multiset', 'Number tokens do not match the official set'));
    // robber
    var robbers = []; H.forEach(function (h, j) { if (h.hasRobber) robbers.push(j); });
    if (robbers.length !== 1) out.push(V('robber_count', 'Expected exactly one robber, found ' + robbers.length, robbers));
    else {
      if (res[robbers[0]] !== 'desert') out.push(V('robber_not_desert', 'Robber must start on a desert', robbers));
      if (board.robberHexId !== robbers[0]) out.push(V('robber_id', 'robberHexId does not match the hex with the robber', robbers));
    }
    // harbors
    var HB = board.harbors;
    if (!Array.isArray(HB) || HB.length !== spec.harborEdges.length) out.push(V('harbor_count', 'Expected ' + spec.harborEdges.length + ' harbors'));
    else {
      var hc = {};
      HB.forEach(function (b, j) {
        hc[b.type] = (hc[b.type] || 0) + 1;
        if (b.slot !== j || b.edge !== spec.harborEdges[j]) out.push(V('harbor_slot', 'Harbor ' + j + ' is not on its official slot'));
        if (b.ratio !== (b.type === 'any' ? 3 : 2)) out.push(V('harbor_ratio', 'Harbor ' + j + ' has the wrong ratio'));
      });
      Object.keys(spec.harbors).forEach(function (k) {
        if ((hc[k] || 0) !== spec.harbors[k]) out.push(V('harbor_types', 'Harbor ' + k + ': ' + (hc[k] || 0) + ' != ' + spec.harbors[k]));
      });
      Object.keys(hc).forEach(function (k) { if (spec.harbors[k] == null) out.push(V('harbor_types', 'Unknown harbor type ' + k)); });
    }
    // mode rules
    var rules = RULES[mode] || [];
    if (rules.indexOf('noAdjacentRed') >= 0 || rules.indexOf('noAdjacentSameNumber') >= 0) {
      geo.pairs.forEach(function (pr) {
        var a = num[pr[0]], b = num[pr[1]];
        if (a == null || b == null) return;
        if (rules.indexOf('noAdjacentRed') >= 0 && isRed(a) && isRed(b)) out.push(V('adjacent_red', 'Hexes ' + pr[0] + ' and ' + pr[1] + ' both carry a 6 or 8', pr.slice()));
        if (rules.indexOf('noAdjacentSameNumber') >= 0 && a === b) out.push(V('adjacent_same_number', 'Hexes ' + pr[0] + ' and ' + pr[1] + ' both carry ' + a, pr.slice()));
      });
    }
    if (rules.indexOf('noSameResourceGroup') >= 0) {
      sameResGroups(H, res, geo).forEach(function (grp) {
        if (grp.length >= 3 && res[grp[0]] !== 'desert') out.push(V('resource_group', grp.length + ' connected ' + res[grp[0]] + ' hexes', grp.slice()));
      });
    }
    return out;
  }

  var api = {
    VERSION: VERSION, RES: RES, MODES: MODES, RULES: RULES, LAYOUTS: LAYOUTS, SEED_SPACE: SEED_SPACE,
    generateBoard: generateBoard, validateBoard: validateBoard, analyzeBoard: analyze,
    sizeFor: sizeFor, boardSupported: boardSupported, normalizeSize: normalizeSize,
    createRng: createRng, shuffle: shuffle, seedCode: seedCode, parseSeedCode: parseSeedCode,
    pips: pips, isRed: isRed,
    _test: { forceBacktrack: function (on) { forceBacktrack = !!on; } }
  };
  global.TallyItCatanBoard = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
