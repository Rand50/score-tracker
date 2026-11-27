/**
 * Score Tracker — Social & Identity Client Layer (window.SocialAPI)
 * Drop-in module for game_tracker.html. Depends on window.sb (Supabase v2 client).
 *
 * Exposes window.SocialAPI:
 *   - ensureProfile(user?, preferredName?)
 *   - updateDisplayName(newName)
 *   - lookupUser(identifier)
 *   - listFriends()
 *   - sendFriendRequest(identifier)
 *   - respondFriendRequest(friendshipId, action) // 'accept' | 'decline'
 *   - removeFriend(friendshipId)
 *   - listGroups()
 *   - createGroup(name, memberUserIds?)
 *   - deleteGroup(groupId)
 *   - saveSharedGame(game, options?)
 *   - loadMyGames(options?)
 *   - loadGroupGames(groupId)
 *   - getCachedProfile()
 *   - getDefaultPlayer()
 *   - isMigrationReady()
 *   - reset()
 *
 * Gracefully falls back to localStorage / legacy `score_history` whenever the
 * Supabase social migration hasn't been applied yet or the client is offline.
 */
(function (global) {
  'use strict';

  const LS_PREFIX = 'gst_social_v1_';
  const APP_URL = 'https://rand50.github.io/score-tracker/game_tracker.html';
  const PENDING_FRIEND_KEY = 'gst_pending_add_friend_v1';
  const PENDING_FRIEND_TTL_MS = 24 * 60 * 60 * 1000;
  let cachedProfile = null;
  let migrationReady = null; // null = unknown, true = ready, false = not migrated yet
  let migrationCheckedAt = 0;

  function markMigrationMissing() {
    migrationReady = false;
    migrationCheckedAt = Date.now();
  }

  function shouldSkipSupabase(client) {
    if (!client) return true;
    if (migrationReady !== false) return false;
    // Allow automatic recovery after 30s (e.g., once SQL migration is applied or transient error clears)
    if (Date.now() - migrationCheckedAt > 30000) {
      migrationReady = null;
      return false;
    }
    return true;
  }

  function extractAddFriendParam(input) {
    const raw = String(input || '').trim();
    if (!raw) return null;
    const keys = ['addFriend', 'addfriend', 'friend', 'friendCode', 'friendcode'];
    const readParams = (sp) => {
      for (const k of keys) {
        const v = sp.get(k);
        if (v && v.trim()) return v.trim();
      }
      // Case-insensitive fallback
      for (const [k, v] of sp.entries()) {
        if (keys.some((x) => x.toLowerCase() === k.toLowerCase()) && v && v.trim()) return v.trim();
      }
      return null;
    };
    try {
      if (/^https?:\/\//i.test(raw)) {
        const u = new URL(raw);
        const fromSearch = readParams(u.searchParams);
        if (fromSearch) return fromSearch;
        if (u.hash) {
          const fromHash = readParams(new URLSearchParams(u.hash.replace(/^#\??/, '')));
          if (fromHash) return fromHash;
        }
        return null;
      }
      if (raw.includes('addFriend=') || raw.includes('addfriend=') || raw.startsWith('?')) {
        const q = raw.includes('?') ? raw.slice(raw.indexOf('?') + 1) : raw;
        const fromQ = readParams(new URLSearchParams(q.split('#')[0]));
        if (fromQ) return fromQ;
      }
    } catch (_) {}
    return null;
  }

  function normalizeFriendIdentifier(rawInput) {
    let val = String(rawInput || '').trim();
    if (!val) return '';
    const fromUrl = extractAddFriendParam(val);
    if (fromUrl) val = fromUrl;
    val = val.trim().replace(/^@+/, '').trim();
    if (!val) return '';
    // Email address
    if (val.includes('@')) return val.toLowerCase();
    // Normalize unicode dashes and whitespace in friend codes (e.g., "rand 4821", "RAND–4821", "RAND4821")
    let code = val.replace(/[\u2010-\u2015\u2212]/g, '-').replace(/\s*-\s*/g, '-').replace(/\s+/g, '-').toUpperCase();
    if (/^[A-Z]{2,4}\d{4}$/.test(code)) {
      code = code.slice(0, -4) + '-' + code.slice(-4);
    }
    return code;
  }

  function parseFriendQrInput(rawInput) {
    const raw = String(rawInput || '').trim();
    const fromUrl = extractAddFriendParam(raw);
    const identifier = normalizeFriendIdentifier(fromUrl || raw);
    if (!identifier || identifier.length < 3) {
      return { ok: false, identifier: '', raw, isUrl: !!fromUrl, error: 'Invalid friend code, email, or QR link.' };
    }
    return { ok: true, identifier, raw, isUrl: !!fromUrl };
  }

  function buildFriendShareUrl(profileOrCode) {
    let code = '';
    if (typeof profileOrCode === 'string') {
      code = normalizeFriendIdentifier(profileOrCode);
    } else if (profileOrCode && typeof profileOrCode === 'object') {
      code = normalizeFriendIdentifier(profileOrCode.friend_code || profileOrCode.friendCode || '');
    } else if (cachedProfile && cachedProfile.friend_code) {
      code = normalizeFriendIdentifier(cachedProfile.friend_code);
    }
    if (!code) return null;
    const base = (global.location && /^https?:\/\//i.test(global.location.origin) && /game_tracker\.html$/i.test(global.location.pathname))
      ? (global.location.origin + global.location.pathname)
      : APP_URL;
    return base + '?addFriend=' + encodeURIComponent(code);
  }

  function capturePendingFriendFromUrl(urlStr) {
    try {
      const href = urlStr || (global.location && global.location.href) || '';
      const extracted = extractAddFriendParam(href);
      if (!extracted) return null;
      const ident = normalizeFriendIdentifier(extracted);
      if (!ident || ident.length < 3) return null;
      const payload = JSON.stringify({ identifier: ident, capturedAt: Date.now() });
      try { if (global.sessionStorage) global.sessionStorage.setItem(PENDING_FRIEND_KEY, payload); } catch (_) {}
      try { if (global.localStorage) global.localStorage.setItem(PENDING_FRIEND_KEY, payload); } catch (_) {}
      return ident;
    } catch (_) {
      return null;
    }
  }

  function getPendingFriendInvite() {
    const fromUrl = capturePendingFriendFromUrl();
    if (fromUrl) return fromUrl;
    try {
      const raw = (global.sessionStorage && global.sessionStorage.getItem(PENDING_FRIEND_KEY))
        || (global.localStorage && global.localStorage.getItem(PENDING_FRIEND_KEY));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.identifier) return null;
      if (parsed.capturedAt && Date.now() - parsed.capturedAt > PENDING_FRIEND_TTL_MS) {
        global.localStorage.removeItem(PENDING_FRIEND_KEY);
        return null;
      }
      return normalizeFriendIdentifier(parsed.identifier) || null;
    } catch (_) {
      return null;
    }
  }

  function clearPendingFriendInvite(cleanUrl) {
    try { if (global.sessionStorage) global.sessionStorage.removeItem(PENDING_FRIEND_KEY); } catch (_) {}
    try { if (global.localStorage) global.localStorage.removeItem(PENDING_FRIEND_KEY); } catch (_) {}
    if (cleanUrl !== false && global.location && global.history && global.history.replaceState) {
      try {
        const u = new URL(global.location.href);
        let dirty = false;
        ['addFriend', 'addfriend', 'friend', 'friendCode', 'friendcode'].forEach((k) => {
          if (u.searchParams.has(k)) { u.searchParams.delete(k); dirty = true; }
        });
        if (dirty) {
          const qs = u.searchParams.toString();
          global.history.replaceState({}, document.title, u.origin + u.pathname + (qs ? '?' + qs : '') + u.hash);
        }
      } catch (_) {}
    }
  }

  function getClient() {
    return global.sb || null;
  }

  async function getAuthUser(explicitUser) {
    if (explicitUser && explicitUser.id) return explicitUser;
    if (global.ScoreAuth && typeof global.ScoreAuth.getUser === 'function') {
      try {
        const u = await global.ScoreAuth.getUser();
        if (u && u.id) return u;
      } catch (_) {}
    }
    const client = getClient();
    if (!client) return cachedProfile ? { id: cachedProfile.id, email: cachedProfile.email } : null;
    try {
      const { data: { session } } = await client.auth.getSession();
      return session && session.user ? session.user : null;
    } catch (_) {
      return null;
    }
  }

  function isMissingMigrationError(err) {
    if (!err) return false;
    const code = String(err.code || '').toUpperCase();
    const msg = String(err.message || err.details || err.hint || '').toLowerCase();
    if (code === '42P01' || code === '42883' || code === '42703' || code === 'PGRST202' || code === 'PGRST205') return true;
    return (
      msg.includes('does not exist') ||
      msg.includes('could not find the table') ||
      msg.includes('could not find the function')
    );
  }

  function lsKey(uid, bucket) {
    return LS_PREFIX + (uid || 'anon') + '_' + bucket;
  }

  function readLocal(uid, bucket, fallback) {
    try {
      const raw = global.localStorage && global.localStorage.getItem(lsKey(uid, bucket));
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function writeLocal(uid, bucket, value) {
    try {
      if (global.localStorage) {
        global.localStorage.setItem(lsKey(uid, bucket), JSON.stringify(value));
      }
    } catch (_) {}
  }

  function deriveDisplayName(user, preferredName) {
    const pref = String(preferredName || '').trim();
    if (pref) return pref.slice(0, 40);
    const meta = (user && user.user_metadata) || {};
    const fromMeta = String(
      meta.full_name || meta.name || meta.display_name || meta.preferred_username || ''
    ).trim();
    if (fromMeta) return fromMeta.slice(0, 40);
    const email = String((user && user.email) || '').trim();
    if (email && email.includes('@')) {
      const local = email.split('@')[0].replace(/[._-]+/g, ' ').trim();
      if (local) {
        return local
          .split(/\s+/)
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' ')
          .slice(0, 40);
      }
    }
    return 'Player';
  }

  function deterministicLocalCode(name, uid) {
    const clean = String(name || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const prefix = clean.length >= 2 ? clean.slice(0, 4) : 'PLYR';
    let hash = 0;
    const seed = String(uid || name || '0');
    for (let i = 0; i < seed.length; i++) {
      hash = (hash * 31 + seed.charCodeAt(i)) % 9000;
    }
    const num = 1000 + Math.abs(hash);
    return prefix + '-' + String(num);
  }

  function buildFallbackProfile(user, preferredName) {
    const saved = readLocal(user.id, 'profile', null);
    const displayName = preferredName
      ? String(preferredName).trim().slice(0, 40)
      : (saved && saved.display_name) || deriveDisplayName(user);
    const profile = {
      id: user.id,
      display_name: displayName,
      email: (user.email || '').toLowerCase() || null,
      friend_code: (saved && saved.friend_code) || deterministicLocalCode(displayName, user.id),
      is_fallback: true
    };
    writeLocal(user.id, 'profile', profile);
    cachedProfile = profile;
    return profile;
  }

  function defaultPlayerFromProfile(profile) {
    if (!profile) return null;
    return {
      name: profile.display_name,
      user_id: profile.id,
      friend_code: profile.friend_code,
      isSelf: true
    };
  }

  // ---------------------------------------------------------------------------
  // 0. Local demo-mode friends (used until the Supabase social migration is applied)
  // ---------------------------------------------------------------------------
  const isLocalId = (id) => /^local-/.test(String(id || ''));
  function readLocalFriends(uid) { return readLocal(uid, 'friends', []); }
  function writeLocalFriends(uid, list) { writeLocal(uid, 'friends', list); }
  function splitLocalFriends(list) {
    const accepted = [], incoming = [], outgoing = [];
    (list || []).forEach((f) => {
      const e = { ...f, isLocal: true };
      if (f.status === 'accepted') accepted.push(e);
      else if (f.status === 'pending') (f.direction === 'incoming' ? incoming : outgoing).push(e);
    });
    return { accepted, incoming, outgoing };
  }
  function addLocalFriend(user, ident) {
    const raw = String(ident || '').trim();
    const lower = raw.toLowerCase();
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw);
    const isCode = /^[a-z0-9]{2,6}-[a-z0-9]{3,8}$/i.test(raw);
    const me = cachedProfile || {};
    if ((isEmail && lower === String(user.email || me.email || '').toLowerCase()) ||
        (isCode && raw.toUpperCase() === String(me.friend_code || '').toUpperCase())) {
      return { ok: false, isFallback: true, error: 'You cannot add yourself as a friend.' };
    }
    const list = readLocalFriends(user.id);
    const existing = list.find((f) => (isEmail && f.email === lower) || (isCode && String(f.friendCode || '').toUpperCase() === raw.toUpperCase()) ||
      (!isEmail && !isCode && String(f.displayName || '').toLowerCase() === lower));
    if (existing) return { ok: true, status: existing.status === 'accepted' ? 'already_friends' : 'already_pending', isFallback: true, target: existing };
    const displayName = isEmail ? deriveDisplayName({ email: raw }) : isCode ? raw.toUpperCase() : raw.slice(0, 40);
    const slug = (isEmail ? lower : isCode ? raw.toUpperCase() : lower).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 40) || 'friend';
    const entry = {
      friendshipId: 'local-fr-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      userId: 'local-friend-' + slug,
      displayName,
      friendCode: isCode ? raw.toUpperCase() : '',
      email: isEmail ? lower : null,
      status: 'accepted',
      since: new Date().toISOString()
    };
    list.unshift(entry);
    writeLocalFriends(user.id, list);
    return { ok: true, status: 'accepted', isFallback: true, target: entry };
  }

  // ---------------------------------------------------------------------------
  // 1. Profiles & Default Signed-In Player
  // ---------------------------------------------------------------------------
  async function ensureProfile(explicitUser, preferredName) {
    const user = await getAuthUser(explicitUser);
    if (!user) return { profile: null, defaultPlayer: null, isFallback: true };

    const client = getClient();
    if (!client) {
      const fallback = buildFallbackProfile(user, preferredName);
      return { profile: fallback, defaultPlayer: defaultPlayerFromProfile(fallback), isFallback: true };
    }

    try {
      const { data, error } = await client.rpc('ensure_my_profile', {
        p_display_name: preferredName ? String(preferredName).trim() : null
      });

      if (error) {
        if (isMissingMigrationError(error)) {
          migrationReady = false;
        }
        const fallback = buildFallbackProfile(user, preferredName);
        return {
          profile: fallback,
          defaultPlayer: defaultPlayerFromProfile(fallback),
          isFallback: true,
          error: error.message
        };
      }

      migrationReady = true;
      const profile = Array.isArray(data) ? data[0] : data;
      if (!profile) {
        const fallback = buildFallbackProfile(user, preferredName);
        return { profile: fallback, defaultPlayer: defaultPlayerFromProfile(fallback), isFallback: true };
      }

      cachedProfile = profile;
      writeLocal(user.id, 'profile', profile);
      return {
        profile,
        defaultPlayer: defaultPlayerFromProfile(profile),
        isFallback: false
      };
    } catch (err) {
      const fallback = buildFallbackProfile(user, preferredName);
      return {
        profile: fallback,
        defaultPlayer: defaultPlayerFromProfile(fallback),
        isFallback: true,
        error: err && err.message
      };
    }
  }

  async function updateDisplayName(newName) {
    const cleaned = String(newName || '').trim().slice(0, 40);
    if (!cleaned) return { ok: false, error: 'Display name cannot be empty.' };

    const user = await getAuthUser();
    if (!user) return { ok: false, error: 'Not signed in.' };

    const client = getClient();
    if (!client || migrationReady === false) {
      const profile = buildFallbackProfile(user, cleaned);
      return { ok: true, profile, isFallback: true };
    }

    try {
      const { data, error } = await client
        .from('profiles')
        .update({ display_name: cleaned, updated_at: new Date().toISOString() })
        .eq('id', user.id)
        .select('*')
        .single();

      if (error) {
        if (isMissingMigrationError(error)) migrationReady = false;
        const profile = buildFallbackProfile(user, cleaned);
        return { ok: true, profile, isFallback: true, warning: error.message };
      }

      migrationReady = true;
      cachedProfile = data;
      writeLocal(user.id, 'profile', data);
      return { ok: true, profile: data, isFallback: false };
    } catch (err) {
      const profile = buildFallbackProfile(user, cleaned);
      return { ok: true, profile, isFallback: true, warning: err && err.message };
    }
  }

  // ---------------------------------------------------------------------------
  // 2. Friends (Lookup via SECURITY DEFINER RPC, Requests, Accept/Decline/Remove, QR)
  // ---------------------------------------------------------------------------
  async function lookupUser(identifier) {
    const ident = normalizeFriendIdentifier(identifier);
    if (ident.length < 3) return { ok: false, user: null, error: 'Enter an email or friend code.' };

    const client = getClient();
    if (shouldSkipSupabase(client)) {
      return { ok: false, user: null, isFallback: true, error: 'Social sync is not enabled yet.' };
    }

    try {
      const { data, error } = await client.rpc('lookup_profile', { identifier: ident });
      if (error) {
        if (isMissingMigrationError(error)) markMigrationMissing();
        return { ok: false, user: null, isFallback: isMissingMigrationError(error), error: error.message };
      }
      migrationReady = true;
      const row = Array.isArray(data) ? data[0] : data;
      return { ok: !!row, user: row || null, error: row ? null : 'No player found.' };
    } catch (err) {
      return { ok: false, user: null, error: (err && err.message) || 'Lookup failed.' };
    }
  }

  function mergeAcceptedWithLocal(remoteAccepted, localAccepted) {
    const seenIds = new Set(remoteAccepted.map((f) => String(f.userId || '').toLowerCase()).filter(Boolean));
    const seenCodes = new Set(remoteAccepted.map((f) => String(f.friendCode || '').toUpperCase()).filter(Boolean));
    const extras = (localAccepted || []).filter((lf) => {
      if (lf.userId && seenIds.has(String(lf.userId).toLowerCase())) return false;
      if (lf.friendCode && seenCodes.has(String(lf.friendCode).toUpperCase())) return false;
      return true;
    });
    return [...remoteAccepted, ...extras];
  }

  function bucketFriendRows(rows, myUserId, profileMap) {
    const accepted = [];
    const incoming = [];
    const outgoing = [];
    const myId = String(myUserId || '').toLowerCase();

    (rows || []).forEach((r) => {
      const status = String(r.status || '').toLowerCase();
      if (status === 'declined') return;
      const reqId = String(r.requester_id || '').toLowerCase();
      const isRequester = reqId === myId;
      const otherId = r.other_user_id || (isRequester ? r.addressee_id : r.requester_id);
      const p = (profileMap && profileMap.get(otherId)) || null;
      const entry = {
        friendshipId: r.friendship_id || r.id,
        userId: (p && p.id) || otherId,
        displayName: (p && p.display_name) || r.display_name || 'Player',
        friendCode: (p && p.friend_code) || r.friend_code || '',
        status,
        direction: status === 'pending' ? (isRequester ? 'outgoing' : 'incoming') : 'accepted',
        since: r.updated_at || r.created_at
      };

      if (status === 'accepted') accepted.push(entry);
      else if (status === 'pending') {
        if (isRequester) outgoing.push(entry);
        else incoming.push(entry);
      }
    });

    return { accepted, incoming, outgoing };
  }

  async function listFriends() {
    const user = await getAuthUser();
    const empty = { accepted: [], incoming: [], outgoing: [], isFallback: true };
    if (!user) return empty;

    const client = getClient();
    const local = splitLocalFriends(readLocalFriends(user.id));
    if (shouldSkipSupabase(client)) {
      return { ...local, isFallback: true, source: 'local' };
    }

    try {
      // Primary path: SECURITY DEFINER RPC (immune to table-grant / profiles-RLS gaps)
      const { data: rpcRows, error: rpcErr } = await client.rpc('list_my_friends');
      if (!rpcErr && Array.isArray(rpcRows)) {
        migrationReady = true;
        const buckets = bucketFriendRows(rpcRows, user.id, null);
        return {
          accepted: buckets.accepted,
          incoming: buckets.incoming,
          outgoing: buckets.outgoing,
          isFallback: false,
          source: 'rpc'
        };
      }

      // If list_my_friends RPC isn't installed yet, fall back to direct table queries
      // without poisoning migrationReady.
      const { data: rows, error } = await client
        .from('friendships')
        .select('id, requester_id, addressee_id, status, created_at, updated_at')
        .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
        .neq('status', 'declined')
        .order('updated_at', { ascending: false });

      if (error) {
        if (isMissingMigrationError(error)) markMigrationMissing();
        return {
          ...local,
          isFallback: isMissingMigrationError(error),
          error: error.message,
          errorCode: error.code || null,
          source: 'error'
        };
      }

      migrationReady = true;
      const list = rows || [];
      const myId = String(user.id).toLowerCase();
      const otherIds = [...new Set(list.map((r) => (String(r.requester_id || '').toLowerCase() === myId ? r.addressee_id : r.requester_id)).filter(Boolean))];
      const profileMap = new Map();

      if (otherIds.length) {
        const { data: profs, error: profErr } = await client
          .from('profiles')
          .select('id, display_name, friend_code')
          .in('id', otherIds);
        if (profErr) {
          console.warn('[SocialAPI] profiles lookup warning:', profErr.message);
        } else {
          (profs || []).forEach((p) => profileMap.set(p.id, p));
        }
      }

      const buckets = bucketFriendRows(list, user.id, profileMap);
      return {
        accepted: buckets.accepted, // live list only (local demo friends are never merged into a live Supabase list)
        incoming: buckets.incoming,
        outgoing: buckets.outgoing,
        isFallback: false,
        source: 'table'
      };
    } catch (err) {
      return { ...local, isFallback: true, error: err && err.message, source: 'error' };
    }
  }

  async function sendFriendRequest(identifier) {
    const parsed = parseFriendQrInput(identifier);
    if (!parsed.ok) return { ok: false, error: 'Enter a friend email or friend code.' };
    const ident = parsed.identifier;

    const user = await getAuthUser();
    if (!user) return { ok: false, error: 'Sign in to add friends.' };

    const myEmail = String(user.email || (cachedProfile && cachedProfile.email) || '').toLowerCase();
    const myCode = String((cachedProfile && cachedProfile.friend_code) || '').toUpperCase();
    if ((myEmail && ident.toLowerCase() === myEmail) || (myCode && ident.toUpperCase() === myCode)) {
      return { ok: false, error: 'You cannot add yourself as a friend.', identifier: ident };
    }

    const client = getClient();
    if (shouldSkipSupabase(client)) {
      return addLocalFriend(user, ident);
    }

    try {
      const { data, error } = await client.rpc('send_friend_request', { identifier: ident });
      if (error) {
        if (isMissingMigrationError(error)) {
          markMigrationMissing();
          return addLocalFriend(user, ident);
        }
        return { ok: false, error: error.message, identifier: ident };
      }
      migrationReady = true;
      return data ? { ...data, identifier: ident } : { ok: false, error: 'Unexpected response.', identifier: ident };
    } catch (err) {
      return { ok: false, error: (err && err.message) || 'Could not send friend request.', identifier: ident };
    }
  }

  async function handleFriendQrOrCode(rawInput) {
    const parsed = parseFriendQrInput(rawInput);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    const res = await sendFriendRequest(parsed.identifier);
    return { ...res, identifier: parsed.identifier, isUrl: parsed.isUrl };
  }

  async function respondFriendRequest(friendshipId, action) {
    if (!friendshipId) return { ok: false, error: 'Missing friendship ID.' };
    const normalized = String(action || '').toLowerCase();
    const nextStatus = normalized === 'accept' || normalized === 'accepted'
      ? 'accepted'
      : normalized === 'decline' || normalized === 'declined'
        ? 'declined'
        : null;

    if (!nextStatus) return { ok: false, error: 'Action must be "accept" or "decline".' };

    const client = getClient();
    if (shouldSkipSupabase(client) || isLocalId(friendshipId)) {
      const user = await getAuthUser();
      if (!user) return { ok: false, error: 'Not signed in.' };
      const list = readLocalFriends(user.id);
      const f = list.find((x) => x.friendshipId === friendshipId);
      if (!f) return { ok: false, isFallback: true, error: 'Friend request not found.' };
      const next = nextStatus === 'declined' ? list.filter((x) => x !== f) : list.map((x) => (x === f ? { ...x, status: 'accepted' } : x));
      writeLocalFriends(user.id, next);
      return { ok: true, status: nextStatus, isFallback: true };
    }

    try {
      // Primary path: SECURITY DEFINER RPC
      const { data: rpcData, error: rpcErr } = await client.rpc('respond_friend_request', {
        p_friendship_id: friendshipId,
        p_action: nextStatus
      });
      if (!rpcErr && rpcData) {
        migrationReady = true;
        return rpcData;
      }
      if (rpcErr && !isMissingMigrationError(rpcErr)) {
        return { ok: false, error: rpcErr.message };
      }

      // Fallback: direct table update (use maybeSingle to avoid PGRST116 on 0-row / already-updated)
      const { data, error } = await client
        .from('friendships')
        .update({ status: nextStatus, updated_at: new Date().toISOString() })
        .eq('id', friendshipId)
        .select('*')
        .maybeSingle();

      if (error) {
        if (isMissingMigrationError(error)) markMigrationMissing();
        return { ok: false, error: error.message };
      }
      migrationReady = true;
      if (!data) return { ok: false, error: 'Friend request not found or already updated.' };
      return { ok: true, status: nextStatus, friendship: data };
    } catch (err) {
      return { ok: false, error: (err && err.message) || 'Could not update friend request.' };
    }
  }

  async function removeFriend(friendshipId) {
    if (!friendshipId) return { ok: false, error: 'Missing friendship ID.' };
    const client = getClient();
    if (shouldSkipSupabase(client) || isLocalId(friendshipId)) {
      const user = await getAuthUser();
      if (!user) return { ok: false, error: 'Not signed in.' };
      const list = readLocalFriends(user.id);
      writeLocalFriends(user.id, list.filter((x) => x.friendshipId !== friendshipId));
      return { ok: true, isFallback: true };
    }

    try {
      // Primary path: SECURITY DEFINER RPC
      const { data: rpcData, error: rpcErr } = await client.rpc('remove_friend', {
        p_friendship_id: friendshipId
      });
      if (!rpcErr && rpcData) {
        migrationReady = true;
        return rpcData;
      }
      if (rpcErr && !isMissingMigrationError(rpcErr)) {
        return { ok: false, error: rpcErr.message };
      }

      // Fallback: direct table delete
      const { error } = await client.from('friendships').delete().eq('id', friendshipId);
      if (error) {
        if (isMissingMigrationError(error)) markMigrationMissing();
        return { ok: false, error: error.message };
      }
      migrationReady = true;
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err && err.message) || 'Could not remove friend.' };
    }
  }

  function subscribeToFriendships(onChange) {
    const client = getClient();
    if (!client || typeof client.channel !== 'function' || typeof onChange !== 'function') {
      return () => {};
    }
    try {
      const ch = client
        .channel('friendships-live-' + Math.random().toString(36).slice(2, 8))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships' }, () => {
          try { onChange(); } catch (_) {}
        })
        .subscribe();
      return () => {
        try { client.removeChannel(ch); } catch (_) {}
      };
    } catch (_) {
      return () => {};
    }
  }

  // ---------------------------------------------------------------------------
  // 3. Groups
  // ---------------------------------------------------------------------------
  async function listGroups() {
    const user = await getAuthUser();
    if (!user) return { groups: [], isFallback: true };

    const client = getClient();
    if (!client || migrationReady === false) {
      return { groups: readLocal(user.id, 'groups', []), isFallback: true };
    }

    try {
      const { data: groups, error } = await client
        .from('groups')
        .select('id, name, created_by, created_at, guest_names, group_members(user_id, role, joined_at)')
        .order('created_at', { ascending: false });

      if (error) {
        if (isMissingMigrationError(error)) migrationReady = false;
        return { groups: readLocal(user.id, 'groups', []), isFallback: true, error: error.message };
      }

      migrationReady = true;
      const allUserIds = new Set();
      (groups || []).forEach((g) => {
        (g.group_members || []).forEach((m) => allUserIds.add(m.user_id));
      });

      const profileMap = new Map();
      if (allUserIds.size) {
        const { data: profs } = await client
          .from('profiles')
          .select('id, display_name, friend_code')
          .in('id', [...allUserIds]);
        (profs || []).forEach((p) => profileMap.set(p.id, p));
      }

      const formatted = (groups || []).map((g) => ({
        id: g.id,
        name: g.name,
        created_by: g.created_by,
        created_at: g.created_at,
        isOwner: g.created_by === user.id,
        members: (g.group_members || []).map((m) => {
          const p = profileMap.get(m.user_id) || { id: m.user_id, display_name: 'Player', friend_code: '' };
          return {
            userId: p.id,
            displayName: p.display_name,
            friendCode: p.friend_code,
            role: m.role
          };
        }).concat((Array.isArray(g.guest_names) ? g.guest_names : []).filter(Boolean).map((n) => ({
          userId: null, displayName: String(n), friendCode: '', role: 'guest', isGuest: true
        })))
      }));

      writeLocal(user.id, 'groups', formatted);
      return { groups: formatted, isFallback: false };
    } catch (err) {
      return { groups: readLocal(user.id, 'groups', []), isFallback: true, error: err && err.message };
    }
  }

  async function createGroup(name, memberUserIds, options) {
    const gopts = options || {};
    const pickedMembers = Array.isArray(gopts.members) ? gopts.members : [];
    const guestNames = [...new Set((gopts.guests || []).map((n) => String(n || '').trim()).filter(Boolean))];
    const cleaned = String(name || '').trim().slice(0, 60);
    if (!cleaned) return { ok: false, error: 'Group name cannot be empty.' };

    const user = await getAuthUser();
    if (!user) return { ok: false, error: 'Not signed in.' };

    const extras = [...new Set((memberUserIds || []).filter((id) => id && id !== user.id))];
    const remoteExtras = extras.filter((id) => !isLocalId(id));
    // Local demo friends can't be linked server-side yet: keep them in the group as named guests.
    const memberInfo = (id) => pickedMembers.find((m) => (m.userId || m.id) === id) || {};
    const remoteGuestNames = [...new Set([...extras.filter(isLocalId).map((id) => memberInfo(id).displayName || memberInfo(id).name).filter(Boolean), ...guestNames])];

    const saveLocalGroup = () => {
      const localGroups = readLocal(user.id, 'groups', []);
      const group = {
        id: 'local-grp-' + Date.now(),
        name: cleaned,
        created_by: user.id,
        created_at: new Date().toISOString(),
        isOwner: true,
        members: [
          {
            userId: user.id,
            displayName: (cachedProfile && cachedProfile.display_name) || deriveDisplayName(user),
            friendCode: (cachedProfile && cachedProfile.friend_code) || '',
            role: 'owner'
          },
          ...extras.map((id) => ({
            userId: id,
            displayName: memberInfo(id).displayName || memberInfo(id).name || 'Friend',
            friendCode: memberInfo(id).friendCode || '',
            role: 'member'
          })),
          ...guestNames.map((n) => ({ userId: null, displayName: n, friendCode: '', role: 'guest', isGuest: true }))
        ],
        is_fallback: true
      };
      localGroups.unshift(group);
      writeLocal(user.id, 'groups', localGroups);
      return { ok: true, group, isFallback: true };
    };

    const client = getClient();
    if (!client || migrationReady === false) {
      return saveLocalGroup();
    }

    try {
      // Make sure caller has a profile row first
      if (!cachedProfile) await ensureProfile(user);

      const { data: groupRow, error: grpErr } = await client
        .from('groups')
        .insert({ name: cleaned, created_by: user.id, guest_names: remoteGuestNames })
        .select('*')
        .single();

      if (grpErr) {
        if (isMissingMigrationError(grpErr)) {
          migrationReady = false;
          return saveLocalGroup();
        }
        return { ok: false, error: grpErr.message };
      }

      migrationReady = true;
      const memberRows = [
        { group_id: groupRow.id, user_id: user.id, role: 'owner' },
        ...remoteExtras.map((uid) => ({ group_id: groupRow.id, user_id: uid, role: 'member' }))
      ];

      const { error: memErr } = await client
        .from('group_members')
        .insert(memberRows);

      if (memErr) {
        return { ok: false, group: groupRow, error: memErr.message };
      }

      const refreshed = await listGroups();
      const fullGroup = (refreshed.groups || []).find((g) => g.id === groupRow.id) || groupRow;
      return { ok: true, group: fullGroup, isFallback: false };
    } catch (err) {
      return { ok: false, error: (err && err.message) || 'Could not create group.' };
    }
  }

  async function deleteGroup(groupId) {
    if (!groupId) return { ok: false, error: 'Missing group ID.' };
    const user = await getAuthUser();
    if (!user) return { ok: false, error: 'Not signed in.' };

    const removeLocal = () => {
      const next = readLocal(user.id, 'groups', []).filter((g) => g.id !== groupId);
      writeLocal(user.id, 'groups', next);
      return { ok: true, isFallback: true };
    };

    const client = getClient();
    if (!client || migrationReady === false || String(groupId).startsWith('local-grp-')) {
      return removeLocal();
    }

    try {
      const { error } = await client.from('groups').delete().eq('id', groupId);
      if (error) {
        if (isMissingMigrationError(error)) {
          migrationReady = false;
          return removeLocal();
        }
        return { ok: false, error: error.message };
      }
      migrationReady = true;
      removeLocal();
      return { ok: true, isFallback: false };
    } catch (err) {
      return { ok: false, error: (err && err.message) || 'Could not delete group.' };
    }
  }

  // ---------------------------------------------------------------------------
  // 4. Shared Games & History (Backwards-compatible with score_history)
  // ---------------------------------------------------------------------------
  function normalizeGameRow(row, groupMap, profileMap) {
    const payload = (row && row.payload) || {};
    const participants = Array.isArray(row.game_participants)
      ? [...row.game_participants].sort((a, b) => (a.seat_order || 0) - (b.seat_order || 0))
      : [];

    // Teams mode (e.g. Nertz partners): game_participants holds one row per partner (for RLS + leaderboard
    // credit) while payload.players keeps the display team rows (name, score, members).
    const isTeamMode = Boolean(
      (payload.meta && payload.meta.mode === 'teams') ||
      (Array.isArray(payload.players) && payload.players.some((pl) => pl && Array.isArray(pl.members) && pl.members.length))
    );
    const expandedParticipants = participants.map((p) => ({
      name: p.display_name,
      score: Number(p.score) || 0,
      user_id: p.user_id || null,
      is_winner: !!p.is_winner
    }));
    const players = isTeamMode && Array.isArray(payload.players) && payload.players.length
      ? payload.players
      : expandedParticipants.length
        ? expandedParticipants
        : Array.isArray(payload.players)
          ? payload.players
          : [];

    const creator = profileMap && row.created_by ? profileMap.get(row.created_by) : null;
    const grp = groupMap && row.group_id ? groupMap.get(row.group_id) : null;

    return {
      ...payload,
      id: row.id,
      client_game_id: row.client_game_id || payload.id || null,
      type: row.game_type || payload.type || 'custom',
      version: row.version != null ? row.version : payload.version || null,
      target: row.target != null ? row.target : payload.target || null,
      winner: row.winner || payload.winner || '',
      startTime: row.started_at || payload.startTime || null,
      endTime: row.ended_at || payload.endTime || row.created_at,
      players,
      ...(isTeamMode ? { participants: expandedParticipants } : {}),
      meta: payload.meta || null,
      rounds: Array.isArray(payload.rounds) ? payload.rounds : [],
      group_id: row.group_id || null,
      group_name: grp ? grp.name : null,
      created_by: row.created_by || null,
      created_by_name: creator ? creator.display_name : null,
      shared: true
    };
  }

  async function saveSharedGame(game, options) {
    const opts = options || {};
    const user = await getAuthUser();
    if (!user || !game) return { ok: false, error: 'Missing user or game.' };

    const groupId = opts.groupId || game.group_id || null;
    const clientGameId = String(game.client_game_id || game.id || (game.endTime ? 'g-' + game.endTime : 'g-' + Date.now()));
    const winnerNames = new Set(
      String(game.winner || '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    );

    const saveLocalGame = () => {
      const localGames = readLocal(user.id, 'games', []);
      const entry = {
        ...game,
        id: game.id || clientGameId,
        client_game_id: clientGameId,
        group_id: groupId,
        created_by: user.id,
        shared: false
      };
      const filtered = localGames.filter((g) => g.client_game_id !== clientGameId && g.id !== entry.id);
      filtered.unshift(entry);
      writeLocal(user.id, 'games', filtered.slice(0, 200));
      return { ok: true, game: entry, isFallback: true };
    };

    const client = getClient();
    if (!client || migrationReady === false) {
      return saveLocalGame();
    }

    try {
      if (!cachedProfile) await ensureProfile(user);

      const gameRecord = {
        client_game_id: clientGameId,
        created_by: user.id,
        group_id: groupId && !String(groupId).startsWith('local-grp-') ? groupId : null,
        game_type: String(game.type || 'custom'),
        version: game.version || null,
        target: typeof game.target === 'number' ? game.target : null,
        winner: game.winner || null,
        started_at: game.startTime || null,
        ended_at: game.endTime || new Date().toISOString(),
        payload: {
          rounds: Array.isArray(game.rounds) ? game.rounds : [],
          players: Array.isArray(game.players) ? game.players : [],
          meta: game.meta || null,
          version: game.version || null,
          target: game.target || null
        }
      };

      const { data: inserted, error: gameErr } = await client
        .from('games')
        .upsert(gameRecord, { onConflict: 'created_by,client_game_id' })
        .select('*')
        .single();

      if (gameErr) {
        if (isMissingMigrationError(gameErr)) {
          migrationReady = false;
          return saveLocalGame();
        }
        return { ok: false, error: gameErr.message, fallback: saveLocalGame() };
      }

      migrationReady = true;

      // Replace participants cleanly for idempotency
      await client.from('game_participants').delete().eq('game_id', inserted.id);

      // One row per player; team rows (p.members) expand into one row per partner so every linked
      // partner passes RLS (is_game_participant) and gets personal history + leaderboard credit.
      const linkedId = (v) => (v && !isLocalId(v) ? v : null);
      const participantRows = [];
      let seat = 0;
      (game.players || []).forEach((p) => {
        const name = String(p.name || p.display_name || 'Player').trim();
        const score = Number(p.score) || 0;
        const isWin = typeof p.is_winner === 'boolean'
          ? p.is_winner
          : typeof p.isWinner === 'boolean' ? p.isWinner : winnerNames.has(name.toLowerCase());
        if (Array.isArray(p.members) && p.members.length) {
          p.members.forEach((m) => {
            participantRows.push({
              game_id: inserted.id,
              user_id: linkedId(m && (m.user_id || m.userId)),
              display_name: String((m && (m.name || m.display_name)) || 'Player').trim(),
              score,
              is_winner: isWin,
              seat_order: seat++
            });
          });
        } else {
          participantRows.push({
            game_id: inserted.id,
            user_id: linkedId(p.user_id || p.userId),
            display_name: name,
            score,
            is_winner: isWin,
            seat_order: seat++
          });
        }
      });

      if (participantRows.length) {
        const { error: partErr } = await client.from('game_participants').insert(participantRows);
        if (partErr) {
          return { ok: false, game: inserted, error: partErr.message };
        }
      }

      return { ok: true, game: inserted, isFallback: false };
    } catch (err) {
      return { ok: false, error: (err && err.message) || 'Could not save shared game.', fallback: saveLocalGame() };
    }
  }

  async function enrichAndNormalizeGames(client, rows) {
    const list = rows || [];
    const groupIds = [...new Set(list.map((r) => r.group_id).filter(Boolean))];
    const creatorIds = [...new Set(list.map((r) => r.created_by).filter(Boolean))];

    const groupMap = new Map();
    const profileMap = new Map();

    if (groupIds.length) {
      const { data: grps } = await client.from('groups').select('id, name').in('id', groupIds);
      (grps || []).forEach((g) => groupMap.set(g.id, g));
    }
    if (creatorIds.length) {
      const { data: profs } = await client
        .from('profiles')
        .select('id, display_name, friend_code')
        .in('id', creatorIds);
      (profs || []).forEach((p) => profileMap.set(p.id, p));
    }

    return list.map((r) => normalizeGameRow(r, groupMap, profileMap));
  }

  async function loadMyGames(options) {
    const opts = options || {};
    const limit = opts.limit || 100;
    const includeLegacy = opts.includeLegacy !== false;
    const user = await getAuthUser();
    if (!user) return { games: [], isFallback: true };

    const client = getClient();

    async function loadLegacyGames() {
      const out = [];
      // Local fallback games
      out.push(...readLocal(user.id, 'games', []));
      if (includeLegacy && client) {
        try {
          const { data } = await client
            .from('score_history')
            .select('history')
            .eq('user_id', user.id)
            .maybeSingle();
          if (data && Array.isArray(data.history)) out.push(...data.history);
        } catch (_) {}
      }
      return out;
    }

    function mergeDedup(primary, secondary) {
      const seen = new Map();
      const keyOf = (g) => (g && (g.client_game_id || g.id || g.endTime || JSON.stringify(g)));
      (secondary || []).forEach((g) => { if (g) seen.set(keyOf(g), g); });
      (primary || []).forEach((g) => { if (g) seen.set(keyOf(g), g); });
      return [...seen.values()].sort(
        (a, b) => (Date.parse(b.endTime || b.startTime || 0) || 0) - (Date.parse(a.endTime || a.startTime || 0) || 0)
      );
    }

    if (!client || migrationReady === false) {
      const legacy = await loadLegacyGames();
      return { games: mergeDedup([], legacy), isFallback: true };
    }

    try {
      // RLS automatically returns games where user is creator, participant, or group member
      const { data: rows, error } = await client
        .from('games')
        .select('id, client_game_id, created_by, group_id, game_type, version, target, winner, started_at, ended_at, payload, created_at, game_participants(id, user_id, display_name, score, is_winner, seat_order)')
        .order('ended_at', { ascending: false })
        .limit(limit);

      if (error) {
        if (isMissingMigrationError(error)) migrationReady = false;
        const legacy = await loadLegacyGames();
        return { games: mergeDedup([], legacy), isFallback: true, error: error.message };
      }

      migrationReady = true;
      const sharedGames = await enrichAndNormalizeGames(client, rows);
      const legacy = includeLegacy ? await loadLegacyGames() : [];
      return { games: mergeDedup(sharedGames, legacy), isFallback: false };
    } catch (err) {
      const legacy = await loadLegacyGames();
      return { games: mergeDedup([], legacy), isFallback: true, error: err && err.message };
    }
  }

  async function loadGroupGames(groupId, options) {
    if (!groupId) return { games: [], isFallback: false };
    const limit = (options && options.limit) || 100;
    const user = await getAuthUser();
    if (!user) return { games: [], isFallback: true };

    const localGroupGames = () =>
      readLocal(user.id, 'games', []).filter((g) => g.group_id === groupId);

    const client = getClient();
    if (!client || migrationReady === false || String(groupId).startsWith('local-grp-')) {
      return { games: localGroupGames(), isFallback: true };
    }

    try {
      const { data: rows, error } = await client
        .from('games')
        .select('id, client_game_id, created_by, group_id, game_type, version, target, winner, started_at, ended_at, payload, created_at, game_participants(id, user_id, display_name, score, is_winner, seat_order)')
        .eq('group_id', groupId)
        .order('ended_at', { ascending: false })
        .limit(limit);

      if (error) {
        if (isMissingMigrationError(error)) migrationReady = false;
        return { games: localGroupGames(), isFallback: true, error: error.message };
      }

      migrationReady = true;
      const games = await enrichAndNormalizeGames(client, rows);
      return { games, isFallback: false };
    } catch (err) {
      return { games: localGroupGames(), isFallback: true, error: err && err.message };
    }
  }

  function reset() {
    cachedProfile = null;
    migrationReady = null;
  }

  // Capture any ?addFriend= deep link immediately on load so it survives OAuth / magic-link redirects
  capturePendingFriendFromUrl();

  global.SocialAPI = {
    ensureProfile,
    updateDisplayName,
    lookupUser,
    listFriends,
    sendFriendRequest,
    respondFriendRequest,
    removeFriend,
    listGroups,
    createGroup,
    deleteGroup,
    saveSharedGame,
    loadMyGames,
    loadGroupGames,
    normalizeFriendIdentifier,
    parseFriendQrInput,
    buildFriendShareUrl,
    capturePendingFriendFromUrl,
    getPendingFriendInvite,
    clearPendingFriendInvite,
    handleFriendQrOrCode,
    subscribeToFriendships,
    getCachedProfile: () => cachedProfile,
    getDefaultPlayer: () => defaultPlayerFromProfile(cachedProfile),
    isMigrationReady: () => migrationReady,
    reset
  };
})(window);
