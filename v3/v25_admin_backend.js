/**
 * TallyIt — v25 Admin Drill-down Backend (window.TallyItV25Admin)
 * Drop-in module. Uses window.sb (Supabase v2 client). Requires supabase_v25_admin_drilldown.sql.
 * NEVER throws. Every call resolves to one of:
 *   { ok:true, rows:[...], total, limit, offset, has_more, box? }
 *   { ok:false, forbidden:true, error:'forbidden' }              (caller is not the admin, SQLSTATE 42501)
 *   { ok:false, unavailable:true, error }                        (v25 migration not applied yet; re-probed every 30s)
 *   { ok:false, code, error }                                    (anything else, incl. not_signed_in / network)
 *
 * List helpers (all take opts { search, limit (1..200, default 50), offset, sort, dir:'asc'|'desc' } plus box filters):
 *   listUsers({signup, active})            signup/active: 'all'|'7d'|'30d'
 *   listPlays({window, gameKey, variationKey, date})   window 'all'|'7d'|'30d'; date 'YYYY-MM-DD' (UTC day)
 *   listGameRequests({status})             all|new|reviewing|planned|built|declined (aliases added, dismissed)
 *   listFriendships({status})              accepted (default)|pending|declined|all
 *   listGroups()
 *   listGameBreakdown()                    Most Played Games
 *   listVariationBreakdown({gameKey})      Most Popular Variations
 *   listDailyPlays({days})                 Daily Plays chart, 1..365 (default 30)
 *   listSharedGames({window, gameType}) / getSharedGame(gameId)
 *   listCommunityVariations({visibility})  all|visible|hidden
 * Generic:
 *   drilldown(boxKey, opts)   resolves BOX[boxKey] (method + default filters) and runs it; opts.filters override defaults
 *   dispatch(boxKey, opts)    same via the server-side admin_drilldown() dispatcher
 *   BOX / listBoxes() / getBox(key) / boxForKpi(elementId) / expectedTotal(boxKey, stats)
 */
