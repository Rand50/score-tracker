/*
 * TallyIt v24 — Qwirkle scoring logic.
 * Exposes `window.TallyItQwirkle` in browsers and `module.exports` in Node.
 * Pure state helpers: no DOM. Honors `TallyItHouseRules` overrides.
 *
 * Rules (defaults):
 *   - Each turn scores the line points the player entered.
 *   - Each Qwirkle (a completed line of 6) adds +6 on top of the line points.
 *   - Going out (first to empty hand when the bag is empty) adds +6 and ends the game.
 *   - Highest score wins.
 */
(function (global) {
  'use strict';

  const TOTAL_TILES = 108;
  const HAND_SIZE = 6;
  const DEFAULT_RULES = Object.freeze({
    qwirkleBonus: 6,
    wentOutBonus: 6,
    targetScore: 0,   // 0 = no target; game ends when someone goes out
    trackBag: true,
    lowWins: false
  });

  function toInt(v, fallback) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : fallback;
  }

  function clone(v) {
    return v === undefined ? v : JSON.parse(JSON.stringify(v));
  }

  function pickHouseRules(game) {
    if (!game || typeof game !== 'object') return {};
    const out = {};
    const hrApi = global.TallyItHouseRules;
    if (game.houseRules && typeof game.houseRules === 'object') Object.assign(out, game.houseRules);
    if (game.scoringOverrides && typeof game.scoringOverrides === 'object') {
      const so = game.scoringOverrides;
      if (so.houseRules && typeof so.houseRules === 'object') Object.assign(out, so.houseRules);
      ['targetScore', 'lowWins', 'qwirkleBonus', 'wentOutBonus', 'trackBag'].forEach((k) => {
        if (so[k] !== undefined && so[k] !== null) out[k] = so[k];
      });
    }
    if (game.customRules && hrApi && typeof hrApi.buildScoringOverrides === 'function') {
      try {
        const so = hrApi.buildScoringOverrides('qwirkle', game.customRules);
        if (so && so.houseRules) Object.assign(out, so.houseRules);
      } catch (_) {}
    }
    return out;
  }

  function resolveRules(game) {
    const hr = pickHouseRules(game);
    const rules = { ...DEFAULT_RULES };
    if (hr.qwirkleBonus !== undefined) rules.qwirkleBonus = Math.max(0, toInt(hr.qwirkleBonus, 6));
    if (hr.wentOutBonus !== undefined) rules.wentOutBonus = Math.max(0, toInt(hr.wentOutBonus, 6));
    if (hr.targetScore !== undefined && hr.targetScore !== null) rules.targetScore = Math.max(0, toInt(hr.targetScore, 0));
    if (hr.trackBag !== undefined) rules.trackBag = Boolean(hr.trackBag);
    if (hr.lowWins !== undefined) rules.lowWins = Boolean(hr.lowWins);
    if (game && game.target !== undefined && hr.targetScore === undefined && Number(game.target) > 0) {
      rules.targetScore = toInt(game.target, 0);
    }
    return rules;
  }

  function normalizePlayers(raw) {
    const list = Array.isArray(raw) ? raw : [];
    return list.map((p, i) => {
      const base = typeof p === 'string' ? { name: p } : (p && typeof p === 'object' ? p : {});
      const name = String(base.name || base.display_name || base.displayName || ('Player ' + (i + 1))).trim();
      return {
        ...base,
        name,
        score: toInt(base.score, 0),
        qwirkles: Math.max(0, toInt(base.qwirkles, 0)),
        bestTurn: Math.max(0, toInt(base.bestTurn, 0)),
        turns: Math.max(0, toInt(base.turns, 0)),
        wentOut: Boolean(base.wentOut)
      };
    });
  }

  /**
   * initState(gameOrPlayers, opts)
   *   gameOrPlayers: array of names/player objects, or a game object { players, houseRules, ... }
   *   opts: { houseRules, startingPlayer, tilesInBag, trackBag }
   */
  function initState(gameOrPlayers, opts) {
    opts = opts || {};
    const game = Array.isArray(gameOrPlayers) ? { players: gameOrPlayers } : (gameOrPlayers || {});
    const merged = { ...game };
    if (opts.houseRules) merged.houseRules = { ...(game.houseRules || {}), ...opts.houseRules };
    const rules = resolveRules(merged);
    if (opts.trackBag !== undefined) rules.trackBag = Boolean(opts.trackBag);
    const players = normalizePlayers(game.players);
    if (players.length < 2 || players.length > 4) {
      // Qwirkle is officially 2–4 players; allow up to 6 for casual play but flag it.
    }
    const n = players.length;
    const startingPlayer = n ? ((toInt(opts.startingPlayer ?? game.startingPlayer, 0) % n) + n) % n : 0;
    const openingTiles = n * HAND_SIZE;
    const tilesInBag = rules.trackBag
      ? Math.max(0, toInt(opts.tilesInBag ?? game.tilesInBag, TOTAL_TILES - openingTiles))
      : null;
    const state = {
      type: 'qwirkle',
      gameKey: 'qwirkle',
      rules,
      qwirkleRules: rules,
      players,
      startingPlayer,
      currentPlayerIndex: toInt(game.currentPlayerIndex, startingPlayer),
      turnNumber: Math.max(0, toInt(game.turnNumber, 0)),
      tilesInBag,
      history: Array.isArray(game.history) ? clone(game.history) : [],
      rounds: Array.isArray(game.rounds) ? clone(game.rounds) : [],
      isGameOver: Boolean(game.isGameOver),
      winnerIndices: Array.isArray(game.winnerIndices) ? game.winnerIndices.slice() : [],
      winnerNames: Array.isArray(game.winnerNames) ? game.winnerNames.slice() : [],
      endReason: game.endReason || null
    };
    return state;
  }

  function getCurrentPlayer(state) {
    if (!state || !state.players.length) return null;
    return { index: state.currentPlayerIndex, name: state.players[state.currentPlayerIndex].name };
  }

  function nextPlayerIndex(state, fromIdx) {
    const n = state.players.length;
    if (!n) return 0;
    return ((toInt(fromIdx, state.currentPlayerIndex) + 1) % n + n) % n;
  }

  function computeTurnPoints(rules, points, opts) {
    const base = Math.max(0, toInt(points, 0));
    const qwirkles = Math.max(0, toInt(opts && opts.qwirkles, 0));
    const wentOut = Boolean(opts && opts.wentOut);
    const qwirkleBonus = qwirkles * rules.qwirkleBonus;
    const wentOutBonus = wentOut ? rules.wentOutBonus : 0;
    return { base, qwirkles, qwirkleBonus, wentOut, wentOutBonus, total: base + qwirkleBonus + wentOutBonus };
  }

  function computeWinners(state) {
    const players = state.players;
    if (!players.length) return { indices: [], names: [] };
    const scores = players.map((p) => p.score);
    const best = state.rules.lowWins ? Math.min(...scores) : Math.max(...scores);
    const indices = scores.map((s, i) => (s === best ? i : -1)).filter((i) => i >= 0);
    return { indices, names: indices.map((i) => players[i].name) };
  }

  function finalize(state, reason) {
    const w = computeWinners(state);
    state.isGameOver = true;
    state.endReason = reason;
    state.winnerIndices = w.indices;
    state.winnerNames = w.names;
    state.players.forEach((p, i) => { p.isWinner = w.indices.includes(i); });
  }

  /**
   * scoreTurn(state, playerIdx, points, { qwirkles, wentOut, tilesPlayed, tilesDrawn, enforceTurnOrder, note })
   *   - points: line points scored this turn (excluding Qwirkle/went-out bonuses).
   *   - qwirkles: number of lines of 6 completed this turn (+qwirkleBonus each, default +6).
   *   - wentOut: player emptied their hand with the bag empty (+wentOutBonus, default +6) and ends the game.
   *   - tilesPlayed: optional; reduces bag by the refill (min(tilesPlayed, bag)).
   * Returns { ok, error?, turn, state }.
   */
  function scoreTurn(state, playerIdx, points, opts) {
    opts = opts || {};
    if (!state || !Array.isArray(state.players) || !state.players.length) {
      return { ok: false, error: 'No players in this Qwirkle game.' };
    }
    if (state.isGameOver) return { ok: false, error: 'The game is already over. Undo the last turn to keep playing.' };
    const idx = playerIdx === undefined || playerIdx === null ? state.currentPlayerIndex : toInt(playerIdx, -1);
    if (idx < 0 || idx >= state.players.length) return { ok: false, error: 'Invalid player index: ' + playerIdx };
    if (opts.enforceTurnOrder && idx !== state.currentPlayerIndex) {
      return { ok: false, error: 'It is ' + state.players[state.currentPlayerIndex].name + "'s turn." };
    }
    const rawPts = Number(points);
    if (!Number.isFinite(rawPts) || rawPts < 0) return { ok: false, error: 'Points must be a number 0 or greater.' };
    const q = toInt(opts.qwirkles, 0);
    if (q < 0 || q > 4) return { ok: false, error: 'Qwirkles per turn must be between 0 and 4.' };
    if (q > 0 && rawPts < 6 * q) {
      return { ok: false, error: 'Each Qwirkle line is worth at least 6 line points; ' + q + ' Qwirkle(s) need at least ' + (6 * q) + ' line points.' };
    }
    if (opts.wentOut && state.rules.trackBag && state.tilesInBag > 0 && !opts.force) {
      return { ok: false, error: 'You can only go out once the bag is empty (' + state.tilesInBag + ' tiles left). Pass force: true to override.' };
    }

    const calc = computeTurnPoints(state.rules, rawPts, opts);
    const snapshot = {
      players: clone(state.players),
      currentPlayerIndex: state.currentPlayerIndex,
      turnNumber: state.turnNumber,
      tilesInBag: state.tilesInBag,
      isGameOver: state.isGameOver,
      winnerIndices: state.winnerIndices.slice(),
      winnerNames: state.winnerNames.slice(),
      endReason: state.endReason
    };

    const p = state.players[idx];
    p.score += calc.total;
    p.turns += 1;
    p.qwirkles += calc.qwirkles;
    if (calc.total > p.bestTurn) p.bestTurn = calc.total;

    let tilesDrawn = 0;
    if (state.rules.trackBag && state.tilesInBag !== null) {
      const want = opts.tilesDrawn !== undefined ? toInt(opts.tilesDrawn, 0)
        : (opts.tilesPlayed !== undefined ? toInt(opts.tilesPlayed, 0) : 0);
      tilesDrawn = Math.max(0, Math.min(want, state.tilesInBag));
      state.tilesInBag -= tilesDrawn;
    }

    state.turnNumber += 1;
    const turn = {
      turn: state.turnNumber,
      playerIdx: idx,
      playerName: p.name,
      points: calc.base,
      qwirkles: calc.qwirkles,
      qwirkleBonus: calc.qwirkleBonus,
      wentOut: calc.wentOut,
      wentOutBonus: calc.wentOutBonus,
      total: calc.total,
      tilesDrawn,
      tilesInBagAfter: state.tilesInBag,
      runningScore: p.score,
      note: opts.note || null,
      at: opts.at || new Date().toISOString()
    };
    state.history.push({ ...turn, _snapshot: snapshot });
    state.rounds.push({ playerIdx: idx, score: calc.total, detail: { points: calc.base, qwirkles: calc.qwirkles, wentOut: calc.wentOut } });
    state.currentPlayerIndex = nextPlayerIndex(state, idx);

    if (calc.wentOut) {
      p.wentOut = true;
      finalize(state, 'went_out');
    } else if (state.rules.targetScore > 0 && p.score >= state.rules.targetScore) {
      finalize(state, 'target');
    }
    return { ok: true, turn, state };
  }

  /** Records a pass/swap (0 points) and advances turn; optional tiles swapped don't change the bag size. */
  function passTurn(state, playerIdx, opts) {
    return scoreTurn(state, playerIdx, 0, { ...(opts || {}), qwirkles: 0, wentOut: false, tilesDrawn: 0, note: (opts && opts.note) || 'Pass / swap' });
  }

  function endGame(state, reason) {
    if (!state || state.isGameOver) return { ok: false, error: 'Game already over.' };
    finalize(state, reason || 'manual');
    return { ok: true, state };
  }

  function undoLastTurn(state) {
    if (!state || !state.history.length) return { ok: false, error: 'Nothing to undo.' };
    const last = state.history.pop();
    state.rounds.pop();
    const s = last._snapshot;
    state.players = s.players;
    state.currentPlayerIndex = s.currentPlayerIndex;
    state.turnNumber = s.turnNumber;
    state.tilesInBag = s.tilesInBag;
    state.isGameOver = s.isGameOver;
    state.winnerIndices = s.winnerIndices;
    state.winnerNames = s.winnerNames;
    state.endReason = s.endReason;
    const undone = { ...last };
    delete undone._snapshot;
    return { ok: true, undone, state };
  }

  function getHistory(state) {
    return (state && state.history ? state.history : []).map((h) => {
      const c = { ...h };
      delete c._snapshot;
      return c;
    });
  }

  function getStandings(state) {
    const low = state.rules.lowWins;
    const rows = state.players.map((p, i) => ({ index: i, name: p.name, score: p.score, qwirkles: p.qwirkles, bestTurn: p.bestTurn, turns: p.turns }));
    rows.sort((a, b) => (low ? a.score - b.score : b.score - a.score) || a.index - b.index);
    let rank = 0;
    let prev = null;
    rows.forEach((r, i) => {
      if (prev === null || r.score !== prev) rank = i + 1;
      r.rank = rank;
      prev = r.score;
    });
    return rows;
  }

  function getStats(state) {
    const hist = getHistory(state);
    let bestTurn = null;
    hist.forEach((h) => {
      if (!bestTurn || h.total > bestTurn.total) bestTurn = { playerIdx: h.playerIdx, playerName: h.playerName, total: h.total, turn: h.turn, qwirkles: h.qwirkles };
    });
    const totalQwirkles = state.players.reduce((s, p) => s + p.qwirkles, 0);
    const perPlayer = state.players.map((p, i) => ({
      index: i,
      name: p.name,
      score: p.score,
      turns: p.turns,
      qwirkles: p.qwirkles,
      bestTurn: p.bestTurn,
      avgPerTurn: p.turns ? Number((p.score / p.turns).toFixed(1)) : 0
    }));
    return { bestTurn, totalQwirkles, totalTurns: hist.length, tilesInBag: state.tilesInBag, perPlayer };
  }

  /** Serializes to the engine/social_scoring game shape { type, players:[{name,score,...}], rounds }. */
  function toGameRecord(state, extra) {
    return {
      type: 'qwirkle',
      players: state.players.map((p) => ({ ...p })),
      rounds: clone(state.rounds),
      target: state.rules.targetScore || null,
      houseRules: { ...state.rules },
      winnerNames: state.winnerNames.slice(),
      meta: { totalQwirkles: getStats(state).totalQwirkles, endReason: state.endReason },
      ...(extra || {})
    };
  }

  const api = {
    TOTAL_TILES,
    HAND_SIZE,
    DEFAULT_RULES,
    resolveRules,
    initState,
    getCurrentPlayer,
    nextPlayerIndex,
    computeTurnPoints,
    scoreTurn,
    passTurn,
    endGame,
    undoLastTurn,
    getHistory,
    getStandings,
    getStats,
    toGameRecord
  };

  global.TallyItQwirkle = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
