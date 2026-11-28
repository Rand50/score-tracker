const fs = require('fs'); const vm = require('vm'); const assert = require('assert');
const src = fs.readFileSync(__dirname + '/../v3/v26_backend.js', 'utf8');
const sql = fs.readFileSync(__dirname + '/../supabase_v26_favorites_game_edit.sql', 'utf8');
const J = (x) => JSON.parse(JSON.stringify(x)); // cross-realm safe
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const G1 = '11111111-1111-1111-1111-111111111111';

function make({ user = { id: 'u1' }, rpc, noClient = false, session = null, authThrows = false, ls = {}, withRealtime = true } = {}) {
  const calls = [], events = [], docL = {}, winL = {}, channels = [], removed = [], authCbs = [];
  let clock = 1000000;
  class D extends Date { static now() { return clock; } }
  const store = Object.assign({}, ls);
  const ctx = {
    setTimeout, clearTimeout, console, Math, JSON, Promise,
    Date: D,
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    dispatchEvent: (e) => { events.push({ type: e.type, detail: J(e.detail) }); },
    addEventListener: (t, f) => { (winL[t] = winL[t] || []).push(f); },
    document: { visibilityState: 'visible', addEventListener: (t, f) => { (docL[t] = docL[t] || []).push(f); } },
    ScoreAuth: user === 'none' ? undefined : { getUser: async () => { if (authThrows) throw new Error('boom'); return user; } },
  };
  if (!noClient) {
    ctx.sb = {
      rpc: async (name, args) => { calls.push({ name, args: J(args) }); return rpc(name, args, calls.length); },
      auth: { getSession: async () => ({ data: { session } }), onAuthStateChange: (cb) => { authCbs.push(cb); } },
    };
    if (withRealtime) {
      ctx.sb.channel = (name) => { const ch = { name, handlers: [], on(kind, filter, fn) { ch.handlers.push({ kind, filter, fn }); return ch; }, subscribe() { ch.subscribed = true; return ch; } }; channels.push(ch); return ch; };
      ctx.sb.removeChannel = (ch) => { removed.push(ch); };
    }
  }
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(src, ctx);
  return { api: ctx.TallyItV26Backend, ctx, calls, events, docL, winL, channels, removed, store, authCbs, tick: (ms) => { clock += ms; }, mkDate: (s) => vm.runInContext('new Date(' + JSON.stringify(s) + ')', ctx) };
}
const OK = (o) => ({ data: Object.assign({ ok: true }, o), error: null });
const ERR = (code, message) => ({ data: null, error: { code, message } });
const favRpc = (state) => (name, args) => {
  if (name === 'get_my_favorites') return OK({ favorites: state.list.slice() });
  if (name === 'set_my_favorites') { state.list = args.p_game_keys.slice(); return OK({ favorites: state.list.slice() }); }
  if (name === 'toggle_favorite') { const i = state.list.indexOf(args.p_game_key); if (i >= 0) state.list.splice(i, 1); else state.list.push(args.p_game_key); return OK({ favorited: i < 0, favorites: state.list.slice() }); }
  return ERR('PGRST202', 'Could not find the function');
};

const tests = [];
const t = (name, fn) => tests.push([name, fn]);

// ---------------------------------------------------------------- sanity vs the SQL file
t('every RPC the adapter calls exists in the migration', () => {
  for (const fn of ['get_my_favorites', 'set_my_favorites', 'toggle_favorite', 'get_game_detail', 'update_game_record']) {
    assert.ok(src.includes("'" + fn + "'"), fn + ' used in adapter');
    assert.ok(new RegExp('create or replace function public\\.' + fn + '\\(').test(sql), fn + ' defined in sql');
  }
  assert.ok(/p_expected_edited_at/.test(sql) && /p_edit jsonb/.test(sql) && /p_game_keys text\[\]/.test(sql) && /p_game_key text/.test(sql));
});

