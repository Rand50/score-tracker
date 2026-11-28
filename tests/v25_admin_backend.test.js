const fs = require('fs'); const vm = require('vm'); const assert = require('assert');
const src = fs.readFileSync(__dirname + '/../v3/v25_admin_backend.js', 'utf8');
const sql = fs.readFileSync(__dirname + '/../supabase_v25_admin_drilldown.sql', 'utf8');
const markup = fs.readFileSync(__dirname + '/../v3/v20_features_markup.html', 'utf8') + fs.readFileSync(__dirname + '/../v3/v22_features_markup.html', 'utf8');
const J = (x) => JSON.parse(JSON.stringify(x)); // cross-realm safe
function make({ user = { id: 'admin' }, rpc, noClient = false, session = null } = {}) {
  const calls = [];
  const ctx = {
    ScoreAuth: user === 'none' ? undefined : { getUser: async () => user },
    sb: noClient ? undefined : { rpc: async (name, args) => { calls.push({ name, args: J(args) }); return rpc(name, args, calls.length); }, auth: { getSession: async () => ({ data: { session } }) } }
  };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(src, ctx);
  return { api: ctx.TallyItV25Admin, ctx, calls };
}
const OK = (rows, total) => ({ data: { ok: true, rows, total: total == null ? rows.length : total, limit: 50, offset: 0, has_more: false } });
const tests = []; const t = (n, f) => tests.push([n, f]);

