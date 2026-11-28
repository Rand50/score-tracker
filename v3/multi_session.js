/* ==========================================================================
   TallyIt — Multi-Game Session Manager & Universal End/Pause/Discard (v21)
   ==========================================================================
   Zero-dependency UMD module for v3/engine.js & v3/shell.html.
   Exposes `window.TallyItSessions` in browsers and `module.exports` in Node.

   Features:
   - Persists multiple simultaneous open games (`activeGames`) in localStorage
     without clobbering one game when starting or pausing another.
   - Automatically migrates any legacy single active game (`gst_active`) on
     first load with zero data loss.
   - Computes rich per-game summary metadata (`playersSummary`, `leaderText`,
     `roundLabel`, `versionLabel`, `variationKey`) for Home "In Progress" cards,
     including low-wins games (Hearts, Rummikub Points Up) and 7 Wonders
     Treasury coin tiebreakers.
   - Universal session lifecycle:
       * listActiveSessions()
       * getSession(sessionId)
       * getFocusedSessionId() / getFocusedSession()
       * createSession(state, opts)
       * upsertSession(sessionOrState)
       * saveCurrentSession(state)
       * resumeSession(sessionId)
       * pauseCurrentSession(state)
       * finishSession(sessionId, { record: true | false, onRecord })
       * deleteSession(sessionId)
   ========================================================================== */

