/* ==========================================================================
   TallyIt — Hearts Scoring Module (v23)
   ==========================================================================
   Zero-dependency UMD module for v3/engine.js & v3/shell.html.
   Exposes `window.TallyItHearts` in browsers and `module.exports` in Node.

   Features:
   - State initialization & normalization (`initState(game)`) honoring
     `TallyItHouseRules` overrides (`targetScore`, `jackOfDiamonds`,
     `moonSubtract` / `shootMoonSubtract`, `lowWins`) and legacy version labels.
   - Pass direction cycle (`getPassDirection(handIndex, playerCount)`):
       * 4p / even: Pass Left -> Pass Right -> Pass Across -> Hold
       * 3p:        Pass Left -> Pass Right -> Hold
       * 5p+:       Pass Left -> Pass Right -> Pass 2 Left -> Pass 2 Right -> Hold
   - Hand validation & scoring (`validateHand`, `scoreHand`):
       * Hearts (0–13), Queen of Spades (+13), optional Jack of Diamonds (-10),
         Shoot the Moon (+26 to all others, or -26 to shooter if `moonSubtract`).
       * Standard 26-point hand sum validation with clear warning + intentional
         override support (`allowNon26: true` or `overridePoints`).
   - Full hand history, `undoLastHand(state)`, `getStandings(state)`, and
     game-over detection when any player reaches `targetScore` (lowest wins).
   ========================================================================== */

