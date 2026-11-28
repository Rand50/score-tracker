/**
 * TallyIt — v26 Backend (window.TallyItV26Backend): cross-device Favorites + Past-game detail/edit.
 * Drop-in module. Uses window.sb (Supabase v2 client). Requires supabase_v26_favorites_game_edit.sql.
 * NEVER throws. Every async call resolves to an object with `ok`:
 *   { ok:true, ... }
 *   { ok:false, unavailable:true, error }          v26 migration not applied yet (re-probed every 30s)
 *   { ok:false, error:'not_signed_in'|'forbidden'|'not_found'|'invalid_payload'|'invalid_input'|'too_many'|'conflict', message }
 *   { ok:false, error, code? }                     anything else (network ...)
 *
 * FAVORITES (signed in -> account via RPC; signed out -> localStorage 'gst_v26_guest_favorites', replies carry guest:true)
 *   getFavorites()                 -> {ok, favorites:[game_key...], guest?}
 *   setFavorites(keys)             -> {ok, favorites, guest?}
 *   toggleFavorite(key)            -> {ok, favorited, favorites, guest?}
 *   isFavorite(key)                -> boolean, SYNC, from the last known list (account cache, or guest list when signed out)
 *   subscribeFavorites(cb)         -> unsubscribe fn. cb({favorites, source, guest}) fires once on subscribe (refresh-on-open)
 *                                     and whenever the list changes: realtime (user_favorites, filter user_id=eq.<me>),
 *                                     tab becomes visible, 'online', own writes, sign-in/out. Same payload as the DOM event.
 *   mergeGuestFavorites()          -> {ok, merged:n, favorites}  folds guest favorites into the account ONCE, then clears them
 *                                     (auto-runs on SIGNED_IN while subscribed; safe to call after any sign-in)
 *   Keys are normalised like the server: trim + lower-case, /^[a-z0-9][a-z0-9_.:-]{0,79}$/, max 100.
 *
 * GAME DETAIL / EDIT
 *   getGameDetail(gameId)                          -> {ok, game:{id, game_key, game_type, variation_key, variation_name, played_at,
 *                                                     created_at, created_by, created_by_name, edited_at, edited_by, edited_by_name,
 *                                                     winner, is_owner, can_edit, payload, rounds, players:[...], participants:[...] ...}}
 *   updateGame(gameId, editOrPayload, {expectedEditedAt})   -> {ok, game, winner_changed, ignored_user_ids}
 *        editOrPayload = TallyItRecordTools.buildSharedEdit() output, or a bare payload object (back-compat)
 *        expectedEditedAt (ISO string or Date; pass detail.game.edited_at, leave null for a never-edited game) -> {ok:false,error:'conflict'}
 *   updateSharedGame(edit, opts)                   alias: reads the game id from edit.game_id (or edit.id)
 *   canEditGame(gameOrDetail)                      SYNC: detail.can_edit || created_by === current user id
 *
 * Events on window: 'tallyit:favorites-changed' {favorites, source, guest}, 'tallyit:game-edited' {game_id, game, winner_changed}
 */
