/* ==========================================================================
   Score Tracker — Reusable 3D Dice Roller & Roll Tracker Logic
   ==========================================================================
   Drop-in logic module for v3/engine.js. Exposes `window.DiceLogic` in
   browsers and `module.exports` in Node.

   Supports:
   - Per-game NdS dice configuration (`getDiceConfig` + `registerDiceConfig`,
     default 2d6 with robberSum: 7 for Catan, extensible via `GAMES[type].dice`)
   - Persisted `game.diceRolls` array (`{ sum, dice, source, ts }`)
   - Unbiased random rolls via `crypto.getRandomValues` (with `Math.random` fallback)
   - Manual roll logging (sum keypad OR explicit dice array), Undo, Clear
   - Exact combinatorial probability distribution for any NdS + live analytics
   - Compact `buildDiceSummary(game)` for `finished.meta.diceStats`
   ========================================================================== */

(function (global) {
  'use strict';

  const DEFAULT_DICE_CONFIG = Object.freeze({
    count: 2,
    sides: 6,
    robberSum: 7
  });

  // Built-in per-game dice configs (extensible via registerDiceConfig or GAMES[type].dice)
  const DICE_CONFIGS = {
    catan: { count: 2, sides: 6, robberSum: 7 }
  };

  // Memoized combinatorial way-counts keyed by `${count}d${sides}`
  const WAYS_CACHE = new Map();

  // ---------------- Config Helpers ----------------
  function normalizeConfig(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const count = Math.max(1, Math.min(20, parseInt(raw.count, 10) || DEFAULT_DICE_CONFIG.count));
    const sides = Math.max(2, Math.min(100, parseInt(raw.sides, 10) || DEFAULT_DICE_CONFIG.sides));
    const minSum = count;
    const maxSum = count * sides;
    const robberRaw = raw.robberSum !== undefined ? parseInt(raw.robberSum, 10) : null;
    const robberSum = Number.isInteger(robberRaw) && robberRaw >= minSum && robberRaw <= maxSum
      ? robberRaw
      : null;
    return {
      count,
      sides,
      minSum,
      maxSum,
      robberSum,
      label: raw.label || `${count}d${sides}`
    };
  }

  function lookupInCatalog(gameType, catalog) {
    if (!gameType || !catalog) return null;
    if (Array.isArray(catalog)) {
      const hit = catalog.find((g) => g && g.id === gameType);
      return hit && hit.dice ? hit.dice : null;
    }
    if (typeof catalog === 'object') {
      const hit = catalog[gameType];
      return hit && hit.dice ? hit.dice : null;
    }
    return null;
  }

  function registerDiceConfig(gameType, config) {
    if (!gameType || typeof gameType !== 'string') return null;
    const norm = normalizeConfig(config);
    if (!norm) return null;
    DICE_CONFIGS[gameType] = { count: norm.count, sides: norm.sides, robberSum: norm.robberSum, label: norm.label };
    return norm;
  }

  /**
   * Returns normalized NdS config for a gameType string or game object,
   * or `null` if that game does not use dice.
   * Lookup order: game.diceConfig -> gamesCatalog[type].dice -> global.GAMES -> built-in DICE_CONFIGS.
   */
  function getDiceConfig(gameTypeOrGame, gamesCatalog) {
    if (!gameTypeOrGame) return null;
    if (typeof gameTypeOrGame === 'object') {
      if (gameTypeOrGame.diceConfig) return normalizeConfig(gameTypeOrGame.diceConfig);
      return getDiceConfig(gameTypeOrGame.type, gamesCatalog);
    }
    const type = String(gameTypeOrGame);
    const fromCatalog = lookupInCatalog(type, gamesCatalog) || lookupInCatalog(type, global.GAMES);
    if (fromCatalog) return normalizeConfig(fromCatalog);
    if (DICE_CONFIGS[type]) return normalizeConfig(DICE_CONFIGS[type]);
    return null;
  }

  function resolveConfig(game, opts) {
    const options = opts || {};
    if (options.config) return normalizeConfig(options.config);
    return getDiceConfig(game, options.gamesCatalog) || normalizeConfig(DEFAULT_DICE_CONFIG);
  }

  // ---------------- Fair RNG ----------------
  function getCryptoObj() {
    if (global.crypto && typeof global.crypto.getRandomValues === 'function') {
      return global.crypto;
    }
    return null;
  }

  /**
   * Unbiased integer in [1, sides] using rejection sampling on crypto.getRandomValues
   * when available, falling back to Math.random().
   */
  function rollDie(sides, rng) {
    if (typeof rng === 'function') {
      const v = Math.floor(rng() * sides) + 1;
      return Math.max(1, Math.min(sides, v));
    }
    const cryptoObj = getCryptoObj();
    if (cryptoObj) {
      const buf = new Uint32Array(1);
      const maxUnbiased = Math.floor(0x100000000 / sides) * sides;
      let val;
      do {
        cryptoObj.getRandomValues(buf);
        val = buf[0];
      } while (val >= maxUnbiased);
      return (val % sides) + 1;
    }
    return Math.floor(Math.random() * sides) + 1;
  }

  // ---------------- State Helpers ----------------
  function ensureDiceRolls(game) {
    if (!game || typeof game !== 'object') return [];
    if (!Array.isArray(game.diceRolls)) game.diceRolls = [];
    return game.diceRolls;
  }

  // ---------------- Actions ----------------
  /**
   * Performs a fair digital roll for `config.count` dice of `config.sides`,
   * appends `{ sum, dice, source: 'digital', ts }` to `game.diceRolls`, and returns it.
   */
  function rollDice(game, opts) {
    if (!game || typeof game !== 'object') return null;
    const cfg = resolveConfig(game, opts);
    const rng = opts && typeof opts.rng === 'function' ? opts.rng : null;
    const dice = [];
    let sum = 0;
    for (let i = 0; i < cfg.count; i++) {
      const d = rollDie(cfg.sides, rng);
      dice.push(d);
      sum += d;
    }
    const entry = {
      sum,
      dice,
      source: 'digital',
      ts: new Date().toISOString()
    };
    ensureDiceRolls(game).push(entry);
    return entry;
  }

  /**
   * Logs a physical/manual roll. Accepts either:
   * - a numeric sum in `[minSum, maxSum]` (sets `dice: null`)
   * - an array of `count` integers each in `[1, sides]`
   * Returns the appended entry, or `null` if invalid.
   */
  function logManualRoll(game, sumOrDice, opts) {
    if (!game || typeof game !== 'object') return null;
    const cfg = resolveConfig(game, opts);
    let sum = null;
    let dice = null;

    if (Array.isArray(sumOrDice)) {
      if (sumOrDice.length !== cfg.count) return null;
      const parsed = [];
      let total = 0;
      for (const raw of sumOrDice) {
        const n = typeof raw === 'number' ? raw : parseInt(String(raw).trim(), 10);
        if (!Number.isInteger(n) || n < 1 || n > cfg.sides) return null;
        parsed.push(n);
        total += n;
      }
      dice = parsed;
      sum = total;
    } else {
      const n = typeof sumOrDice === 'number' ? sumOrDice : parseInt(String(sumOrDice ?? '').trim(), 10);
      if (!Number.isInteger(n) || n < cfg.minSum || n > cfg.maxSum) return null;
      sum = n;
      dice = null;
    }

    const entry = {
      sum,
      dice,
      source: 'manual',
      ts: new Date().toISOString()
    };
    ensureDiceRolls(game).push(entry);
    return entry;
  }

  /**
   * Pops and returns the most recent roll entry, or `null` if none exist.
   */
  function undoLastRoll(game) {
    if (!game || !Array.isArray(game.diceRolls) || !game.diceRolls.length) return null;
    return game.diceRolls.pop();
  }

  /**
   * Clears all tracked rolls on `game` and returns the number cleared.
   */
  function clearRolls(game) {
    if (!game || typeof game !== 'object') return 0;
    const prevCount = Array.isArray(game.diceRolls) ? game.diceRolls.length : 0;
    game.diceRolls = [];
    return prevCount;
  }

  // ---------------- Combinatorial Analytics ----------------
  /**
   * Computes exact number of ways to achieve each sum for `count` dice of `sides`
   * via DP convolution. Returns `{ minSum, maxSum, totalOutcomes, waysBySum }`.
   */
  function computeExactWays(count, sides) {
    const key = `${count}d${sides}`;
    if (WAYS_CACHE.has(key)) return WAYS_CACHE.get(key);

    let dp = [1]; // 0 dice -> sum 0 has 1 way
    for (let d = 0; d < count; d++) {
      const next = new Array(dp.length + sides).fill(0);
      for (let s = 0; s < dp.length; s++) {
        if (!dp[s]) continue;
        for (let face = 1; face <= sides; face++) {
          next[s + face] += dp[s];
        }
      }
      dp = next;
    }

    const minSum = count;
    const maxSum = count * sides;
    const totalOutcomes = Math.pow(sides, count);
    const waysBySum = {};
    for (let sum = minSum; sum <= maxSum; sum++) {
      waysBySum[sum] = dp[sum] || 0;
    }

    const result = { minSum, maxSum, totalOutcomes, waysBySum };
    WAYS_CACHE.set(key, result);
    return result;
  }

  /**
   * Computes full roll distribution & analytics for `game`.
   */
  function getDistribution(game, opts) {
    const cfg = resolveConfig(game, opts);
    const rolls = Array.isArray(game && game.diceRolls) ? game.diceRolls : [];
    const exact = computeExactWays(cfg.count, cfg.sides);

    const counts = {};
    for (let s = cfg.minSum; s <= cfg.maxSum; s++) counts[s] = 0;

    let totalRolls = 0;
    let digitalCount = 0;
    let manualCount = 0;

    for (const r of rolls) {
      if (!r || !Number.isInteger(r.sum)) continue;
      if (r.sum < cfg.minSum || r.sum > cfg.maxSum) continue;
      counts[r.sum] = (counts[r.sum] || 0) + 1;
      totalRolls++;
      if (r.source === 'manual') manualCount++;
      else digitalCount++;
    }

    let maxCount = 0;
    for (let s = cfg.minSum; s <= cfg.maxSum; s++) {
      if (counts[s] > maxCount) maxCount = counts[s];
    }

    const hotSums = totalRolls >= 3 && maxCount > 0
      ? Object.keys(counts)
          .map(Number)
          .filter((s) => counts[s] === maxCount)
      : [];
    const hotSet = new Set(hotSums);

    const rows = [];
    for (let s = cfg.minSum; s <= cfg.maxSum; s++) {
      const ways = exact.waysBySum[s] || 0;
      const prob = ways / exact.totalOutcomes;
      const count = counts[s] || 0;
      rows.push({
        sum: s,
        ways,
        prob,
        theoreticalPct: prob * 100,
        count,
        actualPct: totalRolls > 0 ? (count / totalRolls) * 100 : 0,
        expectedCount: totalRolls * prob,
        isRobber: cfg.robberSum !== null && s === cfg.robberSum,
        isHot: hotSet.has(s)
      });
    }

    const recent = rolls.slice(-12).reverse();

    return {
      config: cfg,
      totalRolls,
      digitalCount,
      manualCount,
      maxCount,
      hotSums,
      counts,
      rows,
      recent
    };
  }

  // ---------------- History Summary ----------------
  /**
   * Builds a compact summary for `finished.meta.diceStats` when a game ends.
   * Returns `null` if no rolls were tracked.
   */
  function buildDiceSummary(game, opts) {
    const dist = getDistribution(game, opts);
    if (!dist.totalRolls) return null;
    return {
      config: {
        count: dist.config.count,
        sides: dist.config.sides,
        robberSum: dist.config.robberSum,
        label: dist.config.label
      },
      totalRolls: dist.totalRolls,
      digitalCount: dist.digitalCount,
      manualCount: dist.manualCount,
      counts: dist.counts
    };
  }

  const api = {
    DEFAULT_DICE_CONFIG,
    getDiceConfig,
    registerDiceConfig,
    ensureDiceRolls,
    rollDie,
    rollDice,
    logManualRoll,
    undoLastRoll,
    clearRolls,
    computeExactWays,
    getDistribution,
    buildDiceSummary
  };

  global.DiceLogic = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
