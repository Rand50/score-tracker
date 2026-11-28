// Supabase mock for Score Tracker v9 tests.
// - score_history + auth behave exactly like mock-supabase.js (legacy tests unchanged)
// - social mode "unmigrated" (default): social tables/RPCs answer like a real project without the
//   social SQL migration (PGRST205 / PGRST202), so SocialAPI falls back to local demo mode
// - social mode "migrated" (sessionStorage.__social_mode = 'migrated'): tiny in-memory PostgREST with
//   simplified RLS for profiles, friendships, groups, group_members, games, game_participants + RPCs
(function(){
  const listeners = [];
  window.__upserts = JSON.parse(sessionStorage.getItem('__ups') || '[]');
  window.__remoteRow = JSON.parse(sessionStorage.getItem('__row') || 'null');
  function sess(){ try { return JSON.parse(sessionStorage.getItem('__mock_session')); } catch(_) { return null; } }
  function setSess(s){ if (s) sessionStorage.setItem('__mock_session', JSON.stringify(s)); else sessionStorage.removeItem('__mock_session'); }
  window.__fireAuth = function(evt, s){ setSess(s); listeners.forEach(cb => cb(evt, s)); };
  const migrated = () => sessionStorage.getItem('__social_mode') === 'migrated';
  const TABLES = ['profiles', 'friendships', 'groups', 'group_members', 'games', 'game_participants'];
  function loadDb(){ const d = JSON.parse(sessionStorage.getItem('__sdb') || '{}'); TABLES.forEach(t => { d[t] = d[t] || []; }); return d; }
  function saveDb(d){ sessionStorage.setItem('__sdb', JSON.stringify(d)); }
  window.__socialDb = () => loadDb();
  window.__seedSocial = (patch) => { const d = loadDb(); Object.keys(patch).forEach(t => { d[t] = d[t].concat(patch[t]); }); saveDb(d); };
  window.__rpcCalls = [];
  let seq = 0;
  const uuid = () => 'id-' + Date.now().toString(36) + '-' + (++seq) + '-' + Math.random().toString(36).slice(2, 7);
  const now = () => new Date().toISOString();
  const uid = () => (sess() && sess().user ? sess().user.id : null);
  const nameFromEmail = (e) => String(e || '').split('@')[0].replace(/[._-]+/g, ' ').split(/\s+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ') || 'Player';
  const DEFAULTS = {
    profiles: () => ({ created_at: now(), updated_at: now() }),
    friendships: () => ({ id: uuid(), status: 'pending', created_at: now(), updated_at: now() }),
    groups: () => ({ id: uuid(), guest_names: [], created_at: now(), updated_at: now() }),
    group_members: () => ({ role: 'member', joined_at: now() }),
    games: () => ({ id: uuid(), payload: {}, created_at: now(), ended_at: now() }),
    game_participants: () => ({ id: uuid(), is_winner: false, seat_order: 0, score: 0 })
  };
  function visible(d, table, row, me){
    const isMember = (gid) => d.group_members.some(m => m.group_id === gid && m.user_id === me);
    const groupVisible = (gid) => d.groups.some(g => g.id === gid && (g.created_by === me || isMember(gid)));
    const gameVisible = (g) => g && (g.created_by === me || d.game_participants.some(p => p.game_id === g.id && p.user_id === me) || (g.group_id && isMember(g.group_id)));
    switch (table) {
      case 'profiles': return true;
      case 'friendships': return row.requester_id === me || row.addressee_id === me;
      case 'groups': return row.created_by === me || isMember(row.id);
      case 'group_members': return row.user_id === me || groupVisible(row.group_id);
      case 'games': return gameVisible(row);
      case 'game_participants': return row.user_id === me || gameVisible(d.games.find(g => g.id === row.game_id));
      default: return true;
    }
  }
  function nestedRelations(cols){ const out = []; String(cols || '').replace(/(\w+)\(([^)]*)\)/g, (_, rel) => { out.push(rel); return ''; }); return out; }
  const FK = { group_members: 'group_id', game_participants: 'game_id' };
  function builder(table){
    const st = { op: 'select', filters: [], order: null, limit: null, single: false, maybe: false, payload: null, onConflict: null, cols: '*', returning: false };
    const api = {
      select(cols){ if (st.op !== 'select') st.returning = true; st.cols = cols || '*'; return api; },
      insert(rows){ st.op = 'insert'; st.payload = rows; return api; },
      update(vals){ st.op = 'update'; st.payload = vals; return api; },
      upsert(rows, o){ st.op = 'upsert'; st.payload = rows; st.onConflict = (o && o.onConflict) || 'id'; return api; },
      delete(){ st.op = 'delete'; return api; },
      eq(c, v){ st.filters.push(r => r[c] === v); return api; },
      neq(c, v){ st.filters.push(r => r[c] !== v); return api; },
      in(c, arr){ st.filters.push(r => (arr || []).includes(r[c])); return api; },
      or(str){ const parts = String(str).split(',').map(p => p.split('.')); st.filters.push(r => parts.some(([c, op, v]) => op === 'eq' && String(r[c]) === v)); return api; },
      order(c, o){ st.order = { c, asc: !(o && o.ascending === false) }; return api; },
      limit(n){ st.limit = n; return api; },
      single(){ st.single = true; return api; },
      maybeSingle(){ st.single = true; st.maybe = true; return api; },
      then(res, rej){ return Promise.resolve().then(run).then(res, rej); }
    };
    function run(){
      if (!migrated()) return { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public." + table + "' in the schema cache" } };
      const slowMs = Number(sessionStorage.getItem('__slow_games') || 0);
      if (table === 'games' && st.op === 'select' && slowMs) return new Promise((res) => setTimeout(() => res(run2()), slowMs));
      return run2();
    }
    function run2(){
      const d = loadDb(), me = uid(), rows = d[table];
      if (!rows) return { data: null, error: { code: 'PGRST205', message: 'unknown table ' + table } };
      let out = [];
      if (st.op === 'insert' || st.op === 'upsert') {
        const list = Array.isArray(st.payload) ? st.payload : [st.payload];
        list.forEach((r) => {
          const keys = st.onConflict ? st.onConflict.split(',') : null;
          const ex = st.op === 'upsert' ? rows.find(x => keys.every(k => x[k] === r[k])) : null;
          if (ex) { Object.assign(ex, r); out.push(ex); } else { const row = { ...DEFAULTS[table](), ...r }; rows.push(row); out.push(row); }
        });
      } else {
        let sel = rows.filter(r => visible(d, table, r, me)).filter(r => st.filters.every(f => f(r)));
        if (st.op === 'update') { sel.forEach(r => Object.assign(r, st.payload)); out = sel; }
        else if (st.op === 'delete') {
          const ids = new Set(sel);
          d[table] = rows.filter(r => !ids.has(r));
          if (table === 'groups') { const gids = sel.map(g => g.id); d.group_members = d.group_members.filter(m => !gids.includes(m.group_id)); }
          if (table === 'games') { const gids = sel.map(g => g.id); d.game_participants = d.game_participants.filter(p => !gids.includes(p.game_id)); }
          out = sel;
        } else out = sel;
      }
      saveDb(d);
      if (st.op !== 'select' && !st.returning) return { data: null, error: null };
      const d2 = loadDb();
      out = out.map(r => { const c = { ...r }; nestedRelations(st.cols).forEach(rel => { c[rel] = d2[rel].filter(x => x[FK[rel]] === r.id && visible(d2, rel, x, me)).map(x => ({ ...x })); }); return c; });
      if (st.order) out.sort((a, b) => (a[st.order.c] > b[st.order.c] ? 1 : a[st.order.c] < b[st.order.c] ? -1 : 0) * (st.order.asc ? 1 : -1));
      if (st.limit) out = out.slice(0, st.limit);
      if (st.single) { if (!out.length) return st.maybe ? { data: null, error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } }; return { data: out[0], error: null }; }
      return { data: out, error: null };
    }
    return api;
  }
  async function rpc(fn, args){
    window.__rpcCalls.push(fn);
    if (!migrated()) return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.' + fn + ' in the schema cache' } };
    const d = loadDb(), me = uid(), s = sess();
    const prof = (id) => d.profiles.find(p => p.id === id);
    // v17: mirrors the SQL normalization (strip leading @, compare friend codes without dashes/spaces)
    const norm = (v) => String(v || '').trim().replace(/^@+/, '').toUpperCase().replace(/[\s\-\u2010-\u2015\u2212]+/g, '');
    const find = (ident) => { const i = String(ident || '').trim().replace(/^@+/, ''); return d.profiles.find(p => (p.email && p.email === i.toLowerCase()) || norm(p.friend_code) === norm(i)); };
    let data = null;
    if (fn === 'ensure_my_profile') {
      let p = prof(me);
      if (!p) { const name = (args && args.p_display_name) || nameFromEmail(s.user.email); p = { id: me, display_name: name, email: String(s.user.email || '').toLowerCase(), friend_code: name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) + '-4821', created_at: now(), updated_at: now() }; d.profiles.push(p); }
      data = p;
    } else if (fn === 'lookup_profile') {
      const p = find(args.identifier); data = p ? [{ id: p.id, display_name: p.display_name, friend_code: p.friend_code }] : [];
    } else if (fn === 'send_friend_request') {
      const t = find(args.identifier);
      const tgt = t && { id: t.id, display_name: t.display_name, friend_code: t.friend_code };
      if (!t) data = { ok: false, error: 'No player found with that email or friend code.' };
      else if (t.id === me) data = { ok: false, error: 'You cannot add yourself as a friend.' };
      else {
        const ex = d.friendships.find(f => (f.requester_id === me && f.addressee_id === t.id) || (f.requester_id === t.id && f.addressee_id === me));
        if (ex && ex.status === 'accepted') data = { ok: true, status: 'already_friends', friendship_id: ex.id, target: tgt };
        else if (ex && ex.status === 'pending' && ex.addressee_id === me) { ex.status = 'accepted'; data = { ok: true, status: 'accepted', friendship_id: ex.id, target: tgt }; }
        else if (ex && ex.status === 'pending') data = { ok: true, status: 'already_pending', friendship_id: ex.id, target: tgt };
        else if (ex) { ex.status = 'pending'; ex.requester_id = me; ex.addressee_id = t.id; data = { ok: true, status: 'pending', friendship_id: ex.id, target: tgt }; }
        else { const f = { id: uuid(), requester_id: me, addressee_id: t.id, status: 'pending', created_at: now(), updated_at: now() }; d.friendships.push(f); data = { ok: true, status: 'pending', friendship_id: f.id, target: tgt }; }
      }
    } else if (['list_my_friends', 'respond_friend_request', 'remove_friend'].includes(fn) && sessionStorage.getItem('__no_v17_rpcs')) {
      return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.' + fn + ' in the schema cache' } };
    } else if (fn === 'list_my_friends') {
      if (sessionStorage.getItem('__friends_err')) return { data: null, error: { code: '08006', message: sessionStorage.getItem('__friends_err') } };
      data = d.friendships.filter(f => (f.requester_id === me || f.addressee_id === me) && ['pending', 'accepted'].includes(f.status))
        .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
        .map(f => { const other = f.requester_id === me ? f.addressee_id : f.requester_id, p = prof(other);
          return { friendship_id: f.id, requester_id: f.requester_id, addressee_id: f.addressee_id, status: f.status, created_at: f.created_at, updated_at: f.updated_at,
            other_user_id: other, display_name: (p && p.display_name) || 'Player', friend_code: (p && p.friend_code) || '' }; });
    } else if (fn === 'respond_friend_request') {
      const act = String(args.p_action || '').toLowerCase(), next = /^accept/.test(act) ? 'accepted' : /^decline/.test(act) ? 'declined' : null;
      const f = d.friendships.find(x => x.id === args.p_friendship_id && (x.requester_id === me || x.addressee_id === me));
      if (!next) data = { ok: false, error: 'Action must be accept or decline.' };
      else if (!f) data = { ok: false, error: 'Friend request not found.' };
      else if (f.addressee_id !== me) data = { ok: false, error: 'Only the recipient can respond to a friend request.' };
      else { f.status = next; f.updated_at = now(); data = { ok: true, status: next, friendship_id: f.id }; }
    } else if (fn === 'remove_friend') {
      const before = d.friendships.length;
      d.friendships = d.friendships.filter(x => !(x.id === args.p_friendship_id && (x.requester_id === me || x.addressee_id === me)));
      data = d.friendships.length < before ? { ok: true } : { ok: false, error: 'Friendship not found.' };
    } else return { data: null, error: { code: 'PGRST202', message: 'unknown rpc ' + fn } };
    saveDb(d);
    return { data, error: null };
  }
  window.supabase = { createClient: function(){
    return {
      auth: {
        getSession: async () => ({ data: { session: sess() }, error: null }),
        getUser: async () => ({ data: { user: sess() ? sess().user : null }, error: null }),
        onAuthStateChange: (cb) => { listeners.push(cb); return { data: { subscription: { unsubscribe(){} } } }; },
        signOut: async () => { setSess(null); listeners.forEach(cb => cb('SIGNED_OUT', null)); return { error: null }; },
        signInWithOAuth: async () => ({ error: null }),
        signInWithOtp: async () => ({ error: null })
      },
      rpc,
      from: (table) => table === 'score_history' ? ({
        select: () => ({ eq: () => ({ maybeSingle: async () => sessionStorage.getItem('__sh_err') ? ({ data: null, error: { code: '42501', message: 'permission denied for table score_history', details: null } }) : ({ data: window.__remoteRow, error: null }) }) }),
        upsert: async (payload) => { if (sessionStorage.getItem('__sh_err')) return { error: { code: '42501', message: 'permission denied for table score_history', details: null } }; window.__upserts.push(JSON.parse(JSON.stringify(payload))); window.__remoteRow = payload; sessionStorage.setItem('__ups', JSON.stringify(window.__upserts)); sessionStorage.setItem('__row', JSON.stringify(payload)); return { error: null }; }
      }) : builder(table)
    };
  }};
})();
