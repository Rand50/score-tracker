/* ==========================================================================
   Score Tracker — 7 Wonders Scoring Module (Illuminated Papyrus Ledger)
   ==========================================================================
   Drop-in logic module for v3/engine.js. Exposes `window.SevenWondersLogic`
   in browsers and `module.exports` in Node.

   Canonical game key: '7wonders' (3–7 players, default 3–4, max 7).
   Scoring flow: Category-by-category ledger across all 7 base categories
   plus tucked-away optional expansions (Leaders, Cities, Armada — all OFF
   by default).

   Features:
   - All 7 base categories:
       1. Military (signed int, supports negative defeat tokens)
       2. Treasury / Coins (enter raw Coins >= 0 -> Math.floor(coins / 3) VP;
          raw coins retained as `coins` / `tiebreakCoins` for official tiebreaker)
       3. Wonder (non-negative int)
       4. Civilian / Blue (non-negative int)
       5. Commercial / Yellow (non-negative int)
       6. Guilds / Purple (non-negative int)
       7. Science / Green (automatic optimal a² + b² + c² + 7*min(a,b,c)
          across all Wild assignments + optional direct VP override)
   - Optional expansions toggle (default OFF):
       - Leaders (non-negative int)
       - Cities (signed int, supports negative Debt tokens)
       - Armada (signed int, supports naval defeats)
   - Official tiebreaker: highest total VP, then highest raw Treasury coins,
     then shared win if still tied.
   - Undo stack, category navigation, ranked standings, and History / Supabase
     shared payload builder (`swBuildFinishPayload`).
   ========================================================================== */