(function (global) {
  'use strict';

  const STORAGE_KEY_SESSIONS = 'tallyit_active_sessions_v1';
  const STORAGE_KEY_FOCUSED  = 'tallyit_focused_session_id_v1';
  const LEGACY_ACTIVE_KEY    = 'gst_active';

  const GAME_DISPLAY_NAMES = {
    catan:       'Catan',
    flip7:       'Flip 7',
    '7wonders':  '7 Wonders',
    carcassonne: 'Carcassonne',
    ohhell:      'Oh Hell',
    hearts:      'Hearts',
    nertz:       'Nertz',
    rummikub:    'Rummikub',
    qwirkle:     'Qwirkle',
    spoons:      'Spoons',
    other:       'Custom'
  };

  const DEFAULT_LOW_GAMES = new Set(['hearts', 'rummikub']);

  // Fallback in-memory storage when localStorage is unavailable (e.g. Node tests)
  function createMemoryStorage() {
    const map = new Map();
    return {
      getItem(k) { return map.has(k) ? map.get(k) : null; },
      setItem(k, v) { map.set(k, String(v)); },
      removeItem(k) { map.delete(k); },
      clear() { map.clear(); }
    };
  }

  let customStorage = null;
  const fallbackMem = createMemoryStorage();

  function getStorage() {
    if (customStorage) return customStorage;
    try {
      if (global && global.localStorage) {
        const testKey = '__tallyit_sess_probe__';
        global.localStorage.setItem(testKey, '1');
        global.localStorage.removeItem(testKey);
        return global.localStorage;
      }
    } catch (_) {
      // Private browsing / quota / Node environment
    }
    return fallbackMem;
  }

  function configure(opts) {
    if (opts && Object.prototype.hasOwnProperty.call(opts, 'storage')) {
      customStorage = opts.storage || null;
    }
  }

  // ---------------- Utilities ----------------
  function uid(prefix) {
    return (prefix || 'sess') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function deepClone(obj) {
    if (obj === null || obj === undefined) return obj;
    try {
      return JSON.parse(JSON.stringify(obj));
    } catch (_) {
      return obj;
    }
  }

  function cleanStr(v) {
    return String(v ?? '').trim();
  }

  function normalizeGameKey(raw) {
    const k = cleanStr(raw).toLowerCase();
    if (!k) return 'other';
    if (global.TallyItVariations && typeof global.TallyItVariations.normalizeGameKey === 'function') {
      return global.TallyItVariations.normalizeGameKey(k);
    }
    if (k === 'seven_wonders' || k === 'seven-wonders') return '7wonders';
    if (k === 'flip_7' || k === 'flip-7') return 'flip7';
    if (k === 'oh_hell' || k === 'oh-hell') return 'ohhell';
    if (k === 'custom') return 'other';
    return k;
  }

  function isLowWinsGame(state, gameKey) {
    if (state && typeof state.low === 'boolean') return state.low;
    if (gameKey === 'rummikub') {
      return state && state.rkScoringMode === 'classic' ? false : true;
    }
    if (state && state.meta && typeof state.meta.low === 'boolean') return state.meta.low;
    return DEFAULT_LOW_GAMES.has(gameKey);
  }

  function resolveVariationMeta(gameKey, state) {
    const rawVersion = cleanStr(state && (state.versionLabel || state.version || state.variant));
    const rawVarKey = cleanStr(state && (state.variationKey || state.variation_key));
    const V = global.TallyItVariations;
    if (V && typeof V.getVariation === 'function') {
      const hit = (rawVarKey && V.getVariation(gameKey, rawVarKey)) ||
                  (rawVersion && V.getVariation(gameKey, rawVersion)) ||
                  (typeof V.getDefaultVariation === 'function' ? V.getDefaultVariation(gameKey) : null);
      if (hit) {
        return {
          versionLabel: rawVersion || hit.versionLabel || hit.name,
          variationKey: hit.key
        };
      }
    }
    return {
      versionLabel: rawVersion || null,
      variationKey: rawVarKey || null
    };
  }

  function buildPlayersSummary(players) {
    const list = Array.isArray(players) ? players : [];
    const names = list
      .map((p) => (typeof p === 'string' ? cleanStr(p) : cleanStr(p && p.name)))
      .filter(Boolean);
    if (!names.length) return 'No players';
    if (names.length <= 3) return names.join(', ');
    return `${names.slice(0, 3).join(', ')} +${names.length - 3} more`;
  }

  function buildLeaderText(state, gameKey) {
    const players = Array.isArray(state && state.players) ? state.players : [];
    if (!players.length) return 'No scores yet';
    if (gameKey === 'spoons') {
      const left = players.filter((p) => !p || p.outRound == null).length;
      return left === 1 ? 'Down to the winner' : `${left} of ${players.length} still in`;
    }

    const scores = players.map((p) => Number(p && p.score) || 0);
    const anyNonZero = scores.some((s) => s !== 0);
    const hasRounds = Array.isArray(state && state.rounds) && state.rounds.length > 0;
    const isSw = gameKey === '7wonders';

    if (!anyNonZero && !hasRounds && !isSw) {
      return 'Not started · 0 pts';
    }

    const low = isLowWinsGame(state, gameKey);
    const best = low ? Math.min(...scores) : Math.max(...scores);
    let leaders = players.filter((p) => (Number(p && p.score) || 0) === best);

    // 7 Wonders official coin tiebreaker
    if (isSw && leaders.length > 1) {
      const maxCoins = Math.max(...leaders.map((p) => Number(p && (p.coins ?? p.tiebreakCoins ?? (p.scores && p.scores.treasury))) || 0));
      const coinLeaders = leaders.filter((p) => (Number(p && (p.coins ?? p.tiebreakCoins ?? (p.scores && p.scores.treasury))) || 0) === maxCoins);
      if (coinLeaders.length) leaders = coinLeaders;
    }

    const unit = gameKey === 'catan' || gameKey === '7wonders' ? 'VP' : 'pts';
    if (leaders.length === 1) {
      const name = cleanStr(leaders[0].name) || 'Player';
      return `${name} leads (${best} ${unit})`;
    }
    if (leaders.length === players.length) {
      return `All tied at ${best} ${unit}`;
    }
    return `${leaders.length}-way tie at ${best} ${unit}`;
  }

  function buildRoundLabel(state, gameKey) {
    const rounds = Array.isArray(state && state.rounds) ? state.rounds : [];
    if (gameKey === '7wonders') {
      const cat = cleanStr(state && state.activeCategory) || 'military';
      const catLabel = cat.charAt(0).toUpperCase() + cat.slice(1);
      const done = Array.isArray(state && state.swDone) ? state.swDone.length : 0;
      const exp = (state && state.expansions) || {};
      const totalCats = 7 + (exp.leaders ? 1 : 0) + (exp.cities ? 1 : 0) + (exp.armada ? 1 : 0);
      return done > 0 ? `${catLabel} · ${done}/${totalCats} done` : `Category: ${catLabel}`;
    }
    if (gameKey === 'catan') {
      const target = state && (state.targetVp || state.target) || 10;
      return rounds.length > 0 ? `${rounds.length} updates · to ${target} VP` : `To ${target} VP`;
    }
    if (gameKey === 'carcassonne') {
      return rounds.length > 0 ? `${rounds.length} ${rounds.length === 1 ? 'entry' : 'entries'}` : 'In progress';
    }
    if (gameKey === 'spoons') return `Round ${rounds.length + 1}`;
    if (rounds.length === 0) {
      const target = state && state.target;
      return target ? `Round 1 · to ${target}` : 'Round 1';
    }
    const target = state && state.target;
    return target ? `Round ${rounds.length + 1} · to ${target}` : `Round ${rounds.length + 1}`;
  }

  /**
   * Builds a normalized session envelope from either a raw game `state` object
   * or an existing session envelope `{ id, ..., snapshot }`.
   */
  function buildSessionEnvelope(input, existingSession, forceUpdatedAt) {
    const isEnvelope = input && typeof input === 'object' && input.snapshot && typeof input.snapshot === 'object';
    const rawState = isEnvelope ? input.snapshot : input;
    if (!rawState || typeof rawState !== 'object') return null;

    const snapshot = deepClone(rawState);
    const id = cleanStr(
      (isEnvelope && input.id) ||
      snapshot.sessionId ||
      snapshot.id ||
      (existingSession && existingSession.id)
    ) || uid('sess');

    snapshot.id = id;
    snapshot.sessionId = id;

    const gameKey = normalizeGameKey(
      (isEnvelope && input.gameKey) ||
      snapshot.type ||
      snapshot.game_type ||
      snapshot.gameKey
    );
    const gameName = cleanStr(
      (isEnvelope && input.gameName) ||
      snapshot.gameName ||
      GAME_DISPLAY_NAMES[gameKey] ||
      gameKey
    );
    const varMeta = resolveVariationMeta(gameKey, {
      ...snapshot,
      ...(isEnvelope ? { versionLabel: input.versionLabel, variationKey: input.variationKey } : {})
    });

    const now = forceUpdatedAt || nowIso();
    const startedAt =
      (existingSession && existingSession.startedAt) ||
      (isEnvelope && input.startedAt) ||
      snapshot.startTime ||
      now;

    if (!snapshot.startTime) snapshot.startTime = startedAt;

    return {
      id,
      gameKey,
      gameName,
      versionLabel: varMeta.versionLabel,
      variationKey: varMeta.variationKey,
      startedAt,
      updatedAt: now,
      playersSummary: buildPlayersSummary(snapshot.players),
      leaderText: buildLeaderText(snapshot, gameKey),
      roundLabel: buildRoundLabel(snapshot, gameKey),
      snapshot
    };
  }

  // ---------------- Storage Read / Write ----------------
  function readRawSessions() {
    const st = getStorage();
    try {
      const raw = st.getItem(STORAGE_KEY_SESSIONS);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((s) => s && s.id && s.snapshot) : [];
    } catch (_) {
      return [];
    }
  }

  function writeRawSessions(list) {
    const st = getStorage();
    const sorted = (Array.isArray(list) ? list : [])
      .filter((s) => s && s.id && s.snapshot)
      .sort((a, b) => Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0));
    try {
      st.setItem(STORAGE_KEY_SESSIONS, JSON.stringify(sorted));
    } catch (e) {
      console.warn('[TallyItSessions] write failed', e);
    }
    return sorted;
  }

  function readFocusedId() {
    try {
      return cleanStr(getStorage().getItem(STORAGE_KEY_FOCUSED)) || null;
    } catch (_) {
      return null;
    }
  }

  function writeFocusedId(sessionId) {
    const st = getStorage();
    try {
      if (sessionId) st.setItem(STORAGE_KEY_FOCUSED, String(sessionId));
      else st.removeItem(STORAGE_KEY_FOCUSED);
    } catch (_) {}
  }

  function clearLegacyActiveKey() {
    try {
      getStorage().removeItem(LEGACY_ACTIVE_KEY);
    } catch (_) {}
  }

  // ---------------- Legacy Single-Game Migration ----------------
  /**
   * Migrates any legacy single active game stored in `gst_active` into
   * `tallyit_active_sessions_v1` without losing data, then clears `gst_active`.
   */
  function migrateLegacyIfNeeded() {
    const st = getStorage();
    let rawLegacy = null;
    try {
      rawLegacy = st.getItem(LEGACY_ACTIVE_KEY);
    } catch (_) {
      return null;
    }
    if (!rawLegacy) return null;

    try {
      const legacyGame = JSON.parse(rawLegacy);
      if (!legacyGame || typeof legacyGame !== 'object' || !Array.isArray(legacyGame.players)) {
        clearLegacyActiveKey();
        return null;
      }

      const existing = readRawSessions();
      const legacyId = cleanStr(legacyGame.sessionId || legacyGame.id);
      const already = legacyId ? existing.find((s) => s.id === legacyId) : null;
      let migrated = already;

      if (!already) {
        migrated = buildSessionEnvelope(legacyGame, null, legacyGame.updatedAt || legacyGame.startTime || nowIso());
        if (migrated) {
          existing.push(migrated);
          writeRawSessions(existing);
        }
      }

      if (migrated && !readFocusedId()) {
        writeFocusedId(migrated.id);
      }
      clearLegacyActiveKey();
      return migrated ? deepClone(migrated) : null;
    } catch (_) {
      return null;
    }
  }

  // ---------------- Public Session API ----------------
  /**
   * Returns all open games sorted by `updatedAt` descending.
   */
  function listActiveSessions() {
    migrateLegacyIfNeeded();
    return readRawSessions()
      .sort((a, b) => Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0))
      .map(deepClone);
  }

  function getSession(sessionId) {
    migrateLegacyIfNeeded();
    const id = cleanStr(sessionId);
    if (!id) return null;
    const found = readRawSessions().find((s) => s.id === id);
    return found ? deepClone(found) : null;
  }

  function getFocusedSessionId() {
    migrateLegacyIfNeeded();
    const fid = readFocusedId();
    if (!fid) return null;
    const exists = readRawSessions().some((s) => s.id === fid);
    if (!exists) {
      writeFocusedId(null);
      return null;
    }
    return fid;
  }

  function getFocusedSession() {
    const fid = getFocusedSessionId();
    return fid ? getSession(fid) : null;
  }

  /**
   * Inserts or updates a session in `activeGames` by `id`.
   */
  function upsertSession(sessionOrState) {
    migrateLegacyIfNeeded();
    if (!sessionOrState || typeof sessionOrState !== 'object') return null;

    const sessions = readRawSessions();
    const probeId = cleanStr(
      sessionOrState.id ||
      (sessionOrState.snapshot && (sessionOrState.snapshot.sessionId || sessionOrState.snapshot.id)) ||
      sessionOrState.sessionId
    );
    const idx = probeId ? sessions.findIndex((s) => s.id === probeId) : -1;
    const existing = idx >= 0 ? sessions[idx] : null;

    const next = buildSessionEnvelope(sessionOrState, existing);
    if (!next) return null;

    if (idx >= 0) sessions[idx] = next;
    else sessions.push(next);

    writeRawSessions(sessions);
    return deepClone(next);
  }

  /**
   * Auto-saves the currently active game on every score change and marks it focused.
   */
  function saveCurrentSession(state) {
    migrateLegacyIfNeeded();
    if (!state || typeof state !== 'object') return null;
    const saved = upsertSession(state);
    if (saved) {
      // Keep caller's state id in sync so subsequent saves update the same session
      state.id = saved.id;
      state.sessionId = saved.id;
      writeFocusedId(saved.id);
      clearLegacyActiveKey();
    }
    return saved;
  }

  /**
   * Starts a brand-new open game with a unique `id` WITHOUT clobbering any
   * other open games in `activeGames`.
   */
  function createSession(state, opts) {
    migrateLegacyIfNeeded();
    if (!state || typeof state !== 'object') return null;
    const options = opts || {};
    const sessions = readRawSessions();
    const existingIds = new Set(sessions.map((s) => s.id));

    const clone = deepClone(state);
    let id = cleanStr(clone.sessionId || clone.id);
    if (!id || existingIds.has(id)) {
      id = uid('sess');
      while (existingIds.has(id)) id = uid('sess');
    }
    clone.id = id;
    clone.sessionId = id;
    if (!clone.startTime) clone.startTime = nowIso();

    const env = buildSessionEnvelope(clone, null);
    if (!env) return null;

    sessions.push(env);
    writeRawSessions(sessions);

    state.id = env.id;
    state.sessionId = env.id;

    if (options.focus !== false) {
      writeFocusedId(env.id);
    }
    clearLegacyActiveKey();
    return deepClone(env);
  }

  /**
   * Restores a specific open session's `snapshot` and sets it as the currently
   * focused game.
   */
  function resumeSession(sessionId) {
    migrateLegacyIfNeeded();
    const id = cleanStr(sessionId);
    if (!id) return { ok: false, error: 'Missing sessionId' };

    const sessions = readRawSessions();
    const idx = sessions.findIndex((s) => s.id === id);
    if (idx < 0) return { ok: false, error: 'Session not found' };

    // Touch updatedAt so resumed game rises to top of open games
    sessions[idx].updatedAt = nowIso();
    writeRawSessions(sessions);
    writeFocusedId(id);
    clearLegacyActiveKey();

    const session = deepClone(sessions[idx]);
    return {
      ok: true,
      session,
      snapshot: deepClone(session.snapshot)
    };
  }

  /**
   * Saves the current game state into `activeGames`, clears the focused game
   * pointer (so the app can return to Home cleanly), and keeps the game open.
   */
  function pauseCurrentSession(state) {
    migrateLegacyIfNeeded();
    let saved = null;
    if (state && typeof state === 'object') {
      saved = upsertSession(state);
      if (saved) {
        state.id = saved.id;
        state.sessionId = saved.id;
      }
    }
    writeFocusedId(null);
    clearLegacyActiveKey();
    return {
      ok: true,
      session: saved,
      activeCount: readRawSessions().length
    };
  }

  /**
   * Ends an open session either WITH recording (`record: true`) or WITHOUT
   * recording / Discard (`record: false`).
   *
   * - `record: true`: runs optional `onRecord(snapshot, session)` callback
   *   (letting standard `endGame()` / History / Supabase shared save execute),
   *   then removes `sessionId` from `activeGames` and clears focus if matched.
   * - `record: false`: removes `sessionId` from `activeGames` and clears focus
   *   WITHOUT writing to History, local stats, Supabase, or leaderboards.
   */
  function finishSession(sessionId, options) {
    migrateLegacyIfNeeded();
    const opts = options || {};
    const record = Boolean(opts.record);
    const id = cleanStr(sessionId) || readFocusedId();
    if (!id) {
      writeFocusedId(null);
      clearLegacyActiveKey();
      return { ok: false, recorded: false, discarded: !record, error: 'No session specified' };
    }

    const sessions = readRawSessions();
    const idx = sessions.findIndex((s) => s.id === id);
    const target = idx >= 0 ? deepClone(sessions[idx]) : null;

    let recordResult = null;
    if (record && typeof opts.onRecord === 'function') {
      recordResult = opts.onRecord(target ? deepClone(target.snapshot) : null, target);
    }

    const remaining = sessions.filter((s) => s.id !== id);
    writeRawSessions(remaining);

    if (readFocusedId() === id) {
      writeFocusedId(null);
    }
    clearLegacyActiveKey();

    return {
      ok: true,
      recorded: record,
      discarded: !record,
      removedId: id,
      session: target,
      recordResult,
      remainingCount: remaining.length
    };
  }

  function deleteSession(sessionId) {
    return finishSession(sessionId, { record: false });
  }

  function clearAllSessions() {
    const st = getStorage();
    try {
      st.removeItem(STORAGE_KEY_SESSIONS);
      st.removeItem(STORAGE_KEY_FOCUSED);
      st.removeItem(LEGACY_ACTIVE_KEY);
    } catch (_) {}
  }

  // ---------------- Exports ----------------
  const api = {
    STORAGE_KEY_SESSIONS,
    STORAGE_KEY_FOCUSED,
    LEGACY_ACTIVE_KEY,
    configure,
    migrateLegacyIfNeeded,
    listActiveSessions,
    getSession,
    getFocusedSessionId,
    getFocusedSession,
    createSession,
    upsertSession,
    saveCurrentSession,
    resumeSession,
    pauseCurrentSession,
    finishSession,
    deleteSession,
    clearAllSessions
  };

  global.TallyItSessions = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
