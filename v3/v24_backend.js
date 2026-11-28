/**
 * TallyIt — v24 Player Linking Backend (window.TallyItV24Backend)
 * Drop-in module for game_tracker.html. Uses window.sb (Supabase v2 client).
 * Requires supabase_v24_player_linking.sql. If the migration hasn't run yet,
 * every call resolves to { ok:false, unavailable:true, error } and never throws.
 *
 * Exposes window.TallyItV24Backend:
 *   linkGameParticipant(gameId, participant, friendUserId)   creator links a friend (participant = row id or name)
 *   unlinkGameParticipant(gameId, participant)               creator or the linked player
 *   createParticipantClaim(gameId, participant)              -> { ok, token, url, participant_name, expires_at }
 *   previewParticipantClaim(token)                           works signed out
 *   claimGameParticipant(token)                              signed-in player links themself
 *   suggestMyUnlinkedGames({ force })                        -> { ok, suggestions: [...] } (30s cache, hides dismissed)
 *   claimSuggestedParticipant(participantId)                 one-tap "That was me"
 *   dismissSuggestion(participantId)                         hide a suggestion locally
 *   buildClaimUrl(token) / parseClaimToken(urlOrSearch)
 *   capturePendingClaimFromUrl({ stripUrl = true })          call on page load, before auth redirects
 *   getPendingClaim() / clearPendingClaim()
 *   consumePendingClaim()                                    call once signed in; claims and clears
 *   clearCache() / isMigrationReady()
 *
 * Fires window event 'tallyit:participant-linked' with detail { game_id, participant_name, user_id, linked_via }
 * after any successful link or claim so History / leaderboards can refresh.
 */
