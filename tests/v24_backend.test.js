const fs = require('fs'); const vm = require('vm'); const assert = require('assert');
const src = fs.readFileSync(__dirname + '/../v3/v24_backend.js', 'utf8');
function store() { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), _m: m }; }
function make({ user = { id: 'u1' }, rpc, search = '', hash = '' } = {}) {
  const events = []; const calls = []; let replaced = null;
  const ctx = {
    localStorage: store(), sessionStorage: store(), URLSearchParams,
    location: { search, hash, pathname: '/' },
    history: { state: null, replaceState: (s, t, u) => { replaced = u; } },
    CustomEvent: function (type, init) { this.type = type; this.detail = init.detail; },
    dispatchEvent: e => events.push(e),
    ScoreAuth: { getUser: async () => user },
    sb: { rpc: async (name, args) => { calls.push({ name, args }); return rpc(name, args, calls.length); }, auth: { getSession: async () => ({ data: { session: null } }) } }
  };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(src, ctx);
  return { api: ctx.TallyItV24Backend, ctx, events, calls, replaced: () => replaced };
}
const TOK = 'AbCdEfGhIjKlMnOpQrStUvWx';
const tests = [];
const t = (n, f) => tests.push([n, f]);

t('link success fires event', async () => {
  const h = make({ rpc: () => ({ data: { ok: true, game_id: 'g1', participant_name: 'Audrey', user_id: 'u2', linked_via: 'creator' } }) });
  const r = await h.api.linkGameParticipant('g1', ' Audrey ', 'u2');
  assert.strictEqual(r.ok, true); assert.deepStrictEqual(JSON.parse(JSON.stringify(h.calls[0].args)), { p_game_id: 'g1', p_participant: 'Audrey', p_user_id: 'u2' });
  assert.strictEqual(h.events.length, 1); assert.strictEqual(h.events[0].type, 'tallyit:participant-linked'); assert.strictEqual(h.events[0].detail.user_id, 'u2');
});
t('link server refusal passes through, no event', async () => {
  const h = make({ rpc: () => ({ data: { ok: false, code: 'not_friends', error: 'x' } }) });
  const r = await h.api.linkGameParticipant('g1', 'Zach', 'u9');
  assert.strictEqual(r.code, 'not_friends'); assert.strictEqual(h.events.length, 0);
});
t('bad args rejected locally', async () => {
  const h = make({ rpc: () => assert.fail('no rpc') });
  assert.strictEqual((await h.api.linkGameParticipant('g1', '', 'u2')).code, 'bad_request');
  assert.strictEqual((await h.api.claimGameParticipant('nope')).code, 'invalid_token');
});
t('signed out blocked except preview', async () => {
  const h = make({ user: null, rpc: (n) => ({ data: { ok: true, status: 'open', participant_name: 'Zach H' } }) });
  assert.strictEqual((await h.api.claimGameParticipant(TOK)).code, 'not_signed_in');
  const p = await h.api.previewParticipantClaim('https://tallyit.fun/?claim=' + TOK);
  assert.strictEqual(p.status, 'open'); assert.strictEqual(h.calls.length, 1); assert.strictEqual(h.calls[0].args.p_token, TOK);
});
t('missing migration -> unavailable, then skips RPC for 30s', async () => {
  const h = make({ rpc: () => ({ error: { code: 'PGRST202', message: 'Could not find the function public.link_game_participant' } }) });
  const r1 = await h.api.linkGameParticipant('g1', 'A', 'u2');
  assert.strictEqual(r1.unavailable, true); assert.strictEqual(h.api.isMigrationReady(), false);
  const r2 = await h.api.createParticipantClaim('g1', 'A');
  assert.strictEqual(r2.unavailable, true); assert.strictEqual(h.calls.length, 1);
});
t('schema cache message does not latch migration missing', async () => {
  const h = make({ rpc: () => ({ error: { code: 'PGRST000', message: 'schema cache reload in progress' } }) });
  const r = await h.api.linkGameParticipant('g1', 'A', 'u2');
  assert.strictEqual(r.unavailable, undefined); assert.notStrictEqual(h.api.isMigrationReady(), false);
});
t('rpc throw -> ok:false, no throw', async () => {
  const h = make({ rpc: () => { throw new Error('offline'); } });
  const r = await h.api.unlinkGameParticipant('g1', 'A'); assert.strictEqual(r.ok, false); assert.strictEqual(r.error, 'offline');
});
t('createParticipantClaim fills url if missing', async () => {
  const h = make({ rpc: () => ({ data: { ok: true, token: TOK } }) });
  const r = await h.api.createParticipantClaim('g1', 'Zach H');
  assert.strictEqual(r.url, 'https://tallyit.fun/?claim=' + TOK);
});
t('suggestions cached, dismiss filters, force refetches', async () => {
  const rows = [{ participant_id: 'p1', game_id: 'g1' }, { participant_id: 'p2', game_id: 'g2' }];
  const h = make({ rpc: () => ({ data: rows }) });
  assert.strictEqual((await h.api.suggestMyUnlinkedGames()).suggestions.length, 2);
  const c = await h.api.suggestMyUnlinkedGames(); assert.strictEqual(c.cached, true); assert.strictEqual(h.calls.length, 1);
  h.api.dismissSuggestion('p1');
  assert.deepStrictEqual((await h.api.suggestMyUnlinkedGames()).suggestions.map(s => s.participant_id), ['p2']);
  const f = await h.api.suggestMyUnlinkedGames({ force: true });
  assert.strictEqual(h.calls.length, 2); assert.deepStrictEqual(f.suggestions.map(s => s.participant_id), ['p2']);
});
t('claimSuggestedParticipant success clears cache + event', async () => {
  const h = make({ rpc: (n) => n === 'suggest_my_unlinked_games' ? { data: [{ participant_id: 'p1' }] } : { data: { ok: true, game_id: 'g1', linked_via: 'suggestion' } } });
  await h.api.suggestMyUnlinkedGames();
  const r = await h.api.claimSuggestedParticipant('p1'); assert.strictEqual(r.ok, true); assert.strictEqual(h.events.length, 1);
  await h.api.suggestMyUnlinkedGames(); assert.strictEqual(h.calls.length, 3);
});
t('parseClaimToken variants', async () => {
  const { api } = make({ rpc: () => ({}) });
  assert.strictEqual(api.parseClaimToken(TOK), TOK);
  assert.strictEqual(api.parseClaimToken('?foo=1&claim=' + TOK + '#x'), TOK);
  assert.strictEqual(api.parseClaimToken('https://tallyit.fun/?claim=' + TOK), TOK);
  assert.strictEqual(api.parseClaimToken('?claim=<script>'), null);
  assert.strictEqual(api.parseClaimToken(''), null);
  assert.strictEqual(api.buildClaimUrl(TOK), 'https://tallyit.fun/?claim=' + TOK);
});
t('capture from URL stores in both storages and strips param', async () => {
  const h = make({ search: '?v=3&claim=' + TOK, hash: '#top', rpc: () => ({}) });
  assert.strictEqual(h.api.capturePendingClaimFromUrl(), TOK);
  assert.ok(h.ctx.sessionStorage.getItem('gst_v24_pending_claim')); assert.ok(h.ctx.localStorage.getItem('gst_v24_pending_claim'));
  assert.strictEqual(h.replaced(), '/?v=3#top');
  h.ctx.sessionStorage._m.clear(); // simulate OAuth redirect losing sessionStorage
  assert.strictEqual(h.api.getPendingClaim(), TOK);
});
t('consumePendingClaim: success clears, unavailable keeps, final error clears', async () => {
  let mode = 'missing';
  const h = make({ search: '?claim=' + TOK, rpc: () => mode === 'missing' ? { error: { code: '42883', message: 'function does not exist' } } : mode === 'ok' ? { data: { ok: true, game_id: 'g1' } } : { data: { ok: false, code: 'expired' } } });
  h.api.capturePendingClaimFromUrl();
  let r = await h.api.consumePendingClaim(); assert.strictEqual(r.unavailable, true); assert.strictEqual(r.pending, true); assert.strictEqual(h.api.getPendingClaim(), TOK);
  // wait out retry window
  const realNow = Date.now; h.ctx.Date = Date; Date.now = () => realNow() + 31000;
  mode = 'ok'; r = await h.api.consumePendingClaim(); Date.now = realNow;
  assert.strictEqual(r.ok, true); assert.strictEqual(h.api.getPendingClaim(), null); assert.strictEqual(h.events.length, 1);
  h.api.capturePendingClaimFromUrl(); mode = 'expired';
  r = await h.api.consumePendingClaim(); assert.strictEqual(r.code, 'expired'); assert.strictEqual(h.api.getPendingClaim(), null);
});
t('consumePendingClaim signed out keeps token', async () => {
  const h = make({ user: null, search: '?claim=' + TOK, rpc: () => assert.fail('no rpc') });
  h.api.capturePendingClaimFromUrl();
  const r = await h.api.consumePendingClaim(); assert.strictEqual(r.code, 'not_signed_in'); assert.strictEqual(h.api.getPendingClaim(), TOK);
});
t('already_claimed by same user does not refire event', async () => {
  const h = make({ rpc: () => ({ data: { ok: true, already_claimed: true, game_id: 'g1' } }) });
  const r = await h.api.claimGameParticipant(TOK); assert.strictEqual(r.ok, true); assert.strictEqual(h.events.length, 0);
});
(async () => { let pass = 0; for (const [n, f] of tests) { try { await f(); pass++; console.log('PASS', n); } catch (e) { console.log('FAIL', n, e.message); } } console.log(`${pass}/${tests.length} passed`); process.exit(pass === tests.length ? 0 : 1); })();