t('success: listUsers maps rows/total/paging and sends clamped args', async () => {
  const h = make({ rpc: () => OK([{ id: 'u1', display_name: 'A' }], 7) });
  const r = await h.api.listUsers({ search: '  aud ', limit: 20, offset: 40, sort: 'friend_count', dir: 'ASC', signup: '7d' });
  assert.strictEqual(r.ok, true); assert.strictEqual(r.total, 7); assert.strictEqual(r.rows.length, 1); assert.strictEqual(r.has_more, false);
  assert.deepStrictEqual(h.calls[0], { name: 'admin_list_users', args: { p_search: 'aud', p_limit: 20, p_offset: 40, p_sort: 'friend_count', p_dir: 'asc', p_signup: '7d' } });
});
t('arg clamping: limit 0/-5/9999/NaN, offset negative/NaN, hostile sort/dir/window dropped', async () => {
  const h = make({ rpc: () => OK([]) });
  await h.api.listUsers({ limit: 0 }); await h.api.listUsers({ limit: -5 }); await h.api.listUsers({ limit: 9999 }); await h.api.listUsers({ limit: 'abc', offset: 'zzz' });
  await h.api.listUsers({ offset: -10 }); await h.api.listUsers({ offset: 12.7 });
  await h.api.listUsers({ sort: 'x; drop table profiles', dir: 'sideways', signup: 'forever', search: '   ' });
  const lim = h.calls.map((c) => c.args.p_limit), off = h.calls.map((c) => c.args.p_offset);
  assert.deepStrictEqual(lim, [1, 1, 200, 50, 50, 50, 50]); assert.deepStrictEqual(off, [0, 0, 0, 0, 0, 12, 0]);
  const last = h.calls[6].args; assert.strictEqual(last.p_sort, undefined); assert.strictEqual(last.p_dir, undefined); assert.strictEqual(last.p_search, undefined); assert.strictEqual(last.p_signup, 'all');
  const long = make({ rpc: () => OK([]) }); await long.api.listUsers({ search: 'x'.repeat(500) }); assert.strictEqual(long.calls[0].args.p_search.length, 100);
});
t('no opts at all -> defaults (limit 50, offset 0), never throws', async () => {
  const h = make({ rpc: () => OK([]) });
  const r = await h.api.listGroups(); assert.strictEqual(r.ok, true); assert.deepStrictEqual(h.calls[0].args, { p_limit: 50, p_offset: 0 });
  assert.strictEqual((await h.api.listGameBreakdown(null)).ok, true);
});
t('every list helper hits its RPC with its filter args', async () => {
  const h = make({ rpc: () => OK([]) });
  await h.api.listPlays({ window: '30d', gameKey: 'catan', variationKey: 'standard', date: '2026-11-20' });
  await h.api.listPlays({ date: 'not-a-date', window: 'weird' });
  await h.api.listGameRequests({ status: 'New' }); await h.api.listFriendships({ status: 'pending' }); await h.api.listVariationBreakdown({ gameKey: 'nertz' });
  await h.api.listDailyPlays({ days: 99999 }); await h.api.listDailyPlays({ days: 0 }); await h.api.listSharedGames({ window: '7d', gameType: 'catan' }); await h.api.listCommunityVariations({ visibility: 'hidden' });
  const by = (i) => h.calls[i];
  assert.deepStrictEqual([by(0).name, by(0).args.p_window, by(0).args.p_game_key, by(0).args.p_variation_key, by(0).args.p_date], ['admin_list_plays', '30d', 'catan', 'standard', '2026-11-20']);
  assert.strictEqual(by(1).args.p_date, undefined); assert.strictEqual(by(1).args.p_window, 'all');
  assert.strictEqual(by(2).args.p_status, 'new'); assert.strictEqual(by(3).args.p_status, 'pending'); assert.strictEqual(by(4).args.p_game_key, 'nertz');
  assert.strictEqual(by(5).args.p_days, 365); assert.strictEqual(by(6).args.p_days, 1);
  assert.deepStrictEqual([by(7).name, by(7).args.p_window, by(7).args.p_game_type], ['admin_list_shared_games', '7d', 'catan']); assert.strictEqual(by(8).args.p_visibility, 'hidden');
});
t('getSharedGame: ok, bad id rejected locally, not_found passthrough', async () => {
  const id = '11111111-1111-1111-1111-111111111111';
  const h = make({ rpc: (n, a) => ({ data: a.p_game_id === id ? { ok: true, game: { id }, participants: [{ display_name: 'A' }] } : { ok: false, error: 'not_found' } }) });
  const r = await h.api.getSharedGame(id); assert.strictEqual(r.ok, true); assert.strictEqual(r.participants.length, 1);
  const bad = await h.api.getSharedGame('nope'); assert.strictEqual(bad.ok, false); assert.strictEqual(bad.code, 'bad_request'); assert.strictEqual(h.calls.length, 1);
  const nf = await h.api.getSharedGame('22222222-2222-2222-2222-222222222222'); assert.strictEqual(nf.error, 'not_found');
});
t('forbidden: 42501 -> {ok:false, forbidden:true}, does not latch migration', async () => {
  const h = make({ rpc: () => ({ error: { code: '42501', message: 'forbidden' } }) });
  const r = await h.api.listUsers(); assert.deepStrictEqual(J(r), { ok: false, forbidden: true, error: 'forbidden' });
  assert.notStrictEqual(h.api.isMigrationReady(), false);
  await h.api.listPlays(); assert.strictEqual(h.calls.length, 2);
  const p = make({ rpc: () => ({ error: { code: '42501', message: 'permission denied for function admin_list_users' } }) });
  assert.strictEqual((await p.api.listUsers()).forbidden, true);
  const th = make({ rpc: () => { throw { code: '42501', message: 'forbidden' }; } });
  assert.strictEqual((await th.api.listUsers()).forbidden, true);
});
t('missing migration -> unavailable, latches, skips RPC for 30s, re-probes after', async () => {
  let mode = 'missing';
  const h = make({ rpc: () => mode === 'missing' ? { error: { code: 'PGRST202', message: 'Could not find the function public.admin_list_users' } } : OK([{ id: 1 }]) });
  const r1 = await h.api.listUsers(); assert.strictEqual(r1.ok, false); assert.strictEqual(r1.unavailable, true); assert.ok(r1.error);
  assert.strictEqual(h.api.isMigrationReady(), false);
  const r2 = await h.api.listPlays(); assert.strictEqual(r2.unavailable, true); assert.strictEqual(h.calls.length, 1);
  const r3 = await h.api.drilldown('users_total'); assert.strictEqual(r3.unavailable, true); assert.strictEqual(h.calls.length, 1);
  // 29s later still skipped, 31s later re-probes
  const D = vm.runInContext('Date', h.ctx), realNow = D.now; try {
    const t0 = realNow(); D.now = () => t0 + 29000; await h.api.listUsers(); assert.strictEqual(h.calls.length, 1);
    mode = 'ok'; D.now = () => t0 + 31000; const r4 = await h.api.listUsers(); assert.strictEqual(r4.ok, true); assert.strictEqual(h.calls.length, 2); assert.strictEqual(h.api.isMigrationReady(), true);
  } finally { D.now = realNow; }
});
t('each missing-migration signature latches: 42P01 42883 42703 PGRST205 + messages', async () => {
  const errs = [{ code: '42P01', message: 'x' }, { code: '42883', message: 'x' }, { code: '42703', message: 'x' }, { code: 'PGRST205', message: 'x' },
    { code: 'XX', message: 'relation "public.profiles" does not exist' }, { code: 'XX', message: 'Could not find the table public.x in the schema cache' }, { code: 'XX', message: 'Could not find the function public.y' }];
  for (const e of errs) { const h = make({ rpc: () => ({ error: e }) }); const r = await h.api.listUsers(); assert.strictEqual(r.unavailable, true, JSON.stringify(e)); assert.strictEqual(h.api.isMigrationReady(), false); }
});
t('"schema cache" alone never latches', async () => {
  const h = make({ rpc: () => ({ error: { code: 'PGRST000', message: 'schema cache reload in progress' } }) });
  const r = await h.api.listUsers(); assert.strictEqual(r.unavailable, undefined); assert.strictEqual(r.ok, false); assert.notStrictEqual(h.api.isMigrationReady(), false);
  await h.api.listUsers(); assert.strictEqual(h.calls.length, 2);
});
t('rpc throw / reject -> ok:false with message, no throw', async () => {
  const h = make({ rpc: () => { throw new Error('offline'); } });
  const r = await h.api.listUsers(); assert.strictEqual(r.ok, false); assert.strictEqual(r.error, 'offline');
  const g = await h.api.getSharedGame('11111111-1111-1111-1111-111111111111'); assert.strictEqual(g.ok, false);
  const d = await h.api.drilldown('games_total'); assert.strictEqual(d.ok, false);
  const x = await h.api.dispatch('games_total'); assert.strictEqual(x.ok, false);
});
t('no client / signed out / empty reply / non-ok reply', async () => {
  const nc = make({ noClient: true, rpc: () => OK([]) }); assert.strictEqual((await nc.api.listUsers()).unavailable, true);
  const so = make({ user: null, rpc: () => assert.fail('no rpc when signed out') }); const r = await so.api.listUsers(); assert.strictEqual(r.code, 'not_signed_in'); assert.strictEqual(so.calls.length, 0);
  const fb = make({ user: 'none', session: { user: { id: 'viaSession' } }, rpc: () => OK([]) }); assert.strictEqual((await fb.api.listUsers()).ok, true);
  const em = make({ rpc: () => ({ data: null }) }); assert.strictEqual((await em.api.listUsers()).ok, false);
  const bad = make({ rpc: () => ({ data: { ok: false, error: 'invalid_status' } }) }); const b = await bad.api.listGameRequests({ status: 'zzz' }); assert.strictEqual(b.ok, false); assert.strictEqual(b.error, 'invalid_status');
  const err = make({ rpc: () => ({ error: { code: '57014', message: 'canceling statement due to statement timeout' } }) }); const e = await err.api.listUsers(); assert.deepStrictEqual([e.ok, e.code, e.unavailable], [false, '57014', undefined]);
});
t('drilldown(boxKey): applies box filters + default sort, user opts/filters override, tags box', async () => {
  const h = make({ rpc: () => OK([{ id: 1 }], 3) });
  const r = await h.api.drilldown('games_7d', { limit: 10 }); assert.strictEqual(r.box, 'games_7d'); assert.strictEqual(r.total, 3);
  assert.deepStrictEqual(h.calls[0].args, { p_limit: 10, p_offset: 0, p_sort: 'created_at', p_dir: 'desc', p_window: '7d' });
  await h.api.drilldown('requests_new'); assert.strictEqual(h.calls[1].args.p_status, 'new');
  await h.api.drilldown('requests_total', { filters: { status: 'planned' }, sort: 'game_name', dir: 'asc', search: 'azul' });
  assert.deepStrictEqual(h.calls[2].args, { p_search: 'azul', p_limit: 50, p_offset: 0, p_sort: 'game_name', p_dir: 'asc', p_status: 'planned' });
  await h.api.drilldown('active_users_30d'); assert.strictEqual(h.calls[3].args.p_active, '30d'); assert.strictEqual(h.calls[3].args.p_sort, 'last_active_at');
  await h.api.drilldown('users_7d'); assert.strictEqual(h.calls[4].args.p_signup, '7d');
  await h.api.drilldown('daily_plays'); assert.strictEqual(h.calls[5].args.p_days, 30);
  await h.api.drilldown('GAMES_TOTAL', { filters: { gameKey: 'catan' } }); assert.strictEqual(h.calls[6].args.p_game_key, 'catan');
  const unk = await h.api.drilldown('nope'); assert.deepStrictEqual(J(unk), { ok: false, code: 'unknown_box', error: 'Unknown admin box.' }); assert.strictEqual(h.calls.length, 7);
  assert.strictEqual((await h.api.drilldown(null)).code, 'unknown_box');
});
t('dispatch(boxKey): uses admin_drilldown with p_box + p_filters, bad key rejected locally', async () => {
  const h = make({ rpc: () => OK([]) });
  const r = await h.api.dispatch('Users_Total', { search: 'zach', limit: 5, filters: { signup: '7d', junk: 'x', days: 14 } });
  assert.strictEqual(r.ok, true); assert.strictEqual(r.box, 'users_total');
  assert.deepStrictEqual(h.calls[0], { name: 'admin_drilldown', args: { p_search: 'zach', p_limit: 5, p_offset: 0, p_box: 'users_total', p_filters: { signup: '7d', days: '14' } } });
  assert.strictEqual((await h.api.dispatch('x; drop')).code, 'unknown_box'); assert.strictEqual(h.calls.length, 1);
});
t('registry completeness: all methods, rpc names, columns, SQL dispatcher keys, markup KPIs', async () => {
  const h = make({ rpc: () => OK([]) }); const A = h.api;
  const boxes = A.listBoxes(); assert.ok(boxes.length >= 20);
  const dispatcherKeys = new Set(); const body = sql.slice(sql.indexOf('create or replace function public.admin_drilldown'));
  for (const m of body.matchAll(/when ((?:'[a-z0-9_]+'(?:, )?)+) then/g)) for (const k of m[1].matchAll(/'([a-z0-9_]+)'/g)) dispatcherKeys.add(k[1]);
  for (const b of boxes) {
    assert.ok(b.label && typeof b.label === 'string', b.key + ' label');
    assert.strictEqual(typeof A[b.method], 'function', b.key + ' method ' + b.method);
    assert.ok(b.rpc && sql.includes('create or replace function public.' + b.rpc + '('), b.key + ' rpc in SQL');
    assert.ok(Array.isArray(b.columns) && b.columns.length >= 3, b.key + ' columns');
    assert.ok(b.columns.every((c) => c.key && c.label && c.type), b.key + ' column fields');
    assert.ok(b.columns.some((c) => !c.hidden), b.key + ' has visible columns');
    assert.ok(dispatcherKeys.has(b.key), b.key + ' handled by SQL dispatcher');
    assert.ok(b.defaultSort && b.columns.some((c) => c.key === b.defaultSort), b.key + ' defaultSort is a column');
    assert.strictEqual(A.getBox(b.key), b);
  }
  // every KPI / card in the admin markup maps to a box
  for (const id of ['kpi-games-total', 'kpi-games-7d', 'kpi-games-30d', 'kpi-users-total', 'kpi-requests-total', 'kpi-requests-new', 'kpi-social-total', 'admin-top-games', 'admin-top-variations', 'admin-daily-chart', 'v22-admin-community-card']) {
    assert.ok(markup.includes('id="' + id + '"'), 'markup has ' + id); assert.ok(A.boxForKpi(id), 'box for ' + id);
  }
  assert.strictEqual(A.boxForKpi('kpi-users-total').key, 'users_total'); assert.deepStrictEqual(J(A.getBox('social_total').tabs), ['friendships', 'groups']);
  assert.strictEqual(A.boxForKpi('kpi-games-total').statKey, 'total_plays');
  assert.deepStrictEqual(J(boxes.filter((b) => b.shown).map((b) => b.key).sort()), ['community_total', 'daily_plays', 'friendships', 'games_30d', 'games_7d', 'games_total', 'groups', 'requests_new', 'requests_total', 'social_total', 'top_games', 'top_variations', 'users_total']);
  // all 12 RPCs in SQL are reachable from the JS side
  const rpcs = new Set(boxes.map((b) => b.rpc)); for (const r of ['admin_list_users', 'admin_list_plays', 'admin_list_game_requests', 'admin_list_friendships', 'admin_list_groups', 'admin_list_game_breakdown', 'admin_list_variation_breakdown', 'admin_list_daily_plays', 'admin_list_shared_games', 'admin_list_community_variations']) assert.ok(rpcs.has(r), r);
  assert.ok(Object.isFrozen(A.BOX.users_total), 'box entries frozen');
  assert.strictEqual(A.getBox('users_total').label, 'Registered Users');
});
t('expectedTotal reconciles with get_admin_stats payload', async () => {
  const A = make({ rpc: () => OK([]) }).api;
  const stats = { totals: { total_plays: 8, plays_7d: 4, plays_30d: 6, users_total: 5, users_7d: 2, users_30d: 3, game_requests_total: 5, game_requests_new: 2, friendships_accepted: 2, friendships_pending: 1, groups_total: 2, shared_games_total: 3, community_variations_total: 3, community_variations_visible: 2 }, by_game: [1, 2, 3], by_variation: [1, 2], daily_plays_30d: new Array(30).fill(0) };
  const exp = (k) => A.expectedTotal(k, stats);
  assert.deepStrictEqual([exp('games_total'), exp('games_7d'), exp('games_30d'), exp('users_total'), exp('requests_new'), exp('social_total'), exp('top_games'), exp('top_variations'), exp('daily_plays'), exp('community_hidden'), exp('active_users_7d'), exp('nope')],
    [8, 4, 6, 5, 2, 4, 3, 2, 30, 1, null, null]);
  assert.strictEqual(A.expectedTotal('games_total', null), null);
});
t('detailFor: top game / variation / chart day -> plays filters; shared game -> getSharedGame', async () => {
  const A = make({ rpc: () => OK([]) }).api;
  assert.deepStrictEqual(J(A.detailFor('top_games', { game_key: 'catan' })), { method: 'drilldown', box: 'games_total', opts: { filters: { gameKey: 'catan' } } });
  assert.deepStrictEqual(J(A.detailFor('top_variations', { game_key: 'catan', variation_key: 'seafarers' })).opts.filters, { gameKey: 'catan', variationKey: 'seafarers' });
  assert.deepStrictEqual(J(A.detailFor('daily_plays', { date: '2026-11-20' })).opts.filters, { date: '2026-11-20' });
  assert.deepStrictEqual(J(A.detailFor('shared_games_total', { id: 'abc' })), { method: 'getSharedGame', id: 'abc' });
  assert.strictEqual(A.detailFor('users_total', { id: 1 }), null);
});
t('end-to-end drill: top game row -> its plays via detailFor + drilldown', async () => {
  const h = make({ rpc: () => OK([{ id: 'p1' }], 4) });
  const d = h.api.detailFor('top_games', { game_key: 'catan' }); const r = await h.api.drilldown(d.box, d.opts);
  assert.strictEqual(r.total, 4); assert.strictEqual(h.calls[0].args.p_game_key, 'catan'); assert.strictEqual(h.calls[0].args.p_window, 'all');
});

(async () => {
  let pass = 0, fail = 0;
  for (const [name, fn] of tests) { try { await fn(); pass++; console.log('PASS ' + name); } catch (e) { fail++; console.log('FAIL ' + name + '\n   ' + (e && e.stack || e)); } }
  console.log(`\n${pass}/${pass + fail} passed`); process.exit(fail ? 1 : 0);
})();