// ---------------------------------------------------------------- never throws
t('never throws: no client, throwing client, throwing auth', async () => {
  const a = make({ noClient: true });
  for (const r of [await a.api.getFavorites(), await a.api.setFavorites(['catan']), await a.api.toggleFavorite('catan'), await a.api.getGameDetail(G1), await a.api.updateGame(G1, { players: [] }), await a.api.mergeGuestFavorites()]) {
    assert.strictEqual(typeof r.ok, 'boolean');
  }
  const b = make({ rpc: () => { throw new Error('net down'); } });
  const r = await b.api.getGameDetail(G1); assert.strictEqual(r.ok, false); assert.ok(r.error);
  const c = make({ authThrows: true, rpc: () => OK({}) });
  assert.strictEqual((await c.api.getFavorites()).guest, true); // auth failure -> treated as signed out
  assert.strictEqual(c.api.isFavorite(null), false); assert.strictEqual(c.api.canEditGame(null), false);
  assert.strictEqual(typeof c.api.subscribeFavorites('nope'), 'function');
});
t('ScoreAuth.getUser first, falls back to getSession', async () => {
  const a = make({ user: 'none', session: { user: { id: 'sess' } }, rpc: favRpc({ list: ['a1'] }) });
  const r = await a.api.getFavorites(); assert.deepStrictEqual(J(r), { ok: true, favorites: ['a1'] });
  const b = make({ user: null, session: null, rpc: favRpc({ list: [] }) });
  assert.strictEqual((await b.api.getFavorites()).guest, true);
});

// ---------------------------------------------------------------- guest favorites
t('guest: get/set/toggle use localStorage (gst_v26_guest_favorites), no RPC, guest:true', async () => {
  const h = make({ user: null, rpc: () => { throw new Error('should not call'); } });
  let r = await h.api.toggleFavorite('  CatAn '); assert.deepStrictEqual(J(r), { ok: true, favorited: true, game_key: 'catan', favorites: ['catan'], guest: true });
  r = await h.api.setFavorites(['Nertz ', 'catan', '', 'nertz', 'hearts']); assert.deepStrictEqual(J(r), { ok: true, favorites: ['nertz', 'catan', 'hearts'], guest: true });
  assert.deepStrictEqual(JSON.parse(h.store.gst_v26_guest_favorites), ['nertz', 'catan', 'hearts']);
  assert.strictEqual(h.api.isFavorite('Catan'), true); assert.strictEqual(h.api.isFavorite('flip7'), false);
  r = await h.api.toggleFavorite('catan'); assert.strictEqual(r.favorited, false); assert.deepStrictEqual(J(r.favorites), ['nertz', 'hearts']);
  assert.deepStrictEqual(J(await h.api.getFavorites()), { ok: true, favorites: ['nertz', 'hearts'], guest: true });
  assert.strictEqual(h.calls.length, 0);
  assert.ok(h.events.some((e) => e.type === 'tallyit:favorites-changed' && e.detail.guest === true));
});
t('guest + client validation: bad key, blank, 81 chars, >100', async () => {
  const h = make({ user: null, rpc: () => OK({}) });
  assert.strictEqual((await h.api.toggleFavorite('bad key!')).error, 'invalid_input');
  assert.strictEqual((await h.api.toggleFavorite('   ')).error, 'invalid_input');
  assert.strictEqual((await h.api.toggleFavorite('a'.repeat(81))).error, 'invalid_input');
  assert.strictEqual((await h.api.setFavorites(['ok', 'no no'])).error, 'invalid_input');
  const many = Array.from({ length: 101 }, (_, i) => 'k' + i);
  assert.strictEqual((await h.api.setFavorites(many)).error, 'too_many');
  assert.strictEqual(h.store.gst_v26_guest_favorites, undefined);
  h.store.gst_v26_guest_favorites = 'not json{'; assert.deepStrictEqual(J((await h.api.getFavorites()).favorites), []);
});

