/**
 * TallyIt — v20 Features Backend Client Layer (window.TallyItBackend)
 * Drop-in module for game_tracker.html. Uses window.sb (Supabase v2 client).
 *
 * Exposes window.TallyItBackend:
 *   - ADMIN_EMAIL
 *   - REQUEST_STATUSES
 *   - submitGameRequest(gameName, websiteUrl?)
 *   - recordGamePlay(gameKey, variationKey?, playerCount?)
 *   - getVariationPopularity(gameKey?, options?)
 *   - isAdmin(options?)
 *   - isLikelyAdminSync()
 *   - getAdminStats()
 *   - updateGameRequestStatus(id, status)
 *   - clearCache()
 *   - isMigrationReady()
 *
 * Gracefully falls back to localStorage whenever the v20 SQL migration has not
 * been applied yet or the client is offline, so the UI never breaks.
 */
(function (global) {
  'use strict';

  const ADMIN_EMAIL = 'randw50@gmail.com';
  const REQUEST_STATUSES = ['new', 'reviewing', 'planned', 'built', 'declined'];
  const LS_REQUESTS = 'gst_v20_game_requests';
  const LS_PLAYS = 'gst_v20_play_events';
  const POPULARITY_TTL_MS = 60 * 1000;
  const MIGRATION_RETRY_MS = 30 * 1000;

  let migrationReady = null; // null = unknown, true = ready, false = not migrated yet
  let migrationCheckedAt = 0;
  let adminCache = { userId: null, value: false, checkedAt: 0 };
  const popularityCache = new Map(); // key ('__all__' or game_key) -> { rows, byGame, fetchedAt }

  function getClient() {
    return global.sb || null;
  }

  async function getAuthUser() {
    if (global.ScoreAuth && typeof global.ScoreAuth.getUser === 'function') {
      try {
        const u = await global.ScoreAuth.getUser();
        if (u && u.id) return u;
      } catch (_) {}
    }
    const client = getClient();
    if (!client || !client.auth || typeof client.auth.getSession !== 'function') return null;
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

  function isForbiddenError(err) {
    if (!err) return false;
    const code = String(err.code || '').toUpperCase();
    const msg = String(err.message || '').toLowerCase();
    return code === '42501' || msg.includes('forbidden');
  }

  function markMigrationMissing() {
    migrationReady = false;
    migrationCheckedAt = Date.now();
  }

  function shouldSkipSupabase(client) {
    if (!client) return true;
    if (migrationReady !== false) return false;
    if (Date.now() - migrationCheckedAt > MIGRATION_RETRY_MS) {
      migrationReady = null;
      return false;
    }
    return true;
  }

  function readLocal(key, fallback) {
    try {
      const raw = global.localStorage && global.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function writeLocal(key, value) {
    try {
      if (global.localStorage) global.localStorage.setItem(key, JSON.stringify(value));
    } catch (_) {}
  }

  function normalizeWebsiteUrl(rawUrl) {
    const trimmed = String(rawUrl || '').trim();
    if (!trimmed) return { ok: true, url: null };
    if (trimmed.length > 500) {
      return { ok: false, url: null, error: 'Website link is too long (max 500 characters).' };
    }
    if (/^https?:\/\//i.test(trimmed)) {
      return { ok: true, url: trimmed };
    }
    if (/^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(trimmed)) {
      return { ok: true, url: 'https://' + trimmed };
    }
    return { ok: false, url: null, error: 'Website link must start with http:// or https://.' };
  }

  function groupPopularityRows(rows) {
    const byGame = {};
    (rows || []).forEach((r) => {
      const gk = String(r.game_key || '').toLowerCase();
      if (!gk) return;
      if (!byGame[gk]) byGame[gk] = [];
      byGame[gk].push({
        game_key: gk,
        variation_key: String(r.variation_key || 'standard'),
        play_count: Number(r.play_count || 0)
      });
    });
    return byGame;
  }

  function localPopularity(gameKey) {
    const filterKey = gameKey ? String(gameKey).trim().toLowerCase() : null;
    const events = readLocal(LS_PLAYS, []);
    const counts = new Map();
    events.forEach((ev) => {
      const gk = String(ev.game_key || '').toLowerCase();
      const vk = String(ev.variation_key || 'standard');
      if (!gk || (filterKey && gk !== filterKey)) return;
      const k = gk + '||' + vk;
      counts.set(k, (counts.get(k) || 0) + 1);
    });
    const rows = [...counts.entries()]
      .map(([k, count]) => {
        const [game_key, variation_key] = k.split('||');
        return { game_key, variation_key, play_count: count };
      })
      .sort((a, b) => (b.play_count - a.play_count) || a.game_key.localeCompare(b.game_key) || a.variation_key.localeCompare(b.variation_key));
    return { ok: true, rows, byGame: groupPopularityRows(rows), isFallback: true };
  }

  function buildLocalAdminStats() {
    const events = readLocal(LS_PLAYS, []);
    const requests = readLocal(LS_REQUESTS, []);
    const now = Date.now();
    const d7 = now - 7 * 86400000;
    const d30 = now - 30 * 86400000;

    let plays7d = 0;
    let plays30d = 0;
    const gameMap = new Map();
    const varMap = new Map();
    const dayCounts = new Map();

    events.forEach((ev) => {
      const ts = Date.parse(ev.created_at || '') || now;
      const in7 = ts >= d7;
      const in30 = ts >= d30;
      if (in7) plays7d++;
      if (in30) plays30d++;

      const gk = String(ev.game_key || 'other').toLowerCase();
      const vk = String(ev.variation_key || 'standard');
      const pc = Number(ev.player_count || 2);

      const gm = gameMap.get(gk) || { game_key: gk, play_count: 0, plays_7d: 0, plays_30d: 0, _players: 0 };
      gm.play_count++;
      if (in7) gm.plays_7d++;
      if (in30) gm.plays_30d++;
      gm._players += pc;
      gameMap.set(gk, gm);

      const vKey = gk + '||' + vk;
      const vm = varMap.get(vKey) || { game_key: gk, variation_key: vk, play_count: 0, plays_7d: 0, plays_30d: 0 };
      vm.play_count++;
      if (in7) vm.plays_7d++;
      if (in30) vm.plays_30d++;
      varMap.set(vKey, vm);

      const dayStr = new Date(ts).toISOString().slice(0, 10);
      dayCounts.set(dayStr, (dayCounts.get(dayStr) || 0) + 1);
    });

    const daily_plays_30d = [];
    for (let i = 29; i >= 0; i--) {
      const dayStr = new Date(now - i * 86400000).toISOString().slice(0, 10);
      daily_plays_30d.push({ date: dayStr, play_count: dayCounts.get(dayStr) || 0 });
    }

    const by_game = [...gameMap.values()]
      .map((g) => ({
        game_key: g.game_key,
        play_count: g.play_count,
        plays_7d: g.plays_7d,
        plays_30d: g.plays_30d,
        avg_players: g.play_count ? Math.round((g._players / g.play_count) * 10) / 10 : 0
      }))
      .sort((a, b) => b.play_count - a.play_count);

    const by_variation = [...varMap.values()].sort((a, b) => b.play_count - a.play_count);

    return {
      generated_at: new Date().toISOString(),
      totals: {
        total_plays: events.length,
        plays_7d: plays7d,
        plays_30d: plays30d,
        shared_games_total: 0,
        shared_games_7d: 0,
        shared_games_30d: 0,
        users_total: 1,
        users_7d: 0,
        users_30d: 0,
        friendships_accepted: 0,
        friendships_pending: 0,
        groups_total: 0,
        game_requests_total: requests.length,
        game_requests_new: requests.filter((r) => r.status === 'new').length
      },
      by_game,
      by_variation,
      daily_plays_30d,
      recent_game_requests: requests.slice(0, 50)
    };
  }

  // ---------------------------------------------------------------------------
  // 1. Request a Game (auth + anon guests)
  // ---------------------------------------------------------------------------
  async function submitGameRequest(gameName, websiteUrl) {
    const name = String(gameName || '').trim();
    if (name.length < 2) {
      return { ok: false, error: 'Please enter a game name (at least 2 characters).' };
    }
    const clippedName = name.slice(0, 120);
    const urlCheck = normalizeWebsiteUrl(websiteUrl);
    if (!urlCheck.ok) {
      return { ok: false, error: urlCheck.error };
    }

    const saveLocalFallback = async (reason) => {
      const user = await getAuthUser();
      const req = {
        id: 'local-req-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        game_name: clippedName,
        website_url: urlCheck.url,
        requester_id: user ? user.id : null,
        requester_email: user && user.email ? String(user.email).toLowerCase() : null,
        status: 'new',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      const list = readLocal(LS_REQUESTS, []);
      list.unshift(req);
      writeLocal(LS_REQUESTS, list.slice(0, 100));
      return { ok: true, request: req, isFallback: true, warning: reason || null };
    };

    const client = getClient();
    if (shouldSkipSupabase(client)) {
      return saveLocalFallback('offline_or_unmigrated');
    }

    try {
      const { data, error } = await client.rpc('submit_game_request', {
        p_game_name: clippedName,
        p_website_url: urlCheck.url
      });
      if (error) {
        if (isMissingMigrationError(error)) {
          markMigrationMissing();
          return saveLocalFallback(error.message);
        }
        return { ok: false, error: error.message || 'Could not submit game request.' };
      }
      migrationReady = true;
      if (data && data.ok === false) {
        return { ok: false, error: data.error || 'Could not submit game request.' };
      }
      return {
        ok: true,
        request: (data && data.request) || data || null,
        isFallback: false
      };
    } catch (err) {
      return saveLocalFallback(err && err.message);
    }
  }

  // ---------------------------------------------------------------------------
  // 2. Game Variation Popularity (auth + anon guests)
  // ---------------------------------------------------------------------------
  async function recordGamePlay(gameKey, variationKey, playerCount) {
    const gk = String(gameKey || '').trim().toLowerCase().slice(0, 80);
    if (!gk) return { ok: false, error: 'Missing game_key.' };
    const vk = String(variationKey || 'standard').trim().slice(0, 120) || 'standard';
    const pc = Math.max(1, Math.min(50, Number.isFinite(Number(playerCount)) ? Math.round(Number(playerCount)) : 2));

    // Always append to local cache so local fallback / immediate tally stays warm
    const localEv = {
      id: 'local-play-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      game_key: gk,
      variation_key: vk,
      player_count: pc,
      created_at: new Date().toISOString()
    };
    const localList = readLocal(LS_PLAYS, []);
    localList.unshift(localEv);
    writeLocal(LS_PLAYS, localList.slice(0, 500));

    // Invalidate cached popularity for this game + all
    popularityCache.delete('__all__');
    popularityCache.delete(gk);

    const client = getClient();
    if (shouldSkipSupabase(client)) {
      return { ok: true, event: localEv, isFallback: true };
    }

    try {
      const { data, error } = await client.rpc('record_game_play', {
        p_game_key: gk,
        p_variation_key: vk,
        p_player_count: pc
      });
      if (error) {
        if (isMissingMigrationError(error)) markMigrationMissing();
        return { ok: true, event: localEv, isFallback: true, warning: error.message };
      }
      migrationReady = true;
      if (data && data.ok === false) {
        return { ok: false, error: data.error || 'Could not record play.' };
      }
      return {
        ok: true,
        event: (data && data.event) || localEv,
        isFallback: false
      };
    } catch (err) {
      return { ok: true, event: localEv, isFallback: true, warning: err && err.message };
    }
  }

  async function getVariationPopularity(gameKey, options) {
    const opts = options || {};
    const gk = gameKey ? String(gameKey).trim().toLowerCase() : null;
    const cacheKey = gk || '__all__';

    if (!opts.force) {
      const cached = popularityCache.get(cacheKey);
      if (cached && Date.now() - cached.fetchedAt < POPULARITY_TTL_MS) {
        return { ok: true, rows: cached.rows, byGame: cached.byGame, isFallback: cached.isFallback, fromCache: true };
      }
    }

    const client = getClient();
    if (shouldSkipSupabase(client)) {
      return localPopularity(gk);
    }

    try {
      const { data, error } = await client.rpc('get_variation_popularity', {
        p_game_key: gk
      });
      if (error) {
        if (isMissingMigrationError(error)) markMigrationMissing();
        return { ...localPopularity(gk), warning: error.message };
      }
      migrationReady = true;
      const rows = (Array.isArray(data) ? data : []).map((r) => ({
        game_key: String(r.game_key || '').toLowerCase(),
        variation_key: String(r.variation_key || 'standard'),
        play_count: Number(r.play_count || 0)
      }));
      const byGame = groupPopularityRows(rows);
      popularityCache.set(cacheKey, { rows, byGame, isFallback: false, fetchedAt: Date.now() });
      return { ok: true, rows, byGame, isFallback: false };
    } catch (err) {
      return { ...localPopularity(gk), warning: err && err.message };
    }
  }

  // ---------------------------------------------------------------------------
  // 3. Private Admin Stats & Request Triage (randw50@gmail.com only)
  // ---------------------------------------------------------------------------
  function isLikelyAdminSync() {
    try {
      const prof = global.SocialAPI && typeof global.SocialAPI.getCachedProfile === 'function'
        ? global.SocialAPI.getCachedProfile()
        : null;
      if (prof && prof.email && String(prof.email).toLowerCase() === ADMIN_EMAIL) return true;
      if (adminCache.value && Date.now() - adminCache.checkedAt < 5 * 60 * 1000) return true;
    } catch (_) {}
    return false;
  }

  async function isAdmin(options) {
    const opts = options || {};
    const user = await getAuthUser();
    if (!user || !user.id) {
      adminCache = { userId: null, value: false, checkedAt: Date.now() };
      return false;
    }

    const emailMatches = String(user.email || '').trim().toLowerCase() === ADMIN_EMAIL;
    if (!emailMatches) {
      adminCache = { userId: user.id, value: false, checkedAt: Date.now() };
      return false;
    }

    if (!opts.force && adminCache.userId === user.id && Date.now() - adminCache.checkedAt < 60 * 1000) {
      return adminCache.value;
    }

    const client = getClient();
    if (shouldSkipSupabase(client)) {
      adminCache = { userId: user.id, value: emailMatches, checkedAt: Date.now() };
      return emailMatches;
    }

    try {
      const { data, error } = await client.rpc('is_admin');
      if (error) {
        if (isMissingMigrationError(error)) markMigrationMissing();
        adminCache = { userId: user.id, value: emailMatches, checkedAt: Date.now() };
        return emailMatches;
      }
      migrationReady = true;
      const val = Boolean(data);
      adminCache = { userId: user.id, value: val, checkedAt: Date.now() };
      return val;
    } catch (_) {
      adminCache = { userId: user.id, value: emailMatches, checkedAt: Date.now() };
      return emailMatches;
    }
  }

  async function getAdminStats() {
    const user = await getAuthUser();
    if (!user || String(user.email || '').trim().toLowerCase() !== ADMIN_EMAIL) {
      return { ok: false, forbidden: true, error: 'forbidden', stats: null };
    }

    const client = getClient();
    if (shouldSkipSupabase(client)) {
      return { ok: true, stats: buildLocalAdminStats(), isFallback: true };
    }

    try {
      const { data, error } = await client.rpc('get_admin_stats');
      if (error) {
        if (isForbiddenError(error)) {
          return { ok: false, forbidden: true, error: 'forbidden', stats: null };
        }
        if (isMissingMigrationError(error)) {
          markMigrationMissing();
          return { ok: true, stats: buildLocalAdminStats(), isFallback: true, warning: error.message };
        }
        return { ok: false, error: error.message || 'Could not load admin stats.', stats: null };
      }
      migrationReady = true;
      return { ok: true, stats: data || buildLocalAdminStats(), isFallback: false };
    } catch (err) {
      return { ok: true, stats: buildLocalAdminStats(), isFallback: true, warning: err && err.message };
    }
  }

  async function updateGameRequestStatus(id, status) {
    const reqId = String(id || '').trim();
    const nextStatus = String(status || '').trim().toLowerCase();
    if (!reqId) return { ok: false, error: 'Missing request id.' };
    if (!REQUEST_STATUSES.includes(nextStatus)) {
      return { ok: false, error: 'Invalid status. Use: ' + REQUEST_STATUSES.join(', ') + '.' };
    }

    const user = await getAuthUser();
    if (!user || String(user.email || '').trim().toLowerCase() !== ADMIN_EMAIL) {
      return { ok: false, forbidden: true, error: 'forbidden' };
    }

    const updateLocalReq = () => {
      const list = readLocal(LS_REQUESTS, []);
      let updated = null;
      const next = list.map((r) => {
        if (r.id === reqId) {
          updated = { ...r, status: nextStatus, updated_at: new Date().toISOString() };
          return updated;
        }
        return r;
      });
      if (!updated) return { ok: false, isFallback: true, error: 'Game request not found.' };
      writeLocal(LS_REQUESTS, next);
      return { ok: true, request: updated, isFallback: true };
    };

    const client = getClient();
    if (shouldSkipSupabase(client) || reqId.startsWith('local-req-')) {
      return updateLocalReq();
    }

    try {
      const { data, error } = await client.rpc('update_game_request_status', {
        p_id: reqId,
        p_status: nextStatus
      });
      if (error) {
        if (isForbiddenError(error)) return { ok: false, forbidden: true, error: 'forbidden' };
        if (isMissingMigrationError(error)) {
          markMigrationMissing();
          return updateLocalReq();
        }
        return { ok: false, error: error.message || 'Could not update request status.' };
      }
      migrationReady = true;
      if (data && data.ok === false) {
        return { ok: false, error: data.error || 'Could not update request status.' };
      }
      return { ok: true, request: (data && data.request) || data || null, isFallback: false };
    } catch (err) {
      return { ok: false, error: (err && err.message) || 'Could not update request status.' };
    }
  }

  function clearCache() {
    popularityCache.clear();
    adminCache = { userId: null, value: false, checkedAt: 0 };
    migrationReady = null;
    migrationCheckedAt = 0;
  }

  global.TallyItBackend = {
    ADMIN_EMAIL,
    REQUEST_STATUSES,
    submitGameRequest,
    recordGamePlay,
    getVariationPopularity,
    isAdmin,
    isLikelyAdminSync,
    getAdminStats,
    updateGameRequestStatus,
    clearCache,
    isMigrationReady: () => migrationReady
  };
})(window);
