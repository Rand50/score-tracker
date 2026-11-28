/* ==========================================================================
   Score Tracker — Rummikub Scoring Module (Classic Blue & Ivory Rack)
   ==========================================================================
   Drop-in logic module for v3/engine.js. Exposes `window.RummikubLogic` in
   browsers and `module.exports` in Node.

   Supports:
   - 2–6 players (MAX_PLAYERS = 6; auto-seeds signed-in user as Player 1 when
     fresh; compatible with Social Group presets)
   - 6 distinct Rummikub tile badge colors (red, blue, orange, black, teal, plum)
   - Two scoring modes (`rkScoringMode`):
     * 'points_up' (default): leftover tile points only go UP (delta >= 0),
       Joker penalty adds +30, LOWEST score wins (`low: true`).
     * 'classic': signed delta (+ / -), Joker penalty subtracts -30,
       HIGHEST score wins (`low: false`).
   - Safe arithmetic calculator helper `rkCalcEval(expr, modeOrGame)` (+ / - chains,
     no eval()) for summing leftover tiles directly into `rkSetDraftDelta`
   - No "who went out" state; Undo Last Round, round log, mid-game add/remove,
     and History / Supabase / Group Leaderboard compatibility
   ========================================================================== */

(function (global) {
  'use strict';

  const MAX_PLAYERS = 6;
  const JOKER_PENALTY = 30;
  const DEFAULT_SCORING_MODE = 'points_up';

  const RK_COLORS = [
    { key: 'red',    label: 'Tile Red',    hex: '#c82333', bg: '#fff5f5' },
    { key: 'blue',   label: 'Tile Blue',   hex: '#1d4ed8', bg: '#eff6ff' },
    { key: 'orange', label: 'Tile Orange', hex: '#d97706', bg: '#fffbeb' },
    { key: 'black',  label: 'Tile Black',  hex: '#1f2937', bg: '#f3f4f6' },
    { key: 'teal',   label: 'Tile Teal',   hex: '#0f766e', bg: '#f0fdfa' },
    { key: 'plum',   label: 'Tile Plum',   hex: '#7e22ce', bg: '#faf5ff' }
  ];

  // ---------------- Helpers ----------------
  function uid(prefix) {
    return (prefix || 'rk') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
  }

  function cleanStr(v) {
    return String(v ?? '').trim();
  }

  function isPointsUpMode(gameOrMode) {
    if (typeof gameOrMode === 'string') return gameOrMode !== 'classic';
    if (gameOrMode && typeof gameOrMode === 'object') {
      return gameOrMode.rkScoringMode !== 'classic';
    }
    return true;
  }

  function parseSignedInt(v) {
    const raw = String(v ?? '').trim();
    if (!raw || raw === '-' || raw === '+') return 0;
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n)) return 0;
    return Math.max(-9999, Math.min(9999, n));
  }

  function parseDeltaForMode(v, gameOrMode) {
    const n = parseSignedInt(v);
    return isPointsUpMode(gameOrMode) ? Math.max(0, n) : n;
  }

  function normalizePlayerInput(raw) {
    if (typeof raw === 'string') {
      const name = cleanStr(raw);
      return name ? { name, userId: null, isSelf: false } : null;
    }
    if (!raw || typeof raw !== 'object') return null;
    const name = cleanStr(raw.name || raw.display_name || raw.displayName || (raw.profile && raw.profile.display_name));
    if (!name) return null;
    const userId = raw.userId ?? raw.user_id ?? (raw.profile && raw.profile.id) ?? null;
    return {
      name,
      userId: userId ? String(userId) : null,
      isSelf: Boolean(raw.isSelf || raw.is_self)
    };
  }

  function rkColor(key) {
    return RK_COLORS.find((c) => c.key === key) || RK_COLORS[0];
  }

  function rkFreeColor(game, skipIdx, afterKey) {
    const players = (game && Array.isArray(game.players)) ? game.players : [];
    const counts = new Map(RK_COLORS.map((c) => [c.key, 0]));
    players.forEach((p, i) => {
      if (i === skipIdx || !p || !p.color) return;
      if (counts.has(p.color)) counts.set(p.color, counts.get(p.color) + 1);
    });
    const minUsed = Math.min(...counts.values());
    const start = afterKey ? RK_COLORS.findIndex((c) => c.key === afterKey) : -1;
    for (let step = 1; step <= RK_COLORS.length; step++) {
      const c = RK_COLORS[(start + step + RK_COLORS.length) % RK_COLORS.length];
      if (counts.get(c.key) === minUsed) return c.key;
    }
    return RK_COLORS[(start + 1 + RK_COLORS.length) % RK_COLORS.length].key;
  }

  function emptyDraftEntry() {
    return { delta: 0, jokers: 0, touched: false };
  }

  function ensureDraft(game) {
    if (!game.rkDraft || typeof game.rkDraft !== 'object') {
      game.rkDraft = {};
    }
    const next = {};
    (game.players || []).forEach((_, idx) => {
      const cur = game.rkDraft[idx];
      if (cur && typeof cur === 'object') {
        next[idx] = {
          delta: parseDeltaForMode(cur.delta, game),
          jokers: Math.max(0, parseInt(cur.jokers, 10) || 0),
          touched: Boolean(cur.touched)
        };
      } else {
        next[idx] = emptyDraftEntry();
      }
    });
    game.rkDraft = next;
    return game.rkDraft;
  }

  // ---------------- Safe Arithmetic Calculator (no eval()) ----------------
  /**
   * Pure safe evaluator for `+` and `-` (or `−`) integer chains, e.g.:
   *   "12 + 9 + 7 + 30" -> 58
   *   "50 - 12 + 5"     -> 43
   * Clamps result to `>= 0` in `'points_up'` mode (default).
   * Returns `null` if the expression is empty or contains invalid tokens.
   */
  function rkCalcEval(expr, modeOrGame) {
    if (expr === null || expr === undefined) return null;
    // Normalize unicode minus / en-dash and whitespace
    const normalized = String(expr)
      .replace(/[\u2212\u2013]/g, '-')
      .replace(/\s+/g, '');
    if (!normalized) return null;
    // Allow only digits, +, and -
    if (!/^[0-9+-]+$/.test(normalized)) return null;

    let i = 0;
    let total = 0;
    let sign = 1;
    let sawNumber = false;

    while (i < normalized.length) {
      const ch = normalized[i];
      if (ch === '+') {
        sign = 1;
        i++;
        continue;
      }
      if (ch === '-') {
        sign = -sign;
        i++;
        continue;
      }
      let start = i;
      while (i < normalized.length && normalized[i] >= '0' && normalized[i] <= '9') {
        i++;
      }
      const num = parseInt(normalized.slice(start, i), 10);
      if (!Number.isFinite(num)) return null;
      total += sign * num;
      sign = 1;
      sawNumber = true;
    }

    if (!sawNumber) return null;
    const clamped = Math.max(-9999, Math.min(9999, total));
    return isPointsUpMode(modeOrGame) ? Math.max(0, clamped) : clamped;
  }

  // ---------------- Initialization & Normalization ----------------
  /**
   * Normalizes a Rummikub game object in-place (works for fresh games,
   * Social Group presets, and restored `gst_active` state).
   * Auto-seeds `opts.selfPlayer` as Player 1 when starting fresh with no players.
   */
  function rkNormalize(game, opts) {
    if (!game || typeof game !== 'object') return null;
    const options = opts || {};

    game.type = 'rummikub';
    game.rkScoringMode = game.rkScoringMode === 'classic' ? 'classic' : DEFAULT_SCORING_MODE;
    game.low = game.rkScoringMode === 'points_up';
    game.rkLogOpen = Boolean(game.rkLogOpen);
    game.rounds = Array.isArray(game.rounds) ? game.rounds : [];
    game.players = Array.isArray(game.players) ? game.players.slice(0, MAX_PLAYERS) : [];

    // Auto-seed signed-in user as Player 1 when starting fresh with empty players
    if (!game.players.length && options.selfPlayer) {
      const self = normalizePlayerInput(options.selfPlayer);
      if (self) {
        self.isSelf = true;
        game.players.push({
          id: uid('rk'),
          ...self,
          score: 0,
          color: RK_COLORS[0].key
        });
      }
    }

    game.players.forEach((p, idx) => {
      if (!p.id) p.id = uid('rk');
      p.name = cleanStr(p.name) || `Player ${idx + 1}`;
      p.score = Number.isFinite(Number(p.score)) ? Number(p.score) : 0;
      if (p.userId === undefined) p.userId = p.user_id ?? null;
      p.isSelf = Boolean(p.isSelf || p.is_self);
      if (!RK_COLORS.some((c) => c.key === p.color)) {
        p.color = RK_COLORS[idx % RK_COLORS.length].key;
      }
    });

    ensureDraft(game);
    return game;
  }

  // ---------------- Scoring Mode Toggle ----------------
  /**
   * Switches between `'points_up'` (default; non-negative deltas, Joker +30, lowest wins)
   * and `'classic'` (signed deltas, Joker -30, highest wins).
   */
  function rkSetScoringMode(game, mode, opts) {
    if (!game || (mode !== 'points_up' && mode !== 'classic')) {
      return { ok: false, reason: 'invalid_mode' };
    }
    const options = opts || {};
    game.rkScoringMode = mode;
    game.low = mode === 'points_up';

    if (options.reset) {
      rkResetScores(game);
    } else {
      ensureDraft(game);
    }
    return { ok: true, mode: game.rkScoringMode, low: game.low };
  }

  // ---------------- Player Management (2–6 players) ----------------
  function rkAddPlayer(game, rawPlayer) {
    if (!game || typeof game !== 'object') return null;
    if (!Array.isArray(game.players)) game.players = [];
    if (game.players.length >= MAX_PLAYERS) return null;

    const p = normalizePlayerInput(rawPlayer);
    if (!p) return null;
    if (game.players.some((ex) => ex.name.toLowerCase() === p.name.toLowerCase())) return null;

    const entry = {
      id: uid('rk'),
      name: p.name,
      userId: p.userId,
      isSelf: p.isSelf,
      score: 0,
      color: rkFreeColor(game, -1, null)
    };
    game.players.push(entry);
    ensureDraft(game);
    return entry;
  }

  function rkRemovePlayer(game, idx) {
    if (!game || !Array.isArray(game.players) || !game.players[idx]) return false;
    if (game.players.length <= 1) return false;
    game.players.splice(idx, 1);

    const oldDraft = game.rkDraft || {};
    const nextDraft = {};
    let nextIdx = 0;
    for (let i = 0; i <= game.players.length; i++) {
      if (i === idx) continue;
      if (oldDraft[i]) nextDraft[nextIdx] = oldDraft[i];
      nextIdx++;
    }
    game.rkDraft = nextDraft;
    ensureDraft(game);
    return true;
  }

  function rkCycleColor(game, idx) {
    if (!game || !game.players || !game.players[idx]) return null;
    const p = game.players[idx];
    const curPos = RK_COLORS.findIndex((c) => c.key === p.color);
    p.color = RK_COLORS[(curPos + 1) % RK_COLORS.length].key;
    return p.color;
  }

  function rkPickColor(game, idx, colorKey) {
    if (!game || !game.players || !game.players[idx]) return false;
    if (!RK_COLORS.some((c) => c.key === colorKey)) return false;
    game.players[idx].color = colorKey;
    return true;
  }

  // ---------------- Round Scoring Draft & Apply ----------------
  function rkSetDraftDelta(game, idx, value) {
    if (!game || !game.players || !game.players[idx]) return null;
    ensureDraft(game);
    const d = game.rkDraft[idx];
    d.delta = parseDeltaForMode(value, game);
    d.touched = true;
    return {
      delta: d.delta,
      jokers: d.jokers,
      touched: d.touched,
      projectedTotal: (Number(game.players[idx].score) || 0) + d.delta
    };
  }

  function rkStepDraftDelta(game, idx, step) {
    if (!game || !game.players || !game.players[idx]) return null;
    ensureDraft(game);
    const d = game.rkDraft[idx];
    return rkSetDraftDelta(game, idx, d.delta + (Number(step) || 0));
  }

  /**
   * Applies one Joker penalty:
   * - `'points_up'` mode: adds +30 to leftover tile points
   * - `'classic'` mode: subtracts -30 from round score
   */
  function rkApplyJokerPenalty(game, idx) {
    if (!game || !game.players || !game.players[idx]) return null;
    ensureDraft(game);
    const d = game.rkDraft[idx];
    const change = isPointsUpMode(game) ? JOKER_PENALTY : -JOKER_PENALTY;
    d.delta = parseDeltaForMode(d.delta + change, game);
    d.jokers = (Number(d.jokers) || 0) + 1;
    d.touched = true;
    return {
      delta: d.delta,
      jokers: d.jokers,
      touched: d.touched,
      projectedTotal: (Number(game.players[idx].score) || 0) + d.delta
    };
  }

  /**
   * Reverts one Joker penalty from the current draft if tapped by mistake.
   */
  function rkRemoveJokerPenalty(game, idx) {
    if (!game || !game.players || !game.players[idx]) return null;
    ensureDraft(game);
    const d = game.rkDraft[idx];
    if (!d.jokers || d.jokers <= 0) {
      return {
        delta: d.delta,
        jokers: 0,
        touched: d.touched,
        projectedTotal: (Number(game.players[idx].score) || 0) + d.delta
      };
    }
    const change = isPointsUpMode(game) ? -JOKER_PENALTY : JOKER_PENALTY;
    d.delta = parseDeltaForMode(d.delta + change, game);
    d.jokers = Math.max(0, d.jokers - 1);
    d.touched = true;
    return {
      delta: d.delta,
      jokers: d.jokers,
      touched: d.touched,
      projectedTotal: (Number(game.players[idx].score) || 0) + d.delta
    };
  }

  function rkClearDraft(game) {
    if (!game) return;
    game.rkDraft = {};
    ensureDraft(game);
  }

  function rkGetDraftSummary(game) {
    if (!game || !Array.isArray(game.players)) {
      return { rows: [], hasAnyInput: false };
    }
    ensureDraft(game);
    let hasAnyInput = false;
    const rows = game.players.map((p, idx) => {
      const d = game.rkDraft[idx] || emptyDraftEntry();
      if (d.touched) hasAnyInput = true;
      return {
        idx,
        name: p.name,
        delta: d.delta,
        jokers: d.jokers,
        touched: d.touched,
        projectedTotal: (Number(p.score) || 0) + d.delta
      };
    });
    return { rows, hasAnyInput };
  }

  function rkApplyRound(game) {
    if (!game || !Array.isArray(game.players) || !game.players.length) return null;
    const summary = rkGetDraftSummary(game);
    if (!summary.hasAnyInput) return null;

    const prev = game.players.map((p) => Number(p.score) || 0);
    const deltas = summary.rows.map((r) => r.delta);

    game.players.forEach((p, idx) => {
      p.score = prev[idx] + deltas[idx];
    });

    const round = {
      ts: new Date().toISOString(),
      scoringMode: game.rkScoringMode || DEFAULT_SCORING_MODE,
      prev,
      deltas,
      detail: {
        scoringMode: game.rkScoringMode || DEFAULT_SCORING_MODE,
        entries: summary.rows.map((r) => ({
          idx: r.idx,
          name: r.name,
          delta: r.delta,
          jokers: r.jokers
        }))
      }
    };

    game.rounds = Array.isArray(game.rounds) ? game.rounds : [];
    game.rounds.push(round);

    rkClearDraft(game);
    return round;
  }

  function rkUndoLastRound(game) {
    if (!game || !Array.isArray(game.rounds) || !game.rounds.length) return null;
    const last = game.rounds.pop();

    game.players.forEach((p, idx) => {
      if (Array.isArray(last.prev) && last.prev[idx] !== undefined) {
        p.score = Number(last.prev[idx]) || 0;
      } else {
        p.score = (Number(p.score) || 0) - ((last.deltas && last.deltas[idx]) || 0);
      }
    });

    return last;
  }

  function rkResetScores(game) {
    if (!game || !Array.isArray(game.players)) return;
    game.players.forEach((p) => {
      p.score = 0;
    });
    game.rounds = [];
    game.winner = null;
    rkClearDraft(game);
  }

  function rkToggleLog(game) {
    if (!game) return false;
    game.rkLogOpen = !game.rkLogOpen;
    return game.rkLogOpen;
  }

  // ---------------- Leaders & Finish ----------------
  /**
   * Returns current leader(s):
   * - `'points_up'` mode: LOWEST score wins (`low: true`)
   * - `'classic'` mode: HIGHEST score wins (`low: false`)
   */
  function rkLeaders(game) {
    const low = isPointsUpMode(game);
    if (!game || !Array.isArray(game.players) || !game.players.length) {
      return { bestScore: null, leaderIndices: [], leaders: [], low };
    }
    const scores = game.players.map((p) => Number(p.score) || 0);
    const bestScore = low ? Math.min(...scores) : Math.max(...scores);
    const hasActivity = (Array.isArray(game.rounds) && game.rounds.length > 0) || scores.some((s) => s !== 0);
    const leaderIndices = hasActivity
      ? scores.map((s, i) => (s === bestScore ? i : -1)).filter((i) => i >= 0)
      : [];
    const leaders = leaderIndices.map((i) => game.players[i]);
    return { bestScore, leaderIndices, leaders, low };
  }

  /**
   * Prepares a finished Rummikub game record compatible with `saveGameToHistory`,
   * Supabase `games` / `game_participants`, and Group Leaderboards.
   */
  function rkPrepareFinish(game) {
    if (!game) return null;
    const finished = JSON.parse(JSON.stringify(game));
    delete finished.rkDraft;
    finished.type = 'rummikub';
    finished.rkScoringMode = finished.rkScoringMode === 'classic' ? 'classic' : DEFAULT_SCORING_MODE;
    const low = finished.rkScoringMode === 'points_up';
    finished.low = low;
    finished.endTime = new Date().toISOString();
    finished.meta = {
      ...(finished.meta || {}),
      scoringMode: finished.rkScoringMode,
      low
    };

    const scores = (finished.players || []).map((p) => Number(p.score) || 0);
    const best = scores.length ? (low ? Math.min(...scores) : Math.max(...scores)) : 0;
    const winners = (finished.players || []).filter((p) => (Number(p.score) || 0) === best);

    finished.winner = winners.map((p) => p.name).join(', ');
    (finished.players || []).forEach((p) => {
      p.score = Number(p.score) || 0;
      p.isWinner = p.score === best;
      if (p.userId === undefined) p.userId = p.user_id ?? null;
    });

    return finished;
  }

  function rkBuildSharedGameRecord(finishedGame) {
    const fin = finishedGame.endTime ? finishedGame : rkPrepareFinish(finishedGame);
    return {
      ...fin,
      client_game_id: fin.id,
      group_id: fin.groupId || fin.group_id || null,
      players: (fin.players || []).map((p) => {
        const userId = p.userId ?? p.user_id ?? null;
        return {
          name: p.name,
          display_name: p.name,
          userId,
          user_id: userId,
          score: Number(p.score) || 0,
          is_winner: Boolean(p.isWinner),
          meta: {
            color: p.color || null,
            scoringMode: fin.rkScoringMode
          }
        };
      })
    };
  }

  const api = {
    MAX_PLAYERS,
    JOKER_PENALTY,
    DEFAULT_SCORING_MODE,
    RK_COLORS,
    rkColor,
    rkFreeColor,
    rkCalcEval,
    rkNormalize,
    rkSetScoringMode,
    rkAddPlayer,
    rkRemovePlayer,
    rkCycleColor,
    rkPickColor,
    rkSetDraftDelta,
    rkStepDraftDelta,
    rkApplyJokerPenalty,
    rkRemoveJokerPenalty,
    rkClearDraft,
    rkGetDraftSummary,
    rkApplyRound,
    rkUndoLastRound,
    rkResetScores,
    rkToggleLog,
    rkLeaders,
    rkPrepareFinish,
    rkBuildSharedGameRecord
  };

  global.RummikubLogic = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