// ---------------------------------------------------------------- signed-in favorites
t('signed in: RPC args, cache, isFavorite sync, events only on change', async () => {
  const st = { list: ['nertz'] }; const h = make({ rpc: favRpc(st) });
  await sleep(20); // load-time prime
  assert.strictEqual(h.api.isFavorite('nertz'), true);
  h.calls.length = 0; h.events.length = 0;
  let r = await h.api.toggleFavorite(' Catan '); assert.deepStrictEqual(J(r), { ok: true, favorited: true, favorites: ['nertz', 'catan'] });
  assert.deepStrictEqual(h.calls[0], { name: 'toggle_favorite', args: { p_game_key: 'catan' } });
  assert.strictEqual(h.api.isFavorite('catan'), true);
  r = await h.api.setFavorites(['hearts', 'Hearts', 'flip7']); assert.deepStrictEqual(J(r.favorites), ['hearts', 'flip7']);
  assert.deepStrictEqual(h.calls[1], { name: 'set_my_favorites', args: { p_game_keys: ['hearts', 'flip7'] } });
  assert.strictEqual(h.api.isFavorite('nertz'), false);
  const n = h.events.length; await h.api.getFavorites(); assert.strictEqual(h.events.length, n); // unchanged -> no event
  assert.ok(h.events.every((e) => e.type === 'tallyit:favorites-changed' && Array.isArray(e.detail.favorites)));
  assert.strictEqual(h.store.gst_v26_guest_favorites, undefined);
});
t('signed in: server errors are passed through, never thrown', async () => {
  const h = make({ rpc: (n) => (n === 'toggle_favorite' ? OK({ ok: false, error: 'too_many', message: 'x' }).data && { data: { ok: false, error: 'too_many', message: 'x' }, error: null } : OK({ favorites: [] })) });
  const r = await h.api.toggleFavorite('catan'); assert.deepStrictEqual(J(r), { ok: false, error: 'too_many', message: 'x' });
  const h2 = make({ rpc: () => ({ data: null, error: { code: '57014', message: 'timeout' } }) });
  const r2 = await h2.api.getFavorites(); assert.strictEqual(r2.ok, false); assert.strictEqual(r2.code, '57014');
  const h3 = make({ rpc: () => ({ data: 'weird', error: null }) });
  assert.strictEqual((await h3.api.getFavorites()).error, 'Unexpected reply.');
});

// ---------------------------------------------------------------- latch
t('missing-migration latch: codes + messages, unavailable:true, re-probe after 30s, never on "schema cache"', async () => {
  for (const [code, msg] of [['42P01', 'x'], ['42883', 'x'], ['42703', 'x'], ['PGRST202', 'x'], ['PGRST205', 'x'], ['', 'relation "user_favorites" does not exist'], ['', 'Could not find the table public.user_favorites'], ['', 'Could not find the function public.get_my_favorites']]) {
    let n = 0; const h = make({ rpc: () => { n++; return ERR(code, msg); } });
    await sleep(10); n = 0;
    const r = await h.api.getFavorites(); assert.deepStrictEqual(J(r), { ok: false, unavailable: true, error: r.error }, code + msg);
    const r2 = await h.api.toggleFavorite('catan'); assert.strictEqual(r2.unavailable, true);
    const r3 = await h.api.getGameDetail(G1); assert.strictEqual(r3.unavailable, true);
    assert.strictEqual(n, 0, 'latched by the load-time probe: no further RPCs (' + code + msg + ')');
    h.tick(31000); await h.api.getFavorites(); assert.strictEqual(n, 1, 're-probed after 30s');
  }
  let n = 0; const h = make({ rpc: () => { n++; return ERR('XX000', 'something about the schema cache'); } });
  await sleep(10); n = 0;
  const r = await h.api.getFavorites(); assert.strictEqual(r.unavailable, undefined); assert.strictEqual(r.ok, false);
  await h.api.getFavorites(); assert.strictEqual(n, 2, 'schema cache must not latch');
  let m = 0; const h2 = make({ rpc: () => { m++; return m <= 1 ? ERR('42883', 'x') : OK({ favorites: ['a'] }); } });
  await sleep(10); h2.tick(31000); const r2 = await h2.api.getFavorites(); assert.strictEqual(r2.ok, true); // recovers once migration is applied
});