(function (global) {
  'use strict';

  const MIGRATION_RETRY_MS = 30 * 1000;
  const DEFAULT_LIMIT = 50, MAX_LIMIT = 200;

  let migrationReady = null;
  let migrationCheckedAt = 0;

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

  function isForbiddenError(err) {
    if (!err) return false;
    const code = String(err.code || '');
    const msg = String(err.message || '').toLowerCase();
    return code === '42501' || msg === 'forbidden' || msg.includes('permission denied');
  }

  function markMigrationMissing() { migrationReady = false; migrationCheckedAt = Date.now(); }

  function shouldSkipSupabase(client) {
    if (!client) return true;
    if (migrationReady !== false) return false;
    if (Date.now() - migrationCheckedAt > MIGRATION_RETRY_MS) { migrationReady = null; return false; }
    return true;
  }

  const UNAVAILABLE = 'Admin drill-down is not available yet (v25 migration pending). Try again in a bit.';
  function unavailable() { return { ok: false, unavailable: true, error: UNAVAILABLE }; }
  function forbidden() { return { ok: false, forbidden: true, error: 'forbidden' }; }

  // ---------------------------------------------------------------- arg cleaning (server clamps too)
  function cleanInt(v, lo, hi, dflt) {
    const n = Math.floor(Number(v));
    if (!isFinite(n)) return dflt;
    return Math.min(Math.max(n, lo), hi);
  }
  function cleanSearch(v) {
    const s = String(v == null ? '' : v).trim().slice(0, 100);
    return s || null;
  }
  function cleanSort(v) { const s = String(v == null ? '' : v).trim().toLowerCase(); return /^[a-z0-9_]{1,40}$/.test(s) ? s : null; }
  function cleanDir(v) { const s = String(v == null ? '' : v).trim().toLowerCase(); return s === 'asc' || s === 'desc' ? s : null; }
  function cleanToken(v, dflt) { const s = String(v == null ? '' : v).trim().toLowerCase().slice(0, 24); return /^[a-z0-9_-]+$/.test(s) ? s : (dflt === undefined ? null : dflt); }
  function cleanKey(v) { const s = String(v == null ? '' : v).trim().slice(0, 120); return s || null; }
  function cleanDate(v) {
    if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
    const s = String(v == null ? '' : v).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  }
  function cleanUuid(v) {
    const s = String(v == null ? '' : v).trim();
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ? s : null;
  }
  function put(args, key, val) { if (val !== null && val !== undefined) args[key] = val; }

  function pageArgs(opts) {
    const o = opts || {};
    const a = {};
    put(a, 'p_search', cleanSearch(o.search));
    a.p_limit = cleanInt(o.limit, 1, MAX_LIMIT, DEFAULT_LIMIT);
    a.p_offset = cleanInt(o.offset, 0, 1e9, 0);
    put(a, 'p_sort', cleanSort(o.sort));
    put(a, 'p_dir', cleanDir(o.dir));
    return a;
  }

  // ---------------------------------------------------------------- RPC core
  async function callRpc(name, args) {
    try {
      const client = getClient();
      if (shouldSkipSupabase(client)) return unavailable();
      const user = await getAuthUser();
      if (!user) return { ok: false, code: 'not_signed_in', error: 'Sign in first.' };
      let res;
      try { res = await client.rpc(name, args || {}); }
      catch (e) {
        if (isForbiddenError(e)) return forbidden();
        return { ok: false, error: (e && e.message) || 'Network error. Try again.' };
      }
      const { data, error } = res || {};
      if (error) {
        if (isForbiddenError(error)) return forbidden();
        if (isMissingMigrationError(error)) { markMigrationMissing(); return unavailable(); }
        return { ok: false, code: error.code || null, error: error.message || 'Something went wrong.' };
      }
      migrationReady = true;
      if (!data || typeof data !== 'object') return { ok: false, error: 'Unexpected reply.' };
      return data;
    } catch (e) {
      return { ok: false, error: (e && e.message) || 'Something went wrong.' };
    }
  }

  async function callList(name, args) {
    const r = await callRpc(name, args);
    if (!r || r.ok !== true) return r && r.ok === false ? r : { ok: false, error: 'Unexpected reply.' };
    return {
      ok: true,
      rows: Array.isArray(r.rows) ? r.rows : [],
      total: Number(r.total) || 0,
      limit: Number(r.limit) || (args && args.p_limit) || DEFAULT_LIMIT,
      offset: Number(r.offset) || 0,
      has_more: r.has_more === true
    };
  }

  // ---------------------------------------------------------------- list helpers
  const WINDOWS = ['all', '7d', '30d'];
  function cleanWindow(v, dflt) { const t = cleanToken(v, dflt); return WINDOWS.includes(t) ? t : dflt; }

  function listUsers(o) {
    o = o || {}; const a = pageArgs(o);
    put(a, 'p_signup', o.signup == null ? null : cleanWindow(o.signup, 'all'));
    put(a, 'p_active', o.active == null ? null : cleanWindow(o.active, 'all'));
    return callList('admin_list_users', a);
  }
  function listPlays(o) {
    o = o || {}; const a = pageArgs(o);
    put(a, 'p_window', o.window == null ? null : cleanWindow(o.window, 'all'));
    put(a, 'p_game_key', cleanKey(o.gameKey));
    put(a, 'p_variation_key', cleanKey(o.variationKey));
    put(a, 'p_date', cleanDate(o.date));
    return callList('admin_list_plays', a);
  }
  function listGameRequests(o) {
    o = o || {}; const a = pageArgs(o);
    put(a, 'p_status', o.status == null ? null : cleanToken(o.status, 'all'));
    return callList('admin_list_game_requests', a);
  }
  function listFriendships(o) {
    o = o || {}; const a = pageArgs(o);
    put(a, 'p_status', o.status == null ? null : cleanToken(o.status, 'accepted'));
    return callList('admin_list_friendships', a);
  }
  function listGroups(o) { return callList('admin_list_groups', pageArgs(o)); }
  function listGameBreakdown(o) { return callList('admin_list_game_breakdown', pageArgs(o)); }
  function listVariationBreakdown(o) {
    o = o || {}; const a = pageArgs(o);
    put(a, 'p_game_key', cleanKey(o.gameKey));
    return callList('admin_list_variation_breakdown', a);
  }
  function listDailyPlays(o) {
    o = o || {}; const a = pageArgs(o);
    if (o.days != null) a.p_days = cleanInt(o.days, 1, 365, 30);
    return callList('admin_list_daily_plays', a);
  }
  function listSharedGames(o) {
    o = o || {}; const a = pageArgs(o);
    put(a, 'p_window', o.window == null ? null : cleanWindow(o.window, 'all'));
    put(a, 'p_game_type', cleanKey(o.gameType));
    return callList('admin_list_shared_games', a);
  }
  function listCommunityVariations(o) {
    o = o || {}; const a = pageArgs(o);
    put(a, 'p_visibility', o.visibility == null ? null : cleanToken(o.visibility, 'all'));
    return callList('admin_list_community_variations', a);
  }
  async function getSharedGame(gameId) {
    const id = cleanUuid(gameId);
    if (!id) return { ok: false, code: 'bad_request', error: 'Invalid game id.' };
    const r = await callRpc('admin_get_shared_game', { p_game_id: id });
    if (r && r.ok === true) return { ok: true, game: r.game || null, participants: Array.isArray(r.participants) ? r.participants : [] };
    return r && r.ok === false ? r : { ok: false, error: 'Unexpected reply.' };
  }

  // ---------------------------------------------------------------- BOX registry (UI contract)
  const col = (key, label, type, extra) => Object.assign({ key, label, type: type || 'text' }, extra || {});
  const C = {
    users: [col('display_name', 'Name', 'text', { sortable: true }), col('email', 'Email', 'text', { sortable: true }), col('signed_up_at', 'Signed up', 'datetime', { sortable: true }),
      col('last_active_at', 'Last active', 'datetime', { sortable: true }), col('games_played', 'Games played', 'number', { sortable: true }), col('friend_count', 'Friends', 'number', { sortable: true }),
      col('plays', 'Plays logged', 'number', { sortable: true, hidden: true }), col('shared_games', 'Shared games', 'number', { sortable: true, hidden: true }),
      col('last_sign_in_at', 'Last sign-in', 'datetime', { sortable: true, hidden: true }), col('friend_code', 'Friend code', 'text', { hidden: true }), col('id', 'User id', 'uuid', { hidden: true })],
    plays: [col('created_at', 'When', 'datetime', { sortable: true }), col('game_key', 'Game', 'text', { sortable: true }), col('variation_key', 'Variation', 'text', { sortable: true }),
      col('player_count', 'Players', 'number', { sortable: true }), col('user_name', 'Player', 'text', { sortable: true }), col('user_email', 'Email', 'text', { hidden: true }), col('id', 'Id', 'uuid', { hidden: true })],
    requests: [col('created_at', 'Requested', 'datetime', { sortable: true }), col('game_name', 'Game', 'text', { sortable: true }), col('status', 'Status', 'text', { sortable: true }),
      col('requester_name', 'Name', 'text', { sortable: true }), col('requester_email', 'Email', 'text', { sortable: true }), col('website_url', 'Link', 'url'), col('updated_at', 'Updated', 'datetime', { sortable: true, hidden: true }),
      col('dismissed_at', 'Dismissed', 'datetime', { hidden: true }), col('id', 'Id', 'uuid', { hidden: true })],
    friendships: [col('requester_name', 'From', 'text', { sortable: true }), col('requester_email', 'From email', 'text'), col('addressee_name', 'To', 'text', { sortable: true }), col('addressee_email', 'To email', 'text'),
      col('status', 'Status', 'text', { sortable: true }), col('created_at', 'Since', 'datetime', { sortable: true }), col('updated_at', 'Updated', 'datetime', { sortable: true, hidden: true }), col('id', 'Id', 'uuid', { hidden: true })],
    groups: [col('name', 'Group', 'text', { sortable: true }), col('owner_name', 'Owner', 'text', { sortable: true }), col('owner_email', 'Owner email', 'text', { hidden: true }), col('member_count', 'Members', 'number', { sortable: true }),
      col('games_count', 'Games', 'number', { sortable: true }), col('guest_names', 'Guests', 'json'), col('created_at', 'Created', 'datetime', { sortable: true }), col('id', 'Id', 'uuid', { hidden: true })],
    gameBreakdown: [col('game_key', 'Game', 'text', { sortable: true }), col('play_count', 'Plays', 'number', { sortable: true }), col('plays_7d', '7d', 'number', { sortable: true }), col('plays_30d', '30d', 'number', { sortable: true }),
      col('avg_players', 'Avg players', 'number', { sortable: true }), col('unique_players', 'Signed-in players', 'number', { sortable: true, hidden: true }), col('last_played_at', 'Last played', 'datetime', { sortable: true }), col('first_played_at', 'First played', 'datetime', { sortable: true, hidden: true })],
    variationBreakdown: [col('game_key', 'Game', 'text', { sortable: true }), col('variation_key', 'Variation', 'text', { sortable: true }), col('play_count', 'Plays', 'number', { sortable: true }), col('plays_7d', '7d', 'number', { sortable: true }),
      col('plays_30d', '30d', 'number', { sortable: true }), col('avg_players', 'Avg players', 'number', { sortable: true, hidden: true }), col('last_played_at', 'Last played', 'datetime', { sortable: true })],
    daily: [col('date', 'Day (UTC)', 'date', { sortable: true }), col('play_count', 'Plays', 'number', { sortable: true }), col('unique_players', 'Signed-in players', 'number', { sortable: true })],
    shared: [col('created_at', 'Saved', 'datetime', { sortable: true }), col('game_type', 'Game', 'text', { sortable: true }), col('creator_name', 'Created by', 'text', { sortable: true }), col('winner', 'Winner', 'text', { sortable: true }),
      col('participant_count', 'Players', 'number', { sortable: true }), col('linked_count', 'Linked', 'number', { sortable: true }), col('group_name', 'Group', 'text'), col('creator_email', 'Creator email', 'text', { hidden: true }),
      col('ended_at', 'Ended', 'datetime', { sortable: true, hidden: true }), col('id', 'Game id', 'uuid', { hidden: true })],
    community: [col('created_at', 'Published', 'datetime', { sortable: true }), col('name', 'Variation', 'text', { sortable: true }), col('game_key', 'Game', 'text', { sortable: true }), col('author_name', 'Author', 'text', { sortable: true }),
      col('differences_count', 'Rules', 'number', { sortable: true }), col('is_hidden', 'Hidden', 'bool', { sortable: true }), col('tagline', 'Tagline', 'text', { hidden: true }), col('author_email', 'Author email', 'text', { hidden: true }),
      col('differences', 'Differences', 'json', { hidden: true }), col('id', 'Id', 'uuid', { hidden: true })]
  };

  // statKey = get_admin_stats().totals field the list total reconciles with (null = no existing counter / computed)
  function box(key, label, method, columns, extra) {
    return Object.freeze(Object.assign({ key, label, method, columns, filters: {}, statKey: null, kpiId: null, rpc: null, detail: null, tabs: null, shown: true }, extra || {}));
  }
  const BOX = Object.freeze({
    games_total: box('games_total', 'All-Time Games', 'listPlays', C.plays, { rpc: 'admin_list_plays', kpiId: 'kpi-games-total', statKey: 'total_plays', filters: { window: 'all' }, defaultSort: 'created_at', defaultDir: 'desc' }),
    games_7d: box('games_7d', 'Last 7 Days', 'listPlays', C.plays, { rpc: 'admin_list_plays', kpiId: 'kpi-games-7d', statKey: 'plays_7d', filters: { window: '7d' }, defaultSort: 'created_at', defaultDir: 'desc' }),
    games_30d: box('games_30d', 'Last 30 Days', 'listPlays', C.plays, { rpc: 'admin_list_plays', kpiId: 'kpi-games-30d', statKey: 'plays_30d', filters: { window: '30d' }, defaultSort: 'created_at', defaultDir: 'desc' }),
    users_total: box('users_total', 'Registered Users', 'listUsers', C.users, { rpc: 'admin_list_users', kpiId: 'kpi-users-total', statKey: 'users_total', filters: {}, defaultSort: 'signed_up_at', defaultDir: 'desc' }),
    users_7d: box('users_7d', 'New Users (7d)', 'listUsers', C.users, { rpc: 'admin_list_users', statKey: 'users_7d', filters: { signup: '7d' }, shown: false, defaultSort: 'signed_up_at', defaultDir: 'desc' }),
    users_30d: box('users_30d', 'New Users (30d)', 'listUsers', C.users, { rpc: 'admin_list_users', statKey: 'users_30d', filters: { signup: '30d' }, shown: false, defaultSort: 'signed_up_at', defaultDir: 'desc' }),
    active_users_7d: box('active_users_7d', 'Active Users (7d)', 'listUsers', C.users, { rpc: 'admin_list_users', filters: { active: '7d' }, shown: false, defaultSort: 'last_active_at', defaultDir: 'desc' }),
    active_users_30d: box('active_users_30d', 'Active Users (30d)', 'listUsers', C.users, { rpc: 'admin_list_users', filters: { active: '30d' }, shown: false, defaultSort: 'last_active_at', defaultDir: 'desc' }),
    requests_total: box('requests_total', 'Game Requests', 'listGameRequests', C.requests, { rpc: 'admin_list_game_requests', kpiId: 'kpi-requests-total', statKey: 'game_requests_total', filters: { status: 'all' }, defaultSort: 'created_at', defaultDir: 'desc' }),
    requests_new: box('requests_new', 'New Game Requests', 'listGameRequests', C.requests, { rpc: 'admin_list_game_requests', kpiId: 'kpi-requests-new', statKey: 'game_requests_new', filters: { status: 'new' }, defaultSort: 'created_at', defaultDir: 'desc' }),
    social_total: box('social_total', 'Friends & Groups', 'listFriendships', C.friendships, { rpc: 'admin_list_friendships', kpiId: 'kpi-social-total', statKey: null, statKeys: ['friendships_accepted', 'groups_total'], filters: { status: 'accepted' }, tabs: ['friendships', 'groups'], defaultSort: 'created_at', defaultDir: 'desc' }),
    friendships: box('friendships', 'Friendships', 'listFriendships', C.friendships, { rpc: 'admin_list_friendships', statKey: 'friendships_accepted', filters: { status: 'accepted' }, defaultSort: 'created_at', defaultDir: 'desc' }),
    friendships_pending: box('friendships_pending', 'Pending Friend Requests', 'listFriendships', C.friendships, { rpc: 'admin_list_friendships', statKey: 'friendships_pending', filters: { status: 'pending' }, shown: false, defaultSort: 'created_at', defaultDir: 'desc' }),
    groups: box('groups', 'Groups', 'listGroups', C.groups, { rpc: 'admin_list_groups', statKey: 'groups_total', defaultSort: 'created_at', defaultDir: 'desc' }),
    top_games: box('top_games', 'Most Played Games', 'listGameBreakdown', C.gameBreakdown, { rpc: 'admin_list_game_breakdown', kpiId: 'admin-top-games', statKey: null, defaultSort: 'play_count', defaultDir: 'desc', detail: { box: 'games_total', filterFrom: { game_key: 'gameKey' } } }),
    top_variations: box('top_variations', 'Most Popular Variations', 'listVariationBreakdown', C.variationBreakdown, { rpc: 'admin_list_variation_breakdown', kpiId: 'admin-top-variations', statKey: null, defaultSort: 'play_count', defaultDir: 'desc', detail: { box: 'games_total', filterFrom: { game_key: 'gameKey', variation_key: 'variationKey' } } }),
    daily_plays: box('daily_plays', 'Daily Plays (30d)', 'listDailyPlays', C.daily, { rpc: 'admin_list_daily_plays', kpiId: 'admin-daily-chart', statKey: null, filters: { days: 30 }, defaultSort: 'date', defaultDir: 'desc', detail: { box: 'games_total', filterFrom: { date: 'date' } } }),
    shared_games_total: box('shared_games_total', 'Shared Games', 'listSharedGames', C.shared, { rpc: 'admin_list_shared_games', statKey: 'shared_games_total', filters: { window: 'all' }, shown: false, defaultSort: 'created_at', defaultDir: 'desc', detail: { method: 'getSharedGame', idField: 'id' } }),
    shared_games_7d: box('shared_games_7d', 'Shared Games (7d)', 'listSharedGames', C.shared, { rpc: 'admin_list_shared_games', statKey: 'shared_games_7d', filters: { window: '7d' }, shown: false, defaultSort: 'created_at', defaultDir: 'desc', detail: { method: 'getSharedGame', idField: 'id' } }),
    shared_games_30d: box('shared_games_30d', 'Shared Games (30d)', 'listSharedGames', C.shared, { rpc: 'admin_list_shared_games', statKey: 'shared_games_30d', filters: { window: '30d' }, shown: false, defaultSort: 'created_at', defaultDir: 'desc', detail: { method: 'getSharedGame', idField: 'id' } }),
    community_total: box('community_total', 'Community Variations', 'listCommunityVariations', C.community, { rpc: 'admin_list_community_variations', kpiId: 'v22-admin-community-card', statKey: 'community_variations_total', filters: { visibility: 'all' }, defaultSort: 'created_at', defaultDir: 'desc' }),
    community_visible: box('community_visible', 'Visible Community Variations', 'listCommunityVariations', C.community, { rpc: 'admin_list_community_variations', statKey: 'community_variations_visible', filters: { visibility: 'visible' }, shown: false, defaultSort: 'created_at', defaultDir: 'desc' }),
    community_hidden: box('community_hidden', 'Hidden Community Variations', 'listCommunityVariations', C.community, { rpc: 'admin_list_community_variations', filters: { visibility: 'hidden' }, shown: false, defaultSort: 'created_at', defaultDir: 'desc' })
  });

  const METHODS = { listUsers, listPlays, listGameRequests, listFriendships, listGroups, listGameBreakdown, listVariationBreakdown, listDailyPlays, listSharedGames, listCommunityVariations, getSharedGame };

  function listBoxes(opts) { const all = Object.keys(BOX).map((k) => BOX[k]); return opts && opts.shownOnly ? all.filter((b) => b.shown) : all; }
  function getBox(key) { return BOX[String(key || '').toLowerCase()] || null; }
  function boxForKpi(elementId) { const id = String(elementId || ''); return listBoxes().find((b) => b.kpiId === id) || null; }

  // Expected total from a get_admin_stats() payload (for "N records" labels / reconciliation); null if unknown
  function expectedTotal(boxKey, stats) {
    const b = getBox(boxKey); if (!b || !stats) return null;
    const t = stats.totals || {};
    if (b.statKey && t[b.statKey] != null) return Number(t[b.statKey]);
    if (b.statKeys) { let n = 0; for (const k of b.statKeys) { if (t[k] == null) return null; n += Number(t[k]); } return n; }
    if (b.key === 'top_games' && Array.isArray(stats.by_game)) return stats.by_game.length;
    if (b.key === 'top_variations' && Array.isArray(stats.by_variation)) return stats.by_variation.length;
    if (b.key === 'daily_plays' && Array.isArray(stats.daily_plays_30d)) return stats.daily_plays_30d.length;
    if (b.key === 'community_hidden' && t.community_variations_total != null && t.community_variations_visible != null) return Number(t.community_variations_total) - Number(t.community_variations_visible);
    return null;
  }

  async function drilldown(boxKey, opts) {
    try {
      const b = getBox(boxKey);
      if (!b) return { ok: false, code: 'unknown_box', error: 'Unknown admin box.' };
      const o = Object.assign({}, b.filters, opts || {}, (opts && opts.filters) || {});
      if (o.sort == null && b.defaultSort) o.sort = b.defaultSort;
      if (o.dir == null && b.defaultDir) o.dir = b.defaultDir;
      const r = await METHODS[b.method](o);
      return r && r.ok ? Object.assign({ box: b.key }, r) : r;
    } catch (e) { return { ok: false, error: (e && e.message) || 'Something went wrong.' }; }
  }

  // Same thing through the server dispatcher admin_drilldown(p_box, ...)
  async function dispatch(boxKey, opts) {
    try {
      const o = opts || {};
      const key = String(boxKey || '').trim().toLowerCase();
      if (!/^[a-z0-9_]{1,40}$/.test(key)) return { ok: false, code: 'unknown_box', error: 'Unknown admin box.' };
      const a = pageArgs(o); a.p_box = key;
      const f = {};
      const src = Object.assign({}, o.filters || {});
      ['window', 'signup', 'active', 'status', 'visibility', 'game_key', 'variation_key', 'game_type', 'date', 'days'].forEach((k) => { if (src[k] != null && src[k] !== '') f[k] = String(src[k]).slice(0, 120); });
      if (Object.keys(f).length) a.p_filters = f;
      const r = await callList('admin_drilldown', a);
      return r && r.ok ? Object.assign({ box: key }, r) : r;
    } catch (e) { return { ok: false, error: (e && e.message) || 'Something went wrong.' }; }
  }

  // Row -> filters for the next drill level (e.g. a Most Played Games row -> that game's plays)
  function detailFor(boxKey, row) {
    const b = getBox(boxKey); if (!b || !b.detail || !row) return null;
    if (b.detail.method === 'getSharedGame') return { method: 'getSharedGame', id: row[b.detail.idField] || null };
    const filters = {};
    Object.keys(b.detail.filterFrom || {}).forEach((src) => { if (row[src] != null) filters[b.detail.filterFrom[src]] = row[src]; });
    return { method: 'drilldown', box: b.detail.box, opts: { filters } };
  }

  function clearCache() {}
  function isMigrationReady() { return migrationReady; }

  global.TallyItV25Admin = Object.assign({
    BOX, listBoxes, getBox, boxForKpi, expectedTotal, detailFor,
    drilldown, dispatch, clearCache, isMigrationReady,
    _isMissingMigrationError: isMissingMigrationError, _isForbiddenError: isForbiddenError
  }, METHODS);
})(typeof window !== 'undefined' ? window : globalThis);