(function (global) {
  'use strict';

  const DEFAULT_TARGET = 100;
  const STANDARD_HAND_SUM = 26;

  function cleanStr(v) {
    return String(v ?? '').trim();
  }

  function clampInt(v, min, max) {
    const n = typeof v === 'number' ? Math.trunc(v) : parseInt(String(v ?? '').trim(), 10);
    if (!Number.isFinite(n)) return 0;
    return Math.max(min, Math.min(max, n));
  }

  function resolveRules(game) {
    const g = (game && typeof game === 'object') ? game : {};
    const hr =
      (g.heartsRules && typeof g.heartsRules === 'object' ? g.heartsRules : null) ||
      (g.houseRules && typeof g.houseRules === 'object' ? g.houseRules : null) ||
      (g.scoringOverrides && g.scoringOverrides.houseRules && typeof g.scoringOverrides.houseRules === 'object' ? g.scoringOverrides.houseRules : null) ||
      (g.meta && g.meta.houseRules && typeof g.meta.houseRules === 'object' ? g.meta.houseRules : null) ||
      {};
    const ov = (g.scoringOverrides && typeof g.scoringOverrides === 'object') ? g.scoringOverrides : {};
    const version = cleanStr(g.version || g.versionLabel || g.variant);

    let targetScore = DEFAULT_TARGET;
    if (hr.targetScore !== undefined && Number(hr.targetScore) > 0) {
      targetScore = clampInt(hr.targetScore, 10, 1000);
    } else if (ov.targetScore !== undefined && Number(ov.targetScore) > 0) {
      targetScore = clampInt(ov.targetScore, 10, 1000);
    } else if (g.target !== undefined && g.target !== null && Number(g.target) > 0) {
      targetScore = clampInt(g.target, 10, 1000);
    } else if (/\b50\b/.test(version)) {
      targetScore = 50;
    }

    const jackOfDiamonds =
      hr.jackOfDiamonds !== undefined
        ? Boolean(hr.jackOfDiamonds)
        : /jack of diamonds|omnibus/i.test(version);

    const moonSubtract = Boolean(
      hr.moonSubtract !== undefined ? hr.moonSubtract : hr.shootMoonSubtract
    );

    const lowWins =
      hr.lowWins !== undefined
        ? Boolean(hr.lowWins)
        : (ov.lowWins !== undefined ? Boolean(ov.lowWins) : (typeof g.low === 'boolean' ? g.low : true));

    return {
      targetScore,
      jackOfDiamonds,
      moonSubtract,
      lowWins
    };
  }

  /**
   * Returns the pass direction descriptor for 0-based `handIndex` and `playerCount`.
   */
  function getPassDirection(handIndex, playerCount) {
    const idx = Math.max(0, Math.trunc(Number(handIndex) || 0));
    const n = Math.max(2, Math.trunc(Number(playerCount) || 4));

    let cycle;
    if (n === 3) {
      cycle = [
        { key: 'left',  label: 'Pass Left',  arrow: '←' },
        { key: 'right', label: 'Pass Right', arrow: '→' },
        { key: 'hold',  label: 'Hold',       arrow: '=' }
      ];
    } else if (n === 5) {
      cycle = [
        { key: 'left',   label: 'Pass Left',    arrow: '←' },
        { key: 'right',  label: 'Pass Right',   arrow: '→' },
        { key: 'left2',  label: 'Pass 2 Left',  arrow: '↞' },
        { key: 'right2', label: 'Pass 2 Right', arrow: '↠' },
        { key: 'hold',   label: 'Hold',         arrow: '=' }
      ];
    } else {
      // Standard 4-player (and 6p) cycle
      cycle = [
        { key: 'left',   label: 'Pass Left',   arrow: '←' },
        { key: 'right',  label: 'Pass Right',  arrow: '→' },
        { key: 'across', label: 'Pass Across', arrow: '↔' },
        { key: 'hold',   label: 'Hold',        arrow: '=' }
      ];
    }

    const item = cycle[idx % cycle.length];
    return {
      ...item,
      handNumber: idx + 1,
      cycleLength: cycle.length
    };
  }

  function getStandings(state) {
    const players = Array.isArray(state && state.players) ? state.players : [];
    const rules = resolveRules(state);
    const list = players.map((p, idx) => ({
      playerIdx: idx,
      name: cleanStr(p && p.name) || `Player ${idx + 1}`,
      userId: (p && (p.userId || p.user_id)) || null,
      score: Number(p && p.score) || 0,
      moonShots: Number(p && p.moonShots) || 0,
      queenHits: Number(p && p.queenHits) || 0,
      toTarget: Math.max(0, rules.targetScore - (Number(p && p.score) || 0))
    }));

    list.sort((a, b) => {
      const cmp = rules.lowWins ? (a.score - b.score) : (b.score - a.score);
      return cmp !== 0 ? cmp : (a.playerIdx - b.playerIdx);
    });

    let rank = 1;
    list.forEach((entry, i) => {
      if (i > 0 && entry.score !== list[i - 1].score) {
        rank = i + 1;
      }
      entry.rank = rank;
      entry.isWinner = rank === 1;
    });

    return list;
  }

  function recomputeCompletion(state) {
    const rules = resolveRules(state);
    state.heartsRules = rules;
    state.target = rules.targetScore;
    state.low = rules.lowWins;

    const players = Array.isArray(state.players) ? state.players : [];
    const reached = players.some((p) => (Number(p.score) || 0) >= rules.targetScore);
    const standings = getStandings(state);
    const winners = standings.filter((s) => s.isWinner);

    state.isGameOver = reached;
    state.winnerNames = reached ? winners.map((w) => w.name) : [];
    state.winner = state.winnerNames.join(', ');
    state.nextPass = getPassDirection((state.hands || []).length, players.length);
    return { isGameOver: reached, standings, winnerNames: state.winnerNames };
  }

  /**
   * Initializes or normalizes a Hearts game state object.
   * Accepts either an existing `engine.js` game object or a plain players array.
   */
  function initState(gameOrPlayers, opts) {
    const isArray = Array.isArray(gameOrPlayers);
    const state = isArray
      ? {
          id: (opts && opts.id) || ('ht_' + Date.now().toString(36)),
          type: 'hearts',
          gameName: 'Hearts',
          players: gameOrPlayers.map((p, i) =>
            typeof p === 'string'
              ? { name: cleanStr(p) || `Player ${i + 1}`, score: 0 }
              : { ...p, name: cleanStr(p && p.name) || `Player ${i + 1}`, score: Number(p && p.score) || 0 }
          ),
          ...(opts || {})
        }
      : (gameOrPlayers && typeof gameOrPlayers === 'object' ? gameOrPlayers : { players: [] });

    state.type = 'hearts';
    state.gameName = state.gameName || 'Hearts';
    if (!Array.isArray(state.players)) state.players = [];
    state.players.forEach((p, i) => {
      p.name = cleanStr(p.name) || `Player ${i + 1}`;
      p.score = Number(p.score) || 0;
      p.moonShots = Math.max(0, Math.trunc(Number(p.moonShots) || 0));
      p.queenHits = Math.max(0, Math.trunc(Number(p.queenHits) || 0));
    });

    if (!Array.isArray(state.hands)) {
      state.hands = Array.isArray(state.rounds) ? state.rounds.slice() : [];
    }
    if (!Array.isArray(state.rounds)) {
      state.rounds = state.hands.slice();
    }

    recomputeCompletion(state);
    return state;
  }

  /**
   * Validates a hand entry array before scoring.
   * Each entry: `{ hearts: 0..13, queenOfSpades: bool, jackOfDiamonds?: bool, shotMoon?: bool, overridePoints?: number }`
   */
  function validateHand(state, entries, opts) {
    const options = opts || {};
    const rules = resolveRules(state);
    const players = Array.isArray(state && state.players) ? state.players : [];
    const list = Array.isArray(entries) ? entries : [];

    if (!players.length) {
      return { ok: false, error: 'No players in game.', canOverride: false };
    }
    if (list.length !== players.length) {
      return { ok: false, error: `Expected ${players.length} hand entries, got ${list.length}.`, canOverride: false };
    }

    let heartsSum = 0;
    let queenCount = 0;
    let jackCount = 0;
    let explicitMoonIndices = [];
    let autoMoonIdx = -1;
    let hasOverride = false;

    const normalized = list.map((raw, idx) => {
      const e = (raw && typeof raw === 'object') ? raw : {};
      const hearts = clampInt(e.hearts, 0, 13);
      const queenOfSpades = Boolean(e.queenOfSpades);
      const jackOfDiamonds = Boolean(rules.jackOfDiamonds && e.jackOfDiamonds);
      const shotMoon = Boolean(e.shotMoon);
      const overrideVal =
        e.overridePoints !== undefined && e.overridePoints !== null && e.overridePoints !== '' && Number.isFinite(Number(e.overridePoints))
          ? Math.trunc(Number(e.overridePoints))
          : null;

      if (overrideVal !== null) hasOverride = true;
      heartsSum += hearts;
      if (queenOfSpades) queenCount += 1;
      if (jackOfDiamonds) jackCount += 1;
      if (shotMoon) explicitMoonIndices.push(idx);
      if (hearts === 13 && queenOfSpades) autoMoonIdx = idx;

      return { hearts, queenOfSpades, jackOfDiamonds, shotMoon, overridePoints: overrideVal };
    });

    if (explicitMoonIndices.length > 1) {
      return { ok: false, error: 'Only one player can Shoot the Moon in a hand.', canOverride: false };
    }
    if (queenCount > 1) {
      return { ok: false, error: 'Only one player can take the Queen of Spades.', canOverride: false };
    }
    if (jackCount > 1) {
      return { ok: false, error: 'Only one player can take the Jack of Diamonds.', canOverride: false };
    }

    const shooterIdx = explicitMoonIndices.length === 1 ? explicitMoonIndices[0] : autoMoonIdx;
    const rawBaseSum = heartsSum + queenCount * 13;

    let warning = null;
    if (shooterIdx < 0 && !hasOverride && rawBaseSum !== STANDARD_HAND_SUM) {
      const diff = rawBaseSum - STANDARD_HAND_SUM;
      warning = diff < 0
        ? `Hand points sum to ${rawBaseSum} instead of 26 (${Math.abs(diff)} pts missing).`
        : `Hand points sum to ${rawBaseSum} instead of 26 (${diff} extra pts).`;

      if (!options.allowNon26 && !options.force) {
        return {
          ok: false,
          error: warning,
          warning,
          canOverride: true,
          rawBaseSum,
          shooterIdx: -1,
          normalized
        };
      }
    }

    return {
      ok: true,
      warning,
      canOverride: false,
      rawBaseSum,
      shooterIdx,
      normalized
    };
  }

  /**
   * Scores one Hearts hand, updates running totals & history, and checks game end.
   */
  function scoreHand(state, entries, opts) {
    initState(state);
    const rules = resolveRules(state);
    const check = validateHand(state, entries, opts);
    if (!check.ok) return check;

    const prevScores = state.players.map((p) => Number(p.score) || 0);
    const prevMoonShots = state.players.map((p) => Number(p.moonShots) || 0);
    const prevQueenHits = state.players.map((p) => Number(p.queenHits) || 0);

    const shooterIdx = check.shooterIdx;
    const deltas = check.normalized.map((e, idx) => {
      if (e.overridePoints !== null) return e.overridePoints;

      let pts = 0;
      if (shooterIdx >= 0) {
        if (rules.moonSubtract) {
          pts = idx === shooterIdx ? -STANDARD_HAND_SUM : 0;
        } else {
          pts = idx === shooterIdx ? 0 : STANDARD_HAND_SUM;
        }
        if (rules.jackOfDiamonds && e.jackOfDiamonds) pts -= 10;
      } else {
        pts = e.hearts + (e.queenOfSpades ? 13 : 0) + (rules.jackOfDiamonds && e.jackOfDiamonds ? -10 : 0);
      }
      return pts;
    });

    state.players.forEach((p, idx) => {
      p.score = prevScores[idx] + deltas[idx];
      if (shooterIdx === idx) p.moonShots = prevMoonShots[idx] + 1;
      if (check.normalized[idx].queenOfSpades) p.queenHits = prevQueenHits[idx] + 1;
    });

    const handIndex = state.hands.length;
    const passDir = getPassDirection(handIndex, state.players.length);
    const record = {
      handNumber: handIndex + 1,
      ts: new Date().toISOString(),
      passDirection: passDir.key,
      passLabel: passDir.label,
      prev: prevScores,
      prevMoonShots,
      prevQueenHits,
      deltas,
      shooterIdx,
      moonMode: shooterIdx >= 0 ? (rules.moonSubtract ? 'subtract' : 'add_others') : null,
      entries: check.normalized,
      warning: check.warning || null
    };

    state.hands.push(record);
    state.rounds.push(record);

    const status = recomputeCompletion(state);
    return {
      ok: true,
      hand: record,
      deltas,
      warning: check.warning || null,
      ...status
    };
  }

  /**
   * Undoes the most recent Hearts hand and restores exact previous totals.
   */
  function undoLastHand(state) {
    initState(state);
    if (!state.hands.length) {
      return { ok: false, error: 'No hands to undo.' };
    }
    const last = state.hands.pop();
    if (state.rounds.length) state.rounds.pop();

    state.players.forEach((p, idx) => {
      if (Array.isArray(last.prev) && last.prev[idx] !== undefined) {
        p.score = Number(last.prev[idx]) || 0;
      } else if (Array.isArray(last.deltas) && last.deltas[idx] !== undefined) {
        p.score = (Number(p.score) || 0) - (Number(last.deltas[idx]) || 0);
      }
      if (Array.isArray(last.prevMoonShots) && last.prevMoonShots[idx] !== undefined) {
        p.moonShots = last.prevMoonShots[idx];
      }
      if (Array.isArray(last.prevQueenHits) && last.prevQueenHits[idx] !== undefined) {
        p.queenHits = last.prevQueenHits[idx];
      }
    });

    const status = recomputeCompletion(state);
    return { ok: true, undone: last, ...status };
  }

  const api = {
    DEFAULT_TARGET,
    STANDARD_HAND_SUM,
    resolveRules,
    initState,
    getPassDirection,
    validateHand,
    scoreHand,
    undoLastHand,
    getStandings
  };

  global.TallyItHearts = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