// ---------------------------------------------------------------- merge
t('mergeGuestFavorites: merges once into the account, clears guest list, order = account first', async () => {
  const st = { list: ['nertz', 'catan'] };
  const h = make({ rpc: favRpc(st), ls: { gst_v26_guest_favorites: JSON.stringify(['catan', 'flip7', 'hearts']) } });
  await sleep(10);
  const r = await h.api.mergeGuestFavorites();
  assert.deepStrictEqual(J(r), { ok: true, merged: 2, favorites: ['nertz', 'catan', 'flip7', 'hearts'] });
  assert.deepStrictEqual(st.list, ['nertz', 'catan', 'flip7', 'hearts']);
  assert.strictEqual(h.store.gst_v26_guest_favorites, undefined);
  assert.ok(h.store.gst_v26_guest_merged_u1);
  const writes = h.calls.filter((c) => c.name === 'set_my_favorites').length;
  const r2 = await h.api.mergeGuestFavorites(); assert.strictEqual(r2.merged, 0);
  assert.strictEqual(h.calls.filter((c) => c.name === 'set_my_favorites').length, writes);
});
t('mergeGuestFavorites: failure keeps the guest list; signed-out is a no-op; nothing-to-add skips the write; 100 cap', async () => {
  const h = make({ rpc: () => ERR('XX000', 'down'), ls: { gst_v26_guest_favorites: '["a1"]' } });
  const r = await h.api.mergeGuestFavorites(); assert.strictEqual(r.ok, false); assert.strictEqual(h.store.gst_v26_guest_favorites, '["a1"]');
  const g = make({ user: null, rpc: () => OK({}), ls: { gst_v26_guest_favorites: '["a1"]' } });
  const rg = await g.api.mergeGuestFavorites(); assert.deepStrictEqual(J(rg), { ok: true, merged: 0, favorites: ['a1'], guest: true }); assert.strictEqual(g.store.gst_v26_guest_favorites, '["a1"]');
  const st = { list: ['a1', 'b1'] }; const h2 = make({ rpc: favRpc(st), ls: { gst_v26_guest_favorites: '["b1"]' } });
  await sleep(10); const r2 = await h2.api.mergeGuestFavorites(); assert.strictEqual(r2.merged, 0); assert.strictEqual(h2.calls.filter((c) => c.name === 'set_my_favorites').length, 0); assert.strictEqual(h2.store.gst_v26_guest_favorites, undefined);
  const full = { list: Array.from({ length: 100 }, (_, i) => 's' + i) }; const h3 = make({ rpc: favRpc(full), ls: { gst_v26_guest_favorites: '["extra"]' } });
  await sleep(10); const r3 = await h3.api.mergeGuestFavorites(); assert.strictEqual(r3.favorites.length, 100);
});

// ---------------------------------------------------------------- subscribe / realtime
t('subscribeFavorites: initial refresh, realtime channel filtered by user_id, refresh on event + visibilitychange, unsubscribe', async () => {
  const st = { list: ['catan'] }; const h = make({ rpc: favRpc(st), user: { id: 'me-123' } });
  const got = []; const unsub = h.api.subscribeFavorites((d) => got.push(J(d)));
  assert.strictEqual(typeof unsub, 'function');
  await sleep(40);
  assert.ok(got.length >= 1 && got[0].favorites[0] === 'catan');
  assert.strictEqual(h.channels.length, 1); const ch = h.channels[0]; assert.ok(ch.subscribed);
  assert.deepStrictEqual(J(ch.handlers[0].filter), { event: '*', schema: 'public', table: 'user_favorites', filter: 'user_id=eq.me-123' });
  st.list = ['catan', 'hearts']; ch.handlers[0].fn({});          // another device changed it
  await sleep(300); assert.deepStrictEqual(got[got.length - 1].favorites, ['catan', 'hearts']); assert.strictEqual(got[got.length - 1].source, 'realtime');
  assert.ok(h.docL.visibilitychange && h.docL.visibilitychange.length === 1);
  st.list = ['hearts']; h.docL.visibilitychange[0]();            // tab shown again
  await sleep(300); assert.deepStrictEqual(got[got.length - 1].favorites, ['hearts']); assert.strictEqual(got[got.length - 1].source, 'visibility');
  const n = got.length; h.ctx.document.visibilityState = 'hidden'; st.list = ['x1']; h.docL.visibilitychange[0](); await sleep(300); assert.strictEqual(got.length, n, 'hidden tab does not refresh');
  h.ctx.document.visibilityState = 'visible';
  unsub(); assert.strictEqual(h.removed.length, 1);
  st.list = ['y1']; h.docL.visibilitychange[0](); await sleep(300); assert.strictEqual(got.length, n, 'no callbacks after unsubscribe');
  assert.ok(h.events.some((e) => e.type === 'tallyit:favorites-changed'));
});
t('subscribeFavorites: guest gets the local list, no channel; sign-in event merges guest favorites', async () => {
  const h = make({ user: null, rpc: favRpc({ list: [] }), ls: { gst_v26_guest_favorites: '["flip7"]' } });
  const got = []; h.api.subscribeFavorites((d) => got.push(J(d)));
  await sleep(40); assert.deepStrictEqual(got[0], { favorites: ['flip7'], source: 'open', guest: true }); assert.strictEqual(h.channels.length, 0);
  assert.strictEqual(h.authCbs.length, 1);
  // user signs in
  h.ctx.ScoreAuth.getUser = async () => ({ id: 'late' });
  h.authCbs[0]('SIGNED_IN'); await sleep(400);
  assert.strictEqual(h.store.gst_v26_guest_favorites, undefined);
  assert.ok(h.calls.some((c) => c.name === 'set_my_favorites'));
  assert.strictEqual(h.channels.length, 1);
  assert.ok(got.some((d) => d.guest === false && d.favorites.includes('flip7')));
});
t('subscribe works without a realtime client (polling-only fallback)', async () => {
  const h = make({ rpc: favRpc({ list: ['a1'] }), withRealtime: false }); const got = [];
  h.api.subscribeFavorites((d) => got.push(d)); await sleep(40); assert.ok(got.length >= 1);
});