(function (global) {
  'use strict';

  const GAME_TYPE = '7wonders';
  const MIN_PLAYERS = 3;
  const MAX_PLAYERS = 7;
  const MAX_SCIENCE_WILDS = 6;
  const MAX_UNDO_STACK = 60;

  const BASE_CATEGORIES = [
    'military',
    'treasury',
    'wonder',
    'civilian',
    'commercial',
    'guilds',
    'science'
  ];

  const EXPANSION_CATEGORIES = ['leaders', 'cities', 'armada'];
  const ALL_CATEGORIES = BASE_CATEGORIES.concat(EXPANSION_CATEGORIES);
  const SCIENCE_SYMBOLS = ['tablets', 'compasses', 'gears', 'wilds'];

  const CATEGORY_META = {
    military:   { key: 'military',   label: 'Military',   shortLabel: 'Mil',  color: '#b91c1c', signed: true,  isCoins: false, isScience: false, expansion: null,      hint: 'Conflict tokens (supports negative defeats)' },
    treasury:   { key: 'treasury',   label: 'Treasury',   shortLabel: 'Coin', color: '#b45309', signed: false, isCoins: true,  isScience: false, expansion: null,      hint: 'Enter raw Coins (3 coins = 1 VP; breaks ties)' },
    wonder:     { key: 'wonder',     label: 'Wonder',     shortLabel: 'Wnd',  color: '#92400e', signed: false, isCoins: false, isScience: false, expansion: null,      hint: 'Built Wonder stage VP' },
    civilian:   { key: 'civilian',   label: 'Civilian',   shortLabel: 'Civ',  color: '#1d4ed8', signed: false, isCoins: false, isScience: false, expansion: null,      hint: 'Blue structures' },
    commercial: { key: 'commercial', label: 'Commercial', shortLabel: 'Com',  color: '#ca8a04', signed: false, isCoins: false, isScience: false, expansion: null,      hint: 'Yellow structures' },
    guilds:     { key: 'guilds',     label: 'Guilds',     shortLabel: 'Gld',  color: '#6d28d9', signed: false, isCoins: false, isScience: false, expansion: null,      hint: 'Purple guild cards' },
    science:    { key: 'science',    label: 'Science',    shortLabel: 'Sci',  color: '#15803d', signed: false, isCoins: false, isScience: true,  expansion: null,      hint: 'Tablets, Compasses, Gears & Wilds' },
    leaders:    { key: 'leaders',    label: 'Leaders',    shortLabel: 'Ldr',  color: '#475569', signed: false, isCoins: false, isScience: false, expansion: 'leaders', hint: 'White Leaders expansion cards' },
    cities:     { key: 'cities',     label: 'Cities',     shortLabel: 'Cty',  color: '#1f2937', signed: true,  isCoins: false, isScience: false, expansion: 'cities',  hint: 'Black Cities cards & Debt tokens (signed)' },
    armada:     { key: 'armada',     label: 'Armada',     shortLabel: 'Arm',  color: '#0f766e', signed: true,  isCoins: false, isScience: false, expansion: 'armada',  hint: 'Naval conflicts, fleets & islands (signed)' }
  };

  const WONDERS = [
    'Alexandria',
    'Babylon',
    'Éphesos',
    'Gizah',
    'Halikarnassos',
    'Olympia',
    'Rhodos'
  ];

  // ---------------- Helpers ----------------
  function uid(prefix) {
    return (prefix || 'sw') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
  }

  function cleanStr(v) {
    return String(v ?? '').trim();
  }

  function clampInt(v, min, max) {
    const n = typeof v === 'number' ? Math.trunc(v) : parseInt(String(v ?? '').trim(), 10);
    if (!Number.isFinite(n)) return 0;
    return Math.max(min, Math.min(max, n));
  }

  function parseCategoryValue(cat, raw) {
    const meta = CATEGORY_META[cat];
    if (!meta) return 0;
    if (meta.signed) return clampInt(raw, -999, 999);
    return clampInt(raw, 0, 999);
  }

  function normalizeExpansions(raw) {
    const src = (raw && typeof raw === 'object') ? raw : {};
    return {
      leaders: Boolean(src.leaders),
      cities: Boolean(src.cities),
      armada: Boolean(src.armada)
    };
  }

  function normalizeScienceInput(raw) {
    const src = (raw && typeof raw === 'object') ? raw : {};
    const hasOverride =
      src.override !== null &&
      src.override !== undefined &&
      src.override !== '' &&
      Number.isFinite(Number(src.override));
    return {
      tablets: clampInt(src.tablets, 0, 99),
      compasses: clampInt(src.compasses, 0, 99),
      gears: clampInt(src.gears, 0, 99),
      wilds: clampInt(src.wilds, 0, MAX_SCIENCE_WILDS),
      override: hasOverride ? clampInt(src.override, 0, 999) : null
    };
  }

  function emptyScores() {
    return {
      military: 0,
      treasury: 0, // raw coins (3 coins = 1 VP)
      wonder: 0,
      civilian: 0,
      commercial: 0,
      guilds: 0,
      leaders: 0,
      cities: 0,
      armada: 0
    };
  }

  function normalizeScores(raw) {
    const src = (raw && typeof raw === 'object') ? raw : {};
    const out = emptyScores();
    for (const key of Object.keys(out)) {
      out[key] = parseCategoryValue(key, src[key]);
    }
    return out;
  }

  function normalizePlayerInput(raw) {
    if (typeof raw === 'string') {
      const name = cleanStr(raw);
      return name ? { name, userId: null, isSelf: false, wonder: null } : null;
    }
    if (!raw || typeof raw !== 'object') return null;
    const name = cleanStr(
      raw.name ||
      raw.display_name ||
      raw.displayName ||
      (raw.profile && raw.profile.display_name)
    );
    if (!name) return null;
    const userId = raw.userId ?? raw.user_id ?? (raw.profile && raw.profile.id) ?? null;
    return {
      name,
      userId: userId ? String(userId) : null,
      isSelf: Boolean(raw.isSelf || raw.is_self),
      wonder: raw.wonder ? cleanStr(raw.wonder) : null,
      scores: raw.scores,
      science: raw.science
    };
  }

  // ---------------- Science Calculator ----------------
  /**
   * Computes optimal 7 Wonders Science VP:
   *   a² + b² + c² + 7 * min(a, b, c)
   * across all valid (wa, wb, wc) wild assignments where wa + wb + wc = wilds.
   * Respects `override` when set to a finite non-negative number, while still
   * returning `autoVp` and `bestSplit` for UI display.
   */
  function swComputeScience(sciObj) {
    const sci = normalizeScienceInput(sciObj);
    const t = sci.tablets;
    const c = sci.compasses;
    const g = sci.gears;
    const w = sci.wilds;

    let bestTotal = -1;
    let bestA = t;
    let bestB = c;
    let bestC = g;
    let bestWa = 0;
    let bestWb = 0;
    let bestWc = 0;
    let bestSets = 0;
    let bestSquares = 0;

    for (let wa = 0; wa <= w; wa++) {
      for (let wb = 0; wb <= w - wa; wb++) {
        const wc = w - wa - wb;
        const a = t + wa;
        const b = c + wb;
        const cc = g + wc;
        const squares = a * a + b * b + cc * cc;
        const sets = Math.min(a, b, cc);
        const total = squares + sets * 7;
        if (total > bestTotal) {
          bestTotal = total;
          bestA = a;
          bestB = b;
          bestC = cc;
          bestWa = wa;
          bestWb = wb;
          bestWc = wc;
          bestSets = sets;
          bestSquares = squares;
        }
      }
    }

    const autoVp = Math.max(0, bestTotal);
    const isOverride = sci.override !== null;
    const vp = isOverride ? sci.override : autoVp;

    return {
      vp,
      autoVp,
      isOverride,
      tablets: t,
      compasses: c,
      gears: g,
      wilds: w,
      override: sci.override,
      bestSplit: { tablets: bestA, compasses: bestB, gears: bestC },
      wildAssignment: { tablets: bestWa, compasses: bestWb, gears: bestWc },
      sets: bestSets,
      setsScore: bestSets * 7,
      squaresScore: bestSquares
    };
  }

  // ---------------- Player & Game Totals ----------------
  function swGetActiveCategories(game) {
    const exp = normalizeExpansions(game && game.expansions);
    const cats = BASE_CATEGORIES.slice();
    if (exp.leaders) cats.push('leaders');
    if (exp.cities) cats.push('cities');
    if (exp.armada) cats.push('armada');
    return cats;
  }

  function swComputePlayerTotal(player, expansions) {
    const exp = normalizeExpansions(expansions);
    const scores = normalizeScores(player && player.scores);
    const sci = swComputeScience(player && player.science);

    const coins = scores.treasury;
    const treasuryVp = Math.floor(coins / 3);
    const scienceVp = sci.vp;

    let total =
      scores.military +
      treasuryVp +
      scores.wonder +
      scores.civilian +
      scores.commercial +
      scores.guilds +
      scienceVp;

    if (exp.leaders) total += scores.leaders;
    if (exp.cities) total += scores.cities;
    if (exp.armada) total += scores.armada;

    return {
      total,
      coins,
      treasuryVp,
      scienceVp,
      scienceDetail: sci
    };
  }

  function recomputePlayer(player, expansions) {
    player.scores = normalizeScores(player.scores);
    player.science = normalizeScienceInput(player.science);
    const res = swComputePlayerTotal(player, expansions);
    player.coins = res.coins;
    player.tiebreakCoins = res.coins;
    player.treasuryVp = res.treasuryVp;
    player.scienceVp = res.scienceVp;
    player.score = res.total;
    return res;
  }

  function recomputeAll(game) {
    if (!game || !Array.isArray(game.players)) return;
    game.expansions = normalizeExpansions(game.expansions);
    const activeCats = swGetActiveCategories(game);
    if (!activeCats.includes(game.activeCategory)) {
      game.activeCategory = 'military';
    }
    game.players.forEach((p) => recomputePlayer(p, game.expansions));
  }

  function cloneSnapshot(game) {
    return {
      activeCategory: game.activeCategory,
      expansions: { ...game.expansions },
      players: game.players.map((p) => ({
        name: p.name,
        userId: p.userId || null,
        isSelf: Boolean(p.isSelf),
        wonder: p.wonder || null,
        scores: { ...p.scores },
        science: { ...p.science }
      }))
    };
  }

  function pushUndo(game) {
    if (!Array.isArray(game.undoStack)) game.undoStack = [];
    game.undoStack.push(cloneSnapshot(game));
    if (game.undoStack.length > MAX_UNDO_STACK) {
      game.undoStack.shift();
    }
  }

  // ---------------- Game Factory & Normalization ----------------
  function createSevenWondersGame(playerList, opts) {
    const options = opts || {};
    const rawList = Array.isArray(playerList) ? playerList : [];
    const normalized = rawList
      .map(normalizePlayerInput)
      .filter(Boolean)
      .slice(0, MAX_PLAYERS);

    const expansions = normalizeExpansions(options.expansions);
    const players = normalized.map((p) => {
      const entry = {
        name: p.name,
        userId: p.userId,
        isSelf: p.isSelf,
        wonder: p.wonder,
        scores: normalizeScores(p.scores),
        science: normalizeScienceInput(p.science),
        coins: 0,
        tiebreakCoins: 0,
        treasuryVp: 0,
        scienceVp: 0,
        score: 0
      };
      recomputePlayer(entry, expansions);
      return entry;
    });

    const game = {
      id: options.id || uid('sw'),
      type: GAME_TYPE,
      gameName: '7 Wonders',
      version: '7 Wonders',
      low: false,
      startTime: options.startTime || new Date().toISOString(),
      endTime: null,
      groupId: options.groupId ?? null,
      groupName: options.groupName ?? null,
      activeCategory: 'military',
      expansions,
      players,
      rounds: [],
      undoStack: []
    };

    recomputeAll(game);
    return game;
  }

  function ensureSevenWondersState(game) {
    if (!game || typeof game !== 'object') return null;
    game.type = GAME_TYPE;
    game.gameName = game.gameName || '7 Wonders';
    game.low = false;
    game.expansions = normalizeExpansions(game.expansions);
    if (!Array.isArray(game.players)) game.players = [];
    if (!Array.isArray(game.undoStack)) game.undoStack = [];
    if (!Array.isArray(game.rounds)) game.rounds = [];
    game.players.forEach((p) => {
      if (!p || typeof p !== 'object') return;
      p.scores = normalizeScores(p.scores);
      p.science = normalizeScienceInput(p.science);
      recomputePlayer(p, game.expansions);
    });
    const cats = swGetActiveCategories(game);
    if (!cats.includes(game.activeCategory)) {
      game.activeCategory = cats[0] || 'military';
    }
    return game;
  }

  // ---------------- Category-by-Category Controls ----------------
  function swSelectCategory(game, cat) {
    ensureSevenWondersState(game);
    const cats = swGetActiveCategories(game);
    const key = String(cat || '').toLowerCase();
    if (!cats.includes(key)) {
      return { ok: false, activeCategory: game.activeCategory, categories: cats };
    }
    game.activeCategory = key;
    const index = cats.indexOf(key);
    return {
      ok: true,
      activeCategory: key,
      index,
      total: cats.length,
      isFirst: index === 0,
      isLast: index === cats.length - 1,
      categories: cats
    };
  }

  function swPrevCategory(game) {
    ensureSevenWondersState(game);
    const cats = swGetActiveCategories(game);
    const idx = Math.max(0, cats.indexOf(game.activeCategory));
    const nextIdx = Math.max(0, idx - 1);
    return swSelectCategory(game, cats[nextIdx]);
  }

  function swNextCategory(game) {
    ensureSevenWondersState(game);
    const cats = swGetActiveCategories(game);
    const idx = Math.max(0, cats.indexOf(game.activeCategory));
    const nextIdx = Math.min(cats.length - 1, idx + 1);
    return swSelectCategory(game, cats[nextIdx]);
  }

  function swStepScore(game, playerIdx, cat, delta) {
    ensureSevenWondersState(game);
    const p = game.players[playerIdx];
    const key = String(cat || '').toLowerCase();
    if (!p || !CATEGORY_META[key]) return null;
    if (key === 'science') {
      const cur = swComputeScience(p.science).vp;
      return swSetScienceOverride(game, playerIdx, Math.max(0, cur + clampInt(delta, -999, 999)));
    }
    pushUndo(game);
    const nextVal = parseCategoryValue(key, (p.scores[key] || 0) + clampInt(delta, -999, 999));
    p.scores[key] = nextVal;
    recomputePlayer(p, game.expansions);
    return p;
  }

  function swSetScore(game, playerIdx, cat, val) {
    ensureSevenWondersState(game);
    const p = game.players[playerIdx];
    const key = String(cat || '').toLowerCase();
    if (!p || !CATEGORY_META[key]) return null;
    if (key === 'science') {
      return swSetScienceOverride(game, playerIdx, val);
    }
    pushUndo(game);
    p.scores[key] = parseCategoryValue(key, val);
    recomputePlayer(p, game.expansions);
    return p;
  }

  function swStepScience(game, playerIdx, sym, delta) {
    ensureSevenWondersState(game);
    const p = game.players[playerIdx];
    const key = String(sym || '').toLowerCase();
    if (!p || !SCIENCE_SYMBOLS.includes(key)) return null;
    pushUndo(game);
    const maxVal = key === 'wilds' ? MAX_SCIENCE_WILDS : 99;
    const cur = p.science[key] || 0;
    p.science[key] = clampInt(cur + clampInt(delta, -99, 99), 0, maxVal);
    // Actively adjusting Science symbols switches back to automatic calculation
    p.science.override = null;
    recomputePlayer(p, game.expansions);
    return p;
  }

  function swSetScienceOverride(game, playerIdx, val) {
    ensureSevenWondersState(game);
    const p = game.players[playerIdx];
    if (!p) return null;
    pushUndo(game);
    if (val === null || val === undefined || String(val).trim() === '') {
      p.science.override = null;
    } else {
      p.science.override = clampInt(val, 0, 999);
    }
    recomputePlayer(p, game.expansions);
    return p;
  }

  function swToggleExpansion(game, expKey) {
    ensureSevenWondersState(game);
    const key = String(expKey || '').toLowerCase();
    if (!EXPANSION_CATEGORIES.includes(key)) {
      return { ok: false, expansions: { ...game.expansions } };
    }
    pushUndo(game);
    game.expansions[key] = !game.expansions[key];
    const cats = swGetActiveCategories(game);
    if (!cats.includes(game.activeCategory)) {
      game.activeCategory = 'science';
    }
    recomputeAll(game);
    return {
      ok: true,
      expansion: key,
      enabled: game.expansions[key],
      expansions: { ...game.expansions },
      activeCategory: game.activeCategory,
      categories: cats
    };
  }

  function swUndo(game) {
    ensureSevenWondersState(game);
    if (!game.undoStack.length) return { ok: false, remaining: 0 };
    const snap = game.undoStack.pop();
    game.activeCategory = snap.activeCategory;
    game.expansions = normalizeExpansions(snap.expansions);
    game.players = snap.players.map((p) => {
      const entry = {
        name: p.name,
        userId: p.userId || null,
        isSelf: Boolean(p.isSelf),
        wonder: p.wonder || null,
        scores: normalizeScores(p.scores),
        science: normalizeScienceInput(p.science),
        coins: 0,
        tiebreakCoins: 0,
        treasuryVp: 0,
        scienceVp: 0,
        score: 0
      };
      recomputePlayer(entry, game.expansions);
      return entry;
    });
    recomputeAll(game);
    return { ok: true, remaining: game.undoStack.length };
  }

  // ---------------- Ranking & Official Tiebreaker ----------------
  /**
   * Ranks players by:
   *   1. Highest total VP (`score`)
   *   2. Highest raw Treasury coins (`coins` / `tiebreakCoins`)
   *   3. Shared rank if both VP and coins tie
   */
  function swGetRankedPlayers(game) {
    ensureSevenWondersState(game);
    const list = game.players.map((p, idx) => {
      const calc = swComputePlayerTotal(p, game.expansions);
      return {
        playerIdx: idx,
        name: p.name,
        userId: p.userId || null,
        isSelf: Boolean(p.isSelf),
        wonder: p.wonder || null,
        score: calc.total,
        total: calc.total,
        coins: calc.coins,
        tiebreakCoins: calc.coins,
        treasuryVp: calc.treasuryVp,
        scienceVp: calc.scienceVp,
        science: calc.scienceDetail,
        scores: { ...p.scores }
      };
    });

    list.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.coins !== a.coins) return b.coins - a.coins;
      return a.playerIdx - b.playerIdx;
    });

    const topScore = list.length ? list[0].score : 0;
    const topCoins = list.length ? list[0].coins : 0;
    const tiedAtTopVp = list.filter((x) => x.score === topScore).length > 1;

    let currentRank = 1;
    list.forEach((entry, i) => {
      if (i > 0) {
        const prev = list[i - 1];
        if (entry.score !== prev.score || entry.coins !== prev.coins) {
          currentRank = i + 1;
        }
      }
      entry.rank = currentRank;
      entry.isWinner = currentRank === 1;
      entry.wonByTiebreaker = Boolean(
        entry.isWinner &&
        tiedAtTopVp &&
        list.some((other) => other.score === topScore && other.coins < topCoins)
      );
    });

    return list;
  }

  // ---------------- Finish & Shared Payload Builder ----------------
  function swBuildFinishPayload(game, currentUser) {
    ensureSevenWondersState(game);
    const ranked = swGetRankedPlayers(game);
    const winners = ranked.filter((r) => r.isWinner);
    const winnerNames = winners.map((w) => w.name);
    const winnerSet = new Set(winners.map((w) => w.playerIdx));
    const endTime = game.endTime || new Date().toISOString();

    const playersPayload = game.players.map((p, idx) => {
      const calc = swComputePlayerTotal(p, game.expansions);
      return {
        name: p.name,
        userId: p.userId || null,
        isSelf: Boolean(p.isSelf),
        wonder: p.wonder || null,
        score: calc.total,
        coins: calc.coins,
        tiebreakCoins: calc.coins,
        treasuryVp: calc.treasuryVp,
        scienceVp: calc.scienceVp,
        isWinner: winnerSet.has(idx),
        scores: { ...p.scores },
        science: {
          tablets: calc.scienceDetail.tablets,
          compasses: calc.scienceDetail.compasses,
          gears: calc.scienceDetail.gears,
          wilds: calc.scienceDetail.wilds,
          override: calc.scienceDetail.override,
          vp: calc.scienceDetail.vp,
          autoVp: calc.scienceDetail.autoVp,
          bestSplit: calc.scienceDetail.bestSplit
        }
      };
    });

    const meta = {
      gameType: GAME_TYPE,
      low: false,
      expansions: { ...game.expansions },
      activeCategories: swGetActiveCategories(game),
      tiebreaker: 'coins',
      wonByTiebreaker: winners.some((w) => w.wonByTiebreaker),
      winnerNames,
      players: playersPayload
    };

    const finishedGame = {
      ...game,
      type: GAME_TYPE,
      gameName: '7 Wonders',
      low: false,
      endTime,
      winner: winnerNames.join(', '),
      winnerNames,
      players: playersPayload,
      meta
    };

    let sharedPayload = null;
    if (global.SocialScoring && typeof global.SocialScoring.buildSharedGamePayload === 'function') {
      sharedPayload = global.SocialScoring.buildSharedGamePayload(finishedGame, currentUser);
    }

    return {
      finishedGame,
      ranked,
      winners,
      winnerNames,
      meta,
      sharedPayload
    };
  }

  // ---------------- Exports ----------------
  const api = {
    GAME_TYPE,
    MIN_PLAYERS,
    MAX_PLAYERS,
    MAX_SCIENCE_WILDS,
    BASE_CATEGORIES,
    EXPANSION_CATEGORIES,
    ALL_CATEGORIES,
    SCIENCE_SYMBOLS,
    CATEGORY_META,
    WONDERS,
    createSevenWondersGame,
    ensureSevenWondersState,
    swGetActiveCategories,
    swComputeScience,
    swComputePlayerTotal,
    swSelectCategory,
    swPrevCategory,
    swNextCategory,
    swStepScore,
    swSetScore,
    swStepScience,
    swSetScienceOverride,
    swToggleExpansion,
    swUndo,
    swGetRankedPlayers,
    swBuildFinishPayload
  };

  global.SevenWondersLogic = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