(function (global) {
  'use strict';

  const MIGRATION_RETRY_MS = 30 * 1000;
  const LS_GUEST = 'gst_v26_guest_favorites';
  const LS_MERGED_PREFIX = 'gst_v26_guest_merged_';
  const KEY_RE = /^[a-z0-9][a-z0-9_.:-]{0,79}$/;
  const MAX_FAVS = 100;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  let migrationReady = null;
  let migrationCheckedAt = 0;
  let knownUid = null;               // last user id we saw (for the sync helpers)
  let cache = { uid: null, list: null };   // account favorites cache
  const listeners = new Set();
  let rt = { uid: null, channel: null };
  let docHooked = false;
  let authHooked = false;
  let refreshTimer = null;

  // ------------------------------------------------------------------ plumbing
  function getClient() { return global.sb || null; }

  async function getAuthUser() {
    let user = null;
    if (global.ScoreAuth && typeof global.ScoreAuth.getUser === 'function') {
      try { const u = await global.ScoreAuth.getUser(); if (u && u.id) user = u; } catch (_) {}
    }
    if (!user) {
      const client = getClient();
      if (client && client.auth && typeof client.auth.getSession === 'function') {
        try {
          const { data: { session } } = await client.auth.getSession();
          if (session && session.user) user = session.user;
        } catch (_) {}
      }
    }
    knownUid = user ? user.id : null;
    return user;
  }

  function isMissingMigrationError(err) {
    if (!err) return false;
    const code = String(err.code || '').toUpperCase();
    const msg = String(err.message || err.details || err.hint || '').toLowerCase();
    if (code === '42P01' || code === '42883' || code === '42703' || code === 'PGRST202' || code === 'PGRST205') return true;
    return msg.includes('does not exist') || msg.includes('could not find the table') || msg.includes('could not find the function');
  }

  function markMigrationMissing() { migrationReady = false; migrationCheckedAt = Date.now(); }
  function shouldSkipSupabase(client) {
    if (!client) return true;
    if (migrationReady !== false) return false;
    if (Date.now() - migrationCheckedAt > MIGRATION_RETRY_MS) { migrationReady = null; return false; }
    return true;
  }
  const UNAVAILABLE = 'This feature is not available yet (v26 migration pending). Try again in a bit.';
  function unavailable() { return { ok: false, unavailable: true, error: UNAVAILABLE }; }
  function notSignedIn() { return { ok: false, error: 'not_signed_in', message: 'Sign in first.' }; }

  function emit(name, detail) {
    try {
      if (typeof global.dispatchEvent === 'function' && typeof global.CustomEvent === 'function') {
        global.dispatchEvent(new global.CustomEvent(name, { detail }));
      }
    } catch (_) {}
  }

  async function callRpc(name, args) {
    try {
      const client = getClient();
      if (shouldSkipSupabase(client)) return unavailable();
      let res;
      try { res = await client.rpc(name, args || {}); }
      catch (e) { return { ok: false, error: (e && e.message) || 'Network error. Try again.' }; }
      const { data, error } = res || {};
      if (error) {
        if (isMissingMigrationError(error)) { markMigrationMissing(); return unavailable(); }
        return { ok: false, code: error.code || null, error: error.message || 'Something went wrong.' };
      }
      migrationReady = true;
      if (!data || typeof data !== 'object' || typeof data.ok !== 'boolean') return { ok: false, error: 'Unexpected reply.' };
      return data;
    } catch (e) {
      return { ok: false, error: (e && e.message) || 'Something went wrong.' };
    }
  }

  // ------------------------------------------------------------------ local storage
  function lsGet(key) { try { return global.localStorage ? global.localStorage.getItem(key) : null; } catch (_) { return null; } }
  function lsSet(key, val) { try { if (global.localStorage) global.localStorage.setItem(key, val); return true; } catch (_) { return false; } }
  function lsDel(key) { try { if (global.localStorage) global.localStorage.removeItem(key); } catch (_) {} }

  function normKey(k) {
    const s = String(k == null ? '' : k).trim().toLowerCase();
    return s;
  }
  // -> {keys, invalid} ; blanks dropped, de-duped keeping first position
  function normalizeKeys(arr) {
    const keys = []; let invalid = null;
    (Array.isArray(arr) ? arr : []).forEach((raw) => {
      const k = normKey(raw);
      if (!k) return;
      if (!KEY_RE.test(k)) { if (!invalid) invalid = k; return; }
      if (!keys.includes(k)) keys.push(k);
    });
    return { keys, invalid };
  }

  function readGuest() {
    try {
      const raw = lsGet(LS_GUEST);
      const arr = raw ? JSON.parse(raw) : [];
      return normalizeKeys(Array.isArray(arr) ? arr : []).keys.slice(0, MAX_FAVS);
    } catch (_) { return []; }
  }
  function writeGuest(list) { lsSet(LS_GUEST, JSON.stringify(list.slice(0, MAX_FAVS))); }

  function sameList(a, b) { return JSON.stringify(a || []) === JSON.stringify(b || []); }

  function publish(favorites, source, guest) {
    const detail = { favorites: favorites.slice(), source: source || 'local', guest: !!guest };
    emit('tallyit:favorites-changed', detail);
    listeners.forEach((cb) => { try { cb(detail); } catch (_) {} });
  }

  function setCache(uid, list, source, guestMode) {
    const changed = !(cache.uid === uid && sameList(cache.list, list));
    cache = { uid, list: list.slice() };
    if (changed) publish(list, source, guestMode);
    return changed;
  }

  // ------------------------------------------------------------------ favorites
  async function getFavorites() {
    try {
      const user = await getAuthUser();
      if (!user) return { ok: true, favorites: readGuest(), guest: true };
      const r = await callRpc('get_my_favorites');
      if (r.ok && Array.isArray(r.favorites)) setCache(user.id, r.favorites, 'refresh', false);
      return r;
    } catch (e) { return { ok: false, error: (e && e.message) || 'Something went wrong.' }; }
  }

  async function setFavorites(keys) {
    try {
      const n = normalizeKeys(keys);
      if (n.invalid) return { ok: false, error: 'invalid_input', message: 'invalid game key: ' + n.invalid.slice(0, 40) };
      if (n.keys.length > MAX_FAVS) return { ok: false, error: 'too_many', message: 'At most ' + MAX_FAVS + ' favorites.' };
      const user = await getAuthUser();
      if (!user) { writeGuest(n.keys); setCache(null, n.keys, 'local', true); return { ok: true, favorites: n.keys, guest: true }; }
      const r = await callRpc('set_my_favorites', { p_game_keys: n.keys });
      if (r.ok && Array.isArray(r.favorites)) setCache(user.id, r.favorites, 'local', false);
      return r;
    } catch (e) { return { ok: false, error: (e && e.message) || 'Something went wrong.' }; }
  }

  async function toggleFavorite(key) {
    try {
      const k = normKey(key);
      if (!KEY_RE.test(k)) return { ok: false, error: 'invalid_input', message: 'invalid game key' };
      const user = await getAuthUser();
      if (!user) {
        const list = readGuest();
        const i = list.indexOf(k);
        let fav;
        if (i >= 0) { list.splice(i, 1); fav = false; }
        else { if (list.length >= MAX_FAVS) return { ok: false, error: 'too_many', message: 'At most ' + MAX_FAVS + ' favorites.' }; list.push(k); fav = true; }
        writeGuest(list); setCache(null, list, 'local', true);
        return { ok: true, favorited: fav, game_key: k, favorites: list, guest: true };
      }
      const r = await callRpc('toggle_favorite', { p_game_key: k });
      if (r.ok && Array.isArray(r.favorites)) setCache(user.id, r.favorites, 'local', false);
      return r;
    } catch (e) { return { ok: false, error: (e && e.message) || 'Something went wrong.' }; }
  }

  function isFavorite(key) {
    try {
      const k = normKey(key);
      if (!k) return false;
      const list = knownUid && cache.uid === knownUid && Array.isArray(cache.list) ? cache.list : (knownUid ? [] : readGuest());
      return list.includes(k);
    } catch (_) { return false; }
  }

  async function mergeGuestFavorites() {
    try {
      const user = await getAuthUser();
      if (!user) return { ok: true, merged: 0, favorites: readGuest(), guest: true };
      const guest = readGuest();
      const flag = LS_MERGED_PREFIX + user.id;
      if (!guest.length) { lsDel(LS_GUEST); return { ok: true, merged: 0, already: !!lsGet(flag) }; }
      const cur = await callRpc('get_my_favorites');
      if (!cur.ok) return cur;                                   // leave guest list untouched; retry later
      const server = Array.isArray(cur.favorites) ? cur.favorites : [];
      const add = guest.filter((k) => !server.includes(k));
      let favorites = server;
      if (add.length) {
        const combined = server.concat(add).slice(0, MAX_FAVS);
        const r = await callRpc('set_my_favorites', { p_game_keys: combined });
        if (!r.ok) return r;
        favorites = r.favorites || combined;
      }
      lsDel(LS_GUEST); lsSet(flag, String(Date.now()));
      setCache(user.id, favorites, 'merge', false);
      return { ok: true, merged: add.length, favorites };
    } catch (e) { return { ok: false, error: (e && e.message) || 'Something went wrong.' }; }
  }

  // ---- realtime + refresh-on-open
  function scheduleRefresh(source) {
    if (refreshTimer) return;
    refreshTimer = setTimeout(async () => {
      refreshTimer = null;
      try {
        const user = await getAuthUser();
        if (!user) { setCache(null, readGuest(), source, true); return; }
        const r = await callRpc('get_my_favorites');
        if (r.ok && Array.isArray(r.favorites)) setCache(user.id, r.favorites, source, false);
      } catch (_) {}
    }, 200);
  }

  async function ensureRealtime() {
    try {
      const client = getClient();
      const user = await getAuthUser();
      const uid = user ? user.id : null;
      if (rt.uid === uid && (rt.channel || !uid)) return;
      if (rt.channel && client && typeof client.removeChannel === 'function') { try { client.removeChannel(rt.channel); } catch (_) {} }
      rt = { uid, channel: null };
      if (!uid || !client || typeof client.channel !== 'function' || shouldSkipSupabase(client)) return;
      const ch = client
        .channel('v26-favs-' + Math.random().toString(36).slice(2, 8))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'user_favorites', filter: 'user_id=eq.' + uid }, () => scheduleRefresh('realtime'))
        .subscribe();
      rt = { uid, channel: ch };
    } catch (_) {}
  }

  function hookDocument() {
    if (docHooked) return;
    docHooked = true;
    try {
      if (global.document && typeof global.document.addEventListener === 'function') {
        global.document.addEventListener('visibilitychange', () => {
          if (listeners.size && global.document.visibilityState !== 'hidden') { scheduleRefresh('visibility'); ensureRealtime(); }
        });
      }
      if (typeof global.addEventListener === 'function') {
        global.addEventListener('online', () => { if (listeners.size) scheduleRefresh('online'); });
        global.addEventListener('focus', () => { if (listeners.size) scheduleRefresh('focus'); });
      }
    } catch (_) {}
  }

  function hookAuth() {
    if (authHooked) return;
    const client = getClient();
    if (!client || !client.auth || typeof client.auth.onAuthStateChange !== 'function') return;
    authHooked = true;
    try {
      client.auth.onAuthStateChange((event) => {
        if (!listeners.size) return;
        if (event === 'SIGNED_IN') { mergeGuestFavorites().then(() => { scheduleRefresh('auth'); ensureRealtime(); }); }
        else if (event === 'SIGNED_OUT') { knownUid = null; ensureRealtime(); scheduleRefresh('auth'); }
      });
    } catch (_) {}
  }

  function subscribeFavorites(cb) {
    try {
      if (typeof cb !== 'function') return function () {};
      listeners.add(cb);
      hookDocument(); hookAuth();
      ensureRealtime();
      // refresh-on-open: deliver the current list straight away
      (async () => {
        try {
          const r = await getFavorites();
          if (r && r.ok && listeners.has(cb)) {
            const guest = !!r.guest;
            if (guest) cache = { uid: null, list: r.favorites.slice() };
            try { cb({ favorites: r.favorites.slice(), source: 'open', guest }); } catch (_) {}
          }
        } catch (_) {}
      })();
      return function unsubscribe() {
        listeners.delete(cb);
        if (!listeners.size && rt.channel) {
          const client = getClient();
          try { if (client && typeof client.removeChannel === 'function') client.removeChannel(rt.channel); } catch (_) {}
          rt = { uid: null, channel: null };
        }
      };
    } catch (_) { return function () {}; }
  }

  // ------------------------------------------------------------------ games
  function cleanUuid(v) { const s = String(v == null ? '' : v).trim(); return UUID_RE.test(s) ? s : null; }

  async function getGameDetail(gameId) {
    try {
      const id = cleanUuid(gameId);
      if (!id) return { ok: false, error: 'not_found', message: 'Game not found.' };
      const user = await getAuthUser();
      if (!user) return notSignedIn();
      return await callRpc('get_game_detail', { p_game_id: id });
    } catch (e) { return { ok: false, error: (e && e.message) || 'Something went wrong.' }; }
  }

  function isoOrNull(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString();
    const s = String(v).trim();
    return s || null;
  }

  async function updateGame(gameId, editOrPayload, options) {
    try {
      const id = cleanUuid(gameId);
      if (!id) return { ok: false, error: 'not_found', message: 'Game not found.' };
      if (!editOrPayload || typeof editOrPayload !== 'object' || Array.isArray(editOrPayload)) {
        return { ok: false, error: 'invalid_payload', message: 'edit must be an object' };
      }
      const user = await getAuthUser();
      if (!user) return notSignedIn();
      const opts = options || {};
      const args = { p_game_id: id, p_edit: editOrPayload };
      const expected = isoOrNull(opts.expectedEditedAt != null ? opts.expectedEditedAt : opts.expected_edited_at);
      if (expected) args.p_expected_edited_at = expected;
      const r = await callRpc('update_game_record', args);
      if (r && r.ok === true) {
        emit('tallyit:game-edited', { game_id: id, game: r.game || null, winner_changed: !!r.winner_changed });
      }
      return r;
    } catch (e) { return { ok: false, error: (e && e.message) || 'Something went wrong.' }; }
  }

  function updateSharedGame(edit, options) {
    const id = edit && typeof edit === 'object' ? (edit.game_id || edit.gameId || edit.id) : null;
    return updateGame(id, edit, options);
  }

  function canEditGame(x) {
    try {
      if (!x || typeof x !== 'object') return false;
      const g = x.game && typeof x.game === 'object' ? x.game : x;
      if (g.can_edit === true || g.is_owner === true) return true;
      return !!(knownUid && g.created_by && String(g.created_by) === String(knownUid));
    } catch (_) { return false; }
  }

  function clearCache() { cache = { uid: null, list: null }; migrationReady = null; migrationCheckedAt = 0; }
  function isMigrationReady() { return migrationReady; }

  // prime the sync helpers (isFavorite / canEditGame) without blocking
  try { getAuthUser().then((u) => { if (u) getFavorites(); }).catch(() => {}); } catch (_) {}

  global.TallyItV26Backend = {
    getFavorites, setFavorites, toggleFavorite, isFavorite, subscribeFavorites, mergeGuestFavorites,
    getGameDetail, updateGame, updateSharedGame, canEditGame,
    clearCache, isMigrationReady, normalizeKeys
  };
})(typeof window !== 'undefined' ? window : globalThis);