// ---------------------------------------------------------------- game detail / update
t('getGameDetail: id validation, auth, passthrough of forbidden / not_found / ok', async () => {
  const h = make({ rpc: (n, a) => (a.p_game_id === G1 ? OK({ game: { id: G1, can_edit: true } }) : { data: { ok: false, error: 'forbidden', message: 'no' }, error: null }) });
  await sleep(10); h.calls.length = 0;
  assert.strictEqual((await h.api.getGameDetail('nope')).error, 'not_found'); assert.strictEqual(h.calls.length, 0);
  assert.strictEqual((await h.api.getGameDetail(null)).error, 'not_found');
  assert.deepStrictEqual(J(await h.api.getGameDetail(G1)), { ok: true, game: { id: G1, can_edit: true } });
  assert.deepStrictEqual(h.calls[0], { name: 'get_game_detail', args: { p_game_id: G1 } });
  assert.strictEqual((await h.api.getGameDetail('22222222-2222-2222-2222-222222222222')).error, 'forbidden');
  const o = make({ user: null, rpc: () => OK({}) }); assert.strictEqual((await o.api.getGameDetail(G1)).error, 'not_signed_in');
});
t('updateGame: args (edit passthrough, expected_edited_at as string or Date), event only on success', async () => {
  const edit = { game_id: G1, game: { winner: 'Rand', payload: { players: [] } }, participants: [] };
  const h = make({ rpc: (n, a) => (a.p_edit.stale ? { data: { ok: false, error: 'conflict', message: 'c' }, error: null } : OK({ game: { id: G1, winner: 'Rand' }, winner_changed: true, ignored_user_ids: 0 })) });
  await sleep(10); h.calls.length = 0;
  let r = await h.api.updateGame(G1, edit); assert.strictEqual(r.ok, true); assert.strictEqual(r.winner_changed, true);
  assert.deepStrictEqual(h.calls[0], { name: 'update_game_record', args: { p_game_id: G1, p_edit: edit } });
  assert.ok(!('p_expected_edited_at' in h.calls[0].args));
  const ev = h.events.filter((e) => e.type === 'tallyit:game-edited'); assert.strictEqual(ev.length, 1);
  assert.deepStrictEqual(ev[0].detail, { game_id: G1, game: { id: G1, winner: 'Rand' }, winner_changed: true });
  await h.api.updateGame(G1, edit, { expectedEditedAt: '2026-11-28T06:00:00.123456+00:00' });
  assert.strictEqual(h.calls[1].args.p_expected_edited_at, '2026-11-28T06:00:00.123456+00:00');
  await h.api.updateGame(G1, edit, { expectedEditedAt: h.mkDate('2026-11-28T06:00:00.500Z') });
  assert.strictEqual(h.calls[2].args.p_expected_edited_at, '2026-11-28T06:00:00.500Z');
  await h.api.updateGame(G1, edit, { expectedEditedAt: null }); assert.ok(!('p_expected_edited_at' in h.calls[3].args));
  const before = h.events.length;
  r = await h.api.updateGame(G1, { stale: true }); assert.strictEqual(r.error, 'conflict'); assert.strictEqual(h.events.length, before, 'no event on failure');
});
t('updateGame: local guards (bad id / non-object / signed out) make no RPC; migration missing -> unavailable', async () => {
  const h = make({ rpc: () => OK({ game: {} }) }); await sleep(10); h.calls.length = 0;
  assert.strictEqual((await h.api.updateGame('x', {})).error, 'not_found');
  assert.strictEqual((await h.api.updateGame(G1, null)).error, 'invalid_payload');
  assert.strictEqual((await h.api.updateGame(G1, [])).error, 'invalid_payload');
  assert.strictEqual((await h.api.updateGame(G1, 'str')).error, 'invalid_payload');
  assert.strictEqual(h.calls.length, 0);
  const o = make({ user: null, rpc: () => OK({}) }); assert.strictEqual((await o.api.updateGame(G1, { a: 1 })).error, 'not_signed_in');
  const m = make({ rpc: () => ERR('42883', 'function public.update_game_record does not exist') });
  const r = await m.api.updateGame(G1, { a: 1 }); assert.strictEqual(r.unavailable, true); assert.strictEqual(m.events.filter((e) => e.type === 'tallyit:game-edited').length, 0);
});
t('updateSharedGame(edit) reads edit.game_id and forwards options', async () => {
  const h = make({ rpc: () => OK({ game: { id: G1 }, winner_changed: false }) }); await sleep(10); h.calls.length = 0;
  const edit = { game_id: G1, client_game_id: 'c1', game: { winner: null, payload: {} }, participants: [], winnerChanged: false };
  const r = await h.api.updateSharedGame(edit, { expectedEditedAt: '2026-01-01T00:00:00Z' });
  assert.strictEqual(r.ok, true); assert.strictEqual(h.calls[0].args.p_game_id, G1); assert.strictEqual(h.calls[0].args.p_expected_edited_at, '2026-01-01T00:00:00Z');
  assert.strictEqual((await h.api.updateSharedGame({ game: {} })).error, 'not_found');
  assert.strictEqual((await h.api.updateSharedGame(null)).error, 'not_found');
});
t('canEditGame: detail.can_edit / is_owner / created_by === current user; sync', async () => {
  const h = make({ user: { id: 'owner-1' }, rpc: () => OK({ favorites: [] }) }); await sleep(20);
  const c = h.api.canEditGame;
  assert.strictEqual(c({ ok: true, game: { can_edit: true } }), true);
  assert.strictEqual(c({ can_edit: true }), true);
  assert.strictEqual(c({ is_owner: true }), true);
  assert.strictEqual(c({ created_by: 'owner-1' }), true);
  assert.strictEqual(c({ game: { created_by: 'owner-1', can_edit: false } }), true);
  assert.strictEqual(c({ created_by: 'someone' }), false);
  assert.strictEqual(c({ can_edit: false, created_by: 'someone' }), false);
  assert.strictEqual(c({}), false); assert.strictEqual(c(null), false); assert.strictEqual(c('x'), false);
  const o = make({ user: null, rpc: () => OK({}) }); await sleep(20); assert.strictEqual(o.api.canEditGame({ created_by: 'owner-1' }), false);
});

(async () => {
  let pass = 0, fail = 0;
  for (const [name, fn] of tests) { try { await fn(); pass++; console.log('PASS ' + name); } catch (e) { fail++; console.log('FAIL ' + name + '\n   ' + (e && e.stack || e)); } }
  console.log(`\n${pass}/${pass + fail} passed`); process.exit(fail ? 1 : 0);
})();
