/* ==========================================================================
   TallyIt v25 - Spoons scoring (window.TallyItSpoons + module.exports)
   Simple elimination game: each round exactly one player (the one who
   missed a spoon) is out. Last player standing wins. No letters.
   Placement = reverse elimination order (winner 1st, first out last).
   Pure functions: every mutator returns a NEW state; the input is untouched.
   ========================================================================== */
(function (global) {
  'use strict';

  const GAME_KEY = 'spoons';
  const MIN_PLAYERS = 2;

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function nameOf(p) { return typeof p === 'string' ? p : (p && (p.name || p.display_name)) || ''; }

  function initState(gameOrPlayers, opts) {
    opts = opts || {};
    const src = Array.isArray(gameOrPlayers) ? gameOrPlayers : ((gameOrPlayers && gameOrPlayers.players) || []);
    const players = src.map((p, i) => {
      const o = typeof p === 'string' ? { name: p } : { ...p };
      o.name = nameOf(p).trim() || ('Player ' + (i + 1));
      if (p && p.userId != null) o.userId = p.userId;
      if (p && p.user_id != null && o.userId == null) o.userId = p.user_id;
      return o;
    });
    if (players.length < MIN_PLAYERS) throw new Error('Spoons needs at least ' + MIN_PLAYERS + ' players');
    const seen = new Set();
    players.forEach((p) => {
      const k = p.name.toLowerCase();
      if (seen.has(k)) throw new Error('Duplicate player name: ' + p.name);
      seen.add(k);
    });
    return {
      type: GAME_KEY,
      gameKey: GAME_KEY,
      players,
      round: 1,                      // the round currently being played
      eliminations: [],              // [{player, playerIndex, round, at}]
      active: players.map((p) => p.name),
      history: [],                   // [{action:'eliminate', player, round, at}]
      isGameOver: false,
      winnerIndices: [],
      winnerNames: [],
      startedAt: opts.startedAt || new Date().toISOString(),
      finishedAt: null
    };
  }

  function resolveIndex(state, who) {
    if (typeof who === 'number') return who;
    const n = String(nameOf(who) || who || '').trim().toLowerCase();
    return state.players.findIndex((p) => p.name.toLowerCase() === n);
  }

  function getActivePlayers(state) { return state.active.slice(); }
  function isActive(state, who) {
    const i = resolveIndex(state, who);
    return i >= 0 && state.active.includes(state.players[i].name);
  }
  function canEliminate(state, who) { return !state.isGameOver && isActive(state, who); }
  function canUndo(state) { return state.eliminations.length > 0; }

  function finalize(s) {
    if (s.active.length === 1) {
      const w = s.active[0];
      s.isGameOver = true;
      s.winnerNames = [w];
      s.winnerIndices = [s.players.findIndex((p) => p.name === w)];
      s.finishedAt = s.finishedAt || new Date().toISOString();
    } else {
      s.isGameOver = false; s.winnerNames = []; s.winnerIndices = []; s.finishedAt = null;
    }
    return s;
  }

  function eliminate(state, who, opts) {
    opts = opts || {};
    if (state.isGameOver) throw new Error('Game is over');
    const idx = resolveIndex(state, who);
    if (idx < 0 || idx >= state.players.length) throw new Error('Unknown player');
    const name = state.players[idx].name;
    if (!state.active.includes(name)) throw new Error(name + ' is already out');
    const s = clone(state);
    const at = opts.at || new Date().toISOString();
    s.eliminations.push({ player: name, playerIndex: idx, round: s.round, at });
    s.history.push({ action: 'eliminate', player: name, round: s.round, at });
    s.active = s.active.filter((n) => n !== name);
    finalize(s);
    if (!s.isGameOver) s.round += 1;
    return s;
  }

  function undoLastElimination(state) {
    if (!state.eliminations.length) throw new Error('Nothing to undo');
    const s = clone(state);
    const last = s.eliminations.pop();
    s.history.push({ action: 'undo', player: last.player, round: last.round, at: new Date().toISOString() });
    // restore at original seat order
    const order = s.players.map((p) => p.name);
    s.active = order.filter((n) => n === last.player || s.active.includes(n));
    s.round = last.round;
    return finalize(s);
  }

  // Placement: active players share 1st while game runs (rank = 1 for all active);
  // eliminated players ranked by reverse elimination order.
  function getStandings(state) {
    const n = state.players.length;
    const rows = [];
    state.active.forEach((name) => {
      rows.push({ name, playerIndex: resolveIndex(state, name), place: 1, eliminatedRound: null, isWinner: state.isGameOver, isActive: true });
    });
    state.eliminations.slice().reverse().forEach((e, k) => {
      rows.push({ name: e.player, playerIndex: e.playerIndex, place: state.active.length + k + 1, eliminatedRound: e.round, isWinner: false, isActive: false });
    });
    // score = number of players outlasted (winner = n-1, first out = 0); higher is better
    rows.forEach((r) => { r.score = n - r.place; });
    return rows;
  }

  function getStats(state) {
    return {
      totalPlayers: state.players.length,
      playersRemaining: state.active.length,
      roundsPlayed: state.eliminations.length,
      currentRound: state.round,
      firstOut: state.eliminations[0] ? state.eliminations[0].player : null,
      winner: state.winnerNames[0] || null
    };
  }

  function getHistory(state) { return clone(state.history); }

  // Same shape as the other games: players[{name,score,userId,place}], winnerNames, rounds, meta.
  function toGameRecord(state, extra) {
    const standings = getStandings(state);
    const byName = {};
    standings.forEach((r) => { byName[r.name] = r; });
    return {
      type: GAME_KEY,
      game_key: GAME_KEY,
      players: state.players.map((p) => {
        const r = byName[p.name];
        const o = { name: p.name, score: r.score, place: r.place, eliminatedRound: r.eliminatedRound };
        if (p.userId != null) o.userId = p.userId;
        return o;
      }),
      rounds: state.eliminations.map((e) => ({ round: e.round, eliminated: e.player })),
      target: null,
      lowWins: false,
      winnerNames: state.winnerNames.slice(),
      winner: state.winnerNames[0] || null,
      meta: {
        game_key: GAME_KEY,
        eliminations: clone(state.eliminations),
        placements: standings.map((r) => ({ name: r.name, place: r.place })),
        roundsPlayed: state.eliminations.length,
        finished: state.isGameOver
      },
      date: state.finishedAt || new Date().toISOString(),
      ...(extra || {})
    };
  }


  // ---------------- Stateful UI contract (Score Tracker UI) ----------------
  // window.TallyItSpoons.{start, getState, knockOut, undo, finishAndSave, reset}
  // Fires document 'tallyit:spoons-change' (detail = getState()) on every change.
  const LS_KEY = 'tallyit_spoons_active';
  let current = null;
  function pid(i) { return 'p' + i; }
  function idxFromId(id) {
    if (typeof id === 'number') return id;
    const m = /^p(\d+)$/.exec(String(id));
    return m ? Number(m[1]) : (current ? resolveIndex(current, id) : -1);
  }
  function view(s) {
    if (!s) return null;
    const outBy = {};
    s.eliminations.forEach((e) => { outBy[e.playerIndex] = e.round; });
    const st = {}; getStandings(s).forEach((r) => { st[r.playerIndex] = r.place; });
    const w = s.winnerIndices.length ? pid(s.winnerIndices[0]) : null;
    return {
      gameId: GAME_KEY,
      round: s.round,
      players: s.players.map((p, i) => ({ id: pid(i), name: p.name, userId: p.userId != null ? p.userId : null, outRound: outBy[i] != null ? outBy[i] : null, place: st[i] })),
      history: s.eliminations.map((e) => ({ round: e.round, outPlayerId: pid(e.playerIndex) })),
      winnerId: w,
      isGameOver: s.isGameOver,
      canUndo: canUndo(s)
    };
  }
  function persist() {
    try { if (global.localStorage) { if (current) global.localStorage.setItem(LS_KEY, JSON.stringify(current)); else global.localStorage.removeItem(LS_KEY); } } catch (e) {}
  }
  function emit() {
    persist();
    try {
      if (typeof document !== 'undefined' && typeof CustomEvent === 'function') document.dispatchEvent(new CustomEvent('tallyit:spoons-change', { detail: view(current) }));
    } catch (e) {}
    listeners.forEach((fn) => { try { fn(view(current)); } catch (e) {} });
  }
  const listeners = [];
  function onChange(fn) { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; }
  function start(players, opts) { current = initState(players, opts); emit(); return view(current); }
  function resume() {
    try { const raw = global.localStorage && global.localStorage.getItem(LS_KEY); if (raw) { current = JSON.parse(raw); emit(); } } catch (e) {}
    return view(current);
  }
  function getState() { return view(current); }
  function getRawState() { return current ? clone(current) : null; }
  function knockOut(playerId) { if (!current) throw new Error('No Spoons game started'); current = eliminate(current, idxFromId(playerId)); emit(); return view(current); }
  function undo() { if (!current) throw new Error('No Spoons game started'); current = undoLastElimination(current); emit(); return view(current); }
  // Builds the standard record and hands it to opts.save, else window.TallyItSaveGame if present.
  // Returns a Promise of the record. Clears the active game after a successful save.
  async function finishAndSave(opts) {
    opts = opts || {};
    if (!current) throw new Error('No Spoons game started');
    if (!current.isGameOver && !opts.allowUnfinished) throw new Error('Game not finished: one player must remain');
    const rec = toGameRecord(current, opts.extra);
    const saver = opts.save || global.TallyItSaveGame;
    if (typeof saver === 'function') await saver(rec);
    try { if (typeof document !== 'undefined' && typeof CustomEvent === 'function') document.dispatchEvent(new CustomEvent('tallyit:spoons-saved', { detail: rec })); } catch (e) {}
    current = null; emit();
    return rec;
  }

  // Load a snapshot as the active game. Accepts the raw engine state (getRawState())
  // or a UI view (getState()); persists + fires tallyit:spoons-change.
  function restore(raw) {
    if (!raw) { current = null; emit(); return null; }
    if (typeof raw === 'string') raw = JSON.parse(raw);
    let s;
    if (Array.isArray(raw.eliminations) && Array.isArray(raw.active)) {
      s = clone(raw);
    } else if (Array.isArray(raw.players)) {
      s = initState(raw.players.map((p) => ({ name: p.name, userId: p.userId != null ? p.userId : undefined })));
      const hist = Array.isArray(raw.history) && raw.history.length ? raw.history.slice()
        : raw.players.map((p, i) => ({ round: p.outRound, outPlayerId: p.id || pid(i) })).filter((h) => h.round != null);
      hist.sort((a, b) => a.round - b.round).forEach((h) => {
        const i = typeof h.outPlayerId === 'number' ? h.outPlayerId : (/^p(\d+)$/.exec(String(h.outPlayerId)) || [])[1];
        const idx = i != null ? Number(i) : resolveIndex(s, h.outPlayerId);
        if (idx >= 0 && !s.isGameOver) s = eliminate(s, idx);
      });
    } else throw new Error('Unrecognized Spoons snapshot');
    current = s; emit(); return view(current);
  }
  function reset() { current = null; emit(); }

  const api = {
    GAME_KEY, MIN_PLAYERS,
    initState, eliminate, undoLastElimination,
    getActivePlayers, isActive, canEliminate, canUndo,
    getStandings, getStats, getHistory, toGameRecord,
    // stateful UI contract
    LS_KEY, start, resume, getState, getRawState, knockOut, undo, finishAndSave, reset, onChange, restore
  };
  global.TallyItSpoons = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