(function (global) {
  'use strict';

  const CLAIM_BASE_URL = 'https://tallyit.fun/';
  const CLAIM_PARAM = 'claim';
  const LS_PENDING = 'gst_v24_pending_claim';
  const LS_DISMISSED = 'gst_v24_dismissed_suggestions';
  const SUGGEST_TTL_MS = 30 * 1000;
  const MIGRATION_RETRY_MS = 30 * 1000;
  const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

  let migrationReady = null;
  let migrationCheckedAt = 0;
  let suggestCache = null; // { uid, rows, fetchedAt }

  function getClient() { return global.sb || null; }

  async function getAuthUser() {
    if (global.ScoreAuth && typeof global.ScoreAuth.getUser === 'function') {
      try { const u = await global.ScoreAuth.getUser(); if (u && u.id) return u; } catch (_) {}
    }
    const client = getClient();
    if (!client || !client.auth || typeof client.auth.getSession !== 'function') return null;
    try {
      const { data: { session } } = await client.auth.getSession();
      return session && session.user ? session.user : null;
    } catch (_) { return null; }
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

  function storageGet(store, key) { try { return store ? store.getItem(key) : null; } catch (_) { return null; } }
  function storageSet(store, key, val) { try { if (store) store.setItem(key, val); } catch (_) {} }
  function storageDel(store, key) { try { if (store) store.removeItem(key); } catch (_) {} }

  function readJson(key, fallback) {
    const raw = storageGet(global.localStorage, key);
    if (!raw) return fallback;
    try { return JSON.parse(raw); } catch (_) { return fallback; }
  }

  const UNAVAILABLE = 'Player linking is not available yet. Try again in a bit.';

  function unavailable() { return { ok: false, unavailable: true, error: UNAVAILABLE }; }

  async function callRpc(name, args, { requireUser = true } = {}) {
    const client = getClient();
    if (shouldSkipSupabase(client)) return unavailable();
    if (requireUser) {
      const user = await getAuthUser();
      if (!user) return { ok: false, code: 'not_signed_in', error: 'Sign in first.' };
    }
    let res;
    try {
      res = await client.rpc(name, args || {});
    } catch (e) {
      return { ok: false, error: (e && e.message) || 'Network error. Try again.' };
    }
    const { data, error } = res || {};
    if (error) {
      if (isMissingMigrationError(error)) { markMigrationMissing(); return unavailable(); }
      return { ok: false, code: error.code || null, error: error.message || 'Something went wrong.' };
    }
    migrationReady = true;
    return { ok: true, data };
  }

  function dispatchLinked(detail) {
    try {
      if (typeof global.dispatchEvent === 'function' && typeof global.CustomEvent === 'function') {
        global.dispatchEvent(new global.CustomEvent('tallyit:participant-linked', { detail }));
      }
    } catch (_) {}
  }

  // Wrap jsonb RPC replies ({ ok, code, error, ... }) and fire the link event on success
  async function jsonRpc(name, args, opts, { fireEvent = false } = {}) {
    const r = await callRpc(name, args, opts);
    if (!r.ok) return r;
    const payload = r.data && typeof r.data === 'object' ? r.data : { ok: false, error: 'Unexpected reply.' };
    if (payload.ok && fireEvent && !payload.already_claimed) {
      suggestCache = null;
      dispatchLinked({
        game_id: payload.game_id || null,
        participant_name: payload.participant_name || null,
        user_id: payload.user_id || null,
        linked_via: payload.linked_via || null
      });
    }
    return payload;
  }

  function cleanText(v) { return String(v == null ? '' : v).trim(); }

  async function linkGameParticipant(gameId, participant, friendUserId) {
    if (!gameId || !cleanText(participant) || !friendUserId) return { ok: false, code: 'bad_request', error: 'Pick a player and a friend.' };
    return jsonRpc('link_game_participant', { p_game_id: gameId, p_participant: cleanText(participant), p_user_id: friendUserId }, undefined, { fireEvent: true });
  }

  async function unlinkGameParticipant(gameId, participant) {
    if (!gameId || !cleanText(participant)) return { ok: false, code: 'bad_request', error: 'Pick a player.' };
    const r = await jsonRpc('unlink_game_participant', { p_game_id: gameId, p_participant: cleanText(participant) });
    if (r.ok) { suggestCache = null; dispatchLinked({ game_id: gameId, participant_name: r.participant_name || null, user_id: null, linked_via: 'unlink' }); }
    return r;
  }

  function buildClaimUrl(token) {
    return CLAIM_BASE_URL + '?' + CLAIM_PARAM + '=' + encodeURIComponent(token);
  }

  async function createParticipantClaim(gameId, participant) {
    if (!gameId || !cleanText(participant)) return { ok: false, code: 'bad_request', error: 'Pick a player.' };
    const r = await jsonRpc('create_participant_claim', { p_game_id: gameId, p_participant: cleanText(participant) });
    if (r.ok && r.token && !r.url) r.url = buildClaimUrl(r.token);
    return r;
  }

  function parseClaimToken(input) {
    const s = cleanText(input);
    if (!s) return null;
    if (TOKEN_RE.test(s)) return s;
    let query = s;
    const qi = s.indexOf('?');
    if (qi >= 0) query = s.slice(qi + 1);
    query = query.split('#')[0];
    const m = query.match(new RegExp('(?:^|&)' + CLAIM_PARAM + '=([^&]+)'));
    if (!m) return null;
    let tok;
    try { tok = decodeURIComponent(m[1]); } catch (_) { return null; }
    return TOKEN_RE.test(tok) ? tok : null;
  }

  async function previewParticipantClaim(token) {
    const t = parseClaimToken(token);
    if (!t) return { ok: false, code: 'invalid_token', error: 'This claim link is not valid.' };
    return jsonRpc('preview_participant_claim', { p_token: t }, { requireUser: false });
  }

  async function claimGameParticipant(token) {
    const t = parseClaimToken(token);
    if (!t) return { ok: false, code: 'invalid_token', error: 'This claim link is not valid.' };
    return jsonRpc('claim_game_participant', { p_token: t }, undefined, { fireEvent: true });
  }

  function getDismissed() {
    const d = readJson(LS_DISMISSED, []);
    return Array.isArray(d) ? d : [];
  }

  function dismissSuggestion(participantId) {
    if (!participantId) return false;
    const d = getDismissed();
    if (!d.includes(participantId)) { d.push(participantId); storageSet(global.localStorage, LS_DISMISSED, JSON.stringify(d.slice(-500))); }
    if (suggestCache) suggestCache.rows = suggestCache.rows.filter((r) => r.participant_id !== participantId);
    return true;
  }

  async function suggestMyUnlinkedGames(options) {
    const force = !!(options && options.force);
    const user = await getAuthUser();
    if (!user) return { ok: false, code: 'not_signed_in', error: 'Sign in first.', suggestions: [] };
    if (!force && suggestCache && suggestCache.uid === user.id && Date.now() - suggestCache.fetchedAt < SUGGEST_TTL_MS) {
      return { ok: true, cached: true, suggestions: suggestCache.rows.slice() };
    }
    const r = await callRpc('suggest_my_unlinked_games', {});
    if (!r.ok) return Object.assign({ suggestions: [] }, r);
    const dismissed = new Set(getDismissed());
    const rows = (Array.isArray(r.data) ? r.data : []).filter((s) => s && !dismissed.has(s.participant_id));
    suggestCache = { uid: user.id, rows, fetchedAt: Date.now() };
    return { ok: true, suggestions: rows.slice() };
  }

  async function claimSuggestedParticipant(participantId) {
    if (!participantId) return { ok: false, code: 'bad_request', error: 'Pick a game.' };
    return jsonRpc('claim_suggested_participant', { p_participant_id: participantId }, undefined, { fireEvent: true });
  }

  // ---- Claim deep link: survives the Google OAuth / magic-link round trip ----
  function savePending(token) {
    const v = JSON.stringify({ token, savedAt: Date.now() });
    storageSet(global.sessionStorage, LS_PENDING, v);
    storageSet(global.localStorage, LS_PENDING, v);
  }

  function getPendingClaim() {
    const raw = storageGet(global.sessionStorage, LS_PENDING) || storageGet(global.localStorage, LS_PENDING);
    if (!raw) return null;
    try {
      const p = JSON.parse(raw);
      if (!p || !TOKEN_RE.test(p.token || '')) return null;
      if (Date.now() - (p.savedAt || 0) > 30 * 24 * 3600 * 1000) { clearPendingClaim(); return null; }
      return p.token;
    } catch (_) { return null; }
  }

  function clearPendingClaim() {
    storageDel(global.sessionStorage, LS_PENDING);
    storageDel(global.localStorage, LS_PENDING);
  }

  function capturePendingClaimFromUrl(options) {
    const stripUrl = !options || options.stripUrl !== false;
    const loc = global.location;
    if (!loc) return null;
    const token = parseClaimToken(loc.search || '') || parseClaimToken((loc.hash || '').replace(/^#/, '?'));
    if (!token) return null;
    savePending(token);
    if (stripUrl && global.history && typeof global.history.replaceState === 'function') {
      try {
        const params = new URLSearchParams(loc.search || '');
        params.delete(CLAIM_PARAM);
        const qs = params.toString();
        global.history.replaceState(global.history.state, '', loc.pathname + (qs ? '?' + qs : '') + (loc.hash || ''));
      } catch (_) {}
    }
    return token;
  }

  // Call after sign-in. Keeps the token if the migration is missing or the network fails,
  // clears it for any final answer (claimed, expired, revoked, invalid, success).
  async function consumePendingClaim() {
    const token = getPendingClaim();
    if (!token) return { ok: false, code: 'no_pending_claim', error: 'Nothing to claim.' };
    const user = await getAuthUser();
    if (!user) return { ok: false, code: 'not_signed_in', pending: true, error: 'Sign in to claim this game.' };
    const r = await claimGameParticipant(token);
    const finalCodes = ['invalid_token', 'claimed', 'expired', 'revoked', 'already_linked', 'user_already_in_game', 'participant_not_found'];
    if (r.ok || finalCodes.includes(r.code)) clearPendingClaim();
    else r.pending = true;
    return r;
  }

  function clearCache() { suggestCache = null; }
  function isMigrationReady() { return migrationReady; }

  global.TallyItV24Backend = {
    linkGameParticipant,
    unlinkGameParticipant,
    createParticipantClaim,
    previewParticipantClaim,
    claimGameParticipant,
    suggestMyUnlinkedGames,
    claimSuggestedParticipant,
    dismissSuggestion,
    buildClaimUrl,
    parseClaimToken,
    capturePendingClaimFromUrl,
    getPendingClaim,
    clearPendingClaim,
    consumePendingClaim,
    clearCache,
    isMigrationReady,
    _isMissingMigrationError: isMissingMigrationError
  };
})(typeof window !== 'undefined' ? window : globalThis);
