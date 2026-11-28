/* Score Tracker engine — 7 Wonders Illuminated Papyrus Ledger (3–7p, category-by-category, auto Science, coin tiebreaker), Rummikub Classic Blue & Ivory Rack (2–6p, Points Up / Classic +/−, tile calculator), social layer (you, friends, groups, shared history), game-agnostic shell, per-game scoring, Catan wood/parchment theme, Flip 7 coastal card theme, Carcassonne sunlit meadow tally, Nertz Midnight Parlor & Gold Foil (Solo + unlimited Partners/Teams). */
(function (global) {
  'use strict';

  const KEY_ACTIVE = 'gst_active';
  const KEY_CACHE = 'gst_cache';

  // ---------------- Games ----------------
  const GAMES = [
    { id: 'flip7', name: 'Flip 7', img: 'assets/games/flip7.svg', icon: '7',
      versions: ['Standard (to 200)', 'With a Vengeance', 'Thematic / Promo'],
      target: () => 200, detailedLabel: 'Card Pad' },
    { id: '7wonders', name: '7 Wonders', img: 'assets/games/7wonders.svg', art: 'assets/games/7wonders.svg', icon: '7', minPlayers: 3, maxPlayers: 7, defaultPlayers: 4,
      theme: 'theme-seven-wonders', versions: ['Base Game', 'With Leaders', 'With Cities', 'With Armada'], target: () => null, detailedLabel: 'Categories' },
    { id: 'carcassonne', name: 'Carcassonne', img: 'assets/games/carcassonne.svg', icon: 'C',
      versions: ['Classic (current scoring)', 'Older edition (small cities)', 'With Inns & Cathedrals', 'With other expansions'],
      target: () => null, detailedLabel: 'Features' },
    { id: 'catan', name: 'Catan', img: 'assets/games/catan.svg', icon: '⬢',
      versions: ['Base (to 10 VP)', 'Cities & Knights (to 13 VP)', 'Seafarers (to 12 VP)', '5-6 Player (to 10 VP)'],
      target: (v) => { const m = /to (\d+)/i.exec(v || ''); return m ? Number(m[1]) : 10; },
      dice: { count: 2, sides: 6, robberSum: 7 } },
    { id: 'ohhell', name: 'Oh Hell', img: 'assets/games/ohhell.svg', icon: 'OH',
      versions: ['Exact: 10+bid (miss=0)', '1 per trick +10 if exact', 'Other variant'],
      target: () => null, detailedLabel: 'Bid & Tricks' },
    { id: 'hearts', name: 'Hearts', img: 'assets/games/hearts.svg', icon: 'H', low: true,
      versions: ['Standard (to 100)', 'Short (to 50)', 'With Jack of Diamonds'],
      target: (v) => (/50/.test(v || '') ? 50 : 100), detailedLabel: 'Hand' },
    { id: 'nertz', name: 'Nertz', img: 'assets/games/nertz.svg', icon: 'N',
      versions: ['Standard (to 100)', 'Long game (to 150)', 'Short game (to 50)'],
      target: (v) => (/150/.test(v || '') ? 150 : /50\b/.test(v || '') ? 50 : 100), detailedLabel: 'Round' },
    { id: 'rummikub', name: 'Rummikub', img: 'assets/games/rummikub.svg', art: 'assets/games/rummikub.svg', icon: '▦', low: true, minPlayers: 2, maxPlayers: 6,
      versions: ['Points Up (Lowest Wins)', 'Classic (+/−)'], target: () => null, detailedLabel: 'Round' },
    { id: 'qwirkle', name: 'Qwirkle', img: 'assets/games/qwirkle.svg', art: 'assets/games/qwirkle.svg', icon: 'Q', minPlayers: 2, maxPlayers: 6,
      versions: ['Standard (play it out)', 'Short game (to 300)'], target: (v) => (/300/.test(v || '') ? 300 : null), detailedLabel: 'Turn' },
    { id: 'spoons', name: 'Spoons', img: 'assets/games/spoons.svg', art: 'assets/games/spoons.svg', icon: 'S', minPlayers: 2, maxPlayers: 12,
      versions: ['Last one standing'], target: () => null, detailedLabel: 'Round' },
    { id: 'other', name: 'Custom', img: 'assets/games/custom.svg', icon: '+',
      versions: ['Custom rules'], target: () => null, detailedLabel: null }
  ];
  const V20 = () => global.TallyItV20 || null;
  const V22 = () => global.TallyItV22 || null;
  // v22: a session's House Rules can flip high/low scoring
  const isLowGame = (game) => (game && typeof game.lowWins === 'boolean' ? game.lowWins : !!gameById(game && game.type).low);
  const gameById = (id) => GAMES.find((g) => g.id === id) || GAMES[GAMES.length - 1];

  const FLIP7_COLORS = {
    0: '#1a1a1a', 1: '#4a90d9', 2: '#f4d03f', 3: '#e74c3c', 4: '#27ae60', 5: '#2ecc71', 6: '#8e44ad',
    7: '#e67e22', 8: '#16a085', 9: '#d35400', 10: '#c0392b', 11: '#2c3e50', 12: '#7f8c8d'
  };

  const CATAN_CATS = [
    { key: 'settlements', label: 'Settlements',  vp: 1, max: 5, ui: 'settlement', icon: 'cat-icon--settlement' },
    { key: 'cities',      label: 'Cities',       vp: 2, max: 4, ui: 'city',       icon: 'cat-icon--city' },
    { key: 'longestRoad', label: 'Longest Road', vp: 2, max: 1, ui: 'road',       icon: 'cat-icon--road' },
    { key: 'largestArmy', label: 'Largest Army', vp: 2, max: 1, ui: 'army',       icon: 'cat-icon--army' },
    { key: 'vpCards',     label: 'VP Dev Card',      vp: 1, max: 5, ui: 'vpcard',     icon: 'cat-icon--vpcard' }
  ];
  const emptyBreakdown = () => ({ settlements: 0, cities: 0, longestRoad: 0, largestArmy: 0, vpCards: 0 });

  // ---------------- State ----------------
  let currentUser = null, initializedUserId = null;
  let players = [], history = [], pendingSync = false, syncInFlight = false;
  let currentGame = null, currentView = 'new';
  let selectedGame = 'flip7', selectedVersion = null;
  // v23 Hearts / Oh Hell ledgers
  const HTL = () => global.TallyItHearts || null;
  const OHL = () => global.TallyItOhHell || null;
  const isHt = () => !!(currentGame && currentGame.type === 'hearts' && HTL());
  const isOh = () => !!(currentGame && currentGame.type === 'ohhell' && OHL());
  // v24 Qwirkle
  const QWL = () => global.TallyItQwirkle || null;
  const isQw = () => !!(currentGame && currentGame.type === 'qwirkle' && QWL());
  // v25 Spoons
  const SPL = () => global.TallyItSpoons || null;
  const isSp = () => !!(currentGame && currentGame.type === 'spoons' && SPL());
  let htSel = -1, htForceArmed = false, ohForceMsg = '';
  const deselected = new Set();
  let scoringPlayer = null, padMode = 'simple';
  let flip = null;
  // Social layer state (signed-in "you" chip, friends, groups, shared games)
  let selfPlayer = null, selfIncluded = true, setupFriends = [], setupGroup = null;
  let social = { profile: null, friends: { accepted: [], incoming: [], outgoing: [] }, groups: [], shared: [], groupShared: {}, ready: false };
  let historyFilter = 'all', groupModalGuests = [], groupModalPicks = new Set();
  const groupLbFilter = {};
  const SAPI = () => global.SocialAPI || null, SSC = () => global.SocialScoring || null, SUI = () => global.SocialUI || null;

  // ---------------- Utils ----------------
  const byId = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const num = (id) => { const el = byId(id); return el ? (Number(el.value) || 0) : 0; };
  const checked = (id) => { const el = byId(id); return !!(el && el.checked); };
  const signed = (n) => (n > 0 ? '+' + n : String(n));
  function setHidden(el, hide) { if (!el) return; el.hidden = !!hide; el.classList.toggle('hidden', !!hide); }
  const isCatan = () => !!(currentGame && currentGame.type === 'catan');
  const isCarc = () => !!(currentGame && currentGame.type === 'carcassonne');

  // ---------------- Persistence ----------------
  // v21: every open game lives in window.TallyItSessions (multi-session); gst_active is legacy (auto-migrated)
  const SESS = () => global.TallyItSessions || null;
  function persistActive() {
    try {
      const S = SESS();
      if (S) { if (currentGame) S.saveCurrentSession(currentGame); return; }
      currentGame ? localStorage.setItem(KEY_ACTIVE, JSON.stringify(currentGame)) : localStorage.removeItem(KEY_ACTIVE);
    }
    catch (e) { console.warn('[tracker] persist failed', e); }
  }
  function loadActive() {
    try {
      const S = SESS();
      if (S) { const f = S.getFocusedSession(); return f ? normalizeLoadedGame(f.snapshot) : null; }
      const raw = localStorage.getItem(KEY_ACTIVE);
      return raw ? normalizeLoadedGame(JSON.parse(raw)) : null;
    } catch (_) { return null; }
  }
  // strict: only the focused game; otherwise the focused game or the most recently paused one (what Home's Resume card shows)
  function persistedActiveRaw(strict) {
    const S = SESS();
    if (!S) return localStorage.getItem(KEY_ACTIVE);
    const f = S.getFocusedSession() || (strict ? null : (S.listActiveSessions()[0] || null));
    return f ? JSON.stringify(f.snapshot) : null;
  }
  function normalizeLoadedGame(g) {
    try {
      if (!g || !Array.isArray(g.players)) return null;
      g.rounds = Array.isArray(g.rounds) ? g.rounds : [];
      g.players.forEach((p) => { p.score = Number(p.score) || 0; if (g.type === 'catan') p.breakdown = { ...emptyBreakdown(), ...(p.breakdown || {}) }; if (g.type === 'flip7') p.flip7Count = Number(p.flip7Count) || 0; });
      if (g.type === 'carcassonne') ccNormalize(g);
      if (g.type === 'rummikub' && global.RummikubLogic) global.RummikubLogic.rkNormalize(g);
      if (g.type === '7wonders' && global.SevenWondersLogic) { global.SevenWondersLogic.ensureSevenWondersState(g); if (!Array.isArray(g.swDone)) g.swDone = []; }
      if (g.type === 'hearts' && global.TallyItHearts) global.TallyItHearts.initState(g);
      if (g.type === 'ohhell' && global.TallyItOhHell) global.TallyItOhHell.initState(g);
      if (g.type === 'qwirkle' && global.TallyItQwirkle && (!g.qw || !Array.isArray(g.qw.players) || g.qw.players.length !== g.players.length)) g.qw = null;
      if (g.type === 'catan' && !g.targetVp) g.targetVp = gameById('catan').target(g.version);
      return g;
    } catch (_) { return null; }
  }
  function saveCache(pending) {
    if (typeof pending === 'boolean') pendingSync = pending;
    try {
      localStorage.setItem(KEY_CACHE, JSON.stringify({ userId: currentUser ? currentUser.id : null, players, history, pendingSync, updatedAt: new Date().toISOString() }));
    } catch (e) { console.warn('[tracker] cache failed', e); }
  }
  function loadCache(userId) {
    try {
      const c = JSON.parse(localStorage.getItem(KEY_CACHE) || 'null');
      if (!c || (c.userId && userId && c.userId !== userId)) return null;
      return { players: Array.isArray(c.players) ? c.players : [], history: Array.isArray(c.history) ? c.history : [], pendingSync: !!c.pendingSync };
    } catch (_) { return null; }
  }
  function mergePlayers(a, b) {
    const seen = new Set(), out = [];
    [...(a || []), ...(b || [])].forEach((n) => { n = String(n || '').trim(); if (n && !seen.has(n.toLowerCase())) { seen.add(n.toLowerCase()); out.push(n); } });
    return out;
  }
  function mergeHistory(local, remote) {
    const map = new Map(), k = (g) => g && (g.id || g.endTime || JSON.stringify(g));
    (remote || []).forEach((g) => g && map.set(k(g), g));
    (local || []).forEach((g) => g && map.set(k(g), g));
    return [...map.values()].sort((a, b) => (Date.parse(b.endTime || b.startTime || 0) || 0) - (Date.parse(a.endTime || a.startTime || 0) || 0));
  }
  function syncStatus(text, isErr) { const el = byId('sync-status'); if (el) { el.textContent = text || ''; el.dataset.state = isErr ? 'error' : 'ok'; } }
  function isNetworkFailure(err) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
    const msg = String((err && (err.message || err.details)) || err || '').toLowerCase();
    return msg.includes('failed to fetch') || msg.includes('load failed') || msg.includes('networkerror') || msg.includes('network request failed') || msg.includes('err_internet_disconnected');
  }
  const sb = () => global.sb || null;

  async function loadData() {
    const user = currentUser;
    const cached = loadCache(user ? user.id : null);
    if (cached) { players = [...cached.players]; history = [...cached.history]; pendingSync = cached.pendingSync; }
    const client = sb();
    if (!user || !client) return;
    try {
      const { data, error } = await client.from('score_history').select('*').eq('user_id', user.id).maybeSingle();
      if (error) {
        if (isNetworkFailure(error)) { syncStatus('Offline — using local data', true); }
        else { console.warn('[sync] legacy score_history unavailable:', error.code, error.message); syncStatus('', false); }
        return;
      }
      const rp = data && Array.isArray(data.players) ? data.players : [];
      const rh = data && Array.isArray(data.history) ? data.history : [];
      if (pendingSync) { players = mergePlayers(players, rp); history = mergeHistory(history, rh); saveCache(true); await saveData(); }
      else if (data) { players = rp; history = rh; saveCache(false); syncStatus('Synced', false); }
      else { saveCache(false); syncStatus('', false); if (players.length || history.length) await saveData(); }
    } catch (e) {
      if (isNetworkFailure(e)) syncStatus('Offline — using local data', true);
      else { console.warn('[sync] loadData error:', e); syncStatus('', false); }
    }
  }
  async function saveData() {
    saveCache(true);
    const client = sb();
    if (!currentUser || !client) { syncStatus('Saved locally', false); return; }
    if (syncInFlight) return;
    syncInFlight = true;
    try {
      const { error } = await client.from('score_history').upsert({ user_id: currentUser.id, players, history, updated_at: new Date().toISOString() });
      if (error) {
        if (isNetworkFailure(error)) syncStatus('Saved locally (sync pending)', true);
        else { console.warn('[sync] legacy score_history save skipped:', error.code, error.message); const api = SAPI(); syncStatus(api && api.isMigrationReady() === true ? 'Synced' : '', false); }
        return;
      }
      saveCache(false); syncStatus('Synced', false);
    } catch (e) {
      if (isNetworkFailure(e)) syncStatus('Saved locally (sync pending)', true);
      else console.warn('[sync] saveData error:', e);
    }
    finally { syncInFlight = false; }
  }

  // ---------------- Auth lifecycle ----------------
  async function onAuthReady(user) {
    if (!user) return;
    if (initializedUserId === user.id) { if (pendingSync) await saveData(); return; }
    currentUser = user; initializedUserId = user.id;
    selfPlayer = provisionalSelf(user); selfIncluded = true; setupFriends = []; setupGroup = null;
    currentGame = loadActive();
    showView('new');
    const socialReady = socialInit(user);
    await loadData();
    if (initializedUserId === user.id) showView(currentView);
    if (V20() && V20().onAuthChange) { try { V20().onAuthChange(user); } catch (_) {} }
    await socialReady;
  }
  function onAuthSignedOut() {
    currentUser = null; initializedUserId = null; players = []; history = []; currentGame = null; pendingSync = false;
    scoringPlayer = null; currentView = 'new'; closeDiceModal();
    document.body.classList.remove('theme-catan', 'theme-flip7', 'theme-carcassonne', 'theme-nertz', 'theme-rummikub', 'theme-seven-wonders', 'theme-hearts', 'theme-ohhell', 'theme-qwirkle', 'theme-spoons'); f7 = null; swExpOpen = false; rkCalcOpen = false; rkCalcExpr = ''; nzSheetKind = null; nzPopIdx = -1;
    if (typeof unsubFriendships === 'function') { unsubFriendships(); unsubFriendships = null; }
    if (typeof unsubMyGames === 'function') { unsubMyGames(); unsubMyGames = null; }
    lastFriendsError = null;
    if (V20() && V20().onAuthChange) { try { V20().onAuthChange(null); } catch (_) {} }
    resetSocialState();
    document.querySelectorAll('#app-shell .view').forEach((el) => el.classList.remove('active'));
    ['gen-leaderboard', 'gen-pad', 'leaderboard', 'score-form', 'history-list', 'recent-list', 'player-chips', 'f7-board', 'f7-drawer', 'cc-list',
      'soc-friends-list', 'soc-pending-list', 'soc-groups-list', 'setup-group-presets', 'setup-friend-picks', 'soc-group-friend-picks', 'soc-group-guest-chips'].forEach((id) => { const el = byId(id); if (el) el.innerHTML = ''; });
  }

  // ---------------- Theme + navigation ----------------
  function applyTheme() {
    const on = currentView === 'active' && isCatan();
    const f7on = currentView === 'active' && isFlip7();
    const ccon = currentView === 'active' && isCarc();
    document.body.classList.toggle('theme-catan', on);
    document.body.classList.toggle('theme-flip7', f7on);
    document.body.classList.toggle('theme-carcassonne', ccon);
    const nzon = currentView === 'active' && isNertz();
    document.body.classList.toggle('theme-nertz', nzon);
    const rkon = currentView === 'active' && isRk();
    document.body.classList.toggle('theme-rummikub', rkon);
    const swon = currentView === 'active' && isSw();
    document.body.classList.toggle('theme-seven-wonders', swon);
    const hton = currentView === 'active' && isHt();
    document.body.classList.toggle('theme-hearts', hton);
    const ohon = currentView === 'active' && isOh();
    document.body.classList.toggle('theme-ohhell', ohon);
    const qwon = currentView === 'active' && isQw();
    document.body.classList.toggle('theme-qwirkle', qwon);
    const spon = currentView === 'active' && isSp();
    document.body.classList.toggle('theme-spoons', spon);
    if (!qwon) qwMsg = '';
    if (!hton) { htSel = -1; htForceArmed = false; }
    if (!ohon) ohForceMsg = '';
    if (!swon) swExpOpen = false;
    if (!rkon) rkCalcOpen = false;
    if (!nzon && (nzSheetKind || nzPopIdx >= 0)) { nzCloseSheet(); nzPopIdx = -1; }
    if (!ccon) ccHideAdd();
    if (!f7on) { const s = byId('f7-sheet'); if (s && !s.hidden) { setHidden(s, true); s.innerHTML = ''; } }
    syncDiceTrigger();
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', on ? '#180f08' : f7on ? '#4bbdb8' : ccon ? '#6fa6d8' : nzon ? '#071222' : rkon ? '#0b2f69' : swon ? '#eadbc0' : (hton || ohon) ? '#f5f0e6' : qwon ? '#fbf7ee' : spon ? '#b57d43' : '#0c0d10');
  }
  function showView(v) {
    if (v === 'home') v = 'new';
    if (!byId('view-' + v)) v = 'new';
    if (v === 'new' && !v21HoldStep) v21Step = 'choose';
    // v21: leaving a game for Home / Play never traps you in it: the game auto-pauses into In Progress
    if (v === 'new' && currentView === 'active' && currentGame && SESS()) v21ParkCurrent();
    // v21: the Tracker tab with nothing focused reopens the most recent open game
    if (v === 'active' && !currentGame && SESS()) { const hg = v21HomeGame(); if (hg) { resumeGame(hg.id); return; } }
    currentView = v;
    document.querySelectorAll('#app-shell .view').forEach((el) => el.classList.toggle('active', el.id === 'view-' + v));
    document.querySelectorAll('.bottom-nav button').forEach((b) => b.classList.toggle('active', b.id === 'nav-' + v));
    applyTheme();
    if (v === 'new') { renderNew(); renderHome(); refreshGamesSoon(); }
    if (v === 'history') { renderHistory(); refreshGamesSoon(); }
    if (v === 'social') { renderSocial(); refreshSocial(); }
    if (v === 'active') renderActive();
    window.scrollTo(0, 0);
  }
  // v25 polish: every view / setup-step change goes through TallyItV25Fx.wrap (synchronous; plain pass-through if the module is absent)
  function v25Fx(fn) { const f = window.TallyItV25Fx; return f && f.wrap ? f.wrap(fn) : fn(); }
  { const v25ShowViewCore = showView; showView = function showView(v) { return v25Fx(() => v25ShowViewCore(v)); }; }

  // ---------------- Home ----------------
  function gameLabel(g) { return gameById(g.type).name; }
  function resumeMeta(g) {
    if (!g) return 'Resume Active Game';
    const n = (g.players || []).length, teams = g.type === 'nertz' && g.nertzMode === 'teams';
    return `${gameLabel(g)} · ${n} ${teams ? (n === 1 ? 'team' : 'teams') : (n === 1 ? 'player' : 'players')}`;
  }
  function renderHome() {
    const rb = byId('btn-resume-game'), hg = v21HomeGame(), hgame = hg ? hg.g : null;
    setHidden(rb, !hgame);
    if (rb) rb.dataset.sessionId = hg ? hg.id : '';
    const meta = byId('home-resume-meta');
    if (meta) meta.textContent = resumeMeta(hgame);
    if (rb) rb.setAttribute('aria-label', hgame ? 'Resume ' + resumeMeta(hgame) : 'Resume Active Game');
    v21RenderActiveGames(hg ? hg.id : null);
    if (currentUser) v24RefreshSuggestions();
    const el = byId('recent-list');
    if (!el) return;
    el.innerHTML = history.length
      ? history.slice(0, 5).map((g) => `<div class="recent-item"><strong>${esc(gameLabel(g))}</strong> · ${g.winner ? esc(g.winner) + ' won' : 'No winner'}
          <div class="small">${esc(new Date(g.endTime || g.startTime || Date.now()).toLocaleDateString())} · ${(g.players || []).map((p) => esc(p.name) + ' ' + p.score).join(', ')}</div></div>`).join('')
      : '<p class="small">No games yet — tap Play to start.</p>';
  }

  // v21: In Progress list (every open game except the one featured in the Resume card above)
  const V21_ICO_PLAY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>';
  const V21_ICO_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>';
  function v21ShortVersion(v) { return String(v || '').replace(/\s*\((current scoring|to \d+( VP)?|lowest wins)\)\s*/i, '').trim() || String(v || ''); }
  function v21RenderActiveGames(featuredId) {
    const sec = byId('v21-active-games-section'), list = byId('v21-active-games-list');
    if (!sec || !list) return;
    if (featuredId === undefined) { const hg = v21HomeGame(); featuredId = hg ? hg.id : null; }
    const all = listOpenGames();
    const shown = all.filter((s) => s.id !== featuredId);
    const cnt = byId('v21-active-games-count');
    if (cnt) cnt.textContent = all.length + ' open';
    setHidden(sec, !all.length && !featuredId);
    setHidden(list, !shown.length);
    list.innerHTML = shown.map((s) => {
      const g = s.snapshot || {}, name = s.gameName || gameById(s.gameKey || g.type).name;
      const ver = v21ShortVersion(s.versionLabel || g.version);
      const meta = [s.playersSummary, s.leaderText, s.roundLabel].filter(Boolean).join(' · ');
      const sid = esc(s.id);
      return `<div class="v21-active-card" data-session-id="${sid}" data-game="${esc(s.gameKey || g.type || '')}">
          <div class="v21-active-info">
            <div class="v21-active-title-row"><span class="v21-active-name">${esc(name)}</span>${ver ? `<span class="v21-active-var">${esc(ver)}</span>` : ''}</div>
            <div class="v21-active-meta">${esc(meta)}</div>
          </div>
          <div class="v21-active-actions">
            <button type="button" class="v21-btn-resume" onclick="resumeGame('${sid}')" aria-label="Resume ${esc(name)}"><span>Resume</span>${V21_ICO_PLAY}</button>
            <button type="button" class="v21-btn-discard" onclick="v21DiscardSession('${sid}', this)" aria-label="Discard ${esc(name)} without recording" title="Discard without recording">${V21_ICO_TRASH}</button>
          </div>
        </div>`;
    }).join('');
  }
  let v21DiscardTimer = null;
  function v21DiscardSession(id, btn) {
    if (!id) return false;
    if (btn && !btn.classList.contains('is-confirming')) {
      document.querySelectorAll('.v21-btn-discard.is-confirming').forEach((b) => { b.classList.remove('is-confirming'); b.setAttribute('aria-label', 'Discard without recording'); });
      btn.classList.add('is-confirming'); btn.setAttribute('aria-label', 'Tap again to discard without saving'); btn.title = 'Tap again to discard without saving';
      clearTimeout(v21DiscardTimer);
      v21DiscardTimer = setTimeout(() => { if (btn.isConnected) { btn.classList.remove('is-confirming'); btn.title = 'Discard without recording'; } }, 3500);
      return false;
    }
    clearTimeout(v21DiscardTimer);
    return discardGame(id);
  }

  // ---------------- Choose game ----------------
  // v21 guided flow: step 'choose' (tap a tile) -> step 'setup' (variation + players + sticky Start Scoring)
  let v21Step = 'choose', v21HoldStep = false;
  function v21ApplyStep() {
    const setup = v21Step === 'setup';
    const viewNew = byId('view-new'); if (viewNew) viewNew.dataset.v21Step = v21Step;
    setHidden(byId('v21-choose-step'), setup);
    setHidden(byId('v21-setup-step'), !setup);
    ['v21-setup-header', 'v21-setup-spacer', 'v21-sticky-cta'].forEach((id) => setHidden(byId(id), !setup));
    const nm = byId('v21-setup-game-name'); if (nm) nm.textContent = gameById(selectedGame).name;
    v23ApplySetupTheme(setup);
    v21UpdateSetupMeta();
  }
  // v23: game-themed Setup screen (#setup-screen.setup-theme-<gameKey>) only while on the Setup step
  const V23_THEMES = ['catan', '7wonders', 'flip7', 'carcassonne', 'rummikub', 'nertz', 'hearts', 'ohhell', 'qwirkle', 'spoons', 'other'];
  function v23ApplySetupTheme(on) {
    const scr = byId('setup-screen'); if (!scr) return;
    [...scr.classList].filter((c) => c.indexOf('setup-theme-') === 0).forEach((c) => scr.classList.remove(c));
    if (!on) { scr.removeAttribute('data-game'); return; }
    const g = gameById(selectedGame), key = V23_THEMES.includes(g.id) ? g.id : 'other';
    scr.classList.add('setup-theme-' + key); scr.dataset.game = key;
    const art = byId('v23-hero-art');
    if (art) { const src = g.img || ''; if (art.getAttribute('src') !== src) art.setAttribute('src', src); art.hidden = !src; }
    const badge = byId('v23-hero-badge'); if (badge) badge.textContent = g.name + ' Table';
  }
  function v21UpdateSetupMeta() {
    const el = byId('v21-cta-meta'); if (!el) return;
    const n = setupParticipants().length, g = gameById(selectedGame);
    const ver = v21ShortVersion(selectedVersion || g.versions[0]);
    el.textContent = n ? `${n} ${n === 1 ? 'player' : 'players'} · ${ver}` : `Add players · ${ver}`;
    const hs = byId('v23-hero-sub'); if (hs) hs.textContent = (g.maxPlayers ? `Up to ${g.maxPlayers} players · ` : '') + ver;
  }
  function v21BackToGames() {
    v21Step = 'choose'; v25Fx(() => { renderNew(); window.scrollTo(0, 0); });
    const card = document.querySelector(`#game-grid .game-card[data-game="${selectedGame}"]`);
    if (card && card.scrollIntoView) card.scrollIntoView({ block: 'nearest' });
  }
  function renderNew() {
    const grid = byId('game-grid');
    grid.innerHTML = GAMES.map((g) => `
      <div class="game-card" data-game="${g.id}" role="button" tabindex="0" onclick="selectGame('${g.id}')">
        ${g.img ? (g.fit === 'contain' ? `<img class="game-art-bg" src="${g.img}" alt="" aria-hidden="true" draggable="false">` : '') + `<img class="game-art${g.fit === 'contain' ? ' contain' : ''}" src="${g.img}" alt="" draggable="false" decoding="async">` : `<div class="game-icon" aria-hidden="true">${g.icon}</div>`}
        <div class="overlay">${esc(g.name)}</div>
        <span class="v21-tile-cue" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></span>
      </div>`).join('');
    const g = gameById(selectedGame);
    if (!selectedVersion || !g.versions.includes(selectedVersion)) selectedVersion = g.versions[0];
    const sel = byId('version-select');
    sel.innerHTML = g.versions.map((v) => `<option ${v === selectedVersion ? 'selected' : ''}>${esc(v)}</option>`).join('');
    sel.onchange = () => { selectedVersion = sel.value; v21UpdateSetupMeta(); if (V20() && V20().onSetupRendered) V20().onSetupRendered(selectedGame, selectedVersion); };
    renderSetupPlayers();
    if (V20() && V20().onSetupRendered) { try { V20().onSetupRendered(selectedGame, selectedVersion); } catch (_) {} }
    v21ApplyStep();
  }
  // v21: tapping a tile selects it AND jumps straight to Guided Setup
  function selectGame(id) {
    if (gameById(id).id !== id) return;
    selectedGame = id; selectedVersion = null; v21Step = 'setup';
    if (currentView === 'new') v25Fx(() => { renderNew(); window.scrollTo(0, 0); }); else v21OpenSetup();
  }
  function v21OpenSetup() { v21Step = 'setup'; v21HoldStep = true; try { showView('new'); } finally { v21HoldStep = false; } }
  function quickStart(id) {
    if (!gameById(id) || gameById(id).id !== id) id = selectedGame;
    selectedGame = id; selectedVersion = null;
    v21OpenSetup();
  }
  function togglePlayer(i, on) { const n = players[i]; if (n === undefined) return; on ? deselected.delete(n) : deselected.add(n); v21UpdateSetupMeta(); }
  function addPlayer() {
    const input = byId('new-player-name');
    const name = (input.value || '').trim();
    input.value = '';
    if (!name || players.some((p) => p.toLowerCase() === name.toLowerCase())) return;
    players.push(name); renderSetupPlayers(); saveData();
  }
  function removePlayer(i) {
    if (players[i] === undefined) return;
    deselected.delete(players[i]); players.splice(i, 1); renderSetupPlayers(); saveData();
  }
  function startGame() {
    const chosen = setupParticipants();
    if (!chosen.length) { alert('Add and select at least one player'); return null; }
    const gMax = gameById(selectedGame).maxPlayers, gMin = gameById(selectedGame).id === '7wonders' ? gameById(selectedGame).minPlayers : 0;
    if (gMin && chosen.length < gMin) { alert(`${gameById(selectedGame).name} needs at least ${gMin} players — add ${gMin - chosen.length} more to start.`); return null; }
    if (gMax && chosen.length > gMax) { alert(`${gameById(selectedGame).name} supports up to ${gMax} players — deselect ${chosen.length - gMax} to start.`); return null; }
    if (currentGame) {
      // v21: starting another game never replaces the open one; it stays in In Progress
      const S = SESS();
      if (S) S.pauseCurrentSession(currentGame);
      closeDiceModal(); v21ResetTransient(); currentGame = null;
    }
    const g = gameById(selectedGame);
    const version = selectedVersion || g.versions[0];
    currentGame = {
      id: g.id + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      type: g.id, version, target: g.target(version), startTime: new Date().toISOString(), endTime: null, winner: null,
      players: chosen.map((pt) => {
        const base = { name: pt.name, score: 0 };
        if (pt.userId) base.userId = pt.userId;
        if (pt.isSelf) base.isSelf = true;
        return g.id === 'catan' ? { ...base, breakdown: emptyBreakdown() } : g.id === 'flip7' ? { ...base, flip7Count: 0 } : base;
      }),
      rounds: []
    };
    if (setupGroup) {
      const sc = SSC();
      if (sc) sc.applyGroupPreset({ id: setupGroup.id, name: setupGroup.name, members: [] }, currentGame);
      else { currentGame.groupId = setupGroup.id; currentGame.groupName = setupGroup.name; }
    }
    // v22: Customize Rules / House Rules variation overrides (only when the table customized or picked a custom variation)
    let v22o = null;
    try { v22o = V22() && V22().getStartOverrides ? V22().getStartOverrides(g.id) : null; } catch (_) { v22o = null; }
    if (v22o) {
      if (Number(v22o.targetScore) > 0) currentGame.target = Number(v22o.targetScore);
      if (typeof v22o.lowWins === 'boolean') currentGame.lowWins = v22o.lowWins;
      if (v22o.expansions && typeof v22o.expansions === 'object') currentGame.v22Expansions = { ...v22o.expansions };
      currentGame.houseRules = { ...(v22o.houseRules || {}) };
      currentGame.v22VariationKey = v22o.variationKey || 'house_custom';
      currentGame.v22VariationName = v22o.variationName || 'Custom House Rules';
      currentGame.v22VariationSource = v22o.source || 'custom';
      if (Array.isArray(v22o.differences)) currentGame.v22Differences = v22o.differences.slice(0, 20);
      if (v22o.notes) currentGame.houseRulesNotes = String(v22o.notes);
    }
    if (g.id === 'catan') currentGame.targetVp = currentGame.target;
    if (g.id === 'carcassonne') ccNormalize(currentGame);
    if (g.id === 'nertz') nzStartGame(chosen);
    if (g.id === 'rummikub') rkStartGame();
    if (g.id === '7wonders' && SWL()) swStartGame();
    if (g.id === 'hearts' && HTL()) htStartGame();
    if (g.id === 'ohhell' && OHL()) ohStartGame();
    if (g.id === 'qwirkle' && QWL()) qwStartGame();
    if (g.id === 'spoons' && SPL()) spStartGame();
    if (v22o && g.id === 'rummikub' && v22o.scoringMode && RKL()) { currentGame.rkScoringMode = v22o.scoringMode === 'classic' ? 'classic' : 'points_up'; RKL().rkNormalize(currentGame); }
    scoringPlayer = null; padMode = 'simple'; f7 = null;
    currentGame.v20Recorded = true;
    if (SESS()) SESS().createSession(currentGame);
    persistActive();
    if (V20() && V20().onGameStarted) { try { V20().onGameStarted(currentGame); } catch (_) {} }
    showView('active');
    return currentGame;
  }
  // v21: End Without Recording (UI guards with the 2-tap sheet / card). Never touches history, saveData() or shareFinishedGame().
  function discardGame(sessionId) {
    const S = SESS();
    const hg = (typeof sessionId === 'string' && sessionId) || currentGame ? null : v21HomeGame();
    const id = (typeof sessionId === 'string' && sessionId) || (currentGame && currentGame.id) || (hg && hg.id) || null;
    if (!id) return false;
    const focused = !!(currentGame && currentGame.id === id);
    if (S) S.finishSession(id, { record: false });
    if (focused) {
      if (isNertz()) { nzCloseSheet(); nzPopIdx = -1; }
      if (isCarc()) ccHideAdd();
      closeDiceModal(); v21ResetTransient(); currentGame = null;
      if (!S) { try { localStorage.removeItem(KEY_ACTIVE); } catch (_) {} }
      showView('new');
    } else if (currentView === 'new') renderHome();
    return true;
  }
  function v21ResetTransient() {
    scoringPlayer = null; f7 = null; flip = null; padMode = 'simple';
    swExpOpen = false; swEditKey = null; rkCalcOpen = false; rkCalcExpr = ''; nzSheetKind = null; nzPopIdx = -1;
    htSel = -1; htForceArmed = false; ohForceMsg = ''; qwMsg = '';
  }
  // v21: park the focused game in In Progress (saved, focus cleared) without navigating
  function v21ParkCurrent() {
    const S = SESS();
    if (!currentGame || !S) return null;
    if (isCarc()) { const a = document.activeElement; if (a && a.classList && a.classList.contains('cc-score')) ccInput(Number(a.dataset.idx), a); ccHideAdd(); }
    if (isNertz()) { nzCloseSheet(); nzPopIdx = -1; }
    const id = currentGame.id;
    S.pauseCurrentSession(currentGame);
    closeDiceModal(); v21ResetTransient(); currentGame = null;
    return id;
  }
  // v21: Keep Open (Pause) -> game stays in In Progress, focus cleared, back to Home
  function pauseGame() {
    if (!currentGame) { showView('new'); return null; }
    if (!SESS()) { const id = currentGame.id; persistActive(); showView('new'); return id; }
    const id = v21ParkCurrent();
    showView('new');
    return id;
  }
  // The game Home's Resume card points at: the focused game, else the most recently paused one
  function v21HomeGame() {
    if (currentGame) return { id: currentGame.id, g: currentGame };
    const S = SESS(); const top = S ? S.listActiveSessions()[0] : null;
    return top ? { id: top.id, g: top.snapshot } : null;
  }
  // v21: Resume any open game (restores its exact snapshot); the currently focused game (if different) is paused, never lost
  function resumeGame(sessionId) {
    const S = SESS();
    if (!S) { if (currentGame) showView('active'); return currentGame; }
    const hg = v21HomeGame();
    const id = (typeof sessionId === 'string' && sessionId) || (currentGame && currentGame.id) || S.getFocusedSessionId() || (hg && hg.id);
    if (!id) return null;
    if (currentGame && currentGame.id === id) { persistActive(); showView('active'); return currentGame; }
    if (currentGame) { S.pauseCurrentSession(currentGame); closeDiceModal(); currentGame = null; }
    const res = S.resumeSession(id);
    const g = res && res.ok ? normalizeLoadedGame(res.snapshot) : null;
    if (!g) { if (currentView === 'new') renderHome(); return null; }
    v21ResetTransient();
    currentGame = g;
    showView('active');
    return currentGame;
  }
  function listOpenGames() { const S = SESS(); return S ? S.listActiveSessions() : (currentGame ? [{ id: currentGame.id, gameKey: currentGame.type, snapshot: currentGame }] : []); }

  // ---------------- Rounds (shared by every game) ----------------
  function commitRound(deltas, mode, detail) {
    const prev = currentGame.players.map((p) => p.score);
    currentGame.players.forEach((p, i) => { p.score = prev[i] + (Number(deltas[i]) || 0); });
    if (isCatan()) {
      currentGame.players.forEach((p) => { if (p.score < 0) p.score = 0; });
      if (detail && detail.breakdown) {
        const p = currentGame.players[detail.player];
        CATAN_CATS.forEach((c) => { p.breakdown[c.key] = (p.breakdown[c.key] || 0) + (detail.breakdown[c.key] || 0); });
      }
    }
    currentGame.rounds.push({ ts: new Date().toISOString(), by: scoringPlayer, mode, prev, deltas: currentGame.players.map((p, i) => p.score - prev[i]), detail: detail || null });
    scoringPlayer = null;
    persistActive();
    renderActive();
  }
  function undoLastRound() {
    if (isNertz()) return nzUndo();
    if (isRk()) return rkUndo();
    if (isSw()) return swUndoAction();
    if (isHt()) return HeartsUI.undoHand();
    if (isOh()) return OhHellUI.undoRound();
    if (isQw()) return QwirkleUI.undoTurn();
    if (isSp()) return global.SpoonsUI ? global.SpoonsUI.undo() : null;
    if (!currentGame || !currentGame.rounds.length) return null;
    const r = currentGame.rounds.pop();
    currentGame.players.forEach((p, i) => { p.score = Array.isArray(r.prev) && r.prev[i] !== undefined ? r.prev[i] : p.score - ((r.deltas || [])[i] || 0); });
    if (Array.isArray(r.prevF7)) currentGame.players.forEach((p, i) => { if (r.prevF7[i] !== undefined) p.flip7Count = r.prevF7[i]; });
    if (isCatan() && Array.isArray(r.prevBd)) {
      currentGame.players.forEach((p, i) => { p.breakdown = { ...emptyBreakdown(), ...(r.prevBd[i] || {}) }; });
    } else if (isCatan() && r.detail && r.detail.breakdown) {
      const p = currentGame.players[r.detail.player];
      CATAN_CATS.forEach((c) => { p.breakdown[c.key] = Math.max(0, (p.breakdown[c.key] || 0) - (r.detail.breakdown[c.key] || 0)); });
    }
    if (!isCatan()) { scoringPlayer = null; f7 = null; }
    persistActive();
    renderActive();
    if (isCatan()) cgFeedback(['.cg-vp']);
    return r;
  }
  function onlyFor(idx, pts) { return currentGame.players.map((_, i) => (i === idx ? pts : 0)); }

  function computeWinner(game) {
    const g = gameById(game.type);
    if (game.type === 'spoons' && Array.isArray(game.winnerNames)) return game.winnerNames.join(', ');
    if (!game.players.length) return '';
    const scores = game.players.map((p) => p.score);
    const best = isLowGame(game) ? Math.min(...scores) : Math.max(...scores);
    return game.players.filter((p) => p.score === best).map((p) => p.name).join(', ');
  }
  function endGame() {
    if (!currentGame) return null;
    const v21SessionId = currentGame.id;
    if (isCarc()) { const a = document.activeElement; if (a && a.classList && a.classList.contains('cc-score')) ccInput(Number(a.dataset.idx), a); ccHideAdd(); }
    let finished;
    if (isNertz()) {
      nzCloseSheet(); nzPopIdx = -1;
      finished = NZL().nzPrepareFinish(currentGame);
      ['nzSel', 'nzDone', 'nzRoster', 'nertzLogOpen', 'soloRoster'].forEach((k) => delete finished[k]);
    } else if (isRk()) {
      rkCalcOpen = false; rkCalcExpr = '';
      finished = RKL().rkPrepareFinish(currentGame);
      finished.version = RK_VERSIONS[finished.rkScoringMode] || finished.version;
      ['rkSel', 'rkDone', 'rkLogOpen'].forEach((k) => delete finished[k]);
    } else if (isSw()) {
      swExpOpen = false; swEditKey = null;
      currentGame.endTime = new Date().toISOString();
      finished = { ...SWL().swBuildFinishPayload(currentGame, currentUser).finishedGame };
      finished.version = currentGame.version || finished.version;
      ['undoStack', 'swDone', 'activeCategory'].forEach((k) => delete finished[k]);
    } else {
      finished = { ...currentGame, endTime: new Date().toISOString() };
      if (isQw()) qwPrepareFinish(finished);
      if (isSp()) spPrepareFinish(finished);
      finished.winner = computeWinner(finished);
      if (finished.type === 'hearts' || finished.type === 'ohhell') ['htDraft', 'htMoon', 'ohDraft', 'ohDraftRound', 'ohTrump', 'currentCards', 'currentDealerIndex', 'currentTrump', 'currentRoundIndex'].forEach((k) => delete finished[k]);
    }
    const DL = global.DiceLogic, diceStats = DL ? DL.buildDiceSummary(currentGame, { gamesCatalog: GAMES }) : null;
    if (diceStats) finished.meta = { ...(finished.meta || {}), diceStats };
    delete finished.diceRolls;
    if (currentGame.v20Recorded) finished.v20Recorded = true;
    delete finished.sessionId;
    closeDiceModal();
    history.unshift(finished);
    if (SESS()) SESS().finishSession(v21SessionId, { record: true });
    currentGame = null; scoringPlayer = null; f7 = null;
    persistActive();
    if (!SESS()) { try { localStorage.removeItem(KEY_ACTIVE); } catch (_) {} }
    saveCache(true);
    showView('history');
    saveData();
    shareFinishedGame(finished);
    return finished;
  }

  // ---------------- Active game ----------------
  function renderActive() {
    applyTheme();
    if (!currentGame) {
      byId('gen-title').textContent = 'No active game';
      byId('gen-sub').textContent = 'Tap Play to start one.';
      byId('gen-leaderboard').innerHTML = '';
      setHidden(byId('gen-pad'), true); setHidden(byId('gen-undo'), true);
      byId('generic-board').classList.add('is-empty');
      return;
    }
    byId('generic-board').classList.remove('is-empty');
    if (isCatan()) renderCatan(); else if (isFlip7()) renderFlip7(); else if (isCarc()) renderCarc(); else if (isNertz()) renderNertz(); else if (isRk()) renderRummikub(); else if (isSw()) renderSevenWonders(); else if (isHt()) renderHearts(); else if (isOh()) renderOhHell(); else if (isQw()) renderQwirkle(); else if (isSp()) renderSpoons(); else renderGeneric();
  }

  // ----- Generic (neutral) games -----
  function renderGeneric() {
    const g = gameById(currentGame.type);
    byId('gen-title').textContent = g.name;
    const t = currentGame.target;
    const low = isLowGame(currentGame);
    byId('gen-sub').textContent = [currentGame.version, t ? (low ? `Ends at ${t} · lowest wins` : `First to ${t}`) : (typeof currentGame.lowWins === 'boolean' && low !== !!g.low ? (low ? 'Lowest wins' : 'Highest wins') : ''), `Round ${currentGame.rounds.length + 1}`].filter(Boolean).join(' · ');
    const sorted = currentGame.players.map((p, idx) => ({ ...p, idx })).sort((a, b) => (low ? a.score - b.score : b.score - a.score) || a.idx - b.idx);
    const lead = sorted.length ? sorted[0].score : null;
    byId('gen-leaderboard').innerHTML = sorted.map((p, r) => `
      <div class="player-row ${p.idx === scoringPlayer ? 'selected' : ''} ${currentGame.rounds.length && p.score === lead ? 'leader' : ''}" data-player-idx="${p.idx}" onclick="openPad(${p.idx})">
        <div class="flex"><span class="rank">${r + 1}</span><strong class="p-name">${esc(p.name)}</strong></div>
        <div class="p-score">${p.score}</div>
      </div>`).join('');
    setHidden(byId('gen-undo'), !currentGame.rounds.length);
    if (scoringPlayer === null) { setHidden(byId('gen-pad'), true); byId('gen-pad').innerHTML = ''; }
  }
  function openPad(idx) {
    if (!currentGame || !currentGame.players[idx]) return;
    if (isNertz()) { nzUiSelect(idx); return; }
    if (isRk()) { rkSelect(idx); return; }
    if (isSw()) return;
    if (isHt()) { HeartsUI.selectPlayer(idx); return; }
    if (isOh()) return;
    if (isQw()) { QwirkleUI.selectPlayer(idx); return; }
    if (isSp()) return;
    scoringPlayer = idx;
    if (isCatan()) { selectCatanPlayer(idx); return; }
    if (isFlip7()) { f7Select(idx); return; }
    renderGeneric();
    const g = gameById(currentGame.type);
    const pad = byId('gen-pad');
    setHidden(pad, false);
    pad.innerHTML = `
      <div class="small">Scoring for <strong>${esc(currentGame.players[idx].name)}</strong></div>
      ${g.detailedLabel ? `<div class="mode-toggle-n">
        <button type="button" class="btn ${padMode === 'simple' ? 'active' : ''}" id="gen-mode-simple" onclick="setPadMode('simple')">Simple Points</button>
        <button type="button" class="btn ${padMode === 'detailed' ? 'active' : ''}" id="gen-mode-detailed" onclick="setPadMode('detailed')">${esc(g.detailedLabel)}</button>
      </div>` : ''}
      <div id="gen-form"></div>`;
    renderGenericForm();
  }
  function setPadMode(m) {
    padMode = m === 'detailed' ? 'detailed' : 'simple';
    ['simple', 'detailed'].forEach((k) => { const b = byId('gen-mode-' + k); if (b) b.classList.toggle('active', k === padMode); });
    renderGenericForm();
  }
  function closePad() { scoringPlayer = null; renderActive(); }
  const cancelBtn = '<button class="btn" type="button" onclick="closePad()">Cancel</button>';

  function renderGenericForm() {
    const form = byId('gen-form');
    if (!form) return;
    const g = gameById(currentGame.type);
    if (padMode === 'simple' || !g.detailedLabel) {
      form.innerHTML = `<label class="small" for="simple-pts">Points this round (negative allowed)</label>
        <input type="number" id="simple-pts" value="0" inputmode="numeric">
        <div class="action-bar"><button class="btn primary" type="button" id="commit-simple" onclick="commitSimplePoints()">Add</button>${cancelBtn}</div>`;
      return;
    }
    const v = currentGame.version || '';
    const row = (id, label, extra) => `<div class="form-row"><span>${label}</span><input type="number" id="${id}" value="0" inputmode="numeric" oninput="updateGenericPreview()" ${extra || ''}></div>`;
    const box = (id, label) => `<label class="form-row"><span>${label}</span><input type="checkbox" id="${id}" onchange="updateGenericPreview()"></label>`;
    const commit = `<div class="preview" id="gen-preview"></div><div class="action-bar"><button class="btn primary" type="button" id="commit-detailed" onclick="commitGenericDetailed()">Add</button>${cancelBtn}</div>`;
    switch (g.id) {
      case 'flip7': {
        flip = { numbers: [], x2: false, mods: [], bust: false };
        form.innerHTML = `
          <div class="key-grid-5">${Object.keys(FLIP7_COLORS).map((n) => `<div class="key" id="f7n${n}" style="background:${FLIP7_COLORS[n]}" onclick="flipToggle('n', ${n})">${n}</div>`).join('')}</div>
          <div class="key-grid-6"><div class="key" id="f7x2" style="background:#1e293b" onclick="flipToggle('x2')">×2</div>
            ${[2, 4, 6, 8, 10].map((m) => `<div class="key" id="f7m${m}" style="background:#1e293b" onclick="flipToggle('m', ${m})">+${m}</div>`).join('')}</div>
          <div class="key" id="f7bust" style="background:#3f1d2a" onclick="flipToggle('bust')">Bust (0 this round)</div>${commit}`;
        break;
      }
      case '7wonders': {
        const cats = [['w-mil', 'Military'], ['w-coin', 'Treasury (coins)'], ['w-won', 'Wonder'], ['w-civ', 'Civilian (blue)'], ['w-com', 'Commercial (yellow)'], ['w-gld', 'Guilds (purple)'], ['w-sci', 'Science (green)']];
        if (/Leaders/.test(v)) cats.push(['w-ldr', 'Leaders']);
        if (/Cities/.test(v)) cats.push(['w-cty', 'Cities (black)']);
        if (/Armada/.test(v)) cats.push(['w-arm', 'Armada (naval)']);
        if (/Other/.test(v)) cats.push(['w-oth', 'Expansion extras']);
        form.innerHTML = cats.map(([id, l]) => row(id, l)).join('') + commit;
        form.dataset.fields = cats.map((c) => c[0]).join(',');
        break;
      }
      case 'carcassonne': {
        const cats = [['ca-cit', 'Cities'], ['ca-road', 'Roads'], ['ca-mon', 'Monasteries'], ['ca-field', 'Fields / farms']];
        if (/Inns|other/.test(v)) cats.push(['ca-ext', 'Expansion bonuses']);
        form.innerHTML = cats.map(([id, l]) => row(id, l)).join('') + commit;
        form.dataset.fields = cats.map((c) => c[0]).join(',');
        break;
      }
      case 'ohhell':
        form.innerHTML = row('oh-bid', 'Bid', 'min="0"') + row('oh-tricks', 'Tricks taken', 'min="0"') + `<div class="small">${esc(v)}</div>` + commit;
        break;
      case 'hearts':
        form.innerHTML = row('h-hearts', 'Hearts taken (0-13)', 'min="0" max="13"') + box('h-queen', 'Queen of Spades (+13)') +
          (/Jack/.test(v) ? box('h-jack', 'Jack of Diamonds (−10)') : '') + box('h-moon', 'Shot the moon (everyone else +26)') + commit;
        break;
      case 'nertz':
        form.innerHTML = row('n-played', 'Cards played to center (+1)', 'min="0"') + row('n-left', 'Left in Nertz pile (−2)', 'min="0"') +
          (/No bonus/.test(v) ? '' : box('n-called', 'Called Nertz (+10)')) + commit;
        break;
      default:
        form.innerHTML = row('simple-pts', 'Points') + commit;
    }
    updateGenericPreview();
  }
  function flipCalc() {
    if (!flip || flip.bust) return 0;
    let s = flip.numbers.reduce((a, b) => a + b, 0);
    if (flip.x2) s *= 2;
    s += flip.mods.reduce((a, b) => a + b, 0);
    if (flip.numbers.length === 7) s += 15;
    return s;
  }
  function flipToggle(kind, val) {
    if (!flip) return;
    const tog = (arr, x) => { const i = arr.indexOf(x); i >= 0 ? arr.splice(i, 1) : arr.push(x); };
    if (kind === 'n') { tog(flip.numbers, val); byId('f7n' + val).classList.toggle('active', flip.numbers.includes(val)); }
    if (kind === 'm') { tog(flip.mods, val); byId('f7m' + val).classList.toggle('active', flip.mods.includes(val)); }
    if (kind === 'x2') { flip.x2 = !flip.x2; byId('f7x2').classList.toggle('active', flip.x2); }
    if (kind === 'bust') { flip.bust = !flip.bust; byId('f7bust').classList.toggle('active', flip.bust); }
    updateGenericPreview();
  }
  function genericDetailedDeltas() {
    const g = gameById(currentGame.type), idx = scoringPlayer, v = currentGame.version || '';
    const form = byId('gen-form');
    switch (g.id) {
      case 'flip7': return { deltas: onlyFor(idx, flipCalc()), detail: { ...flip } };
      case '7wonders': case 'carcassonne': {
        const fields = (form.dataset.fields || '').split(',').filter(Boolean);
        const parts = Object.fromEntries(fields.map((f) => [f, num(f)]));
        return { deltas: onlyFor(idx, Object.values(parts).reduce((a, b) => a + b, 0)), detail: parts };
      }
      case 'ohhell': {
        const bid = num('oh-bid'), took = num('oh-tricks'), exact = bid === took;
        const pts = /1 per trick/.test(v) ? took + (exact ? 10 : 0) : (exact ? 10 + bid : 0);
        return { deltas: onlyFor(idx, pts), detail: { bid, took } };
      }
      case 'hearts': {
        if (checked('h-moon')) return { deltas: currentGame.players.map((_, i) => (i === idx ? 0 : 26)), detail: { moon: true } };
        const pts = Math.max(0, Math.min(13, num('h-hearts'))) + (checked('h-queen') ? 13 : 0) - (checked('h-jack') ? 10 : 0);
        return { deltas: onlyFor(idx, pts), detail: { hearts: num('h-hearts'), queen: checked('h-queen'), jack: checked('h-jack') } };
      }
      case 'nertz': {
        const pts = num('n-played') - 2 * num('n-left') + (checked('n-called') ? 10 : 0);
        return { deltas: onlyFor(idx, pts), detail: { played: num('n-played'), left: num('n-left'), called: checked('n-called') } };
      }
      default: return { deltas: onlyFor(idx, num('simple-pts')), detail: null };
    }
  }
  function updateGenericPreview() {
    const el = byId('gen-preview');
    if (!el || scoringPlayer === null) return;
    const { deltas } = genericDetailedDeltas();
    const name = currentGame.players[scoringPlayer].name;
    if (currentGame.type === 'hearts' && checked('h-moon')) el.textContent = `${name} shot the moon: everyone else +26`;
    else el.textContent = `This round: ${signed(deltas[scoringPlayer])}` + (currentGame.type === 'flip7' && flip && flip.numbers.length === 7 && !flip.bust ? ' (includes Flip 7 +15)' : '');
  }
  function commitSimplePoints() {
    if (!currentGame || scoringPlayer === null) return;
    commitRound(onlyFor(scoringPlayer, num('simple-pts')), 'simple');
  }
  function commitGenericDetailed() {
    if (!currentGame || scoringPlayer === null) return;
    const { deltas, detail } = genericDetailedDeltas();
    commitRound(deltas, 'detailed', detail);
    const g = gameById(currentGame ? currentGame.type : 'other');
    if (currentGame && currentGame.target && currentGame.players.some((p) => p.score >= currentGame.target)) {
      const t = byId('gen-sub'); if (t) t.textContent += isLowGame(currentGame) ? ' · Target reached — lowest score wins' : ' · Target reached!';
    }
  }

  // ----- Flip 7 (coastal teal + cream card theme, modeled on the Flip 7 app) -----
  const F7_COLORS = { 0: '#111827', 1: '#a68a6d', 2: '#d4c23a', 3: '#d93855', 4: '#5fa89d', 5: '#4ea649', 6: '#8b2c7c',
    7: '#b84a48', 8: '#7fb539', 9: '#e68a2e', 10: '#cf3327', 11: '#6a93b8', 12: '#8b7a5e' };
  const F7_MODS = [2, 4, 6, 8, 10];
  const F7_TARGETS = [150, 200, 300];
  const isFlip7 = () => !!(currentGame && currentGame.type === 'flip7');
  let f7 = null; // drawer state: { numbers:[], x2, mods:[], bust, mode:'cards'|'num', manual:'' }
  const f7Laurel = (() => {
    const leaves = (side) => {
      const out = [];
      for (let k = 0; k < 5; k++) {
        const a = (200 + k * 28) * Math.PI / 180, r = 14.5;
        const x = 20 + side * Math.cos(a) * r * -1, y = 19 - Math.sin(a) * r * -1;
        const rot = side > 0 ? (k * 28 - 60) : (60 - k * 28);
        out.push(`<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="2.1" ry="4.3" transform="rotate(${rot} ${x.toFixed(1)} ${y.toFixed(1)})"/>`);
      }
      return out.join('');
    };
    return `<svg viewBox="0 0 40 36" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M14 32.5C7 30 4 23.5 5.5 15.5"/><path d="M26 32.5C33 30 36 23.5 34.5 15.5"/></g><g fill="currentColor">${leaves(-1)}${leaves(1)}</g></svg>`;
  })();
  const f7Trophy = '<svg viewBox="0 0 24 24" aria-label="Reaches target"><path d="M7 3h10v3h3v2a4 4 0 0 1-4 4h-.4A5 5 0 0 1 13 14.8V17h3v3H8v-3h3v-2.2A5 5 0 0 1 8.4 12H8a4 4 0 0 1-4-4V6h3zm0 5V8H6a2 2 0 0 0 1 1.7zm10 0v1.7A2 2 0 0 0 18 8z" fill="#f97316" stroke="#223266" stroke-width=".9"/></svg>';
  const f7Check = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  function f7Target() { return Number(currentGame && currentGame.target) || 200; }
  function f7Ranks() {
    const ps = currentGame.players;
    return ps.map((p) => 1 + ps.filter((q) => q.score > p.score).length);
  }
  function f7Round() {
    const n = currentGame.players.length; if (!n) return 1;
    const counts = currentGame.players.map((_, i) => currentGame.rounds.filter((r) => r.mode === 'flip7' && r.detail && r.detail.player === i).length);
    return Math.min(...counts) + 1;
  }
  function renderFlip7() {
    const t = f7Target();
    currentGame.players.forEach((p) => { p.flip7Count = Number(p.flip7Count) || 0; });
    byId('f7-target').innerHTML = `${t} <small>PTS</small>`;
    const d = new Date(currentGame.startTime || Date.now());
    byId('f7-date').textContent = `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase()} · RD ${f7Round()}`;
    const sortTurn = currentGame.f7sort === 'turn';
    byId('f7-sort').innerHTML = `<span>⇅</span>${sortTurn ? 'Turn Order' : 'Top Score'}`;
    byId('f7-sort').dataset.sort = sortTurn ? 'turn' : 'score';
    byId('f7-undo').disabled = !currentGame.rounds.length;
    const ranks = f7Ranks();
    const list = currentGame.players.map((p, idx) => ({ ...p, idx, rank: ranks[idx] }));
    if (!sortTurn) list.sort((a, b) => (b.score - a.score) || (a.idx - b.idx));
    byId('f7-board').innerHTML = list.map((p) => {
      const sel = p.idx === scoringPlayer, won = p.score >= t, pct = Math.max(0, Math.min(100, p.score / t * 100));
      const laurel = p.rank <= 3 && p.score > 0;
      return `<div class="f7-row${sel ? ' selected' : ''}" data-player-idx="${p.idx}" role="option" aria-selected="${sel}" tabindex="0"
          onclick="f7Select(${p.idx})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();f7Select(${p.idx})}">
          <div class="f7-rank${laurel ? ' laurel' : ' plain'}" data-rank="${p.rank}">${laurel ? f7Laurel : ''}<b>${p.rank}</b></div>
          <div class="f7-name">${esc(p.name)}</div>
          <div class="f7-right">
            ${p.flip7Count > 0 ? `<span class="f7-sevens" aria-label="${p.flip7Count} Flip 7 bonuses"><span class="f7-seven">7</span>× ${p.flip7Count}</span><span class="f7-div" aria-hidden="true"></span>` : ''}
            <span class="f7-score${won ? ' won' : ''}">${p.score}</span>
          </div>
          <div class="f7-bar" aria-hidden="true"><i class="${pct >= 100 ? 'full' : ''}" style="width:${pct.toFixed(1)}%"></i></div>
        </div>`;
    }).join('');
    const anyWon = currentGame.players.some((p) => p.score >= t);
    setHidden(byId('f7-finish'), !anyWon || scoringPlayer !== null);
    byId('f7-board').classList.toggle('scoring', scoringPlayer !== null);
    setHidden(byId('f7-hint'), scoringPlayer !== null);
    renderF7Drawer();
  }
  function f7Select(idx) {
    if (!isFlip7() || !currentGame.players[idx]) return;
    if (scoringPlayer !== idx || !f7) f7 = { numbers: [], x2: false, mods: [], bust: false, mode: (f7 && f7.mode) || 'cards', manual: '' };
    scoringPlayer = idx;
    renderFlip7();
    try { if (navigator.vibrate) navigator.vibrate(6); } catch (e) { /* ignore */ }
    requestAnimationFrame(() => { const d = byId('f7-drawer'); if (d && d.scrollIntoView) d.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); });
  }
  function f7Calc() {
    if (!f7) return { total: 0, numberSum: 0, multiplied: 0, modSum: 0, flip7Bonus: 0 };
    if (f7.mode === 'num') { const v = Number(f7.manual) || 0; return { total: f7.bust ? 0 : v, manual: v, numberSum: 0, multiplied: 0, modSum: 0, flip7Bonus: 0 }; }
    const numberSum = f7.numbers.reduce((a, b) => a + b, 0);
    const multiplied = f7.x2 ? numberSum * 2 : numberSum;
    const modSum = f7.mods.reduce((a, b) => a + b, 0);
    const flip7Bonus = new Set(f7.numbers).size >= 7 ? 15 : 0;
    return { total: f7.bust ? 0 : multiplied + modSum + flip7Bonus, numberSum, multiplied, modSum, flip7Bonus };
  }
  function renderF7Preview() {
    const el = byId('f7-preview'); if (!el || scoringPlayer === null || !f7) return;
    const p = currentGame.players[scoringPlayer], c = f7Calc(), next = p.score + c.total;
    const minis = f7.mode === 'cards' ? [...f7.numbers].sort((a, b) => a - b).map((n) => `<span class="f7-mini" style="color:${F7_COLORS[n]}">${n}</span>`).join('') : '';
    const chips = f7.mode === 'cards'
      ? (f7.x2 ? '<span class="f7-chip">×2</span>' : '') + [...f7.mods].sort((a, b) => a - b).map((m) => `<span class="f7-chip mod">+${m}</span>`).join('') + (c.flip7Bonus && !f7.bust ? '<span class="f7-chip flip7" id="f7-bonus">FLIP 7 +15!</span>' : '')
      : (f7.manual !== '' ? `<span class="f7-chip">Manual ${esc(f7.manual)}</span>` : '');
    el.innerHTML = `
      <div class="f7-pv-top">
        <div><div class="f7-pv-name">${esc(p.name)}</div>
          <div class="f7-pv-trans" id="f7-pv-trans">${p.score} → ${next}${next >= f7Target() ? f7Trophy : ''}</div></div>
        <div class="f7-pv-total${f7.bust ? ' bust' : ''}" id="f7-preview-total">${f7.bust ? 'BUST · 0' : '+' + c.total}</div>
      </div>
      <div class="f7-pv-cards">${minis ? `<span class="f7-minis">${minis}</span>` : ''}${chips}${!minis && !chips ? `<span class="f7-pv-empty">${f7.mode === 'cards' ? 'Tap the cards they flipped' : 'Type the round score'}</span>` : ''}</div>`;
  }
  function renderF7Drawer() {
    const d = byId('f7-drawer');
    if (scoringPlayer === null || !currentGame.players[scoringPlayer]) { setHidden(d, true); d.innerHTML = ''; return; }
    if (!f7) f7 = { numbers: [], x2: false, mods: [], bust: false, mode: 'cards', manual: '' };
    setHidden(d, false);
    const cards = f7.mode === 'cards';
    const key = (id, label, cls, color, on, fn) => `<button type="button" class="f7-key${cls ? ' ' + cls : ''}${on ? ' on' : ''}" id="${id}" style="color:${color}" aria-pressed="${on}" onclick="${fn}">${label}</button>`;
    const grid = cards
      ? `<div class="f7-grid" id="f7-cards">
          ${Object.keys(F7_COLORS).map(Number).map((n) => key('f7-key-n' + n, n, '', F7_COLORS[n], f7.numbers.includes(n), `f7Toggle('n',${n})`)).join('')}
          ${key('f7-key-x2', '×2', 'wide', '#223266', f7.x2, "f7Toggle('x2')")}
          ${F7_MODS.map((m) => key('f7-key-m' + m, '+' + m, 'mod', '#c84b31', f7.mods.includes(m), `f7Toggle('m',${m})`)).join('')}
        </div>`
      : `<div class="f7-nums" id="f7-numpad">${['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map((k) =>
          `<button type="button" class="f7-num${/\d/.test(k) ? '' : ' fn'}" id="f7-num-${k === '⌫' ? 'back' : k}" onclick="f7Num('${k}')">${k}</button>`).join('')}</div>`;
    d.innerHTML = `
      <div class="f7-preview" id="f7-preview" aria-live="polite"></div>
      <div class="f7-pad">
        <div class="f7-pad-head">
          <button type="button" class="f7-x" id="f7-cancel" aria-label="Cancel" onclick="f7Close()">✕</button>
          <div class="f7-pad-mid">
            <button type="button" class="f7-tog" id="f7-mode" onclick="f7SetMode('${cards ? 'num' : 'cards'}')">${cards ? '123' : 'CARDS'}</button>
            <button type="button" class="f7-tog bust${f7.bust ? ' on' : ''}" id="f7-bust" aria-pressed="${f7.bust}" onclick="f7Toggle('bust')">BUST</button>
          </div>
          <button type="button" class="f7-ok" id="f7-confirm" aria-label="Confirm round score" onclick="f7Confirm()">${f7Check}</button>
        </div>
        ${grid}
      </div>`;
    renderF7Preview();
  }
  function f7Toggle(kind, val) {
    if (!f7) return;
    const tog = (arr, x) => { const i = arr.indexOf(x); i >= 0 ? arr.splice(i, 1) : arr.push(x); };
    if (kind === 'n') tog(f7.numbers, val);
    if (kind === 'm') tog(f7.mods, val);
    if (kind === 'x2') f7.x2 = !f7.x2;
    if (kind === 'bust') f7.bust = !f7.bust;
    const set = (id, on) => { const b = byId(id); if (b) { b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); } };
    if (kind === 'n') set('f7-key-n' + val, f7.numbers.includes(val));
    if (kind === 'm') set('f7-key-m' + val, f7.mods.includes(val));
    if (kind === 'x2') set('f7-key-x2', f7.x2);
    if (kind === 'bust') set('f7-bust', f7.bust);
    try { if (navigator.vibrate) navigator.vibrate(4); } catch (e) { /* ignore */ }
    renderF7Preview();
  }
  function f7SetMode(m) { if (!f7) return; f7.mode = m === 'num' ? 'num' : 'cards'; renderF7Drawer(); }
  function f7Num(k) {
    if (!f7) return;
    if (k === 'C') f7.manual = '';
    else if (k === '⌫') f7.manual = f7.manual.slice(0, -1);
    else if (f7.manual.length < 3) f7.manual = (f7.manual === '0' ? '' : f7.manual) + k;
    renderF7Preview();
  }
  function f7Close() { scoringPlayer = null; f7 = null; renderFlip7(); }
  function f7Snapshot() { return currentGame.players.map((p) => Number(p.flip7Count) || 0); }
  function f7Confirm() {
    if (!isFlip7() || scoringPlayer === null || !f7) return null;
    const idx = scoringPlayer, c = f7Calc();
    const detail = f7.mode === 'num'
      ? { player: idx, manual: true, value: c.manual, bust: f7.bust, total: c.total, flip7: false }
      : { player: idx, numbers: [...f7.numbers].sort((a, b) => a - b), x2: f7.x2, mods: [...f7.mods].sort((a, b) => a - b), bust: f7.bust,
          numberSum: c.numberSum, modSum: c.modSum, flip7Bonus: f7.bust ? 0 : c.flip7Bonus, total: c.total, flip7: !f7.bust && c.flip7Bonus > 0 };
    const prev = currentGame.players.map((p) => p.score), prevF7 = f7Snapshot();
    currentGame.players[idx].score += c.total;
    if (detail.flip7) currentGame.players[idx].flip7Count = (Number(currentGame.players[idx].flip7Count) || 0) + 1;
    currentGame.rounds.push({ ts: new Date().toISOString(), by: idx, mode: 'flip7', prev, prevF7, deltas: currentGame.players.map((p, i) => p.score - prev[i]), detail });
    scoringPlayer = null; f7 = null;
    persistActive(); saveCache();
    renderFlip7();
    return detail;
  }
  function f7Undo() { const r = undoLastRound(); return r; }
  function f7ToggleSort() { if (!isFlip7()) return; currentGame.f7sort = currentGame.f7sort === 'turn' ? 'score' : 'turn'; persistActive(); renderFlip7(); }
  function f7OpenSheet(kind) {
    if (!isFlip7()) return;
    const s = byId('f7-sheet'), t = f7Target();
    if (kind === 'add') {
      s.innerHTML = `<div class="f7-sheet-card" role="dialog" aria-label="Add player">
          <h3>Add Player</h3>
          <input type="text" id="f7-new-player" placeholder="Player name" autocomplete="off" maxlength="24" onkeydown="if(event.key==='Enter'){event.preventDefault();f7AddPlayer()}">
          <button type="button" class="f7-sbtn primary" id="f7-add-confirm" onclick="f7AddPlayer()">Add to game</button>
          <button type="button" class="f7-sbtn" onclick="f7CloseSheet()">Cancel</button>
        </div>`;
    } else {
      s.innerHTML = `<div class="f7-sheet-card" role="dialog" aria-label="Game options">
          <h3>Game Options</h3>
          <div class="f7-sheet-lbl">Target score</div>
          <div class="f7-targets">${F7_TARGETS.map((v) => `<button type="button" class="f7-tgt${v === t ? ' on' : ''}" id="f7-tgt-${v}" onclick="f7SetTarget(${v})">${v}</button>`).join('')}</div>
          <button type="button" class="f7-sbtn primary" id="f7-opt-finish" onclick="f7CloseSheet();openEndGameModal()"><svg class="v24-2-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 4h8v5a4 4 0 0 1-8 0V4z"/><path d="M8 6H5a3 3 0 0 0 3 4"/><path d="M16 6h3a3 3 0 0 1-3 4"/><path d="M12 13v4"/><path d="M8.5 20h7"/><path d="M10 17h4v3h-4z"/></svg><span>Finish &amp; Save Game</span></button>
          <button type="button" class="f7-sbtn danger" id="f7-opt-reset" onclick="f7ResetScores()">↻ Reset Scores</button>
          <button type="button" class="f7-sbtn danger" id="f7-opt-discard" onclick="f7CloseSheet();openEndGameModal()">Discard Game</button>
          <button type="button" class="f7-sbtn" onclick="f7CloseSheet()">Close</button>
        </div>`;
    }
    setHidden(s, false);
    if (kind === 'add') setTimeout(() => { const i = byId('f7-new-player'); if (i) i.focus(); }, 30);
  }
  function f7CloseSheet() { const s = byId('f7-sheet'); if (s) { setHidden(s, true); s.innerHTML = ''; } }
  function f7SetTarget(v) {
    if (!isFlip7() || !F7_TARGETS.includes(v)) return;
    currentGame.target = v; persistActive(); renderFlip7();
    document.querySelectorAll('#f7-sheet .f7-tgt').forEach((b) => b.classList.toggle('on', b.id === 'f7-tgt-' + v));
  }
  function f7AddPlayer() {
    const i = byId('f7-new-player'); const name = ((i && i.value) || '').trim();
    if (!name || !isFlip7()) return;
    if (currentGame.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) { i.value = ''; i.placeholder = 'Already playing'; return; }
    currentGame.players.push({ name, score: 0, flip7Count: 0 });
    if (!players.some((p) => p.toLowerCase() === name.toLowerCase())) { players.push(name); saveData(); }
    persistActive(); f7CloseSheet(); renderFlip7();
  }
  function f7ResetScores() {
    if (!isFlip7()) return;
    if (!currentGame.players.some((p) => p.score || p.flip7Count)) { f7CloseSheet(); return; }
    if (!confirm('Reset every player to 0? (You can Undo this.)')) return;
    const prev = currentGame.players.map((p) => p.score), prevF7 = f7Snapshot();
    currentGame.players.forEach((p) => { p.score = 0; p.flip7Count = 0; });
    currentGame.rounds.push({ ts: new Date().toISOString(), by: null, mode: 'reset', prev, prevF7, deltas: prev.map((s) => -s), detail: { reset: true } });
    scoringPlayer = null; f7 = null; persistActive(); f7CloseSheet(); renderFlip7();
  }

  // ----- Catan (wood + parchment theme, layout from the approved rendering) -----
  const CG_SHIELDS = ['red', 'green', 'blue', 'purple'];
  const CG_ICONS = { settlements: 'icon-settlements.svg', cities: 'icon-cities.svg', longestRoad: 'icon-road.svg', largestArmy: 'icon-army.svg', vpCards: 'icon-vpcard.svg' };
  const CG_ASSET = './assets/catan/';
  const UNIQUE_CATS = ['longestRoad', 'largestArmy'];
  const cgStar = '<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#cg-star"/></svg>';
  const cgCrown = '<svg class="cg-crown" viewBox="0 0 24 24" aria-label="Winner"><use href="#cg-crown"/></svg>';
  function cgSelected() {
    if (!isCatan() || !currentGame.players.length) return null;
    if (scoringPlayer === null || !currentGame.players[scoringPlayer]) scoringPlayer = 0;
    return scoringPlayer;
  }
  function cgFeedback(selectors) {
    try { if (navigator.vibrate) navigator.vibrate(12); } catch (e) { /* ignore */ }
    requestAnimationFrame(() => (selectors || []).forEach((sel) => document.querySelectorAll(sel).forEach((el) => {
      const cls = el.classList.contains('cg-act') ? 'cg-flash' : 'cg-pulse';
      el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
    })));
  }
  let cgToastTimer = null;
  function cgToast(msg) {
    const t = byId('cg-toast'); if (!t) return;
    t.textContent = msg; t.classList.add('show');
    clearTimeout(cgToastTimer); cgToastTimer = setTimeout(() => t.classList.remove('show'), 1600);
  }
  // Every Catan change is one undoable round that snapshots scores + breakdowns.
  function commitCatan(mutate, mode, detail) {
    const prev = currentGame.players.map((p) => p.score);
    const prevBd = currentGame.players.map((p) => ({ ...emptyBreakdown(), ...(p.breakdown || {}) }));
    currentGame.players.forEach((p) => { p.breakdown = { ...emptyBreakdown(), ...(p.breakdown || {}) }; });
    mutate(currentGame.players);
    currentGame.players.forEach((p) => { p.score = Math.max(0, Number(p.score) || 0); });
    const deltas = currentGame.players.map((p, i) => p.score - prev[i]);
    if (deltas.every((d) => d === 0) && JSON.stringify(prevBd) === JSON.stringify(currentGame.players.map((p) => p.breakdown))) return false;
    currentGame.rounds.push({ ts: new Date().toISOString(), by: scoringPlayer, mode, prev, prevBd, deltas, detail: detail || null });
    persistActive();
    renderCatan();
    return true;
  }
  function renderCatan() {
    const t = currentGame.targetVp || 10;
    byId('catan-title').textContent = 'Score Tracker';
    byId('catan-sub').textContent = `FIRST TO ${t} VICTORY POINTS`;
    cgSelected();
    renderCatanLeaderboard();
    renderCatanPad();
    renderCatanActions();
    const u = byId('btn-undo'); if (u) u.disabled = !currentGame.rounds.length;
  }
  function renderCatanLeaderboard() {
    const t = currentGame.targetVp || 10;
    const sorted = currentGame.players.map((p, idx) => ({ ...p, idx })).sort((a, b) => (b.score - a.score) || (a.idx - b.idx));
    byId('leaderboard').innerHTML = sorted.map((p) => {
      const win = p.score >= t, sel = p.idx === scoringPlayer;
      const n = Math.max(0, p.score);
      return `<div class="cg-row${sel ? ' selected' : ''}${win ? ' winner' : ''}" data-player-idx="${p.idx}" data-color="${CG_SHIELDS[p.idx % CG_SHIELDS.length]}" role="option" aria-selected="${sel}" tabindex="0"
          onclick="selectCatanPlayer(${p.idx})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();selectCatanPlayer(${p.idx})}">
          <img class="cg-shield" src="${CG_ASSET}shield-${CG_SHIELDS[p.idx % CG_SHIELDS.length]}.svg" alt="" width="44" height="47" draggable="false">
          <div class="cg-name">${esc(p.name)}${win ? cgCrown : ''}</div>
          <div class="cg-stars${n > 10 ? ' xs' : n > 8 ? ' sm' : n > 6 ? ' md' : ''}" aria-label="${n} stars">${cgStar.repeat(n)}</div>
          <div class="cg-vp vp-num" data-vp="${p.idx}">${p.score}</div>
        </div>`;
    }).join('');
  }
  function renderCatanPad() {
    const idx = scoringPlayer, p = idx === null ? null : currentGame.players[idx];
    byId('adj-val').textContent = p ? String(p.score) : '0';
    byId('pad-player-banner').innerHTML = p ? `Selected: <b>${esc(p.name)}</b>` : 'Selected: —';
    byId('catan-minus').disabled = !p || p.score <= 0;
    byId('catan-plus').disabled = !p;
  }
  function renderCatanActions() {
    const p = scoringPlayer === null ? null : currentGame.players[scoringPlayer];
    byId('score-form').innerHTML = CATAN_CATS.map((c) => {
      const have = p && p.breakdown ? (p.breakdown[c.key] || 0) : 0;
      const held = UNIQUE_CATS.includes(c.key) && have > 0;
      return `<button type="button" class="cg-act${held ? ' held' : ''}" data-cat="${c.key}" onclick="catanAction('${c.key}')" aria-label="${c.label}: add ${c.vp} VP">
          <img class="cg-act-ic" src="${CG_ASSET}${CG_ICONS[c.key]}" alt="" width="70" height="46" draggable="false">
          <span class="cg-act-txt"><span class="cg-act-title">${c.label}</span><span class="cg-act-vp">+${c.vp} VP${have ? `<span class="cg-act-count">${held ? '· held' : '· ×' + have}</span>` : ''}</span></span>
          <span class="cg-act-chev" aria-hidden="true"><svg viewBox="0 0 12 18"><path d="M2.5 2.5l7 6.5-7 6.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
        </button>`;
    }).join('');
  }
  function selectCatanPlayer(idx) {
    if (!isCatan() || !currentGame.players[idx]) return;
    scoringPlayer = idx;
    renderCatanLeaderboard(); renderCatanPad(); renderCatanActions();
    try { if (navigator.vibrate) navigator.vibrate(6); } catch (e) { /* ignore */ }
  }
  function catanStep(d) {
    const idx = cgSelected(); if (idx === null) return;
    const ok = commitCatan((ps) => { ps[idx].score += d; }, 'simple', { player: idx, step: d });
    if (ok) cgFeedback([`.cg-vp[data-vp="${idx}"]`, '#adj-val']);
  }
  function catanAction(key) {
    const c = CATAN_CATS.find((x) => x.key === key); const idx = cgSelected();
    if (!c || idx === null) return;
    const me = currentGame.players[idx];
    if (UNIQUE_CATS.includes(key) && (me.breakdown || {})[key] > 0) { cgToast(`${me.name} already holds ${c.label}`); return; }
    let from = null;
    const ok = commitCatan((ps) => {
      if (UNIQUE_CATS.includes(key)) {
        ps.forEach((q, i) => { if (i !== idx && (q.breakdown[key] || 0) > 0) { from = i; q.breakdown[key] = 0; q.score -= c.vp; } });
      }
      ps[idx].breakdown[key] = (ps[idx].breakdown[key] || 0) + 1;
      ps[idx].score += c.vp;
    }, 'detailed', { player: idx, breakdown: { [key]: 1 } });
    if (!ok) return;
    cgFeedback([`.cg-vp[data-vp="${idx}"]`, '#adj-val', `.cg-act[data-cat="${key}"]`].concat(from !== null ? [`.cg-vp[data-vp="${from}"]`] : []));
    cgToast(`+${c.vp} VP ${me.name} · ${c.label}${from !== null ? ` (from ${currentGame.players[from].name})` : ''}`);
  }
  function resetCatanScores() {
    if (!isCatan() || !currentGame.players.some((p) => p.score || Object.values(p.breakdown || {}).some(Boolean))) { cgToast('Scores are already 0'); return; }
    if (!confirm('Reset every player to 0 VP? (You can Undo this.)')) return;
    commitCatan((ps) => ps.forEach((p) => { p.score = 0; p.breakdown = emptyBreakdown(); }), 'reset', { reset: true });
    cgFeedback(['.cg-vp']);
    cgToast('Scores reset');
  }


  // ----- Carcassonne (sunlit meadow + stitched parchment final-score tally) -----
  const CC_COLORS = [
    { key: 'blue', label: 'Blue', hex: '#1d5bbf' }, { key: 'red', label: 'Red', hex: '#c72b2b' },
    { key: 'green', label: 'Green', hex: '#3a8a34' }, { key: 'yellow', label: 'Yellow', hex: '#dfa418' },
    { key: 'black', label: 'Black', hex: '#2b2b2b' }, { key: 'pink', label: 'Pink', hex: '#d64b8a' }
  ];
  const ccColor = (key) => CC_COLORS.find((c) => c.key === key) || CC_COLORS[0];
  const ccClamp = (v) => { const raw = String(v ?? '').trim(), x = Number(raw); const n = Number.isFinite(x) ? Math.floor(x) : Math.floor(Number(raw.replace(/[^0-9]/g, '')) || 0); return Math.max(0, Math.min(9999, n)); };
  function ccFreeColor(game, exceptIdx, startKey) {
    const used = new Set(game.players.filter((_, i) => i !== exceptIdx).map((p) => p.color));
    const start = startKey ? CC_COLORS.findIndex((c) => c.key === startKey) : -1;
    for (let k = 1; k <= CC_COLORS.length; k++) {
      const c = CC_COLORS[(start + k + CC_COLORS.length) % CC_COLORS.length];
      if (!used.has(c.key)) return c.key;
    }
    return CC_COLORS[(start + 1 + CC_COLORS.length) % CC_COLORS.length].key;
  }
  function ccNormalize(game) {
    game.players.forEach((p, i) => {
      p.score = ccClamp(p.score);
      if (!CC_COLORS.some((c) => c.key === p.color)) p.color = ccFreeColor({ players: game.players.slice(0, i) }, -1, null);
    });
  }
  function ccLeaders() {
    if (!isCarc()) return [];
    const best = Math.max(0, ...currentGame.players.map((p) => p.score));
    return best > 0 ? currentGame.players.map((p, i) => (p.score === best ? i : -1)).filter((i) => i >= 0) : [];
  }
  const ccMeeple = (hex) => `<svg class="cc-meeple-svg" viewBox="0 0 100 104" aria-hidden="true" style="color:${hex}">
      <use href="#cc-mp" transform="translate(0 5)" fill="currentColor"/><use href="#cc-mp" transform="translate(0 5)" fill="#000" opacity=".42"/>
      <use href="#cc-mp" fill="currentColor"/><use href="#cc-mp" fill="url(#cc-shade)"/><use href="#cc-mp" fill="url(#cc-grain)" opacity=".85"/><use href="#cc-mp" fill="url(#cc-hi)"/>
      <use href="#cc-mp" fill="none" stroke="#000" stroke-opacity=".38" stroke-width="1.6"/><use href="#cc-mp" fill="none" stroke="#fff" stroke-opacity=".28" stroke-width="1.2" transform="translate(50 46) scale(.93) translate(-50 -46)"/></svg>`;
  const ccCrown = '<svg class="cc-crown" viewBox="0 0 24 24" role="img" aria-label="Leader"><use href="#cc-crown-s"/></svg>';
  let ccPickerIdx = -1;
  const ccMeepleInner = (hex) => `${ccMeeple(hex)}<span class="cc-meeple-hint" aria-hidden="true">▾</span>`;
  function ccCloseColorPicker() {
    const pop = byId('cc-color-pop');
    if (pop) pop.remove();
    document.querySelectorAll('#cc-list .cc-row.picker-open').forEach((r) => r.classList.remove('picker-open'));
    document.querySelectorAll('#cc-list .cc-meeple[aria-expanded="true"]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
    ccPickerIdx = -1;
  }
  function ccToggleColorPicker(idx, e) {
    if (e && e.stopPropagation) e.stopPropagation();
    if (!isCarc() || !currentGame.players[idx]) return false;
    if (ccPickerIdx === idx && byId('cc-color-pop')) { ccCloseColorPicker(); return false; }
    ccCloseColorPicker();
    const row = document.querySelector(`#cc-list .cc-row[data-idx="${idx}"]`);
    if (!row) return false;
    const p = currentGame.players[idx];
    const btn = row.querySelector('.cc-meeple');
    row.classList.add('picker-open');
    if (btn) btn.setAttribute('aria-expanded', 'true');
    const pop = document.createElement('div');
    pop.id = 'cc-color-pop';
    pop.className = 'cc-color-pop';
    pop.setAttribute('role', 'menu');
    pop.setAttribute('aria-label', `Choose meeple color for ${p.name}`);
    pop.innerHTML = `<div class="cc-color-pop-title">Meeple Color</div><div class="cc-swatch-grid">${CC_COLORS.map((c) => {
      const cur = p.color === c.key;
      return `<button type="button" class="cc-swatch${cur ? ' active' : ''}" role="menuitemradio" aria-checked="${cur}" data-color="${c.key}" aria-label="${c.label}" onclick="ccPickColor(${idx}, '${c.key}', event)">${ccMeeple(c.hex)}${cur ? '<span class="cc-swatch-check" aria-hidden="true">✓</span>' : ''}</button>`;
    }).join('')}</div>`;
    row.appendChild(pop);
    ccPickerIdx = idx;
    return true;
  }
  function ccPickColor(idx, colorKey, e) {
    if (e && e.stopPropagation) e.stopPropagation();
    if (!isCarc() || !currentGame.players[idx]) return null;
    if (!CC_COLORS.some((c) => c.key === colorKey)) return null;
    const p = currentGame.players[idx];
    p.color = colorKey;
    persistActive();
    ccCloseColorPicker();
    const row = document.querySelector(`#cc-list .cc-row[data-idx="${idx}"]`);
    if (row) {
      const c = ccColor(p.color), btn = row.querySelector('.cc-meeple');
      btn.dataset.color = c.key; btn.setAttribute('aria-label', `${p.name} meeple color: ${c.label}. Tap to pick color`);
      btn.innerHTML = ccMeepleInner(c.hex);
      btn.classList.remove('hop'); void btn.offsetWidth; btn.classList.add('hop');
    } else renderCarc();
    return p.color;
  }
  document.addEventListener('click', (e) => {
    if (ccPickerIdx < 0) return;
    if (e.target && e.target.closest && (e.target.closest('#cc-color-pop') || e.target.closest('.cc-meeple'))) return;
    ccCloseColorPicker();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ccPickerIdx >= 0) ccCloseColorPicker(); });
  function renderCarc() {
    ccCloseColorPicker();
    const list = byId('cc-list');
    if (!list || !isCarc()) return;
    const leaders = ccLeaders();
    list.innerHTML = currentGame.players.map((p, i) => {
      const c = ccColor(p.color);
      return `<div class="cc-row${leaders.includes(i) ? ' leader' : ''}" role="listitem" data-idx="${i}" data-player="${esc(p.name)}">
        <button type="button" class="cc-meeple" data-color="${c.key}" aria-haspopup="menu" aria-expanded="false" aria-label="${esc(p.name)} meeple color: ${c.label}. Tap to pick color" onclick="ccToggleColorPicker(${i}, event)">${ccMeepleInner(c.hex)}</button>
        <div class="cc-name-wrap"><span class="cc-name">${esc(p.name)}</span><span class="cc-crown-slot">${leaders.includes(i) ? ccCrown : ''}</span></div>
        <input class="cc-score" type="number" inputmode="numeric" pattern="[0-9]*" min="0" max="9999" step="1" enterkeyhint="${i < currentGame.players.length - 1 ? 'next' : 'done'}"
          data-idx="${i}" aria-label="${esc(p.name)} final score" placeholder="0" value="${p.score > 0 ? p.score : ''}"
          oninput="ccInput(${i}, this)" onchange="ccInput(${i}, this, true)" onfocus="this.select()" onkeydown="ccKey(event, ${i})">
      </div>`;
    }).join('');
  }
  function ccRefreshLeader() {
    const leaders = ccLeaders();
    document.querySelectorAll('#cc-list .cc-row').forEach((row) => {
      const i = Number(row.dataset.idx), on = leaders.includes(i);
      row.classList.toggle('leader', on);
      const slot = row.querySelector('.cc-crown-slot');
      if (slot && (!!slot.firstChild) !== on) slot.innerHTML = on ? ccCrown : '';
    });
  }
  function ccInput(idx, el, final) {
    if (!isCarc() || !currentGame.players[idx]) return;
    const raw = String(el && el.value != null ? el.value : '');
    const v = ccClamp(raw);
    if (el && raw !== '' && (String(v) !== raw)) el.value = String(v);
    if (el && final && v === 0) el.value = '';
    currentGame.players[idx].score = v;
    persistActive();
    ccRefreshLeader();
  }
  function ccKey(e, idx) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const next = document.querySelector(`#cc-list .cc-score[data-idx="${idx + 1}"]`);
    if (next) next.focus(); else if (e.target) e.target.blur();
  }
  function ccCycleColor(idx) {
    if (!isCarc() || !currentGame.players[idx]) return null;
    const p = currentGame.players[idx];
    p.color = ccFreeColor(currentGame, idx, p.color);
    persistActive();
    const row = document.querySelector(`#cc-list .cc-row[data-idx="${idx}"]`);
    if (row) {
      const c = ccColor(p.color), btn = row.querySelector('.cc-meeple');
      btn.dataset.color = c.key; btn.setAttribute('aria-label', `${p.name} meeple color: ${c.label}. Tap to change`);
      btn.innerHTML = ccMeepleInner(c.hex);
      btn.classList.remove('hop'); void btn.offsetWidth; btn.classList.add('hop');
    } else renderCarc();
    return p.color;
  }
  function ccShowAdd() {
    if (!isCarc()) return;
    const box = byId('cc-add'); setHidden(box, false);
    const inp = byId('cc-add-name'); if (inp) { inp.value = ''; inp.focus(); }
  }
  function ccHideAdd() { const box = byId('cc-add'); if (box && !box.hidden) setHidden(box, true); }
  function ccAddPlayer() {
    if (!isCarc()) return null;
    const inp = byId('cc-add-name');
    const name = ((inp && inp.value) || '').trim();
    if (!name) { if (inp) inp.focus(); return null; }
    if (currentGame.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) { inp.select(); return null; }
    currentGame.players.push({ name, score: 0, color: ccFreeColor(currentGame, -1, null) });
    if (!players.some((p) => p.toLowerCase() === name.toLowerCase())) { players.push(name); saveData(); }
    persistActive(); ccHideAdd(); renderCarc();
    return name;
  }
  function ccReset() {
    if (!isCarc()) return;
    if (currentGame.players.some((p) => p.score) && !confirm('Reset every score to 0?')) return;
    currentGame.players.forEach((p) => { p.score = 0; });
    persistActive(); renderCarc();
  }

  // ---------------- History ----------------
  // ----- Nertz (Midnight Parlor & Gold Foil · Solo + unlimited Partners/Teams; math lives in NertzLogic) -----
  const NZL = () => global.NertzLogic || null;
  const isNertz = () => !!(currentGame && currentGame.type === 'nertz' && NZL());
  let nzPopIdx = -1, nzSheetKind = null;
  const nzDeckSvg = '<svg class="nz-deck-svg" viewBox="0 0 48 48" aria-hidden="true"><use href="#nz-deck-filigree"/></svg>';
  function nzRoster() { return currentGame && Array.isArray(currentGame.nzRoster) ? currentGame.nzRoster : []; }
  function nzEnsure() {
    const g = currentGame, N = NZL();
    N.nzNormalize(g);
    if (!Array.isArray(g.nzDone)) g.nzDone = [];
    g.nzDone = g.nzDone.filter((i) => i >= 0 && i < g.players.length);
    if (!(g.nzSel >= 0 && g.nzSel < g.players.length)) g.nzSel = 0;
    if (!Array.isArray(g.nzRoster)) g.nzRoster = g.nertzMode === 'teams'
      ? g.players.flatMap((t) => t.partners || []) : g.players.map((p) => ({ name: p.name, userId: p.userId || null, isSelf: !!p.isSelf }));
    return g;
  }
  function nzStartGame(chosen) {
    const g = currentGame, N = NZL();
    if (!N) return;
    g.nzRoster = chosen.map((pt) => ({ name: pt.name, userId: pt.userId || null, isSelf: !!pt.isSelf }));
    N.nzNormalize(g);
    // Started from a Social Group with 4+ people → auto-pair partners into teams (Solo is one tap away).
    if (setupGroup && chosen.length >= 4) N.nzSetMode(g, 'teams', { groupMembers: g.nzRoster });
    g.nzSel = 0; g.nzDone = [];
  }
  let nzSkipSheet = false;
  function nzCommit(full) { persistActive(); if (full) renderNertz(); else { nzRenderRoster(); nzRenderScorer(true); } }
  function nzResetProgress() { currentGame.nzDone = []; currentGame.nzSel = 0; }
  function nzSpliceRounds(idx) {
    (currentGame.rounds || []).forEach((r) => ['prev', 'deltas', 'prevNertzCalls'].forEach((k) => { if (Array.isArray(r[k])) r[k].splice(idx, 1); }));
  }

  function renderNertz() {
    const g = nzEnsure(), N = NZL();
    const lead = N.nzLeaders(g), teams = g.nertzMode === 'teams';
    byId('nz-target-val').textContent = g.target;
    byId('nz-round-label').textContent = 'ROUND ' + (g.rounds.length + 1);
    [['solo', !teams], ['teams', teams]].forEach(([k, on]) => { const b = byId('nz-mode-' + k); b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on)); });
    setHidden(byId('nz-teams-bar'), !teams);
    if (teams) {
      const partners = g.players.reduce((a, t) => a + (t.partners || []).length, 0);
      byId('nz-teams-summary').textContent = `${g.players.length} teams · ${partners} partners`;
    }
    nzRenderRoster(lead);
    nzRenderScorer(false);
    byId('nz-undo').disabled = !g.rounds.length;
    byId('nz-add-btn').textContent = teams ? '+ Team' : '+ Add';
    byId('nz-finish').classList.toggle('ready', lead.reachedTarget);
    const rt = byId('nz-rounds-toggle');
    rt.textContent = g.nertzLogOpen ? 'Hide Rounds' : `Rounds${g.rounds.length ? ' (' + g.rounds.length + ')' : ''}`;
    rt.setAttribute('aria-expanded', String(!!g.nertzLogOpen));
    nzRenderDrawer();
    if (nzSheetKind && !nzSkipSheet) nzRenderSheet();
  }
  function nzRenderRoster(leadIn) {
    const g = currentGame, N = NZL(), lead = leadIn || N.nzLeaders(g), teams = g.nertzMode === 'teams';
    const sum = N.nzGetDraftSummary(g);
    const banner = lead.reachedTarget
      ? `<div class="nz-winner-banner" id="nz-winner-banner" role="status">♠ ${esc(lead.winners.map((w) => w.name).join(' & '))} ${lead.winners.length > 1 ? 'tie' : 'wins'} at ${lead.bestScore}! ♠</div>` : '';
    const rows = g.players.map((p, i) => {
      const c = N.nzColor(p.color), r = sum.rows[i] || {}, sel = i === g.nzSel, isLead = lead.leaderIndices.includes(i);
      const pending = r.touched || g.nzDone.includes(i);
      const pop = nzPopIdx === i ? `<div class="nz-color-pop" id="nz-color-pop" role="menu" aria-label="Choose deck back for ${esc(p.name)}" onclick="event.stopPropagation()">
          <div class="nz-color-pop-title">Deck Back</div><div class="nz-swatch-grid">${N.NZ_COLORS.map((k) => {
            const cur = p.color === k.key;
            return `<button type="button" class="nz-swatch${cur ? ' active' : ''}" role="menuitemradio" aria-checked="${cur}" data-deck="${k.key}" aria-label="${esc(k.label)}" onclick="nzUiPickDeck(${i}, '${k.key}', event)">${nzDeckSvg}${cur ? '<span class="nz-swatch-check" aria-hidden="true">✓</span>' : ''}</button>`;
          }).join('')}</div></div>` : '';
      const tags = `${pending ? `<span class="nz-round-tag${r.net < 0 ? ' neg' : ''}">${signed(r.net || 0)}</span>` : ''}${r.calledNertz ? '<span class="nz-nertz-badge" aria-label="Got Nertz this round">♠ NERTZ</span>' : ''}`;
      const partnerTxt = teams ? `<span class="nz-partners">${(p.partners || []).length ? esc(p.partners.map((pt) => pt.name).join(' & ')) : 'No partners yet — tap + Manage Teams'}</span>` : '';
      const partners = tags || partnerTxt ? `<div class="nz-sub-line">${tags}${partnerTxt}</div>` : '';
      return `<div class="nz-row${sel ? ' selected' : ''}${isLead ? ' leader' : ''}${r.calledNertz ? ' is-nertz-caller' : ''}${g.nzDone.includes(i) ? ' done' : ''}${nzPopIdx === i ? ' picker-open' : ''}" data-idx="${i}" data-name="${esc(p.name)}" role="option" aria-selected="${sel}" tabindex="0"
          onclick="nzUiSelect(${i})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();nzUiSelect(${i})}">
        <button type="button" class="nz-deck-btn" data-deck="${c.key}" aria-haspopup="menu" aria-expanded="${nzPopIdx === i}" aria-label="${esc(p.name)} deck back: ${esc(c.label)}. Tap to pick" onclick="nzUiToggleDeckPop(${i}, event)">${nzDeckSvg}<span class="nz-deck-caret" aria-hidden="true">▾</span></button>
        ${pop}
        <div class="nz-info">
          <div class="nz-name-row"><span class="nz-name">${esc(p.name)}</span>${isLead ? '<span class="nz-crown" aria-label="Leader">♛</span>' : ''}</div>
          ${partners}
        </div>
        <div class="nz-score${p.score < 0 ? ' neg' : ''}">${p.score}</div>
      </div>`;
    }).join('');
    const done = g.nzDone.length;
    const progress = g.players.length > 1 ? `<div class="nz-progress" id="nz-progress">${done ? `${done} of ${g.players.length} entered this round` : 'Tap a ' + (teams ? 'team' : 'player') + ' card, enter their round, then Confirm'}</div>` : '';
    byId('nz-roster').innerHTML = banner + rows + progress;
  }
  // Signed round entry: the input text is authoritative ("-12" / "14" / "-" while typing); the −/+ toggle mirrors it.
  const nzDeltaText = (v) => (v ? String(v) : '');
  function nzSignOf(text, delta) { return /^\s*-/.test(String(text || '')) || delta < 0 ? -1 : 1; }
  function nzRenderScorer(keepInputs) {
    const g = currentGame, N = NZL();
    const p = g.players[g.nzSel], d = (g.nertzDraft || {})[g.nzSel] || { delta: 0 };
    byId('nz-scorer-who').textContent = 'ROUND SCORING • ' + (p ? p.name.toUpperCase() : '—');
    const input = byId('nz-net-input');
    if (!keepInputs) input.value = nzDeltaText(d.delta);
    const sign = nzSignOf(input.value, d.delta);
    [['minus', sign < 0], ['plus', sign > 0]].forEach(([k, on]) => { const b = byId('nz-sign-' + k); b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
    input.classList.toggle('is-neg', sign < 0);
    const caller = g.nertzDraftCallerIdx === g.nzSel;
    const gb = byId('nz-got-nertz-btn'); gb.classList.toggle('is-active', caller); gb.setAttribute('aria-pressed', String(caller));
    const pv = byId('nz-preview'); pv.textContent = signed(d.delta || 0); pv.classList.toggle('is-neg', d.delta < 0);
    const remaining = g.players.filter((_, i) => i !== g.nzSel && !g.nzDone.includes(i)).length;
    const lbl = byId('nz-confirm').querySelector('span:nth-child(2)');
    if (lbl) lbl.textContent = remaining ? 'CONFIRM · NEXT' : 'CONFIRM ROUND';
  }
  function nzRenderDrawer() {
    const g = currentGame, el = byId('nz-history-drawer');
    setHidden(el, !g.nertzLogOpen);
    if (!g.nertzLogOpen) return;
    el.innerHTML = g.rounds.length ? g.rounds.map((r, k) => ({ r, k })).reverse().map(({ r, k }) => {
      const entries = (r.detail && r.detail.entries) || g.players.map((p, i) => ({ name: p.name, net: (r.deltas || [])[i] || 0 }));
      return `<div class="nz-hist-round">Round ${k + 1}</div>` + entries.map((e) =>
        `<div class="nz-hist-row${e.calledNertz ? ' is-nertz-caller' : ''}"><span>${esc(e.name)}${e.calledNertz ? ' <span class="nz-nertz-badge">♠ NERTZ</span>' : ''}</span><span class="${e.net < 0 ? 'neg' : ''}">${signed(Number(e.net ?? e.delta) || 0)}</span></div>`).join('');
    }).join('') : '<div class="nz-hist-empty">No rounds yet.</div>';
  }

  // UI actions (markup onclick hooks)
  function nzUiSelect(idx) {
    if (!isNertz() || !currentGame.players[idx]) return false;
    nzPopIdx = -1; currentGame.nzSel = idx; nzCommit(true); return true;
  }
  function nzUiSetMode(mode) {
    if (!isNertz()) return false;
    const N = NZL(), g = currentGame;
    if (g.nertzMode === mode) return true;
    let r = N.nzSetMode(g, mode, { groupMembers: nzRoster() });
    if (!r.ok && r.reason === 'rounds_exist') {
      if (!confirm('Switching between Solo and Teams starts the scores over. Continue?')) return false;
      r = N.nzSetMode(g, mode, { force: true, groupMembers: nzRoster() });
    }
    nzPopIdx = -1; nzResetProgress(); nzCommit(true); return !!r.ok;
  }
  function nzStepNet(step) {
    if (!isNertz()) return null;
    const r = NZL().nzStepDraftDelta(currentGame, currentGame.nzSel, step);
    nzCommit(false); nzRenderScorer(false); return r;
  }
  function nzSetSign(sign) {
    if (!isNertz()) return null;
    const g = currentGame, i = g.nzSel, d = g.nertzDraft[i] || { delta: 0 }, input = byId('nz-net-input');
    const mag = Math.abs(Number(d.delta) || 0), want = sign < 0 ? -1 : 1;
    const r = NZL().nzSetDraftDelta(g, i, want * mag);
    nzCommit(false);
    input.value = mag ? String(want * mag) : (want < 0 ? '-' : '');   // "-" arms negative entry for the next digit
    nzRenderScorer(true);
    return r;
  }
  function nzSyncPreview() {
    if (!isNertz()) return null;
    const g = currentGame, input = byId('nz-net-input');
    const raw = String(input.value || '').replace(/[^0-9+-]/g, '');
    const neg = /^-/.test(raw), digits = raw.replace(/[^0-9]/g, '').slice(0, 4);
    const clean = (neg ? '-' : '') + digits;
    if (clean !== input.value) input.value = clean;
    const r = NZL().nzSetDraftDelta(g, g.nzSel, (neg ? -1 : 1) * (Number(digits) || 0));
    nzCommit(false); return r;
  }
  function nzToggleGotNertz() {
    if (!isNertz()) return null;
    const c = NZL().nzToggleNertzCaller(currentGame, currentGame.nzSel);
    nzCommit(false); return c;
  }
  function nzConfirmRound() {
    if (!isNertz()) return null;
    const g = currentGame, N = NZL(), n = g.players.length, sel = g.nzSel;
    if (!g.nzDone.includes(sel)) g.nzDone.push(sel);
    let next = -1;
    for (let s = 1; s <= n; s++) { const k = (sel + s) % n; if (!g.nzDone.includes(k)) { next = k; break; } }
    if (next >= 0) { g.nzSel = next; nzCommit(true); return { next }; }
    if (!N.nzGetDraftSummary(g).hasAnyInput) N.nzSetDraftDelta(g, sel, (g.nertzDraft[sel] || {}).delta || 0);
    const round = N.nzApplyRound(g);
    nzResetProgress(); nzCommit(true);
    return round;
  }
  function nzUndo() {
    if (!isNertz()) return null;
    const r = NZL().nzUndoLastRound(currentGame);
    const caller = currentGame.nertzDraftCallerIdx; // undo restores the undone round's Nertz caller highlight
    NZL().nzClearDraft(currentGame); currentGame.nertzDraftCallerIdx = caller; nzResetProgress(); nzCommit(true); return r;
  }
  function nzToggleHistory() { if (!isNertz()) return false; NZL().nzToggleLog(currentGame); nzCommit(true); return currentGame.nertzLogOpen; }
  function nzUiToggleDeckPop(idx, e) {
    if (e && e.stopPropagation) e.stopPropagation();
    if (!isNertz() || !currentGame.players[idx]) return false;
    nzPopIdx = nzPopIdx === idx ? -1 : idx; nzRenderRoster(); return nzPopIdx === idx;
  }
  function nzUiPickDeck(idx, key, e) {
    if (e && e.stopPropagation) e.stopPropagation();
    if (!isNertz() || !NZL().nzPickColor(currentGame, idx, key)) return null;
    nzPopIdx = -1; nzCommit(true); return currentGame.players[idx].color;
  }
  function nzClosePop() { if (nzPopIdx >= 0) { nzPopIdx = -1; if (isNertz()) nzRenderRoster(); } }
  document.addEventListener('click', (e) => {
    if (nzPopIdx < 0) return;
    if (e.target && e.target.closest && (e.target.closest('#nz-color-pop') || e.target.closest('.nz-deck-btn'))) return;
    nzClosePop();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { nzClosePop(); if (nzSheetKind) nzCloseSheet(); } });

  // Sheets: target score, add player (solo), team builder (teams)
  function nzOpenSheet(kind) {
    if (!isNertz()) return false;
    nzSheetKind = kind === 'add' ? (currentGame.nertzMode === 'teams' ? 'teams' : 'add') : kind;
    nzPopIdx = -1; nzRenderSheet(); return nzSheetKind;
  }
  function nzCloseSheet() { nzSheetKind = null; const s = byId('nz-sheet'); if (s) { s.innerHTML = ''; setHidden(s, true); } }
  function nzRenderSheet() {
    const s = byId('nz-sheet'), g = currentGame, N = NZL();
    if (!s || !nzSheetKind || !isNertz()) return;
    const head = (t) => `<div class="nz-sheet-head"><h3>${t}</h3><button type="button" class="nz-sheet-close" aria-label="Close" onclick="nzCloseSheet()">✕</button></div>`;
    let body = '';
    if (nzSheetKind === 'target') {
      body = head('Target Score') + `<p class="nz-sheet-note">First to reach this score wins.</p>
        <div class="nz-field-row"><input type="number" inputmode="numeric" class="nz-field" id="nz-target-input" value="${g.target}" aria-label="Target score">
        <button type="button" class="nz-sheet-btn primary" id="nz-target-save" onclick="nzUiSaveTarget()">Save</button></div>
        <div class="nz-quick-row">${[50, 75, 100, 150, 200].map((v) => `<button type="button" class="nz-quick${v === g.target ? ' active' : ''}" onclick="nzUiSaveTarget(${v})">${v}</button>`).join('')}</div>`;
    } else if (nzSheetKind === 'add') {
      const inGame = new Set(g.players.map((p) => lc(p.name)));
      const quick = nzRoster().filter((m) => !inGame.has(lc(m.name)));
      body = head('Players') + g.players.map((p, i) => `<div class="nz-team-card" data-player="${esc(p.name)}"><div class="nz-team-head"><span class="nz-team-swatch" style="background:${N.nzColor(p.color).hex}"></span>
          <span style="flex:1">${esc(p.name)}</span>${g.players.length > 1 ? `<button type="button" class="nz-chip-x" aria-label="Remove ${esc(p.name)}" onclick="nzUiRemovePlayer(${i})">×</button>` : ''}</div></div>`).join('')
        + `<div class="nz-field-row"><input class="nz-field" id="nz-add-name" placeholder="Player name" maxlength="40" onkeydown="if(event.key==='Enter'){event.preventDefault();nzUiAddPlayer()}">
          <button type="button" class="nz-sheet-btn primary" id="nz-add-player" onclick="nzUiAddPlayer()">Add</button></div>`
        + (quick.length ? `<div class="nz-quick-row">${quick.map((m, k) => `<button type="button" class="nz-quick" onclick="nzUiAddPlayer(${k})">+ ${esc(m.name)}</button>`).join('')}</div>` : '')
        + '<button type="button" class="nz-sheet-btn wide" onclick="nzCloseSheet()">Done</button>';
    } else {
      const un = N.nzUnassignedGroupMembers(g, nzRoster());
      body = head('Partners &amp; Teams') + '<p class="nz-sheet-note">As many teams as you like — 2 or more partners each.</p>' + g.players.map((t, i) => `
        <div class="nz-team-card" data-team="${i}">
          <div class="nz-team-head"><span class="nz-team-swatch" style="background:${N.nzColor(t.color).hex}"></span>
            <input class="nz-field nz-team-name" value="${esc(t.name)}" maxlength="40" aria-label="Team name" onchange="nzUiRenameTeam(${i}, this.value)">
            ${g.players.length > 1 ? `<button type="button" class="nz-chip-x nz-team-remove" aria-label="Remove ${esc(t.name)}" onclick="nzUiRemoveTeam(${i})">×</button>` : ''}</div>
          <div class="nz-partner-chips">${(t.partners || []).map((pt, j) => `<span class="nz-partner-chip" data-partner="${esc(pt.name)}">${esc(pt.name)}${pt.isSelf ? ' (You)' : ''}
            ${g.players.length > 1 ? `<select class="nz-move-sel" aria-label="Move ${esc(pt.name)} to another team" onchange="nzUiMovePartner(${i}, ${j}, this.value)"><option value="">Move…</option>${g.players.map((o, k) => (k === i ? '' : `<option value="${k}">${esc(o.name)}</option>`)).join('')}</select>` : ''}
            <button type="button" class="nz-chip-x" aria-label="Remove ${esc(pt.name)}" onclick="nzUiRemovePartner(${i}, ${j})">×</button></span>`).join('') || '<span class="nz-sheet-note">No partners yet</span>'}</div>
          <div class="nz-field-row"><input class="nz-field nz-partner-input" id="nz-partner-input-${i}" placeholder="Add partner" maxlength="40" onkeydown="if(event.key==='Enter'){event.preventDefault();nzUiAddPartner(${i})}">
            <button type="button" class="nz-sheet-btn" onclick="nzUiAddPartner(${i})">Add</button></div>
          ${un.length ? `<div class="nz-quick-row">${un.map((m, k) => `<button type="button" class="nz-quick" onclick="nzUiAddPartner(${i}, ${k})">+ ${esc(m.name)}</button>`).join('')}</div>` : ''}
        </div>`).join('')
        + '<button type="button" class="nz-sheet-btn wide" id="nz-add-team" onclick="nzUiAddTeam()">+ Add Team</button><button type="button" class="nz-sheet-btn wide primary" onclick="nzCloseSheet()">Done</button>';
    }
    s.innerHTML = `<div class="nz-sheet-card">${body}</div>`;
    setHidden(s, false);
  }
  function nzUiSaveTarget(v) {
    if (!isNertz()) return null;
    const t = NZL().nzSetTarget(currentGame, v !== undefined ? v : (byId('nz-target-input') || {}).value);
    nzCloseSheet(); nzCommit(true); return t;
  }
  function nzUiAddPlayer(quickIdx) {
    if (!isNertz()) return null;
    const g = currentGame, inGame = new Set(g.players.map((p) => lc(p.name)));
    let raw;
    if (quickIdx !== undefined) raw = nzRoster().filter((m) => !inGame.has(lc(m.name)))[quickIdx];
    else { const el = byId('nz-add-name'); raw = el ? el.value : ''; if (el) el.value = ''; }
    const p = raw ? NZL().nzAddSoloPlayer(g, raw) : null;
    if (p && !nzRoster().some((m) => lc(m.name) === lc(p.name))) g.nzRoster.push({ name: p.name, userId: p.userId || null, isSelf: !!p.isSelf });
    nzCommit(true); return p;
  }
  function nzUiRemovePlayer(i) {
    if (!isNertz()) return false;
    if (currentGame.rounds.length && !confirm('Remove ' + currentGame.players[i].name + ' and their score?')) return false;
    const ok = NZL().nzRemoveSoloPlayer(currentGame, i);
    if (ok) { nzSpliceRounds(i); nzResetProgress(); }
    nzCommit(true); return ok;
  }
  function nzUiAddTeam() {
    if (!isNertz()) return null;
    const t = NZL().nzAddTeam(currentGame);
    nzResetProgress(); nzCommit(true); return t;
  }
  function nzUiRemoveTeam(i) {
    if (!isNertz()) return false;
    if (currentGame.rounds.length && !confirm('Remove ' + currentGame.players[i].name + ' and its score?')) return false;
    const ok = NZL().nzRemoveTeam(currentGame, i);
    if (ok) { nzSpliceRounds(i); nzResetProgress(); }
    nzCommit(true); return ok;
  }
  function nzUiRenameTeam(i, name) {
    if (!isNertz()) return false;
    const ok = NZL().nzRenameTeam(currentGame, i, name);
    // Fired from the input's change/blur: refresh the table but leave the sheet's DOM in place mid-blur.
    nzSkipSheet = true; try { nzCommit(true); } finally { nzSkipSheet = false; }
    return ok;
  }
  function nzUiAddPartner(i, quickIdx) {
    if (!isNertz()) return null;
    let raw;
    if (quickIdx !== undefined) raw = NZL().nzUnassignedGroupMembers(currentGame, nzRoster())[quickIdx];
    else { const el = byId('nz-partner-input-' + i); raw = el ? el.value : ''; }
    const p = raw ? NZL().nzAddPartner(currentGame, i, raw) : null;
    if (p && !nzRoster().some((m) => lc(m.name) === lc(p.name))) currentGame.nzRoster.push({ ...p });
    nzCommit(true); return p;
  }
  function nzUiRemovePartner(i, j) { if (!isNertz()) return false; const ok = NZL().nzRemovePartner(currentGame, i, j); nzCommit(true); return ok; }
  function nzUiMovePartner(i, j, to) {
    if (!isNertz() || to === '' || to === undefined) return false;
    const ok = NZL().nzMovePartner(currentGame, i, j, Number(to)); nzCommit(true); return ok;
  }

  // ----- 7 Wonders (Illuminated Papyrus Ledger · 3–7 players · category-by-category; math lives in SevenWondersLogic) -----
  const SWL = () => global.SevenWondersLogic || null;
  const isSw = () => !!(currentGame && currentGame.type === '7wonders' && SWL());
  const SW_TITLES = { military: 'Military Conflicts', treasury: 'Treasury', wonder: 'Wonder Stages', civilian: 'Civilian Structures', commercial: 'Commercial Structures',
    guilds: 'Guilds', science: 'Science', leaders: 'Leaders', cities: 'Cities', armada: 'Armada' };
  const SW_HINTS = { military: 'Sum victory & defeat tokens (negative allowed)', treasury: 'Enter raw coins: every 3 coins = 1 VP (coins break ties)', wonder: 'VP from built Wonder stages',
    civilian: 'Blue structure VP', commercial: 'Yellow structure VP', guilds: 'Purple guild VP', science: 'Tablets, Compasses, Gears & Wilds: optimal VP is automatic',
    leaders: 'White Leaders card VP', cities: 'Black Cities VP & Debt tokens (negative allowed)', armada: 'Naval conflicts, fleets & islands (negative allowed)' };
  const SW_SCI = [['tablets', 'Tablet', 'sw-ico-tablet'], ['compasses', 'Compass', 'sw-ico-compass'], ['gears', 'Gear', 'sw-ico-gear'], ['wilds', 'Wild', 'sw-ico-wild']];
  let swExpOpen = false, swEditKey = null;
  const swMinus = (n) => String(n).replace(/-/g, '−');
  function swEnsure() {
    const g = currentGame;
    SWL().ensureSevenWondersState(g);
    if (!Array.isArray(g.swDone)) g.swDone = [];
    return g;
  }
  function swExpansionsFromVersion(v) {
    return { leaders: /Leaders/i.test(v || ''), cities: /Cities/i.test(v || ''), armada: /Armada/i.test(v || '') };
  }
  function swStartGame() {
    const base = currentGame;
    const sw = SWL().createSevenWondersGame(base.players, { id: base.id, startTime: base.startTime, groupId: base.groupId || null, groupName: base.groupName || null,
      expansions: base.v22Expansions || swExpansionsFromVersion(base.version) });
    Object.assign(base, sw, { id: base.id, version: base.version, target: null, swDone: [] });
    swExpOpen = false; swEditKey = null;
  }
  function swCommit() { persistActive(); renderSevenWonders(); }
  function swMarkDone(cat) { const g = currentGame; if (cat && !g.swDone.includes(cat)) g.swDone.push(cat); }
  function swLaurel() { return '<svg class="sw-lb-laurel" viewBox="0 0 24 24" role="img" aria-label="Leader"><use href="#sw-ico-laurel"/></svg>'; }
  function renderSevenWonders() {
    const g = swEnsure(), L = SWL(), cats = L.swGetActiveCategories(g), cat = g.activeCategory, idx = Math.max(0, cats.indexOf(cat));
    const shell = byId('sw-shell'); if (!shell) return;
    shell.dataset.cat = cat;
    // Expansions drawer
    const bar = byId('sw-exp-bar'); setHidden(bar, !swExpOpen);
    const tgl = byId('sw-exp-toggle'); if (tgl) tgl.setAttribute('aria-expanded', String(swExpOpen));
    let onCount = 0;
    L.EXPANSION_CATEGORIES.forEach((k) => {
      const on = !!g.expansions[k]; if (on) onCount++;
      const cb = byId('sw-exp-' + k); if (cb) { cb.checked = on; const chip = cb.closest('.sw-exp-chip'); if (chip) chip.classList.toggle('is-on', on); }
    });
    const badge = byId('sw-exp-badge'); if (badge) { badge.textContent = onCount ? String(onCount) : ''; setHidden(badge, !onCount); }
    swRenderLeaderboard();
    // Category tabs
    document.querySelectorAll('#sw-cat-tabs .sw-cat-tab').forEach((t) => {
      const k = t.dataset.cat, shown = cats.includes(k), active = k === cat;
      t.hidden = !shown;
      t.classList.toggle('is-active', active); t.setAttribute('aria-selected', String(active));
      t.classList.toggle('is-done', shown && g.swDone.includes(k) && !active);
    });
    const at = document.querySelector(`#sw-cat-tabs .sw-cat-tab[data-cat="${cat}"]`);
    if (at && at.scrollIntoView && at.parentElement) { const p = at.parentElement, l = at.offsetLeft - p.offsetLeft; if (l < p.scrollLeft || l + at.offsetWidth > p.scrollLeft + p.clientWidth) p.scrollLeft = Math.max(0, l - 16); }
    // Active category card
    const card = byId('sw-cat-card'); card.dataset.cat = cat;
    byId('sw-cat-icon').innerHTML = `<svg><use href="#sw-ico-${cat}"/></svg>`;
    byId('sw-cat-title').textContent = SW_TITLES[cat] || cat;
    byId('sw-cat-hint').textContent = SW_HINTS[cat] || '';
    byId('sw-cat-step').textContent = `${idx + 1} / ${cats.length}`;
    swRenderRows();
    // Footer
    byId('sw-btn-prev').disabled = idx === 0;
    const last = idx === cats.length - 1;
    byId('sw-btn-next').disabled = last;
    byId('sw-btn-next-label').textContent = last ? 'Last Category' : 'Next: ' + L.CATEGORY_META[cats[idx + 1]].label;
    byId('sw-btn-undo').disabled = !(g.undoStack && g.undoStack.length);
  }
  function swRenderLeaderboard() {
    const g = currentGame, ranked = SWL().swGetRankedPlayers(g), el = byId('sw-leaderboard');
    el.dataset.count = String(Math.max(3, Math.min(7, g.players.length)));
    const started = ranked.some((r) => r.score !== 0 || r.coins > 0);
    el.innerHTML = ranked.map((r) => {
      const lead = started && r.rank === 1, tied = started && ranked.filter((o) => o.score === r.score).length > 1;
      return `<div class="sw-lb-row${lead ? ' is-leader' : ''}" data-idx="${r.playerIdx}" data-name="${esc(r.name)}" data-rank="${r.rank}">
        <span class="sw-lb-rank">${r.rank}</span>
        <span class="sw-lb-name-wrap"><span class="sw-lb-name">${esc(r.name)}</span>${tied ? `<span class="sw-lb-tie" title="Tied on VP: most coins wins">${r.coins} ${r.coins === 1 ? 'coin' : 'coins'}</span>` : ''}</span>
        <span class="sw-lb-score-wrap"><span class="sw-lb-score">${swMinus(r.score)}</span>${lead ? swLaurel() : ''}</span>
      </div>`;
    }).join('');
  }
  function swRowSub(p) { return `Total ${swMinus(p.score)} VP`; }
  function swRenderRows() {
    const g = currentGame, cat = g.activeCategory, meta = SWL().CATEGORY_META[cat], el = byId('sw-player-rows');
    if (cat === 'science') {
      el.innerHTML = g.players.map((p, i) => {
        const s = SWL().swComputeScience(p.science), wa = s.wildAssignment;
        const hint = s.wilds > 0 ? 'Wild → ' + SW_SCI.slice(0, 3).filter(([k]) => wa[k] > 0).map(([k, l]) => (wa[k] > 1 ? wa[k] + '× ' : '') + l).join(', ') : '';
        return `<div class="sw-row is-science" data-idx="${i}" data-name="${esc(p.name)}">
          <div class="sw-sci-head">
            <span class="sw-row-name">${esc(p.name)}</span>
            <span class="sw-sci-summary"><span class="sw-sci-vp-pill" title="${s.squaresScore} + ${s.setsScore} (sets)">${s.vp} VP${s.isOverride ? ' · set' : ''}</span>${hint ? `<span class="sw-sci-wild-hint">${esc(hint)}</span>` : ''}</span>
            <label class="sw-sci-override-wrap"><span>Set VP</span><input class="sw-sci-override-input" type="number" inputmode="numeric" min="0" placeholder="${s.autoVp}" value="${s.isOverride ? s.override : ''}" aria-label="Override ${esc(p.name)} Science VP"
              onfocus="swBeginEdit()" oninput="swSciOverride(${i}, this.value, true)" onchange="swSciOverride(${i}, this.value)" onkeydown="if(event.key==='Enter')this.blur()"></label>
          </div>
          <div class="sw-sci-grid">${SW_SCI.map(([k, l, ico]) => `<div class="sw-sci-cell" data-sym="${k}">
            <span class="sw-sci-label"><svg aria-hidden="true"><use href="#${ico}"/></svg>${l}</span>
            <span class="sw-sci-ctrl"><button type="button" class="sw-sci-btn" aria-label="Remove ${l}" onclick="swSci(${i}, '${k}', -1)">−</button><span class="sw-sci-val">${s[k]}</span><button type="button" class="sw-sci-btn" aria-label="Add ${l}" onclick="swSci(${i}, '${k}', 1)">+</button></span>
          </div>`).join('')}</div>
        </div>`;
      }).join('');
      return;
    }
    const isCoins = cat === 'treasury';
    el.innerHTML = g.players.map((p, i) => {
      const v = Number(p.scores[cat]) || 0;
      const sub = isCoins ? `<span class="sw-coin-vp">${v} ${v === 1 ? 'coin' : 'coins'} → ${Math.floor(v / 3)} VP</span>` : `<div class="sw-row-sub">${swRowSub(p)}</div>`;
      return `<div class="sw-row${isCoins ? ' is-treasury' : ''}" data-idx="${i}" data-name="${esc(p.name)}">
        <div class="sw-row-left"><div class="sw-row-name">${esc(p.name)}</div>${sub}</div>
        <div class="sw-stepper">
          <button type="button" class="sw-step-btn" aria-label="Decrease ${esc(p.name)} ${esc(meta.label)}" onclick="swStep(${i}, -1)">−</button>
          <input class="sw-num-input" type="number" ${meta.signed ? '' : 'inputmode="numeric" min="0"'} value="${v}" aria-label="${esc(p.name)} ${esc(meta.label)}"
            onfocus="swBeginEdit();this.select()" oninput="swSetVal(${i}, this.value, true)" onchange="swSetVal(${i}, this.value)" onkeydown="if(event.key==='Enter')this.blur()">
          <button type="button" class="sw-step-btn" aria-label="Increase ${esc(p.name)} ${esc(meta.label)}" onclick="swStep(${i}, 1)">+</button>
        </div>
      </div>`;
    }).join('');
  }
  // Live partial refresh while typing (keeps focus in the input)
  function swLiveRefresh(i) {
    const g = currentGame, cat = g.activeCategory, row = document.querySelector(`#sw-player-rows .sw-row[data-idx="${i}"]`), p = g.players[i];
    swRenderLeaderboard();
    if (row && p) {
      if (cat === 'treasury') { const v = Number(p.scores.treasury) || 0, b = row.querySelector('.sw-coin-vp'); if (b) b.textContent = `${v} ${v === 1 ? 'coin' : 'coins'} → ${Math.floor(v / 3)} VP`; }
      else if (cat === 'science') { const s = SWL().swComputeScience(p.science), pill = row.querySelector('.sw-sci-vp-pill'); if (pill) pill.textContent = `${s.vp} VP${s.isOverride ? ' · set' : ''}`; }
      else { const sub = row.querySelector('.sw-row-sub'); if (sub) sub.textContent = swRowSub(p); }
    }
    byId('sw-btn-undo').disabled = !(g.undoStack && g.undoStack.length);
    persistActive();
  }
  // One undo snapshot per typing session (focus → blur), not per keystroke
  function swBeginEdit() { swEditKey = null; }
  function swTrackEdit(key, fn) {
    const g = currentGame, before = (g.undoStack || []).length, r = fn();
    if (swEditKey === key && g.undoStack.length > before) g.undoStack.pop();
    swEditKey = key;
    return r;
  }
  function swStep(i, delta) {
    if (!isSw() || !currentGame.players[i]) return null;
    const g = currentGame, cat = g.activeCategory; if (cat === 'science') return null;
    swEditKey = null;
    const r = SWL().swStepScore(g, i, cat, delta); swMarkDone(cat); swCommit(); return r ? (Number(r.scores[cat]) || 0) : null;
  }
  function swSetVal(i, val, live) {
    if (!isSw() || !currentGame.players[i]) return null;
    const g = currentGame, cat = g.activeCategory; if (cat === 'science') return null;
    const raw = String(val ?? '').trim();
    if (live && (raw === '' || raw === '-' || raw === '−')) return null;
    const r = swTrackEdit(cat + ':' + i, () => SWL().swSetScore(g, i, cat, raw.replace('−', '-') || 0));
    swMarkDone(cat);
    if (live) swLiveRefresh(i); else { swEditKey = null; swCommit(); }
    return r ? (Number(r.scores[cat]) || 0) : null;
  }
  function swSci(i, sym, delta) {
    if (!isSw() || !currentGame.players[i]) return null;
    swEditKey = null;
    const r = SWL().swStepScience(currentGame, i, sym, delta); swMarkDone('science'); swCommit();
    return r ? SWL().swComputeScience(r.science) : null;
  }
  function swSciOverride(i, val, live) {
    if (!isSw() || !currentGame.players[i]) return null;
    const g = currentGame, raw = String(val ?? '').trim();
    const r = swTrackEdit('sci:' + i, () => SWL().swSetScienceOverride(g, i, raw === '' ? null : raw));
    swMarkDone('science');
    if (live) swLiveRefresh(i); else { swEditKey = null; swCommit(); }
    return r ? SWL().swComputeScience(r.science) : null;
  }
  function swSelectCategory(cat) {
    if (!isSw()) return null;
    const r = SWL().swSelectCategory(currentGame, cat); swEditKey = null; swCommit(); swScrollCard(); return r;
  }
  function swScrollCard() { const c = byId('sw-cat-tabs'); if (c && c.getBoundingClientRect().top < 0) c.scrollIntoView({ block: 'start' }); }
  function swStepCategory(dir) {
    if (!isSw()) return null;
    const g = currentGame;
    if (dir > 0) swMarkDone(g.activeCategory);
    const r = dir < 0 ? SWL().swPrevCategory(g) : SWL().swNextCategory(g);
    swEditKey = null; swCommit(); swScrollCard(); return r;
  }
  function swToggleExpansionsDrawer(force) {
    if (!isSw()) return false;
    swExpOpen = typeof force === 'boolean' ? force : !swExpOpen; renderSevenWonders(); return swExpOpen;
  }
  function swToggleExpansion(key, checked) {
    if (!isSw()) return null;
    const g = currentGame, k = String(key || '').toLowerCase();
    if (!SWL().EXPANSION_CATEGORIES.includes(k)) return null;
    if (typeof checked === 'boolean' && !!g.expansions[k] === checked) { renderSevenWonders(); return { ...g.expansions }; }
    SWL().swToggleExpansion(g, k);
    if (!g.expansions[k]) g.swDone = g.swDone.filter((c) => c !== k);
    swEditKey = null; swCommit(); return { ...g.expansions };
  }
  function swUndoAction() {
    if (!isSw()) return null;
    const r = SWL().swUndo(currentGame); swEditKey = null; swCommit(); return r;
  }
  function swFinishGame() { if (!isSw()) return null; return endGame(); }

  // ---------------- v15 Reusable 3D Dice Roller + Roll Tracker ----------------
  // ----- Rummikub (Classic Blue & Ivory Rack · 2–6 players · Points Up / Classic +/− · built-in tile calculator; math lives in RummikubLogic) -----
  const RKL = () => global.RummikubLogic || null;
  const isRk = () => !!(currentGame && currentGame.type === 'rummikub' && RKL());
  const RK_MAX = 6;
  const RK_VERSIONS = { points_up: 'Points Up (Lowest Wins)', classic: 'Classic (+/−)' };
  let rkSign = -1, rkCalcExpr = '', rkCalcOpen = false, rkCalcDone = false;
  const rkUp = () => !!(currentGame && currentGame.rkScoringMode !== 'classic');
  const rkMinus = (s) => String(s).replace(/-/g, '−');
  const rkCrownSvg = '<svg class="rk-crown" viewBox="0 0 24 20" role="img" aria-label="Leader"><path d="M2 16.5h20L20.3 5.6l-5 4.2L12 2.2 8.7 9.8l-5-4.2z" fill="#f5c542" stroke="#8a5a00" stroke-width="1.2" stroke-linejoin="round"/><rect x="2" y="16.4" width="20" height="2.6" rx=".9" fill="#d39b1c" stroke="#8a5a00" stroke-width=".9"/></svg>';
  function rkEnsure() {
    const g = currentGame;
    RKL().rkNormalize(g);
    if (!Array.isArray(g.rkDone)) g.rkDone = [];
    g.rkDone = g.rkDone.filter((i) => i >= 0 && i < g.players.length);
    if (!(g.rkSel >= 0 && g.rkSel < g.players.length)) g.rkSel = 0;
    g.version = RK_VERSIONS[g.rkScoringMode] || g.version;
    return g;
  }
  function rkStartGame() {
    const g = currentGame;
    g.rkScoringMode = /classic/i.test(g.version || '') ? 'classic' : 'points_up';
    RKL().rkNormalize(g);
    g.rkSel = 0; g.rkDone = []; rkSign = -1; rkCalcExpr = ''; rkCalcOpen = false;
  }
  function rkCommit(full) { persistActive(); if (full) renderRummikub(); else { rkRenderRoster(); rkRenderScorer(true); } }
  function rkResetProgress() { currentGame.rkDone = []; currentGame.rkSel = 0; }
  function rkRanks(g) {
    const up = rkUp(), scores = g.players.map((p) => Number(p.score) || 0);
    return scores.map((s) => 1 + scores.filter((o) => (up ? o < s : o > s)).length);
  }
  function renderRummikub() {
    const g = rkEnsure(), up = rkUp();
    const shell = byId('rk-shell'); shell.dataset.mode = up ? 'up' : 'classic';
    [['up', up], ['classic', !up]].forEach(([k, on]) => { const b = byId('rk-mode-' + k); b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on)); });
    byId('rk-round-pill').textContent = 'Round ' + (g.rounds.length + 1);
    byId('rk-joker-label').textContent = up ? 'Joker +30' : 'Joker −30';
    byId('rk-joker-btn').setAttribute('aria-label', up ? 'Joker penalty: add 30 points' : 'Joker penalty: subtract 30 points');
    rkRenderRoster();
    rkRenderScorer(false);
    rkRenderCalc();
    const undo = byId('rk-undo'); undo.disabled = !g.rounds.length;
    const rb = byId('rk-rounds-btn').querySelector('span');
    if (rb) rb.textContent = g.rkLogOpen ? 'Hide' : `Rounds${g.rounds.length ? ' (' + g.rounds.length + ')' : ''}`;
    byId('rk-rounds-btn').setAttribute('aria-expanded', String(!!g.rkLogOpen));
    const add = byId('rk-add-player'), full = g.players.length >= RK_MAX;
    add.disabled = full; add.title = full ? 'Rummikub supports up to 6 players' : 'Add a player';
    add.setAttribute('aria-label', full ? 'Player limit reached (6 max)' : 'Add player');
    rkRenderDrawer();
  }
  function rkRenderRoster() {
    const g = currentGame, N = RKL(), lead = N.rkLeaders(g), ranks = rkRanks(g), sum = N.rkGetDraftSummary(g);
    const el = byId('rk-roster');
    el.dataset.count = String(Math.max(2, Math.min(RK_MAX, g.players.length)));
    el.innerHTML = g.players.map((p, i) => {
      const sel = i === g.rkSel, isLead = lead.leaderIndices.includes(i), s = Number(p.score) || 0;
      const d = sum.rows[i] || { delta: 0, jokers: 0, touched: false };
      const pill = d.touched || d.jokers ? `<span class="rk-draft-pill${d.delta < 0 ? ' is-neg' : ''}">${rkMinus(signed(d.delta))}${d.jokers ? ' · J×' + d.jokers : ''}</span>` : '<span></span>';
      return `<div class="rk-card${sel ? ' selected' : ''}${isLead ? ' leader' : ''}${g.rkDone.includes(i) ? ' done' : ''}" data-idx="${i}" data-name="${esc(p.name)}" data-color="${esc(p.color)}" role="option" aria-selected="${sel}" tabindex="0"
        onclick="rkSelect(${i})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();rkSelect(${i})}">
        <div class="rk-card-top"><span class="rk-name">${esc(p.name)}${p.isSelf ? ' <span class="small">(You)</span>' : ''}</span>${isLead ? rkCrownSvg : ''}</div>
        <div class="rk-score ${s > 0 ? 'is-pos' : s < 0 ? 'is-neg' : 'is-zero'}">${rkMinus(s)}</div>
        <div class="rk-card-foot">${pill}<span class="rk-badge rk-c-${esc(p.color)}" role="button" tabindex="0" title="Change tile color" aria-label="Rank ${ranks[i]} · change ${esc(p.name)} tile color" onclick="event.stopPropagation();rkCycleColor(${i})">${ranks[i]}</span></div>
      </div>`;
    }).join('');
  }
  function rkRenderScorer(keepInput) {
    const g = currentGame, up = rkUp(), p = g.players[g.rkSel], d = (g.rkDraft || {})[g.rkSel] || { delta: 0, jokers: 0 };
    byId('rk-scorer-who').textContent = `Round ${g.rounds.length + 1} · ${p ? p.name : '—'}`;
    const input = byId('rk-delta-input');
    if (!up && d.delta) rkSign = d.delta < 0 ? -1 : 1;
    const sign = up ? 1 : rkSign;
    if (!keepInput) input.value = d.delta ? String(up ? d.delta : d.delta) : '';
    input.placeholder = up ? 'Tile points' : (sign < 0 ? '−0' : '+0');
    input.setAttribute('inputmode', up ? 'numeric' : 'text');
    input.classList.toggle('is-neg', !up && sign < 0); input.classList.toggle('is-pos', !up && sign > 0);
    [['minus', sign < 0], ['plus', sign > 0]].forEach(([k, on]) => { const b = byId('rk-sign-' + k); b.classList.toggle('active', !up && on); b.setAttribute('aria-pressed', String(!up && on)); });
    const pv = byId('rk-preview'); pv.textContent = rkMinus(signed(d.delta || 0)) + (d.jokers ? ` · J×${d.jokers}` : '');
    pv.classList.toggle('is-neg', d.delta < 0); pv.classList.toggle('is-pos', d.delta > 0);
    const remaining = g.players.filter((_, i) => i !== g.rkSel && !g.rkDone.includes(i)).length;
    const c = byId('rk-confirm'); c.textContent = remaining ? 'Confirm · Next' : 'Confirm Round';
    c.setAttribute('aria-label', remaining ? `Confirm ${p ? p.name : ''} and score the next player` : 'Confirm and apply this round');
  }
  function rkRenderDrawer() {
    const g = currentGame, el = byId('rk-history-drawer'), list = byId('rk-history-list');
    setHidden(el, !g.rkLogOpen);
    if (!g.rkLogOpen) return;
    list.innerHTML = g.rounds.length ? g.rounds.map((r, k) => ({ r, k })).reverse().map(({ r, k }) => {
      const entries = (r.detail && r.detail.entries) || g.players.map((p, i) => ({ name: p.name, delta: (r.deltas || [])[i] || 0, jokers: 0 }));
      return `<div class="rk-history-row" data-round="${k + 1}"><strong>Round ${k + 1}</strong><span>${entries.map((e) =>
        `${esc(e.name)} <b>${rkMinus(signed(Number(e.delta) || 0))}</b>${e.jokers ? ` <span class="small">J×${e.jokers}</span>` : ''}`).join(' · ')}</span></div>`;
    }).join('') : '<p class="rk-history-empty">No rounds recorded yet.</p>';
  }
  // ----- Rummikub UI actions (markup onclick hooks) -----
  function rkSelect(idx) {
    if (!isRk() || !currentGame.players[idx]) return false;
    currentGame.rkSel = idx; rkCommit(true); return true;
  }
  function rkSetMode(mode) {
    if (!isRk()) return false;
    const want = mode === 'classic' ? 'classic' : 'points_up', g = currentGame;
    if (g.rkScoringMode === want) return true;
    const hasScores = g.rounds.length || g.players.some((p) => p.score);
    if (hasScores && !confirm(`Switch to ${RK_VERSIONS[want]}? Scores start over at 0.`)) return false;
    RKL().rkSetScoringMode(g, want, { reset: true });
    g.version = RK_VERSIONS[want]; rkSign = -1; rkResetProgress(); rkCalcExpr = ''; rkCalcDone = false;
    rkCommit(true); return true;
  }
  function rkSetSign(sign) {
    if (!isRk() || rkUp()) return null;
    const g = currentGame, i = g.rkSel, d = (g.rkDraft || {})[i] || { delta: 0 };
    rkSign = sign < 0 ? -1 : 1;
    const mag = Math.abs(Number(d.delta) || 0);
    const r = mag ? RKL().rkSetDraftDelta(g, i, rkSign * mag) : null;
    persistActive(); rkRenderRoster(); rkRenderScorer(false);
    return r;
  }
  function rkOnDeltaInput(val) {
    if (!isRk()) return null;
    const g = currentGame, up = rkUp(), input = byId('rk-delta-input');
    const raw = String(val ?? input.value).replace(/[\u2212\u2013]/g, '-').replace(/[^0-9+-]/g, '');
    const digits = raw.replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '').slice(0, 4);
    if (!up) { if (/^-/.test(raw)) rkSign = -1; else if (/^\+/.test(raw)) rkSign = 1; }
    const n = Number(digits) || 0, delta = up ? n : rkSign * n;
    const clean = up ? digits : (digits ? (rkSign < 0 ? '-' : '') + digits : '');
    if (input.value !== clean) input.value = clean;
    const r = RKL().rkSetDraftDelta(g, g.rkSel, delta);
    persistActive(); rkRenderRoster(); rkRenderScorer(true);
    return r;
  }
  function rkStep(step) {
    if (!isRk()) return null;
    const r = RKL().rkStepDraftDelta(currentGame, currentGame.rkSel, step);
    persistActive(); rkRenderRoster(); rkRenderScorer(false); return r;
  }
  function rkApplyJoker() {
    if (!isRk()) return null;
    const r = RKL().rkApplyJokerPenalty(currentGame, currentGame.rkSel);
    persistActive(); rkRenderRoster(); rkRenderScorer(false); return r;
  }
  function rkConfirmRound() {
    if (!isRk()) return null;
    const g = currentGame, N = RKL(), n = g.players.length, sel = g.rkSel;
    if (!g.rkDone.includes(sel)) g.rkDone.push(sel);
    rkCalcOpen = false; rkCalcExpr = ''; rkCalcDone = false;
    let next = -1;
    for (let s = 1; s <= n; s++) { const k = (sel + s) % n; if (!g.rkDone.includes(k)) { next = k; break; } }
    if (next >= 0) { g.rkSel = next; rkCommit(true); return { next }; }
    if (!N.rkGetDraftSummary(g).hasAnyInput) N.rkSetDraftDelta(g, sel, ((g.rkDraft || {})[sel] || {}).delta || 0);
    const round = N.rkApplyRound(g);
    rkResetProgress(); rkCommit(true);
    return round;
  }
  function rkUndo() {
    if (!isRk()) return null;
    const r = RKL().rkUndoLastRound(currentGame);
    RKL().rkClearDraft(currentGame); rkResetProgress(); rkCommit(true); return r;
  }
  function rkToggleHistory(force) {
    if (!isRk()) return false;
    const g = currentGame;
    if (typeof force === 'boolean') g.rkLogOpen = force; else RKL().rkToggleLog(g);
    rkCommit(true); return g.rkLogOpen;
  }
  function rkAddPlayer(name) {
    if (!isRk()) return null;
    const g = currentGame;
    if (g.players.length >= RK_MAX) { alert('Rummikub supports up to 6 players.'); return null; }
    if (name === undefined) name = prompt('New player name', 'Player ' + (g.players.length + 1));
    name = String(name || '').trim();
    if (!name) return null;
    const known = (social.friends.accepted || []).find((a) => a && a.userId && lc(memberName(a)) === lc(name));
    const p = RKL().rkAddPlayer(g, known ? { name, userId: known.userId } : name);
    if (!p) { alert('That player is already in this game.'); return null; }
    rkCommit(true); return p;
  }
  function rkCycleColor(idx) {
    if (!isRk()) return null;
    const c = RKL().rkCycleColor(currentGame, idx); rkCommit(false); return c;
  }
  function rkFinishGame() { if (!isRk()) return null; return endGame(); }
  // ----- Built-in tile calculator -----
  function rkCalcPretty(expr) { return String(expr || '').replace(/([+-])/g, ' $1 ').replace(/-/g, '−').replace(/\s+/g, ' ').trim(); }
  function rkCalcValue() { const N = RKL(); return N && rkCalcExpr ? N.rkCalcEval(rkCalcExpr, currentGame) : null; }
  function rkRenderCalc() {
    const panel = byId('rk-calc-panel'), tog = byId('rk-calc-toggle');
    setHidden(panel, !rkCalcOpen);
    tog.classList.toggle('active', rkCalcOpen); tog.setAttribute('aria-expanded', String(rkCalcOpen));
    if (!rkCalcOpen) return;
    byId('rk-calc-expr').textContent = rkCalcExpr ? rkCalcPretty(rkCalcExpr) : '0';
    const v = rkCalcValue();
    byId('rk-calc-res').textContent = v === null ? '' : '= ' + rkMinus(v);
    panel.classList.toggle('is-done', rkCalcDone);
  }
  function rkToggleCalc(force) {
    if (!isRk()) return false;
    rkCalcOpen = typeof force === 'boolean' ? force : !rkCalcOpen;
    if (rkCalcOpen && !rkCalcExpr) rkCalcDone = false;
    rkRenderCalc(); return rkCalcOpen;
  }
  function rkCalcKey(k) {
    if (!isRk()) return null;
    k = String(k);
    if (k === '−') k = '-';
    if (/^[0-9]$/.test(k)) {
      if (rkCalcDone) { rkCalcExpr = ''; rkCalcDone = false; }
      const last = (rkCalcExpr.match(/[0-9]+$/) || [''])[0];
      if (last.length >= 4) return rkCalcExpr;
      rkCalcExpr = last === '0' ? rkCalcExpr.slice(0, -1) + k : rkCalcExpr + k;
    } else if (k === '+' || k === '-') {
      rkCalcDone = false;
      if (!rkCalcExpr) { if (k === '-') rkCalcExpr = '-'; }
      else rkCalcExpr = /[+-]$/.test(rkCalcExpr) ? rkCalcExpr.slice(0, -1) + k : rkCalcExpr + k;
    } else if (k === 'BS') { rkCalcDone = false; rkCalcExpr = rkCalcExpr.slice(0, -1); }
    else if (k === 'C') { rkCalcExpr = ''; rkCalcDone = false; }
    else if (k === '=') { const v = rkCalcValue(); if (v !== null) { rkCalcExpr = String(v); rkCalcDone = true; } }
    if (rkCalcExpr.length > 40) rkCalcExpr = rkCalcExpr.slice(0, 40);
    rkRenderCalc(); return rkCalcExpr;
  }
  function rkCalcApply() {
    if (!isRk()) return null;
    let v = rkCalcValue();
    if (v === null) v = 0;
    // Classic +/−: the calculator adds up tile values; the −/+ toggle decides whether they count against or for the player.
    if (!rkUp() && v > 0 && rkSign < 0) v = -v;
    const r = RKL().rkSetDraftDelta(currentGame, currentGame.rkSel, v);
    rkCalcOpen = false; rkCalcExpr = ''; rkCalcDone = false;
    persistActive(); rkRenderRoster(); rkRenderScorer(false); rkRenderCalc();
    return r;
  }

  const DLx = () => global.DiceLogic || null;
  let diceAnimTimer = null;
  function diceConfigFor(game) { const d = DLx(); return d && game ? d.getDiceConfig(game, GAMES) : null; }
  function diceEnabled() { return currentView === 'active' && !!currentGame && !!diceConfigFor(currentGame); }
  function syncDiceTrigger() {
    const btn = byId('dice-open-btn'); if (!btn) return;
    const on = diceEnabled();
    const host = on ? byId(isCatan() ? 'catan-dice-slot' : 'gen-dice-slot') : byId('dice-mount');
    if (host && btn.parentElement !== host) host.appendChild(btn);
    ['catan-dice-slot', 'gen-dice-slot'].forEach((id) => { const el = byId(id); if (el) el.classList.toggle('has-dice', on && el === host); });
    setHidden(btn, !on);
    const n = on && Array.isArray(currentGame.diceRolls) ? currentGame.diceRolls.length : 0;
    const badge = byId('dice-open-badge');
    if (badge) { badge.textContent = String(n); setHidden(badge, !n); }
    btn.setAttribute('aria-label', n ? `Open Dice Roller and Roll Tracker (${n} rolls)` : 'Open Dice Roller and Roll Tracker');
    if (!on) { const m = byId('dice-modal'); if (m && !m.hidden) closeDiceModal(); }
  }
  function openDiceModal() {
    if (!diceEnabled()) return;
    const m = byId('dice-modal'); if (!m) return;
    const cfg = diceConfigFor(currentGame);
    const title = byId('dice-modal-title'); if (title) title.textContent = cfg && cfg.label && !isCatan() ? `Dice & Rolls · ${cfg.label}` : 'Dice & Rolls';
    setHidden(m, false);
    document.body.classList.add('dice-open');
    diceReadoutFromLatest();
    renderDiceUI();
  }
  function closeDiceModal() {
    const m = byId('dice-modal'); if (!m) return;
    setHidden(m, true);
    document.body.classList.remove('dice-open');
  }
  function diceShowReadout(entry, physical) {
    const cfg = diceConfigFor(currentGame) || {};
    const tot = byId('dice-result-total'), split = byId('dice-result-split'), robber = byId('dice-robber-tag');
    if (!entry) {
      if (tot) tot.textContent = '—';
      if (split) split.textContent = 'Tap dice to roll';
      setHidden(robber, true);
      return;
    }
    if (tot) tot.textContent = String(entry.sum);
    if (split) split.textContent = physical || entry.source === 'manual' ? 'Physical roll' : (entry.dice || []).join(' + ');
    setHidden(robber, !(isCatan() && cfg.robberSum != null && entry.sum === cfg.robberSum));
  }
  function diceSetFaces(entry) {
    if (!entry || !Array.isArray(entry.dice)) return;
    entry.dice.slice(0, 2).forEach((v, i) => { const d = byId('die-' + (i + 1)); if (d && v >= 1 && v <= 6) d.setAttribute('data-face', String(v)); });
  }
  function renderDiceUI() {
    const d = DLx(); if (!d || !currentGame) { syncDiceTrigger(); return; }
    const dist = d.getDistribution(currentGame, { gamesCatalog: GAMES });
    const tr = byId('dice-total-rolls'); if (tr) tr.textContent = `${dist.totalRolls} ${dist.totalRolls === 1 ? 'roll' : 'rolls'}`;
    const latest = dist.recent && dist.recent.length ? dist.recent[0] : null;
    const scale = Math.max(1, ...dist.rows.map((r) => Math.max(r.actualPct, r.theoreticalPct))) * 1.08;
    const chart = byId('dice-chart-bars');
    if (chart) {
      chart.classList.toggle('has-rolls', dist.totalRolls > 0);
      dist.rows.forEach((r) => {
        const col = chart.querySelector(`.dice-col[data-sum="${r.sum}"]`); if (!col) return;
        const bar = col.querySelector('.dice-col-bar'), exp = col.querySelector('.dice-col-expected'), cnt = col.querySelector('.dice-col-count');
        if (bar) bar.style.height = (dist.totalRolls ? (r.actualPct / scale) * 100 : 0).toFixed(1) + '%';
        if (exp) exp.style.bottom = ((r.theoreticalPct / scale) * 100).toFixed(1) + '%';
        if (cnt) cnt.textContent = r.count ? String(r.count) : '';
        col.classList.toggle('is-hot', !!r.isHot);
        col.classList.toggle('is-latest', !!latest && latest.sum === r.sum);
        col.setAttribute('aria-label', `${r.sum}: ${r.count} rolled, ${r.expectedCount.toFixed(1)} expected`);
      });
    }
    const hot = byId('dice-hot-summary');
    if (hot) hot.textContent = dist.hotSums.length ? `Hottest: ${dist.hotSums.join(', ')}` : 'Expected vs. actual';
    const rec = byId('dice-recent');
    if (rec) {
      const robberSum = dist.config ? dist.config.robberSum : null;
      rec.innerHTML = dist.recent.length
        ? dist.recent.map((r, i) => `<span class="dice-pill${i === 0 ? ' is-latest' : ''}${robberSum != null && r.sum === robberSum ? ' is-seven' : ''}" title="${r.source === 'manual' ? 'Physical roll' : esc((r.dice || []).join(' + '))}">${r.sum}</span>`).join('')
        : '<span class="dice-recent-empty">No rolls logged yet</span>';
    }
    const has = dist.totalRolls > 0;
    const u = byId('dice-undo-btn'); if (u) u.disabled = !has;
    const z = byId('dice-reset-btn'); if (z) z.disabled = !has;
    syncDiceTrigger();
    return dist;
  }
  function rollVirtualDice() {
    const d = DLx(); if (!d || !diceEnabled()) return null;
    const entry = d.rollDice(currentGame, { gamesCatalog: GAMES });
    if (!entry) return null;
    const els = ['die-1', 'die-2', 'die-wrap-1', 'die-wrap-2'].map(byId).filter(Boolean);
    els.forEach((el) => el.classList.remove('is-rolling'));
    void (els[0] && els[0].offsetWidth); // force reflow so back-to-back rolls restart the tumble
    diceSetFaces(entry);
    els.forEach((el) => el.classList.add('is-rolling'));
    clearTimeout(diceAnimTimer);
    diceAnimTimer = setTimeout(() => els.forEach((el) => el.classList.remove('is-rolling')), 580);
    persistActive();
    diceShowReadout(entry, false);
    renderDiceUI();
    return entry;
  }
  function logPhysicalRoll(n) {
    const d = DLx(); if (!d || !diceEnabled()) return null;
    const entry = d.logManualRoll(currentGame, Number(n), { gamesCatalog: GAMES });
    if (!entry) return null;
    persistActive();
    diceShowReadout(entry, true);
    renderDiceUI();
    return entry;
  }
  function diceReadoutFromLatest() {
    const rolls = currentGame && Array.isArray(currentGame.diceRolls) ? currentGame.diceRolls : [];
    const last = rolls[rolls.length - 1] || null;
    if (last && last.source !== 'manual') diceSetFaces(last);
    diceShowReadout(last, last && last.source === 'manual');
  }
  function undoDiceRoll() {
    const d = DLx(); if (!d || !currentGame) return null;
    const r = d.undoLastRoll(currentGame);
    persistActive(); diceReadoutFromLatest(); renderDiceUI();
    return r;
  }
  function resetDiceRolls() {
    const d = DLx(); if (!d || !currentGame) return 0;
    if (Array.isArray(currentGame.diceRolls) && currentGame.diceRolls.length > 1 && !confirm('Clear all logged rolls for this game?')) return 0;
    const n = d.clearRolls(currentGame);
    persistActive(); diceShowReadout(null); renderDiceUI();
    return n;
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { const m = byId('dice-modal'); if (m && !m.hidden) closeDiceModal(); } });
  function diceHistoryLine(g) {
    const st = g && g.meta && g.meta.diceStats;
    if (!st || !st.totalRolls) return '';
    const counts = st.counts || {}, max = Math.max(0, ...Object.values(counts).map(Number));
    const top = max > 0 ? Object.keys(counts).filter((k) => Number(counts[k]) === max).join(', ') : '';
    return `<div class="small history-dice" data-dice-rolls="${st.totalRolls}" style="margin-top:.2rem;opacity:.72">${st.totalRolls} ${st.totalRolls === 1 ? 'roll' : 'rolls'}${top ? ` · Most rolled: ${esc(top)}` : ''}</div>`;
  }

  // ---------------- v23 Hearts: Ivory & Crimson Ledger (window.HeartsUI backed by window.TallyItHearts) ----------------
  const V23_SVG = {
    heart: (c) => `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 14S2 9.8 2 5.6A3.4 3.4 0 0 1 8 3.5a3.4 3.4 0 0 1 6 2.1C14 9.8 8 14 8 14Z" fill="${c}"/></svg>`,
    spade: (c) => `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5C8 1.5 2.5 6.1 2.5 9.4A3.1 3.1 0 0 0 7.1 11.8L6.1 14.5h3.8l-1-2.7a3.1 3.1 0 0 0 4.6-2.4C13.5 6.1 8 1.5 8 1.5Z" fill="${c}"/></svg>`,
    diamond: (c) => `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5 13.5 8 8 14.5 2.5 8Z" fill="${c}"/></svg>`,
    club: (c) => `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="4.6" r="2.9" fill="${c}"/><circle cx="4.5" cy="9" r="2.9" fill="${c}"/><circle cx="11.5" cy="9" r="2.9" fill="${c}"/><path d="M7.2 9h1.6l1 5.5H6.2Z" fill="${c}"/></svg>`,
    moon: (c) => `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10.8 2.2a6 6 0 1 0 3 9.9A5 5 0 0 1 10.8 2.2Z" fill="${c}"/></svg>`,
    nt: (c) => `<svg viewBox="0 0 16 16" aria-hidden="true"><text x="8" y="11.5" text-anchor="middle" font-family="Georgia,serif" font-size="9" font-weight="700" fill="${c}">NT</text></svg>`
  };
  const HT_CRIMSON = '#9A1B22', HT_INK = '#23201D', OH_EMERALD = '#115539';
  function htDraftFresh() { return currentGame.players.map(() => ({ hearts: 0, queenOfSpades: false, jackOfDiamonds: false })); }
  function htEnsure() {
    const L = HTL(); if (!L || !currentGame) return null;
    L.initState(currentGame);
    if (!Array.isArray(currentGame.htDraft) || currentGame.htDraft.length !== currentGame.players.length) currentGame.htDraft = htDraftFresh();
    if (typeof currentGame.htMoon !== 'number' || currentGame.htMoon >= currentGame.players.length) currentGame.htMoon = -1;
    if (htSel >= currentGame.players.length) htSel = -1;
    return L.resolveRules(currentGame);
  }
  function htStartGame() { currentGame.htDraft = null; currentGame.htMoon = -1; htSel = -1; htForceArmed = false; htEnsure(); }
  function htDraftPoints(rules) {
    const d = currentGame.htDraft, moon = currentGame.htMoon;
    return d.map((e, i) => {
      let pts;
      if (moon >= 0) pts = rules.moonSubtract ? (i === moon ? -26 : 0) : (i === moon ? 0 : 26);
      else pts = (e.hearts || 0) + (e.queenOfSpades ? 13 : 0);
      if (rules.jackOfDiamonds && e.jackOfDiamonds) pts -= 10;
      return pts;
    });
  }
  function htMsg(text) { const m = byId('ht-error-msg'); if (!m) return; m.textContent = text || ''; m.hidden = !text; }
  function renderHearts() {
    const rules = htEnsure(); if (!rules) return;
    const g = currentGame, L = HTL(), n = g.players.length, hands = g.hands || [];
    const set = (id, t) => { const el = byId(id); if (el) el.textContent = t; };
    const pass = L.getPassDirection(hands.length, n);
    set('ht-hand-label', 'Hand ' + (hands.length + 1));
    set('ht-target-score', String(rules.targetScore));
    set('ht-pass-dir', pass.label);
    const d = g.htDraft, moon = g.htMoon;
    const heartsSum = d.reduce((s, e) => s + (e.hearts || 0), 0);
    const qIdx = d.findIndex((e) => e.queenOfSpades), jIdx = d.findIndex((e) => e.jackOfDiamonds);
    const handPts = heartsSum + (qIdx >= 0 ? 13 : 0);
    set('ht-hearts-tally', `Hearts: ${heartsSum} / 13`);
    const qs = byId('ht-qs-status'); if (qs) qs.innerHTML = `Q${V23_SVG.spade(HT_INK).replace('<svg ', '<svg style="width:10px;height:10px;vertical-align:-1px" ')}: ${esc(qIdx >= 0 ? g.players[qIdx].name : 'Unassigned')}`;
    set('ht-points-tally', moon >= 0 ? `Moon: ${g.players[moon].name}` : `Hand: ${handPts} / 26`);
    const sb = byId('ht-hand-status');
    if (sb) { sb.classList.toggle('is-ready', moon >= 0 || handPts === 26); sb.classList.toggle('is-error', moon < 0 && (handPts > 26 || heartsSum > 13)); }
    const proj = htDraftPoints(rules);
    const scores = g.players.map((p) => Number(p.score) || 0);
    const best = hands.length ? (rules.lowWins ? Math.min(...scores) : Math.max(...scores)) : null;
    const step = (i, dir, lbl) => `<button type="button" class="ht-step-btn" aria-label="${lbl}" onclick="event.stopPropagation();HeartsUI.stepHearts(${i},${dir})">${dir < 0 ? '&minus;' : '+'}</button>`;
    const rows = byId('ht-player-rows');
    if (rows) rows.innerHTML = g.players.map((p, i) => {
      const e = d[i], sel = i === htSel, isMoon = moon === i;
      const delta = proj[i];
      return `<div class="ht-row${sel ? ' is-selected' : ''}${isMoon ? ' is-moon' : ''}" data-player-idx="${i}" onclick="HeartsUI.selectPlayer(${i})" role="button" aria-pressed="${sel}">
        <div class="ht-row-left">
          <div class="ht-row-head"><span class="ht-suit-badge">${V23_SVG.heart(i % 2 ? HT_INK : HT_CRIMSON)}<span class="ht-suit-lines"></span></span>
            <span class="ht-name-wrap"><span class="ht-player-name">${esc(p.name)}</span>${best !== null && scores[i] === best ? '<span class="ht-leader-tag">Leader</span>' : ''}</span>
            ${delta ? `<span class="ht-delta-tag">${signed(delta)}</span>` : ''}</div>
          <div class="ht-controls">
            <div class="ht-stepper">${step(i, -1, 'Fewer hearts for ' + esc(p.name))}<span class="ht-step-val" data-hearts="${e.hearts}">${V23_SVG.heart(HT_CRIMSON)}${e.hearts}</span>${step(i, 1, 'More hearts for ' + esc(p.name))}</div>
            <button type="button" class="ht-chip-btn ht-chip-qs${e.queenOfSpades ? ' active' : ''}" aria-pressed="${!!e.queenOfSpades}" onclick="event.stopPropagation();HeartsUI.toggleQueen(${i})">Q${V23_SVG.spade(e.queenOfSpades ? '#FFFFFF' : HT_INK).replace('<svg ', '<svg style="width:10px;height:10px" ')} +13</button>
            ${rules.jackOfDiamonds ? `<button type="button" class="ht-chip-btn ht-chip-jd${e.jackOfDiamonds ? ' active' : ''}" aria-pressed="${!!e.jackOfDiamonds}" onclick="event.stopPropagation();HeartsUI.toggleJack(${i})">J${V23_SVG.diamond(e.jackOfDiamonds ? '#FFFFFF' : HT_CRIMSON).replace('<svg ', '<svg style="width:10px;height:10px" ')} &minus;10</button>` : ''}
            <button type="button" class="ht-chip-btn ht-chip-moon${isMoon ? ' active' : ''}" aria-pressed="${isMoon}" aria-label="Shoot the Moon for ${esc(p.name)}" onclick="event.stopPropagation();HeartsUI.setMoon(${i})">${V23_SVG.moon(isMoon ? '#F8E6C2' : HT_INK).replace('<svg ', '<svg style="width:11px;height:11px" ')}</button>
          </div>
        </div>
        <div class="ht-row-right"><div class="ht-pts-box"><span class="ht-pts-num">${scores[i]}</span><span class="ht-pts-lbl">Points</span></div></div>
      </div>`;
    }).join('');
    const selP = htSel >= 0 ? g.players[htSel] : null;
    const qt = byId('ht-qs-toggle'); if (qt) { qt.checked = !!(htSel >= 0 && d[htSel].queenOfSpades); qt.disabled = htSel < 0; }
    set('ht-qs-holder', qIdx >= 0 ? `(+13) Taken by ${g.players[qIdx].name}` : selP ? `(+13) Toggle for ${selP.name}` : '(+13) Tap Q on a player row');
    const mb = byId('ht-moon-btn'); if (mb) mb.setAttribute('aria-pressed', String(moon >= 0));
    set('ht-moon-sub', moon >= 0 ? `${g.players[moon].name} shot the moon (${rules.moonSubtract ? '\u221226 to shooter' : '+26 to all others'})` : (rules.moonSubtract ? '(\u221226 to the shooter)' : '(+26 to all others)'));
    const jb = byId('ht-jd-banner'); if (jb) jb.hidden = !rules.jackOfDiamonds;
    set('ht-jd-status', jIdx >= 0 ? `Jack of Diamonds (\u221210) taken by ${g.players[jIdx].name}` : 'Jack of Diamonds (\u221210) active \u2014 tap J on a player row');
    const ub = byId('ht-btn-undo'); if (ub) ub.disabled = !hands.length;
    const rb = byId('ht-btn-record'); if (rb) rb.disabled = !!g.isGameOver;
    set('ht-history-count', hands.length + (hands.length === 1 ? ' hand' : ' hands'));
    const hl = byId('ht-history-list');
    if (hl) hl.innerHTML = hands.length ? hands.slice().reverse().map((h) => `<div class="ht-history-item" data-hand="${h.handNumber}"><span style="flex:0 0 auto;font-weight:700">Hand ${h.handNumber} &middot; ${esc(h.passLabel || '')}${h.shooterIdx >= 0 ? ' &middot; Moon' : ''}</span>
        <span style="min-width:0;text-align:right;overflow-wrap:anywhere">${g.players.map((p, i) => esc(p.name) + ' ' + signed((h.deltas || [])[i] || 0)).join(', ')}</span></div>`).join('')
      : '<div class="ht-history-empty">No hands recorded yet.</div>';
    if (!htForceArmed) htMsg('');
  }
  function htCommit() { htForceArmed = false; persistActive(); renderHearts(); }
  const HeartsUI = {
    render: () => { if (isHt()) renderHearts(); },
    selectPlayer(i) { if (!isHt() || !currentGame.players[i]) return; htSel = htSel === i ? -1 : i; renderHearts(); },
    stepHearts(i, dir) {
      if (!isHt() || !currentGame.players[i]) return; htEnsure();
      const e = currentGame.htDraft[i]; e.hearts = Math.max(0, Math.min(13, (e.hearts || 0) + (dir < 0 ? -1 : 1)));
      htSel = i; htCommit();
    },
    toggleQueen(i) {
      if (!isHt() || !currentGame.players[i]) return; htEnsure();
      const on = !currentGame.htDraft[i].queenOfSpades;
      currentGame.htDraft.forEach((e, k) => { e.queenOfSpades = on && k === i; });
      htSel = i; htCommit();
    },
    toggleQueenForSelected(checked) {
      if (!isHt()) return; htEnsure();
      if (htSel < 0) { renderHearts(); htMsg('Tap a player row first, then toggle the Queen of Spades.'); return; }
      currentGame.htDraft.forEach((e, k) => { e.queenOfSpades = !!checked && k === htSel; });
      htCommit();
    },
    toggleJack(i) {
      if (!isHt() || !currentGame.players[i]) return; const rules = htEnsure(); if (!rules.jackOfDiamonds) return;
      const on = !currentGame.htDraft[i].jackOfDiamonds;
      currentGame.htDraft.forEach((e, k) => { e.jackOfDiamonds = on && k === i; });
      htSel = i; htCommit();
    },
    setMoon(i) { if (!isHt() || !currentGame.players[i]) return; htEnsure(); currentGame.htMoon = currentGame.htMoon === i ? -1 : i; htSel = i; htCommit(); },
    toggleShootMoon() {
      if (!isHt()) return; htEnsure();
      if (currentGame.htMoon >= 0) { currentGame.htMoon = -1; htCommit(); return; }
      if (htSel < 0) { renderHearts(); htMsg('Tap the player who shot the moon first.'); return; }
      currentGame.htMoon = htSel; htCommit();
    },
    recordHand() {
      if (!isHt()) return null; htEnsure();
      const L = HTL(), g = currentGame;
      const entries = g.htDraft.map((e, i) => ({ ...e, shotMoon: g.htMoon === i }));
      const res = L.scoreHand(g, entries, htForceArmed ? { allowNon26: true } : {});
      if (!res.ok) {
        if (res.canOverride) { htForceArmed = true; renderHearts(); htMsg(res.error + ' Tap Record Hand again to record it anyway.'); }
        else { htForceArmed = false; renderHearts(); htMsg(res.error || 'Could not record that hand.'); }
        return res;
      }
      g.htDraft = htDraftFresh(); g.htMoon = -1; htSel = -1; htForceArmed = false;
      persistActive(); renderHearts();
      if (res.isGameOver && typeof global.openEndGameModal === 'function') global.openEndGameModal();
      return res;
    },
    undoHand() {
      if (!isHt()) return null; htEnsure();
      const res = HTL().undoLastHand(currentGame);
      if (res.ok) { currentGame.htDraft = htDraftFresh(); currentGame.htMoon = -1; htSel = -1; }
      htCommit(); return res;
    }
  };

  // ---------------- v23 Oh Hell: Ivory & Emerald Ledger (window.OhHellUI backed by window.TallyItOhHell) ----------------
  function ohEnsure() {
    const L = OHL(); if (!L || !currentGame) return null;
    L.initState(currentGame);
    const n = currentGame.players.length;
    if (!Array.isArray(currentGame.ohDraft) || currentGame.ohDraft.length !== n) currentGame.ohDraft = currentGame.players.map(() => ({ bid: 0, tricksWon: 0 }));
    if (currentGame.ohDraftRound !== currentGame.rounds.length) { currentGame.ohDraft = currentGame.players.map(() => ({ bid: 0, tricksWon: 0 })); currentGame.ohDraftRound = currentGame.rounds.length; currentGame.ohTrump = null; }
    return L.resolveRules(currentGame);
  }
  function ohStartGame() { currentGame.ohDraft = null; currentGame.ohDraftRound = 0; currentGame.ohTrump = null; ohForceMsg = ''; ohEnsure(); }
  function ohTrumpNow() {
    const L = OHL(), key = currentGame.ohTrump;
    const t = key ? L.TRUMP_SUITS.find((s) => s.key === key) : null;
    return t || L.getTrumpSuit(currentGame.rounds.length);
  }
  function ohSuitSvg(key) {
    const red = '#9A1B22';
    return key === 'hearts' ? V23_SVG.heart(red) : key === 'diamonds' ? V23_SVG.diamond(red) : key === 'clubs' ? V23_SVG.club(OH_EMERALD) : key === 'notrump' ? V23_SVG.nt('#475569') : V23_SVG.spade(OH_EMERALD);
  }
  function ohMsg(text) { const m = byId('oh-error-msg'); if (!m) return; m.textContent = text || ''; m.hidden = !text; }
  function ohLive() {
    const L = OHL(), rules = ohEnsure(), g = currentGame;
    const cards = g.currentCards || (g.schedule || [])[g.rounds.length] || 0;
    const dealer = g.currentDealerIndex || 0;
    const bids = g.ohDraft.map((e) => e.bid), tricks = g.ohDraft.map((e) => e.tricksWon);
    const forbidden = L.getForbiddenDealerBid(cards, bids, dealer, rules.screwTheDealer);
    return { rules, cards, dealer, bids, tricks, forbidden, bidSum: bids.reduce((a, b) => a + b, 0), trickSum: tricks.reduce((a, b) => a + b, 0), violation: forbidden !== null && bids[dealer] === forbidden };
  }
  function renderOhHell() {
    if (!ohEnsure()) return;
    const g = currentGame, n = g.players.length, total = (g.schedule || []).length;
    const lv = ohLive(), { rules, cards, dealer } = lv;
    const set = (id, t) => { const el = byId(id); if (el) el.textContent = t; };
    const over = !!g.isGameOver;
    set('oh-round-label', over ? `Game Complete \u00b7 ${total} rounds` : `Round ${g.rounds.length + 1} of ${total}`);
    set('oh-cards-dealt', over ? '\u2014' : String(cards));
    const tr = ohTrumpNow();
    set('oh-trump-name', tr.label);
    const ti = byId('oh-trump-icon'); if (ti) ti.innerHTML = ohSuitSvg(tr.key);
    const tb = byId('oh-trump-btn'); if (tb) tb.dataset.trump = tr.key;
    set('oh-bids-tally', `Total Bids: ${lv.bidSum} / ${cards}`);
    set('oh-tricks-tally', `Tricks Won: ${lv.trickSum} / ${cards}`);
    const sb = byId('oh-round-status');
    if (sb) { sb.classList.toggle('is-ready', !over && lv.trickSum === cards && !lv.violation); sb.classList.toggle('is-error', !over && (lv.trickSum > cards || lv.violation)); }
    const complete = lv.trickSum === cards;
    const scores = g.players.map((p) => Number(p.score) || 0);
    const best = g.rounds.length ? (rules.lowWins ? Math.min(...scores) : Math.max(...scores)) : null;
    const step = (i, k, dir, lbl) => `<button type="button" class="oh-step-btn" aria-label="${lbl}" onclick="OhHellUI.step(${i},'${k}',${dir})"${over ? ' disabled' : ''}>${dir < 0 ? '&minus;' : '+'}</button>`;
    const rows = byId('oh-player-rows');
    if (rows) rows.innerHTML = g.players.map((p, i) => {
      const e = g.ohDraft[i], exact = complete && e.tricksWon === e.bid, isDealer = i === dealer && !over;
      const viol = isDealer && lv.violation;
      const pts = exact ? rules.exactBonus + e.tricksWon : rules.missPointsPerTrick * e.tricksWon;
      return `<div class="oh-row${exact ? ' is-exact' : ''}${viol ? ' is-screw-violation' : ''}" data-player-idx="${i}">
        <div class="oh-row-left">
          <div class="oh-row-head"><span class="oh-suit-badge">${i % 2 ? V23_SVG.spade(HT_INK) : V23_SVG.spade(OH_EMERALD)}<span class="oh-suit-lines"></span></span>
            <span class="oh-name-wrap"><span class="oh-player-name">${esc(p.name)}</span>${isDealer ? '<span class="oh-dealer-pill">Dealer</span>' : ''}</span>
            ${over || !complete ? (best !== null && scores[i] === best && over ? '<span class="oh-exact-pill">Winner</span>' : '') : exact ? `<span class="oh-exact-pill">Exact +${pts}</span>` : `<span class="oh-miss-pill">Miss${pts ? ' +' + pts : ''}</span>`}</div>
          <div class="oh-controls">
            <div class="oh-stepper-group" data-kind="bid"><span class="oh-stepper-lbl">Bid</span>${step(i, 'bid', -1, 'Lower bid for ' + esc(p.name))}<span class="oh-step-val">${e.bid}</span>${step(i, 'bid', 1, 'Raise bid for ' + esc(p.name))}</div>
            <div class="oh-stepper-group" data-kind="tricks"><span class="oh-stepper-lbl">Won</span>${step(i, 'tricksWon', -1, 'Fewer tricks for ' + esc(p.name))}<span class="oh-step-val">${e.tricksWon}</span>${step(i, 'tricksWon', 1, 'More tricks for ' + esc(p.name))}</div>
          </div>
        </div>
        <div class="oh-row-right"><div class="oh-pts-box"><span class="oh-pts-num">${scores[i]}</span><span class="oh-pts-lbl">Points</span></div></div>
      </div>`;
    }).join('');
    const sc = byId('oh-screw-card'); if (sc) sc.classList.toggle('is-warning', !over && lv.violation);
    const dn = g.players[dealer] ? g.players[dealer].name : 'Dealer';
    set('oh-screw-sub', !rules.screwTheDealer ? '(Off \u2014 dealer may bid freely)' : over ? '(Dealer cannot even the bids)' : lv.forbidden === null ? `(${dn} cannot make bids total ${cards})` : lv.violation ? `${dn} cannot bid ${lv.forbidden} \u2014 change the dealer's bid` : `(${dn} cannot bid ${lv.forbidden})`);
    const st = byId('oh-screw-toggle'); if (st) st.checked = !!rules.screwTheDealer;
    set('oh-bonus-sub', `(+${rules.exactBonus} + tricks won${rules.missPointsPerTrick ? ` \u00b7 miss ${rules.missPointsPerTrick}/trick` : ''})`);
    const ub = byId('oh-btn-undo'); if (ub) ub.disabled = !g.rounds.length;
    const btn = byId('oh-btn-score'); if (btn) btn.disabled = over;
    set('oh-history-count', g.rounds.length + (g.rounds.length === 1 ? ' round' : ' rounds'));
    const hl = byId('oh-history-list');
    if (hl) hl.innerHTML = g.rounds.length ? g.rounds.slice().reverse().map((r) => `<div class="oh-history-item" data-round="${r.roundNumber}"><span style="flex:0 0 auto;font-weight:700">R${r.roundNumber} &middot; ${r.cardsDealt} card${r.cardsDealt === 1 ? '' : 's'}</span>
        <span style="min-width:0;text-align:right;overflow-wrap:anywhere">${g.players.map((p, i) => { const e = (r.entries || [])[i] || {}; return esc(p.name) + ' ' + (e.bid ?? '-') + '/' + (e.tricksWon ?? '-') + ' ' + signed((r.deltas || [])[i] || 0); }).join(', ')}</span></div>`).join('')
      : '<div class="oh-history-empty">No rounds recorded yet.</div>';
    ohMsg(ohForceMsg);
  }
  function ohCommit() { ohForceMsg = ''; persistActive(); renderOhHell(); }
  const OhHellUI = {
    render: () => { if (isOh()) renderOhHell(); },
    step(i, key, dir) {
      if (!isOh() || !currentGame.players[i] || currentGame.isGameOver) return; ohEnsure();
      const cards = currentGame.currentCards || 1, e = currentGame.ohDraft[i], k = key === 'bid' ? 'bid' : 'tricksWon';
      e[k] = Math.max(0, Math.min(cards, (Number(e[k]) || 0) + (dir < 0 ? -1 : 1)));
      ohCommit();
    },
    cycleTrump() {
      if (!isOh() || currentGame.isGameOver) return null; ohEnsure();
      const S = OHL().TRUMP_SUITS, cur = ohTrumpNow();
      const idx = S.findIndex((s) => s.key === cur.key);
      currentGame.ohTrump = S[(idx + 1) % S.length].key;
      ohCommit(); return currentGame.ohTrump;
    },
    toggleScrewDealer(checked) {
      if (!isOh()) return; const rules = ohEnsure();
      currentGame.ohHellRules = { ...rules, screwTheDealer: !!checked };
      currentGame.houseRules = { ...(currentGame.houseRules || {}), screwTheDealer: !!checked };
      ohCommit();
    },
    scoreRound() {
      if (!isOh() || currentGame.isGameOver) return null; ohEnsure();
      const g = currentGame, tr = ohTrumpNow();
      const res = OHL().scoreRound(g, g.ohDraft.map((e) => ({ bid: e.bid, tricksWon: e.tricksWon })), { trump: tr.key });
      if (!res.ok) { ohForceMsg = res.error || 'Could not score that round.'; renderOhHell(); return res; }
      ohForceMsg = ''; ohEnsure(); persistActive(); renderOhHell();
      if (res.isGameOver && typeof global.openEndGameModal === 'function') global.openEndGameModal();
      return res;
    },
    undoRound() {
      if (!isOh()) return null; ohEnsure();
      const res = OHL().undoLastRound(currentGame);
      ohEnsure(); ohCommit(); return res;
    }
  };

  // ---------------- v24 Qwirkle: Bright Playful Tile Grid (window.QwirkleUI backed by window.TallyItQwirkle) ----------------
  const QW_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'];
  const QW_SHAPES = ['circle', 'square', 'diamond', 'clover', 'star', 'burst'];
  let qwMsg = '';
  function qwFreshDraft(idx) { return { idx: typeof idx === 'number' ? idx : 0, points: 0, qwirkles: 0, wentOut: false, picked: null }; }
  function qwStartGame() {
    const L = QWL(); if (!L || !currentGame) return;
    currentGame.qw = L.initState({ players: currentGame.players.map((p) => ({ name: p.name })), houseRules: currentGame.houseRules || {}, target: currentGame.target || 0 });
    currentGame.qwDraft = qwFreshDraft(currentGame.qw.currentPlayerIndex);
    qwMsg = ''; qwSync();
  }
  function qwEnsure() {
    const L = QWL(); if (!L || !currentGame) return null;
    const q = currentGame.qw;
    if (!q || !Array.isArray(q.players) || q.players.length !== currentGame.players.length) qwStartGame();
    const d = currentGame.qwDraft;
    if (!d || typeof d.idx !== 'number' || d.idx < 0 || d.idx >= currentGame.players.length) currentGame.qwDraft = qwFreshDraft(currentGame.qw.currentPlayerIndex);
    return currentGame.qw;
  }
  // Mirror the Qwirkle state into the engine's shape so History, stats, sessions and cloud sync work like every other game
  function qwSync() {
    const q = currentGame && currentGame.qw; if (!q) return;
    currentGame.players.forEach((p, i) => {
      const s = q.players[i] || {};
      p.score = Number(s.score) || 0; p.qwirkles = Number(s.qwirkles) || 0; p.bestTurn = Number(s.bestTurn) || 0; p.turns = Number(s.turns) || 0;
      if (s.wentOut) p.wentOut = true; else delete p.wentOut;
    });
    currentGame.rounds = (q.history || []).map((h) => {
      const prev = h._snapshot && Array.isArray(h._snapshot.players) ? h._snapshot.players.map((p) => Number(p.score) || 0) : currentGame.players.map(() => 0);
      return { ts: h.at, by: h.playerIdx, mode: 'qwirkle', prev, deltas: currentGame.players.map((_, i) => (i === h.playerIdx ? h.total : 0)),
        detail: { player: h.playerIdx, points: h.points, qwirkles: h.qwirkles, wentOut: !!h.wentOut, tilesDrawn: h.tilesDrawn || 0, tilesInBag: h.tilesInBagAfter } };
    });
  }
  function qwDraftTotal(q, d) { return QWL().computeTurnPoints(q.rules, d.points, { qwirkles: d.qwirkles, wentOut: d.wentOut }).total; }
  function renderQwirkle() {
    const q = qwEnsure(); if (!q) return;
    const g = currentGame, d = g.qwDraft, n = g.players.length;
    const set = (id, t) => { const el = byId(id); if (el) el.textContent = t; };
    set('qw-turn-label', q.isGameOver ? 'Game over' + (q.winnerNames.length ? ' · ' + q.winnerNames.join(' & ') + (q.winnerNames.length > 1 ? ' tie' : ' wins') : '') : 'Turn ' + (q.turnNumber + 1));
    const bag = byId('qw-bag');
    if (bag) bag.hidden = !q.rules.trackBag || q.tilesInBag === null;
    set('qw-bag-count', q.tilesInBag === null ? '0' : String(q.tilesInBag));
    const last = new Array(n).fill(null);
    (q.history || []).forEach((h) => { last[h.playerIdx] = h.total; });
    const scores = q.players.map((p) => p.score), best = q.rules.lowWins ? Math.min(...scores) : Math.max(...scores);
    const anyTurns = (q.history || []).length > 0;
    const cards = byId('qw-player-cards');
    if (cards) cards.innerHTML = g.players.map((p, i) => {
      const cur = i === d.idx, lead = anyTurns && q.players[i].score === best, lt = last[i];
      const delta = lt === null ? '&ndash;' : (lt > 0 ? '+' + lt : '0');
      const dcls = lt === null || lt === 0 ? ' is-zero' : (lt < 4 ? ' is-low' : '');
      return `<button type="button" class="qw-pcard${cur ? ' is-current' : ''}${lead ? ' is-leader' : ''}" data-idx="${i}" role="option" aria-selected="${cur}" onclick="QwirkleUI.selectPlayer(${i})">
        <span class="qw-ptile qw-c-${QW_COLORS[i % 6]}"><svg><use href="#qw-sh-${QW_SHAPES[i % 6]}"/></svg></span>
        <span class="qw-pname">${esc(p.name)}</span>
        <span class="qw-ptotal">${q.players[i].score}</span>
        <span class="qw-pdelta${dcls}">${delta}</span>
      </button>`;
    }).join('');
    set('qw-turn-player', g.players[d.idx] ? g.players[d.idx].name : '');
    set('qw-turn-points', String(qwDraftTotal(q, d)));
    const eq = document.querySelector('#qw-turn-total .qw-turn-eq');
    if (eq) { eq.textContent = qwMsg || 'this turn'; eq.style.color = qwMsg ? '#C62828' : ''; eq.dataset.error = qwMsg ? '1' : ''; }
    document.querySelectorAll('#qw-chip-grid .qw-chip').forEach((c) => c.classList.toggle('is-picked', Number(c.dataset.pts) === d.picked));
    const qb = byId('qw-btn-qwirkle');
    if (qb) { qb.setAttribute('aria-pressed', String(d.qwirkles > 0)); qb.textContent = d.qwirkles > 1 ? `${d.qwirkles} Qwirkles +${d.qwirkles * q.rules.qwirkleBonus}` : `Qwirkle +${q.rules.qwirkleBonus}`; qb.disabled = q.isGameOver; }
    const wb = byId('qw-btn-wentout');
    if (wb) { wb.setAttribute('aria-pressed', String(!!d.wentOut)); wb.textContent = `Went Out +${q.rules.wentOutBonus}`; wb.disabled = q.isGameOver; }
    const add = byId('qw-btn-add');
    if (add) { add.disabled = q.isGameOver; add.textContent = q.isGameOver ? 'Game over · tap End to save' : (qwDraftTotal(q, d) === 0 ? 'Pass / Swap Tiles' : 'Add Turn'); }
    const undo = byId('qw-btn-undo'); if (undo) undo.disabled = !(q.history || []).length;
    const hist = QWL().getHistory(q);
    set('qw-history-count', hist.length + (hist.length === 1 ? ' turn' : ' turns'));
    const hl = byId('qw-history-list');
    if (hl) hl.innerHTML = hist.length ? hist.slice().reverse().map((h) => `<div class="qw-history-item" data-turn="${h.turn}">
        <span class="qw-h-turn">T${h.turn}</span> <strong class="qw-h-name">${esc(h.playerName)}</strong>
        <span class="qw-h-pts">${h.total > 0 ? '+' + h.total : (h.note ? esc(h.note) : '0')}</span>
        ${h.qwirkles ? `<span class="qw-h-tag">${h.qwirkles > 1 ? h.qwirkles + ' Qwirkles' : 'Qwirkle'}</span>` : ''}${h.wentOut ? '<span class="qw-h-tag">Went Out</span>' : ''}
        <span class="qw-h-run">${h.runningScore}</span>
      </div>`).join('') : '<div class="qw-history-empty">No turns recorded yet.</div>';
  }
  function qwCommit() { qwSync(); persistActive(); renderQwirkle(); }
  const QwirkleUI = {
    render: () => { if (isQw()) renderQwirkle(); },
    selectPlayer(i) { if (!isQw() || !currentGame.players[i]) return; qwEnsure(); currentGame.qwDraft.idx = i; qwMsg = ''; persistActive(); renderQwirkle(); },
    addPoints(n) {
      if (!isQw()) return; const q = qwEnsure(); if (q.isGameOver) return;
      const v = Math.max(0, Math.trunc(Number(n) || 0)); const d = currentGame.qwDraft;
      d.points = Math.min(999, d.points + v); d.picked = v; qwMsg = ''; persistActive(); renderQwirkle();
    },
    addCustom() {
      if (!isQw()) return; const inp = byId('qw-custom-input'); const v = inp ? Number(inp.value) : NaN;
      if (!Number.isFinite(v) || v <= 0) { qwMsg = 'Enter a points number first.'; renderQwirkle(); return; }
      if (inp) inp.value = '';
      QwirkleUI.addPoints(v); currentGame.qwDraft.picked = null; renderQwirkle();
    },
    clearTurn() { if (!isQw()) return; qwEnsure(); const d = currentGame.qwDraft; currentGame.qwDraft = qwFreshDraft(d.idx); qwMsg = ''; persistActive(); renderQwirkle(); },
    toggleQwirkle() { if (!isQw()) return; const q = qwEnsure(); if (q.isGameOver) return; const d = currentGame.qwDraft; d.qwirkles = (d.qwirkles + 1) % 3; qwMsg = ''; persistActive(); renderQwirkle(); },
    toggleWentOut() { if (!isQw()) return; const q = qwEnsure(); if (q.isGameOver) return; const d = currentGame.qwDraft; d.wentOut = !d.wentOut; qwMsg = ''; persistActive(); renderQwirkle(); },
    addTurn() {
      if (!isQw()) return null; const q = qwEnsure(), L = QWL(), d = currentGame.qwDraft;
      let res;
      if (!d.points && !d.qwirkles && !d.wentOut) res = L.passTurn(q, d.idx);
      // Went Out always ends the game here: the bag counter is a manual aid, so a table that says it is out wins the +6
      else res = L.scoreTurn(q, d.idx, d.points, { qwirkles: d.qwirkles, wentOut: d.wentOut, force: true });
      if (!res || !res.ok) { qwMsg = (res && res.error) || 'Could not add that turn.'; renderQwirkle(); return res || null; }
      if (d.wentOut && q.tilesInBag) q.tilesInBag = 0;
      currentGame.qwDraft = qwFreshDraft(q.currentPlayerIndex); qwMsg = '';
      qwCommit();
      if (q.isGameOver && typeof global.openEndGameModal === 'function') { try { global.openEndGameModal(); } catch (_) {} }
      return res;
    },
    undoTurn() {
      if (!isQw()) return null; const q = qwEnsure(); const res = QWL().undoLastTurn(q);
      if (!res.ok) return null;
      const u = res.undone;
      currentGame.qwDraft = { idx: u.playerIdx, points: u.points, qwirkles: u.qwirkles, wentOut: !!u.wentOut, picked: null }; qwMsg = '';
      qwCommit(); return u;
    },
    editBag() {
      if (!isQw()) return; const q = qwEnsure(); if (!q.rules.trackBag) return;
      const raw = global.prompt ? global.prompt('Tiles left in the bag', String(q.tilesInBag ?? 0)) : null;
      if (raw === null || raw === undefined) return;
      const v = Math.trunc(Number(raw));
      if (!Number.isFinite(v) || v < 0 || v > QWL().TOTAL_TILES) { qwMsg = 'Bag count must be 0 to ' + QWL().TOTAL_TILES + '.'; renderQwirkle(); return; }
      q.tilesInBag = v; qwMsg = ''; qwCommit();
    },
    setBag(v) { if (!isQw()) return; const q = qwEnsure(); const n = Math.trunc(Number(v)); if (!Number.isFinite(n) || n < 0 || n > QWL().TOTAL_TILES) return; q.tilesInBag = n; qwCommit(); },
    getState: () => (isQw() ? { qw: currentGame.qw, draft: { ...currentGame.qwDraft }, msg: qwMsg } : null)
  };
  function qwPrepareFinish(finished) {
    const L = QWL(), q = currentGame.qw;
    if (L && q) {
      if (!q.isGameOver) L.endGame(q, 'manual');
      qwSync();
      const st = L.getStats(q);
      finished.players = currentGame.players.map((p, i) => ({ ...p, isWinner: q.winnerIndices.includes(i) }));
      finished.rounds = currentGame.rounds;
      finished.houseRules = { ...(currentGame.houseRules || {}), ...q.rules };
      finished.meta = { ...(finished.meta || {}), qwirkle: { totalQwirkles: st.totalQwirkles, totalTurns: st.totalTurns, bestTurn: st.bestTurn, endReason: q.endReason, tilesInBag: q.tilesInBag } };
    }
    ['qw', 'qwDraft'].forEach((k) => delete finished[k]);
    return finished;
  }

  // ---------------- v25 Spoons: Kitchen Table Linen (window.SpoonsUI over window.TallyItSpoons) ----------------
  // The engine owns the open game (sessions, pause/resume, History); TallyItSpoons owns the knock-out state.
  // currentGame.spoons is a snapshot of TallyItSpoons.getRawState(); the module is re-seeded from it when this game is shown.
  let spLoadedId = null, spPendingRecord = null;
  function spSync() {
    const L = SPL(); if (!L || !currentGame) return;
    const raw = L.getRawState(), st = L.getState(); if (!raw || !st) return;
    const n = currentGame.players.length;
    currentGame.spoons = raw;
    currentGame.players.forEach((p, i) => {
      const s = st.players[i]; if (!s) return;
      p.score = n - s.place; p.place = s.place;
      if (s.outRound != null) p.outRound = s.outRound; else delete p.outRound;
    });
    currentGame.rounds = raw.eliminations.map((e) => ({ ts: e.at, by: e.playerIndex, mode: 'spoons', prev: [], deltas: [], detail: { round: e.round, eliminated: e.player } }));
  }
  function spStartGame() {
    const L = SPL(); if (!L || !currentGame) return;
    const seen = new Set();
    currentGame.players.forEach((p, i) => {
      let name = String(p.name || '').trim() || 'Player ' + (i + 1), k = 2;
      while (seen.has(name.toLowerCase())) name = String(p.name).trim() + ' ' + (k++);
      p.name = name; seen.add(name.toLowerCase());
    });
    spLoadedId = currentGame.id;
    L.start(currentGame.players.map((p) => ({ name: p.name, userId: p.userId || null })));
    spSync();
  }
  function spEnsure() {
    const L = SPL(); if (!L || !currentGame) return;
    if (spLoadedId === currentGame.id && L.getState()) return;
    const raw = currentGame.spoons;
    if (raw && Array.isArray(raw.players) && raw.players.length === currentGame.players.length) {
      spLoadedId = currentGame.id;
      if (typeof L.restore === 'function') L.restore(raw);
      else { try { localStorage.setItem(L.LS_KEY, JSON.stringify(raw)); } catch (_) {} L.resume(); }
      if (!L.getState()) spStartGame();
    } else spStartGame();
  }
  function renderSpoons() { spEnsure(); if (global.SpoonsUI) global.SpoonsUI.render(); }
  document.addEventListener('tallyit:spoons-change', (e) => {
    if (!e.detail || !isSp() || spLoadedId !== currentGame.id) return;
    spSync(); if (currentGame.v20Recorded) persistActive();
  });
  function spPrepareFinish(finished) {
    const L = SPL(); spEnsure();
    const raw = L ? L.getRawState() : null;
    if (L && raw) {
      const rec = spPendingRecord || L.toGameRecord(raw);
      finished.players = currentGame.players.map((p, i) => ({ ...p, score: rec.players[i].score, place: rec.players[i].place, eliminatedRound: rec.players[i].eliminatedRound }));
      finished.winnerNames = rec.winnerNames;
      finished.meta = { ...(finished.meta || {}), spoons: rec.meta };
    }
    spPendingRecord = null; delete finished.spoons;
    if (L) { spLoadedId = null; L.reset(); }
    return finished;
  }
  // The save hook TallyItSpoons.finishAndSave() hands its record to: lands the open Spoons game in History like every other game
  global.TallyItSaveGame = (rec) => { if (!isSp()) return null; spPendingRecord = rec || null; return endGame(); };

  // ---------------- v24 Link players after a game + claim flow (V24Link UI <-> TallyItV24Backend) ----------------
  const V24B = () => global.TallyItV24Backend || null;
  const V24L = () => global.V24Link || null;
  const v24Ready = () => !!(V24B() && currentUser && V24B().isMigrationReady() !== false);
  function v24Flatten(players) {
    const out = [];
    (players || []).forEach((p) => {
      if (Array.isArray(p.members) && p.members.length) p.members.forEach((m) => out.push({ name: m.name, userId: m.userId || m.user_id || null }));
      else out.push({ name: p.name, userId: p.userId || p.user_id || null });
    });
    return out.map((p) => ({ ...p, claimStatus: p.userId ? 'linked' : null }));
  }
  function v24FindEntry(gameId) {
    const id = String(gameId || '');
    return historyEntries().find((g) => g && (String(g.sharedGameId || '') === id || String(g.id || '') === id)) || null;
  }
  function v24GameFor(g) {
    if (!g || !g.sharedGameId) return null; // only cloud-synced games can be linked server-side
    return { id: String(g.sharedGameId), label: gameLabel(g), date: new Date(g.endTime || g.startTime || Date.now()).toLocaleDateString(), createdBy: g.createdBy || null, players: v24Flatten(g.players) };
  }
  function v24LinkButton(g) {
    const L = V24L(); if (!L || !v24Ready()) return '';
    const game = v24GameFor(g); if (!game) return '';
    try { const html = L.renderLinkButton(game); return html ? `<div class="v24-link-slot">${html}</div>` : ''; } catch (_) { return ''; }
  }
  const v24Err = (r, fallback) => new Error((r && r.error) || fallback);
  // Keep the local copy (guest history in localStorage) in step with the cloud link, via TallyItPlayerLink
  function v24LinkLocal(gameId, playerName, user) {
    const PL = global.TallyItPlayerLink; if (!PL) return false;
    const e = v24FindEntry(gameId); const localId = e ? String(e.id || '') : '';
    const i = localId ? history.findIndex((h) => h && String(h.id || '') === localId) : -1;
    if (i < 0) return false;
    const r = PL.linkParticipant(history[i], playerName, user);
    if (r && r.ok) { history[i] = r.record; saveCache(true); saveData(); return true; }
    return false;
  }
  const V24_ADAPTER = {
    getCurrentUserId: () => (currentUser ? currentUser.id : null),
    getGame: async (gameId) => { const g = v24GameFor(v24FindEntry(gameId)); if (!g) throw new Error('This game has not synced to the cloud yet, so it cannot be linked.'); return g; },
    getFriends: async () => (social.friends.accepted || []).map((f) => ({ userId: f.userId, displayName: f.displayName || f.name || 'Friend', friendCode: f.friendCode || '' })),
    assignToFriend: async (gameId, playerName, friendUserId) => {
      const r = await V24B().linkGameParticipant(gameId, playerName, friendUserId);
      if (!r || !r.ok) throw v24Err(r, 'Could not link that player.');
      const f = (social.friends.accepted || []).find((x) => String(x.userId) === String(friendUserId));
      v24LinkLocal(gameId, playerName, { userId: friendUserId, displayName: (f && (f.displayName || f.name)) || r.display_name || playerName });
      return { ok: true };
    },
    createClaim: async (gameId, playerName) => {
      const r = await V24B().createParticipantClaim(gameId, playerName);
      if (!r || !r.ok) throw v24Err(r, 'Could not create a claim link.');
      return { code: r.token, url: r.url || V24B().buildClaimUrl(r.token), expiresAt: r.expires_at || null };
    },
    // no revokeClaim: there is no revoke RPC yet, so V24Link hides the Revoke button
    lookupClaim: async (code) => {
      const B = V24B(); const token = B.parseClaimToken(code);
      if (!token) throw new Error('That does not look like a TallyIt claim link or code.');
      const r = await B.previewParticipantClaim(token);
      if (!r || !r.ok) throw v24Err(r, 'Could not check that claim.');
      if (r.status && r.status !== 'open') {
        if (B.getPendingClaim() === token) B.clearPendingClaim();
        throw new Error(r.status === 'claimed' ? 'This game has already been claimed.' : r.status === 'expired' ? 'This claim link has expired. Ask the host for a new one.' : 'This claim link is no longer active.');
      }
      const label = gameById(r.game_type).name + (r.creator_name ? ' with ' + r.creator_name : '');
      return [{ token, gameId: r.game_id || token, label, date: r.ended_at ? new Date(r.ended_at).toLocaleDateString() : '', playerName: r.participant_name || '' }];
    },
    getSuggestions: async () => {
      const B = V24B(); if (!B || !currentUser) return [];
      const r = await B.suggestMyUnlinkedGames();
      if (!r || !r.ok) return [];
      return (r.suggestions || []).map((s) => ({ participantId: s.participant_id, gameId: s.game_id, label: gameById(s.game_type).name + (s.creator_name ? ' with ' + s.creator_name : ''),
        date: s.ended_at ? new Date(s.ended_at).toLocaleDateString() : '', playerName: s.participant_name || '' }));
    },
    confirmClaims: async (items) => {
      const B = V24B(); let claimed = 0, lastErr = null;
      for (const it of items || []) {
        let r;
        if (it.token) r = B.getPendingClaim() === it.token ? await B.consumePendingClaim() : await B.claimGameParticipant(it.token);
        else if (it.participantId) r = await B.claimSuggestedParticipant(it.participantId);
        if (r && r.ok) claimed++; else lastErr = r;
      }
      if (!claimed) throw v24Err(lastErr, 'Could not claim those games.');
      return { ok: true, claimed };
    },
    onLinked: () => { v24AfterLink(); }
  };
  let v24LinkTimer = null;
  function v24AfterLink() {
    clearTimeout(v24LinkTimer);
    v24LinkTimer = setTimeout(async () => {
      try { await refreshSocial(true); } catch (_) {}
      if (currentView === 'history') renderHistory();
      if (currentView === 'new') renderHome();
    }, 150);
  }
  async function v24RefreshSuggestions() {
    const L = V24L(); if (!L || !currentUser || !V24B()) return;
    try { await L.refreshSuggestions(); } catch (_) {}
    if (V24B().isMigrationReady() === false && currentView === 'history') renderHistory();
  }
  // After sign-in: a ?claim= link captured at boot (TallyItV24Backend.capturePendingClaimFromUrl) opens the "Is this you?" sheet
  async function v24HandlePendingClaim() {
    const B = V24B(), L = V24L(); if (!B || !L || !currentUser) return false;
    const token = B.getPendingClaim(); if (!token) return false;
    const pv = await B.previewParticipantClaim(token);
    if (pv && pv.unavailable) return false; // migration not run yet: keep the token for later
    if (pv && !pv.ok && pv.code === 'invalid_token') { B.clearPendingClaim(); return false; }
    await L.openClaimSheet(token);
    return true;
  }
  function v24Init() {
    const bind = () => { const L = V24L(); if (L) L.setBackend(V24_ADAPTER); return !!L; };
    if (!bind() && typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', bind, { once: true });
    global.addEventListener('tallyit:participant-linked', () => v24AfterLink());
  }
  v24Init();

  function renderHistory() {
    const el = byId('history-list');
    // v27: the hybrid History list (v27_history_list.js) owns #history-list when it is loaded; classic list below is the fallback
    const v27 = global.TallyItV27HistoryList;
    if (v27 && typeof v27.render === 'function' && el) { try { if (v27.render(el) !== false) return; } catch (e) { console.warn('[v27] history list failed, showing the classic list:', e); } }
    renderHistoryFilter();
    const entries = historyEntries().filter((g) => historyFilter === 'all' || String(g.groupId || '') === historyFilter);
    if (!entries.length) { el.innerHTML = `<p class="small">${historyFilter === 'all' ? 'Nothing here yet.' : 'No games for this group yet.'}</p>`; return; }
    const ui = SUI(), uid = currentUser ? currentUser.id : null;
    el.innerHTML = entries.map((g) => {
      const i = history.findIndex((h) => h && h.id && String(h.id) === String(g.id));
      const sharedId = g.sharedGameId || (g.source === 'shared' ? g.id : '');
      const isOwner = !!(uid && g.createdBy && String(g.createdBy) === String(uid));
      const canDelete = i >= 0 || isOwner;
      const sharedBy = g.createdBy && uid && String(g.createdBy) !== String(uid) ? (g.sharedByName || 'a friend') : '';
      const badges = ui ? ui.renderHistoryBadges({ groupName: g.groupName, sharedByName: sharedBy }) : '';
      return `
      <div class="history-item" data-game-id="${esc(g.id)}"${sharedId ? ` data-shared-id="${esc(sharedId)}"` : ''}${g.groupId ? ` data-group-id="${esc(g.groupId)}"` : ''}>
        <div class="flex space-between" style="flex-wrap:nowrap">
          <div><strong>${esc(gameLabel(g))}</strong>${g.version ? ` <span class="small">· ${esc(g.version)}</span>` : ''}
            <div class="small">${esc(new Date(g.endTime || g.startTime || Date.now()).toLocaleDateString())}</div></div>
          ${canDelete ? `<button class="btn danger sm" type="button" aria-label="Delete game" onclick="deleteHistoryEntry('${esc(g.id || '')}','${esc(sharedId || '')}')">×</button>` : ''}
        </div>${badges}
        <div style="margin-top:.3rem">${[...(g.players || [])].sort((a, b) => ((typeof g.low === 'boolean' ? g.low : g.meta && typeof g.meta.low === 'boolean' ? g.meta.low : gameById(g.type).low) ? a.score - b.score : b.score - a.score)).map((p) => `${esc(p.name)}${Array.isArray(p.members) && p.members.length ? ` <span class="small">(${esc(p.members.map((m) => m.name).join(' & '))})</span>` : ''}: <strong>${p.score}</strong>`).join(' · ')}</div>
        <div class="winner">Winner: ${esc(g.winner || '—')}</div>${diceHistoryLine(g)}${window.V24Link ? v24LinkButton(g) : ''}
      </div>`;
    }).join('');
  }
  // v23: delete any game you own from History — local entries AND cloud-synced public.games rows (never resurrects on reload)
  async function deleteHistoryEntry(gameId, sharedId) {
    const gid = String(gameId || '').trim();
    const sid = String(sharedId || '').trim();
    const localIdx = gid ? history.findIndex((h) => h && String(h.id || '') === gid) : -1;
    const sharedRow = (social.shared || []).find((s) => s && ((sid && String(s.id) === sid) || (gid && (String(s.id) === gid || String(s.client_game_id || '') === gid))));
    const uid = currentUser ? String(currentUser.id) : null;
    const ownsShared = !!(sharedRow && uid && String(sharedRow.created_by || '') === uid);
    const resolvedSharedId = sid || (sharedRow ? String(sharedRow.id) : '');
    if (localIdx < 0 && !ownsShared && !resolvedSharedId) return false;
    if (!confirm('Delete this game from history?')) return false;
    if (localIdx >= 0) history.splice(localIdx, 1);
    const matchesEntry = (s) => s && (
      (resolvedSharedId && String(s.id) === resolvedSharedId) ||
      (gid && (String(s.id) === gid || String(s.client_game_id || '') === gid))
    );
    if (Array.isArray(social.shared)) social.shared = social.shared.filter((s) => !matchesEntry(s));
    if (social.groupShared && typeof social.groupShared === 'object') {
      Object.keys(social.groupShared).forEach((k) => { if (Array.isArray(social.groupShared[k])) social.groupShared[k] = social.groupShared[k].filter((s) => !matchesEntry(s)); });
    }
    renderHistory();
    saveData();
    const api = SAPI();
    if (api && typeof api.deleteSharedGame === 'function' && uid && (ownsShared || resolvedSharedId || gid)) {
      try {
        const r = await api.deleteSharedGame(resolvedSharedId || null, { clientGameId: gid || null });
        if (r && !r.ok) console.warn('[social] deleteSharedGame failed:', r.error);
      } catch (e) { console.warn('[social] deleteSharedGame error:', e); }
    }
    return true;
  }
  function deleteGame(i) {
    const h = history[i];
    if (!h) return false;
    return deleteHistoryEntry(h.id || '', '');
  }
  // v26: History past-game detail seam for v26_history_detail.js (read the merged list + write an edited local record back)
  global.TallyItV26HistoryEngine = {
    entries: () => historyEntries(), user: () => currentUser, games: () => GAMES,
    local: (id) => history.find((h) => h && String(h.id || '') === String(id || '')) || null,
    applyLocalEdit(id, rec) {
      const i = history.findIndex((h) => h && String(h.id || '') === String(id || ''));
      if (i < 0 || !rec) return false;
      history[i] = { ...rec, id: history[i].id }; saveCache(true); saveData();
      if (currentView === 'history') renderHistory();
      return true;
    },
    refresh: () => { if (currentView === 'history') renderHistory(); }, refreshSocial: () => refreshSocial(),
    // v27: read-only helpers for the hybrid History list + the detail sheet's owner-only Delete (reuses deleteHistoryEntry and its confirm)
    groups: () => {
      const map = new Map((social.groups || []).map((g) => [String(g.id), g.name]));
      history.forEach((h) => { if (h && h.groupId && !map.has(String(h.groupId))) map.set(String(h.groupId), h.groupName || 'Group'); });
      return [...map].map(([id, name]) => ({ id, name }));
    },
    canDelete: (e) => {
      if (!e) return false;
      const by = e.createdBy || e.created_by || null, uid = currentUser ? String(currentUser.id) : null;
      if (by) return !!(uid && String(by) === uid);
      return history.some((h) => h && String(h.id || '') === String(e.id || ''));
    },
    deleteEntry: (gameId, sharedId) => deleteHistoryEntry(gameId, sharedId),
    linkButton: (e) => (global.V24Link && e ? v24LinkButton(e) : '')
  };

  // ---------------- Social layer: you + friends + groups ----------------
  const lc = (s) => String(s || '').trim().toLowerCase();
  function provisionalSelf(user) {
    const api = SAPI(), dp = api && api.getDefaultPlayer ? api.getDefaultPlayer() : null;
    if (dp && dp.user_id === user.id) return { name: dp.name, userId: dp.user_id, friendCode: dp.friend_code || '', isSelf: true };
    const meta = user.user_metadata || {};
    let name = String(meta.full_name || meta.name || meta.display_name || '').trim();
    if (!name && user.email) name = String(user.email).split('@')[0].replace(/[._-]+/g, ' ').trim().split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    return { name: (name || 'Me').slice(0, 40), userId: user.id, friendCode: '', isSelf: true };
  }
  function resetSocialState() {
    const api = SAPI(); if (api && api.reset) api.reset();
    selfPlayer = null; selfIncluded = true; setupFriends = []; setupGroup = null; historyFilter = 'all';
    groupModalGuests = []; groupModalPicks = new Set();
    social = { profile: null, friends: { accepted: [], incoming: [], outgoing: [] }, groups: [], shared: [], groupShared: {}, ready: false };
    const ui = SUI(); if (ui) ui.closeCreateGroupModal();
    setHidden(byId('nav-social-dot'), true); setHidden(byId('soc-demo-banner'), true);
    lastFriendsError = null; showFriendsError(null); setSocialLoading(false); closeMyQrModal(); closeScanQrModal();
  }
  async function socialInit(user) {
    const api = SAPI(); if (!api || !user) return;
    try {
      const r = await api.ensureProfile(user);
      if (!currentUser || currentUser.id !== user.id) return;
      if (r && r.profile) {
        social.profile = r.profile;
        const dp = r.defaultPlayer;
        if (dp) selfPlayer = { name: dp.name, userId: dp.user_id || user.id, friendCode: dp.friend_code || '', isSelf: true };
      }
      if (typeof unsubFriendships === 'function') { unsubFriendships(); unsubFriendships = null; }
      if (typeof api.subscribeToFriendships === 'function') {
        unsubFriendships = api.subscribeToFriendships(() => {
          if (currentUser && currentUser.id === user.id) refreshSocial();
        });
      }
      if (typeof unsubMyGames === 'function') { unsubMyGames(); unsubMyGames = null; }
      if (typeof api.subscribeToMyGames === 'function') {
        unsubMyGames = api.subscribeToMyGames(user.id, () => { if (currentUser && currentUser.id === user.id) { clearTimeout(myGamesPing); myGamesPing = setTimeout(() => refreshSocial(false, true), 400); } });
      }
      await refreshSocial();
      await consumePendingFriendInvite();
      try { await v24HandlePendingClaim(); } catch (e) { console.warn('[v24] claim link failed', e); }
      v24RefreshSuggestions();
    } catch (e) { console.warn('[social] init failed', e); }
  }
  let refreshSeq = 0;
  let lastSocialRefreshAt = 0;
  let unsubFriendships = null;
  let unsubMyGames = null, myGamesPing = null;
  let lastFriendsError = null;
  const sameId = (a, b) => !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase();
  function setSocialLoading(on) {
    const btn = byId('btn-refresh-social');
    if (btn) { btn.classList.toggle('is-loading', !!on); btn.setAttribute('aria-busy', on ? 'true' : 'false'); }
    setHidden(byId('soc-loading-banner'), !on);
  }
  function showFriendsError(msg) {
    const banner = byId('soc-error-banner');
    if (byId('soc-error-text') && msg) byId('soc-error-text').textContent = 'Could not refresh friends: ' + msg;
    setHidden(banner, !msg);
  }
  // Keep quick-added friends in sync with the accepted list, but never strip members of an active Group preset
  function pruneSetupFriends() {
    const acc = social.friends.accepted || [];
    if (!setupGroup) { setupFriends = setupFriends.filter((f) => acc.some((a) => sameId(a.userId, f.userId))); return; }
    const g = (social.groups || []).find((x) => String(x.id) === String(setupGroup.id));
    const memberIds = [...(setupGroup.memberIds || []), ...((g && g.members) || []).map((m) => m && m.userId).filter(Boolean)];
    setupFriends = setupFriends.filter((f) => acc.some((a) => sameId(a.userId, f.userId)) || memberIds.some((id) => sameId(id, f.userId)));
  }
  function applyFriendsResult(fr) {
    if (!fr) return;
    if (fr.error) {
      lastFriendsError = fr.error;
      console.warn('[social] listFriends error:', fr.error, fr.errorCode || '');
      // keep what we already show; only seed from the (local) result before the first successful load
      if (!social.ready) social.friends = { accepted: fr.accepted || [], incoming: fr.incoming || [], outgoing: fr.outgoing || [] };
    } else {
      lastFriendsError = null;
      social.friends = { accepted: fr.accepted || [], incoming: fr.incoming || [], outgoing: fr.outgoing || [] };
    }
    showFriendsError(lastFriendsError);
  }
  async function refreshSocial(force, silent) {
    const api = SAPI(), user = currentUser; if (!api || !user) return;
    const seq = ++refreshSeq;
    lastSocialRefreshAt = Date.now();
    const stale = () => !currentUser || currentUser.id !== user.id || seq !== refreshSeq;
    if (!silent) setSocialLoading(true);
    try {
      const frP = api.listFriends().catch((e) => ({ error: (e && e.message) || 'Failed to load friends.' }));
      const grP = api.listGroups().catch(() => null);
      const mgP = api.loadMyGames({ includeLegacy: false }).catch(() => null);
      // Friends first: render incoming/sent/accepted as soon as listFriends() resolves (never wait on game queries)
      const fr = await frP;
      if (stale()) return;
      applyFriendsResult(fr);
      pruneSetupFriends();
      updateNavDot();
      if (currentView === 'social') renderSocial();
      else if (currentView === 'new') renderSetupPlayers();
      const [gr, mg] = await Promise.all([grP, mgP]);
      if (stale()) return;
      if (gr) social.groups = gr.groups || [];
      if (mg) social.shared = (mg.games || []).filter((g) => g && g.shared === true);
      // Group games played without you (visible to members once the migration is live)
      const groupShared = {};
      if (api.isMigrationReady() === true) {
        await Promise.all(social.groups.filter((g) => !/^local-/.test(String(g.id))).map(async (g) => {
          const r = await api.loadGroupGames(g.id).catch(() => null);
          if (r && !r.isFallback) groupShared[g.id] = (r.games || []).filter((x) => x && x.shared === true);
        }));
      }
      if (stale()) return;
      social.groupShared = groupShared;
      if (api.isMigrationReady() === true) syncStatus('Synced', false);
      if (selfPlayer && social.profile && social.profile.display_name) selfPlayer.name = social.profile.display_name;
      if (gr && setupGroup && !social.groups.some((g) => String(g.id) === String(setupGroup.id))) setupGroup = null;
      pruneSetupFriends();
      social.ready = true;
    } catch (e) { console.warn('[social] refresh failed', e); }
    finally { if (seq === refreshSeq && !silent) setSocialLoading(false); }
    if (stale()) return;
    if (silent) { if (currentView === 'history') renderHistory(); else if (currentView === 'new') renderHome(); updateNavDot(); return; }
    rerenderSocialViews();
  }
  function rerenderSocialViews() {
    updateNavDot();
    if (currentView === 'new') renderSetupPlayers();
    else if (currentView === 'social') renderSocial();
    else if (currentView === 'history') renderHistory();
  }
  function updateNavDot() { setHidden(byId('nav-social-dot'), !(social.friends.incoming || []).length); }
  const memberName = (m) => (m && (m.displayName || m.display_name || m.name)) || 'Player';

  // ----- Setup (Choose Game) players: (You) + friends + guests -----
  function hiddenRosterNames() {
    const set = new Set();
    if (selfPlayer) set.add(lc(selfPlayer.name));
    setupFriends.forEach((f) => set.add(lc(f.name)));
    return set;
  }
  function setupParticipants() {
    const out = [], seen = new Set();
    const push = (pt) => { const k = lc(pt.name); if (!k || seen.has(k)) return; seen.add(k); out.push(pt); };
    if (selfPlayer && selfIncluded) push({ name: selfPlayer.name, userId: selfPlayer.userId, isSelf: true });
    setupFriends.forEach((f) => push({ name: f.name, userId: f.userId }));
    const hide = hiddenRosterNames();
    players.filter((p) => !deselected.has(p) && !hide.has(lc(p))).forEach((p) => push({ name: p }));
    return out;
  }
  function renderSetupPlayers() {
    const chipsEl = byId('player-chips'); if (!chipsEl) return;
    const ui = SUI(), chips = [], hide = hiddenRosterNames();
    if (selfPlayer && selfIncluded) chips.push(`<span class="player-chip is-self" id="chip-self"><span>${esc(selfPlayer.name)}</span> <span class="soc-you-badge">You</span>
        <button type="button" class="chip-remove" id="btn-remove-self" aria-label="Remove yourself" onclick="removeSelf()">×</button></span>`);
    setupFriends.forEach((f) => chips.push(`<span class="player-chip is-friend" data-friend="${esc(f.userId)}"><span class="soc-friend-dot" aria-hidden="true"></span><span>${esc(f.name)}</span>
        <button type="button" class="chip-remove" aria-label="Remove ${esc(f.name)}" onclick="removeSetupFriend('${esc(f.userId)}')">×</button></span>`));
    players.forEach((p, i) => {
      if (hide.has(lc(p))) return;
      chips.push(`<label class="player-chip"><input type="checkbox" data-player="${i}" ${deselected.has(p) ? '' : 'checked'} onchange="togglePlayer(${i}, this.checked)"> ${esc(p)}
          <button type="button" class="chip-remove" aria-label="Remove ${esc(p)}" onclick="event.preventDefault(); removePlayer(${i})">×</button></label>`);
    });
    if (selfPlayer && !selfIncluded) chips.push(`<button type="button" class="soc-friend-pick soc-add-self" id="btn-add-self" onclick="addSelf()"><span>+</span><span>Add me (${esc(selfPlayer.name)})</span></button>`);
    chipsEl.innerHTML = chips.length ? chips.join('') : '<span class="small">Add players below</span>';
    v21UpdateSetupMeta();
    const note = byId('setup-active-group-note');
    setHidden(note, !setupGroup);
    if (setupGroup && byId('setup-active-group-label')) byId('setup-active-group-label').innerHTML = '<svg class="v24-2-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8.5" r="3.25"/><path d="M3.5 19.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/><circle cx="16.5" cy="9.5" r="2.5"/><path d="M16.5 14.5c2.2 0 4 1.5 4 4.5"/></svg><span>Playing as group: ' + esc(setupGroup.name) + '</span>';
    const groups = social.groups || [], acc = social.friends.accepted || [];
    setHidden(byId('setup-groups-wrap'), !groups.length);
    setHidden(byId('setup-friends-wrap'), !acc.length);
    if (ui) {
      const gp = byId('setup-group-presets'); if (gp) gp.innerHTML = groups.map((g) => ui.renderGroupPresetPill(g, !!(setupGroup && setupGroup.id === g.id))).join('');
      const fp = byId('setup-friend-picks'); if (fp) fp.innerHTML = acc.map((f) => ui.renderFriendPickPill(f, setupFriends.some((s) => s.userId === f.userId))).join('');
    }
  }
  function removeSelf() { selfIncluded = false; renderSetupPlayers(); }
  function addSelf() { selfIncluded = true; renderSetupPlayers(); }
  function removeSetupFriend(uid) { setupFriends = setupFriends.filter((f) => f.userId !== uid); renderSetupPlayers(); }
  function toggleSetupFriend(uid) {
    if (setupFriends.some((f) => f.userId === uid)) { setupFriends = setupFriends.filter((f) => f.userId !== uid); }
    else {
      const f = (social.friends.accepted || []).find((a) => a.userId === uid);
      if (!f) return false;
      setupFriends.push({ name: memberName(f), userId: f.userId });
    }
    if (currentView === 'new') renderSetupPlayers();
    return setupFriends.some((f) => f.userId === uid);
  }
  function includeFriendInNextGame(uid) {
    const on = toggleSetupFriend(uid);
    const f = (social.friends.accepted || []).find((a) => a.userId === uid);
    socMsg('soc-friend-msg', f ? (on ? `${memberName(f)} will be in your next game.` : `${memberName(f)} removed from your next game.`) : '', 'success');
    renderSocial();
  }
  function groupPresetSource(g) {
    return { id: g.id, name: g.name, members: (g.members || []).map((m) => ({ name: memberName(m), userId: m.userId || null, isGuest: !m.userId })) };
  }
  function applyGroupPreset(groupId) {
    const g = (social.groups || []).find((x) => String(x.id) === String(groupId)); if (!g) return null;
    const sc = SSC(), uid = currentUser ? currentUser.id : null;
    const res = sc ? sc.applyGroupPreset(groupPresetSource(g), { currentUserId: uid })
      : { players: groupPresetSource(g).members.map((m) => ({ ...m, isSelf: m.userId === uid })), groupId: g.id, groupName: g.name };
    selfIncluded = true;
    setupFriends = res.players.filter((p) => p.userId && !p.isSelf && String(p.userId) !== String(uid)).map((p) => ({ name: p.name, userId: p.userId }));
    const guests = res.players.filter((p) => !p.userId).map((p) => p.name);
    let changed = false;
    guests.forEach((n) => { if (!players.some((p) => lc(p) === lc(n))) { players.push(n); changed = true; } });
    const keep = new Set(guests.map(lc));
    players.forEach((p) => { if (keep.has(lc(p))) deselected.delete(p); else deselected.add(p); });
    setupGroup = { id: String(res.groupId), name: res.groupName || g.name, memberIds: (g.members || []).map((m) => m && m.userId).filter(Boolean).map(String) };
    if (currentView === 'new') renderSetupPlayers();
    if (changed) saveData();
    return setupGroup;
  }
  function clearSetupGroup() { setupGroup = null; renderSetupPlayers(); }
  function startGameWithGroup(groupId) { if (applyGroupPreset(groupId)) v21OpenSetup(); }

  // ----- Friends & Groups view -----
  function socMsg(id, text, tone) { const el = byId(id); if (el) { el.textContent = text || ''; el.dataset.tone = tone || ''; } }
  function groupGames(g) {
    const sc = SSC(), uid = currentUser ? currentUser.id : null;
    const local = history.filter((h) => h && String(h.groupId || h.group_id || '') === String(g.id));
    const shared = [...(social.shared || []), ...((social.groupShared || {})[g.id] || [])].filter((x) => String(x.group_id || '') === String(g.id)).map(adaptShared);
    if (!sc) return local;
    return sc.mergePersonalHistory(shared, local, uid, { includeAllShared: true }).filter((r) => String(r.groupId || '') === String(g.id));
  }
  function groupForUi(g) {
    const sc = SSC(), uid = currentUser ? currentUser.id : null;
    const games = groupGames(g);
    const members = (g.members || []).map((m) => ({ name: m.userId && String(m.userId) === String(uid) && selfPlayer ? selfPlayer.name : memberName(m), userId: m.userId || null }));
    const type = groupLbFilter[g.id] || 'all';
    const lb = sc ? sc.computeGroupLeaderboard(games, members, { gameType: type }) : [];
    const typesPlayed = [...new Set(games.map((x) => x.type))];
    const filterHtml = `<div class="soc-lb-filter-row"><span class="soc-code-label">Group Leaderboard</span>
        <select class="soc-lb-filter" data-group-id="${esc(g.id)}" aria-label="Filter leaderboard by game" onchange="setGroupLbFilter('${esc(g.id)}', this.value)">
          <option value="all"${type === 'all' ? ' selected' : ''}>All games</option>
          ${GAMES.filter((x) => typesPlayed.includes(x.id) || x.id === type).map((x) => `<option value="${x.id}"${type === x.id ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}
        </select></div>`;
    return {
      id: g.id, name: g.name, members: members.map((m) => ({ name: m.name + (m.userId && String(m.userId) === String(uid) ? ' (You)' : '') })),
      leaderboard: lb.map((r) => ({ name: r.name, wins: r.wins, gamesPlayed: r.gamesPlayed, winRate: r.winRatePct, isSelf: !!(r.userId && String(r.userId) === String(uid)) })),
      recentGames: games.filter((x) => type === 'all' || x.type === type).slice(0, 3).map((x) => ({ gameName: gameById(x.type).name, winnerName: x.winner || '—', dateLabel: new Date(x.endTime || x.startTime || Date.now()).toLocaleDateString() })),
      filterHtml
    };
  }
  function renderSocial() {
    const view = byId('view-social'); if (!view) return;
    const api = SAPI(), ui = SUI();
    setHidden(byId('soc-demo-banner'), !(api && api.isMigrationReady() === false));
    const prof = social.profile || {};
    const name = prof.display_name || (selfPlayer && selfPlayer.name) || '';
    const inp = byId('soc-display-name');
    if (inp && document.activeElement !== inp) inp.value = name;
    if (byId('soc-friend-code')) byId('soc-friend-code').textContent = prof.friend_code || '—';
    if (byId('soc-my-avatar')) byId('soc-my-avatar').textContent = (name.trim().charAt(0) || '?').toUpperCase();
    const fr = social.friends, incoming = fr.incoming || [], outgoing = fr.outgoing || [], accepted = fr.accepted || [];
    const badge = byId('soc-pending-badge'); if (badge) { badge.textContent = String(incoming.length); setHidden(badge, !incoming.length); }
    const setTxt = (id, v) => { const el = byId(id); if (el) el.textContent = String(v); };
    setTxt('soc-incoming-count', incoming.length); setTxt('soc-sent-count', outgoing.length); setTxt('soc-friends-count', accepted.length);
    updateNavDot();
    showFriendsError(lastFriendsError);
    setHidden(byId('soc-pending-card'), !incoming.length);
    setHidden(byId('soc-sent-card'), !outgoing.length);
    if (ui) {
      byId('soc-pending-list').innerHTML = incoming.map((r) => ui.renderPendingRequestRow({ friendshipId: r.friendshipId, id: r.friendshipId, displayName: r.displayName, friendCode: r.friendCode })).join('');
      const sent = byId('soc-sent-list');
      if (sent) sent.innerHTML = outgoing.map((r) => (typeof ui.renderSentRequestRow === 'function'
        ? ui.renderSentRequestRow({ friendshipId: r.friendshipId, id: r.friendshipId, displayName: r.displayName, friendCode: r.friendCode })
        : `<div class="soc-sent-row"><div class="soc-row-main"><div class="soc-row-info"><div class="soc-row-name">${esc(r.displayName || 'Player')}</div></div></div></div>`)).join('');
      byId('soc-friends-list').innerHTML = accepted.length
        ? accepted.map((f) => ui.renderFriendRow(f, setupFriends.some((s) => sameId(s.userId, f.userId)))).join('')
        : (lastFriendsError
            ? '<p class="soc-empty-note">Your friends list could not be synced right now. Tap Retry above.</p>'
            : '<p class="soc-empty-note">No friends yet. Show your QR code, scan a friend, or add them by code above.</p>');
      const groups = social.groups || [];
      byId('soc-groups-list').innerHTML = groups.length
        ? groups.map((g) => ui.renderGroupCard(groupForUi(g))).join('')
        : '<div class="card"><p class="small" style="margin:0">Create a group (like "Friday Catan Crew") to load your regulars in one tap and track a group leaderboard.</p></div>';
    }
  }
  async function saveDisplayName() {
    const api = SAPI(), inp = byId('soc-display-name'); if (!api || !inp) return;
    const r = await api.updateDisplayName(inp.value);
    if (!r || !r.ok) { socMsg('soc-profile-msg', (r && r.error) || 'Could not save your name.', 'error'); return; }
    social.profile = r.profile || social.profile;
    if (selfPlayer && r.profile) selfPlayer.name = r.profile.display_name;
    inp.blur();
    socMsg('soc-profile-msg', 'Saved — you’ll show up as ' + (r.profile ? r.profile.display_name : inp.value) + '.', 'success');
    renderSocial();
  }
  function formatFriendActionMsg(r, fallbackIdent) {
    const who = (r && r.target && (r.target.display_name || r.target.displayName)) || fallbackIdent || 'player';
    const msgs = {
      pending: `Friend request sent to ${who}.`,
      accepted: `You’re now friends with ${who}.`,
      already_friends: `You’re already friends with ${who}.`,
      already_pending: `Request to ${who} is still pending.`
    };
    return msgs[r && r.status] || `Added ${who}.`;
  }
  async function sendFriendRequest(explicitIdent) {
    const api = SAPI(), inp = byId('soc-add-friend-input'); if (!api) return null;
    const ident = String(typeof explicitIdent === 'string' ? explicitIdent : (inp ? inp.value : '')).trim();
    if (!ident) { socMsg('soc-friend-msg', 'Enter an email or friend code.', 'error'); return { ok: false, error: 'Enter an email or friend code.' }; }
    const r = await api.sendFriendRequest(ident);
    if (!r || !r.ok) { socMsg('soc-friend-msg', (r && r.error) || 'Could not send that request.', 'error'); return r || { ok: false }; }
    socMsg('soc-friend-msg', formatFriendActionMsg(r, ident), 'success');
    if (inp && typeof explicitIdent !== 'string') inp.value = '';
    await refreshSocial();
    return r;
  }
  function getMyFriendShareUrl() {
    const api = SAPI();
    if (!api || typeof api.buildFriendShareUrl !== 'function') return null;
    return api.buildFriendShareUrl(social.profile || api.getCachedProfile());
  }
  async function handleScannedFriendQr(rawInput) {
    const api = SAPI(); if (!api) return { ok: false, error: 'Social not ready.' };
    const r = typeof api.handleFriendQrOrCode === 'function'
      ? await api.handleFriendQrOrCode(rawInput)
      : await api.sendFriendRequest(rawInput);
    if (!r || !r.ok) {
      socMsg('soc-friend-msg', (r && r.error) || 'Could not add friend from QR code.', 'error');
      return r || { ok: false };
    }
    socMsg('soc-friend-msg', formatFriendActionMsg(r, r.identifier || rawInput), 'success');
    await refreshSocial();
    return r;
  }
  async function consumePendingFriendInvite() {
    const api = SAPI();
    if (!api || !currentUser || typeof api.getPendingFriendInvite !== 'function') return null;
    const pending = api.getPendingFriendInvite();
    if (!pending) return null;
    api.clearPendingFriendInvite(true);
    showView('social');
    if (SUI() && typeof SUI().switchSocialTab === 'function') SUI().switchSocialTab('friends');
    return handleScannedFriendQr(pending);
  }
  async function respondFriendRequest(friendshipId, accept) {
    const api = SAPI(); if (!api) return;
    const r = await api.respondFriendRequest(friendshipId, accept ? 'accept' : 'decline');
    if (!r || !r.ok) { socMsg('soc-friend-msg', (r && r.error) || 'Could not update that request.', 'error'); return; }
    socMsg('soc-friend-msg', accept ? 'Friend request accepted.' : 'Request declined.', 'success');
    await refreshSocial();
  }
  async function removeFriend(id) {
    const api = SAPI(); if (!api || !id) return;
    const key = String(id);
    const acc = social.friends.accepted || [], out = social.friends.outgoing || [];
    const byKey = (list) => list.find((a) => sameId(a.friendshipId, key)) || list.find((a) => sameId(a.userId, key));
    const f = byKey(acc), req = f ? null : byKey(out);
    const target = f || req; if (!target) return;
    const who = memberName(target);
    if (!confirm(f ? 'Remove ' + who + ' from your friends?' : 'Cancel your friend request to ' + who + '?')) return;
    const r = await api.removeFriend(target.friendshipId);
    if (!r || !r.ok) { socMsg('soc-friend-msg', (r && r.error) || (f ? 'Could not remove that friend.' : 'Could not cancel that request.'), 'error'); return; }
    if (f) setupFriends = setupFriends.filter((s) => !sameId(s.userId, f.userId));
    socMsg('soc-friend-msg', f ? who + ' removed from your friends.' : 'Request to ' + who + ' canceled.', 'success');
    await refreshSocial();
  }

  // ----- v17 Friend QR codes: My QR + Scan QR -----
  function setModalOpen(id, open) {
    const m = byId(id); if (!m) return;
    setHidden(m, !open);
    m.classList.toggle('open', !!open);
  }
  function qrMsg(id, text, tone) { socMsg(id, text, tone); }
  function openMyQrModal() {
    const url = currentUser ? getMyFriendShareUrl() : null;
    const prof = social.profile || (SAPI() && SAPI().getCachedProfile ? SAPI().getCachedProfile() : null) || {};
    const name = prof.display_name || (selfPlayer && selfPlayer.name) || 'Player';
    const svgHost = byId('soc-my-qr-svg');
    if (byId('soc-qr-handle')) byId('soc-qr-handle').textContent = name;
    if (byId('soc-qr-code-text')) byId('soc-qr-code-text').textContent = prof.friend_code || '—';
    if (!url) {
      if (svgHost) svgHost.innerHTML = '';
      qrMsg('soc-qr-msg', currentUser ? 'Your friend code is still loading. Try again in a moment.' : 'Sign in to get your friend QR code.', 'error');
    } else {
      try { if (svgHost) svgHost.innerHTML = global.ScoreQR ? global.ScoreQR.renderSvg(url) : ''; } catch (e) { console.warn('[qr] render failed', e); if (svgHost) svgHost.innerHTML = ''; }
      qrMsg('soc-qr-msg', svgHost && svgHost.querySelector('svg') ? '' : 'Could not draw the QR code. Use Copy Link instead.', svgHost && svgHost.querySelector('svg') ? '' : 'error');
    }
    setModalOpen('soc-qr-modal', true);
    return url;
  }
  function closeMyQrModal() { setModalOpen('soc-qr-modal', false); }
  function legacyCopy(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.top = '-1000px'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand && document.execCommand('copy');
      ta.remove(); return !!ok;
    } catch (_) { return false; }
  }
  async function copyFriendInviteLink() {
    const url = getMyFriendShareUrl();
    if (!url) { qrMsg('soc-qr-msg', 'Sign in to get your friend link.', 'error'); return false; }
    let ok = false;
    try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(url); ok = true; } } catch (_) { ok = false; }
    if (!ok) ok = legacyCopy(url);
    qrMsg('soc-qr-msg', ok ? 'Friend link copied. Send it to a friend to connect.' : 'Copy this link: ' + url, ok ? 'success' : '');
    return ok;
  }
  async function shareFriendInviteLink() {
    const url = getMyFriendShareUrl();
    if (!url) { qrMsg('soc-qr-msg', 'Sign in to get your friend link.', 'error'); return false; }
    if (navigator.share) {
      const prof = social.profile || {};
      try {
        await navigator.share({ title: 'Add me on Score Tracker', text: 'Add me as a friend on Score Tracker' + (prof.friend_code ? ' (code ' + prof.friend_code + ')' : '') + '.', url });
        qrMsg('soc-qr-msg', 'Shared.', 'success');
        return true;
      } catch (e) {
        if (e && e.name === 'AbortError') return false;
      }
    }
    return copyFriendInviteLink();
  }
  let scanStream = null, scanRaf = 0, scanBusy = false, scanSession = 0;
  function stopScanCamera() {
    if (scanRaf) { clearTimeout(scanRaf); try { cancelAnimationFrame(scanRaf); } catch (_) {} scanRaf = 0; }
    if (scanStream) { try { scanStream.getTracks().forEach((t) => t.stop()); } catch (_) {} scanStream = null; }
    const v = byId('soc-scan-video'); if (v) { try { v.pause(); } catch (_) {} v.srcObject = null; }
  }
  function showScanFallback(on) {
    setHidden(byId('soc-scan-viewport'), !!on);
    setHidden(byId('soc-scan-fallback-note'), !on);
  }
  async function onScannedValue(raw) {
    if (scanBusy) return; scanBusy = true;
    stopScanCamera();
    qrMsg('soc-scan-msg', 'Adding friend...', '');
    const r = await handleScannedFriendQr(raw);
    scanBusy = false;
    if (r && r.ok) {
      qrMsg('soc-scan-msg', formatFriendActionMsg(r, r.identifier || raw), 'success');
      setTimeout(() => { if (!scanBusy) closeScanQrModal(); }, 1200);
    } else {
      qrMsg('soc-scan-msg', (r && r.error) || 'That QR code is not a Score Tracker friend link.', 'error');
      showScanFallback(true);
    }
    return r;
  }
  async function openScanQrModal() {
    const session = ++scanSession;
    stopScanCamera(); scanBusy = false;
    qrMsg('soc-scan-msg', '');
    const inp = byId('soc-scan-paste-input'); if (inp) inp.value = '';
    const f = byId('soc-scan-file'); if (f) f.value = '';
    setModalOpen('soc-scan-modal', true);
    // v22: TallyItQR (native BarcodeDetector when present, bundled jsQR otherwise) -> iPhone Safari / iOS PWA can scan too
    const qr = global.TallyItQR || null;
    const canCamera = !!(qr && qr.canScanCamera());
    if (!canCamera) { showScanFallback(true); return false; }
    showScanFallback(false);
    try {
      const stream = await qr.openCameraStream();
      if (session !== scanSession || byId('soc-scan-modal').hidden) { stream.getTracks().forEach((t) => t.stop()); return false; }
      scanStream = stream;
      const video = byId('soc-scan-video');
      video.setAttribute('playsinline', ''); video.setAttribute('webkit-playsinline', ''); video.muted = true;
      video.srcObject = stream;
      await video.play().catch(() => {});
      const every = qr.hasNativeDetector() ? 80 : 160;
      const tick = async () => {
        scanRaf = 0;
        if (session !== scanSession || !scanStream) return;
        try {
          const val = await qr.decodeVideoFrame(video);
          if (session !== scanSession || !scanStream) return;
          if (val) { onScannedValue(val); return; }
        } catch (_) {}
        if (session === scanSession && scanStream) scanRaf = setTimeout(tick, every);
      };
      scanRaf = setTimeout(tick, every);
      return true;
    } catch (e) {
      stopScanCamera();
      if (session === scanSession) {
        showScanFallback(true);
        qrMsg('soc-scan-msg', qr && qr.formatCameraError ? qr.formatCameraError(e) : 'Could not start the camera. Paste the link or code below instead.', 'error');
      }
      return false;
    }
  }
  function closeScanQrModal() {
    scanSession++;
    stopScanCamera();
    setModalOpen('soc-scan-modal', false);
  }
  async function handleScanQrFile(input) {
    const file = input && input.files && input.files[0];
    if (!file) return null;
    const qr = global.TallyItQR || null;
    if (!qr || typeof qr.decodeImageFile !== 'function') {
      qrMsg('soc-scan-msg', 'This browser cannot read QR images. Paste the friend link or code below instead.', 'error');
      input.value = ''; return null;
    }
    try {
      const val = await qr.decodeImageFile(file);
      input.value = '';
      if (!val) { qrMsg('soc-scan-msg', 'No QR code found in that image. Paste the friend link or code below instead.', 'error'); return null; }
      return onScannedValue(val);
    } catch (e) {
      input.value = '';
      qrMsg('soc-scan-msg', 'Could not read that image. Paste the friend link or code below instead.', 'error');
      return null;
    }
  }
  async function submitScannedFriend() {
    const inp = byId('soc-scan-paste-input');
    const val = String((inp && inp.value) || '').trim();
    if (!val) { qrMsg('soc-scan-msg', 'Paste a friend link, friend code, or email.', 'error'); return { ok: false }; }
    qrMsg('soc-scan-msg', 'Adding friend...', '');
    const r = await handleScannedFriendQr(val);
    if (r && r.ok) {
      qrMsg('soc-scan-msg', formatFriendActionMsg(r, r.identifier || val), 'success');
      if (inp) inp.value = '';
    } else qrMsg('soc-scan-msg', (r && r.error) || 'Could not add that friend.', 'error');
    return r;
  }
  function renderGroupModal() {
    const picks = byId('soc-group-friend-picks'), acc = social.friends.accepted || [];
    if (picks) picks.innerHTML = acc.length
      ? acc.map((f) => `<button type="button" class="soc-friend-pick ${groupModalPicks.has(f.userId) ? 'included' : ''}" data-friend="${esc(f.userId)}" onclick="toggleGroupModalFriend('${esc(f.userId)}')"><span>${groupModalPicks.has(f.userId) ? '✓' : '+'}</span><span>${esc(memberName(f))}</span></button>`).join('')
      : '<span class="small">No friends yet — add guests below, or add friends first.</span>';
    const gc = byId('soc-group-guest-chips');
    if (gc) gc.innerHTML = groupModalGuests.map((n, i) => `<span class="player-chip">${esc(n)}<button type="button" class="chip-remove" aria-label="Remove ${esc(n)}" onclick="removeGroupModalGuest(${i})">×</button></span>`).join('');
  }
  function openCreateGroup() {
    groupModalGuests = []; groupModalPicks = new Set();
    if (byId('soc-group-name')) byId('soc-group-name').value = '';
    if (byId('soc-group-guest-input')) byId('soc-group-guest-input').value = '';
    socMsg('soc-group-modal-msg', '');
    renderGroupModal();
    const ui = SUI(); if (ui) ui.openCreateGroupModal();
  }
  function toggleGroupModalFriend(uid) { groupModalPicks.has(uid) ? groupModalPicks.delete(uid) : groupModalPicks.add(uid); renderGroupModal(); }
  function addGroupModalGuest() {
    const inp = byId('soc-group-guest-input'); if (!inp) return;
    const n = inp.value.trim(); inp.value = '';
    if (n && !groupModalGuests.some((g) => lc(g) === lc(n))) groupModalGuests.push(n.slice(0, 24));
    renderGroupModal();
  }
  function removeGroupModalGuest(i) { groupModalGuests.splice(i, 1); renderGroupModal(); }
  async function createGroupFromModal() {
    const api = SAPI(); if (!api) return null;
    const name = (byId('soc-group-name') && byId('soc-group-name').value.trim()) || '';
    if (!name) { socMsg('soc-group-modal-msg', 'Give your group a name.', 'error'); return null; }
    addGroupModalGuest();
    const ids = [...groupModalPicks];
    const members = (social.friends.accepted || []).filter((f) => groupModalPicks.has(f.userId));
    const r = await api.createGroup(name, ids, { members, guests: groupModalGuests });
    if (!r || !r.ok) { socMsg('soc-group-modal-msg', (r && r.error) || 'Could not create that group.', 'error'); return null; }
    const ui = SUI(); if (ui) { ui.closeCreateGroupModal(); ui.switchSocialTab('groups'); }
    await refreshSocial();
    return r.group || null;
  }
  async function deleteGroup(groupId) {
    const api = SAPI(); if (!api) return;
    const g = (social.groups || []).find((x) => String(x.id) === String(groupId));
    if (!g || !confirm('Delete the group "' + g.name + '"? Games already played stay in everyone’s history.')) return;
    const r = await api.deleteGroup(groupId);
    if (!r || !r.ok) { alert((r && r.error) || 'Could not delete that group.'); return; }
    if (setupGroup && String(setupGroup.id) === String(groupId)) setupGroup = null;
    if (historyFilter === String(groupId)) historyFilter = 'all';
    await refreshSocial();
  }
  function setGroupLbFilter(groupId, type) { groupLbFilter[groupId] = type || 'all'; renderSocial(); }

  // ----- Shared games + merged personal history -----
  function adaptShared(g) {
    return {
      id: g.id, game_type: g.type, variant: g.version || null, group_id: g.group_id || null, group_name: g.group_name || null,
      created_by: g.created_by || null, played_at: g.endTime || null, meta: g.meta || null,
      summary: { local_game_id: g.client_game_id || null, target: g.target ?? null, rounds: g.rounds || [], start_time: g.startTime || null },
      ...((g.meta && g.meta.mode === 'teams') && g.winner ? { winner_names: [g.winner] } : {}),
      participants: (g.players || []).map((p) => ({ user_id: p.user_id || p.userId || null, display_name: p.name, score: p.score, is_winner: !!(p.is_winner ?? p.isWinner), meta: {},
        ...(Array.isArray(p.members) && p.members.length ? { members: p.members } : {}) }))
    };
  }
  function historyEntries() {
    const sc = SSC(), uid = currentUser ? currentUser.id : null;
    if (!sc) return history.map((g) => ({ ...g, groupId: g.groupId || null, groupName: g.groupName || null }));
    const creators = new Map(), groupNames = new Map((social.groups || []).map((g) => [String(g.id), g.name]));
    (social.shared || []).forEach((g) => { if (g.created_by && g.created_by_name) creators.set(String(g.created_by), g.created_by_name); });
    return sc.mergePersonalHistory((social.shared || []).map(adaptShared), history, uid).map((r) => ({
      ...r, groupName: r.groupName || (r.groupId ? groupNames.get(String(r.groupId)) : null) || null,
      sharedByName: r.createdBy ? creators.get(String(r.createdBy)) || null : null
    }));
  }
  function renderHistoryFilter() {
    const bar = byId('history-filter-bar'); if (!bar) return;
    const map = new Map((social.groups || []).map((g) => [String(g.id), g.name]));
    history.forEach((h) => { if (h && h.groupId && !map.has(String(h.groupId))) map.set(String(h.groupId), h.groupName || 'Group'); });
    const groups = [...map].map(([id, name]) => ({ id, name }));
    if (historyFilter !== 'all' && !map.has(historyFilter)) historyFilter = 'all';
    const ui = SUI();
    setHidden(bar, !groups.length);
    bar.innerHTML = ui ? ui.renderHistoryFilterBar(groups, historyFilter) : '';
  }
  function setHistoryFilter(id) { historyFilter = id ? String(id) : 'all'; renderHistory(); }
  async function shareFinishedGame(fin) {
    const api = SAPI(), sc = SSC(), user = currentUser;
    if (!api || !sc || !user || !fin) return null;
    if (fin.edited === true || fin.edited_at || (fin.meta && (fin.meta.edited_at || fin.meta.edited))) return null; // v26: never re-share an edited game
    try {
      const payload = sc.buildSharedGamePayload(fin, user);
      const game = {
        ...fin, client_game_id: fin.id, group_id: payload.group_id || null,
        winner: (fin.type === 'nertz' || fin.type === 'rummikub' || fin.type === '7wonders') ? fin.winner : ((payload.winner_names || []).join(', ') || fin.winner),
        meta: { ...(fin.meta || {}), variation_key: fin.v22VariationKey || null, variation_name: fin.v22VariationName || null }, // v26: persist the variation so History detail can show it
        players: fin.players.map((p, i) => ({ ...p, user_id: (payload.participants[i] || {}).user_id || null, is_winner: !!(payload.participants[i] || {}).is_winner, meta: (payload.participants[i] || {}).meta || {} })),
        summary: payload.summary
      };
      if (fin.type === 'rummikub' && RKL()) {
        const rec = RKL().rkBuildSharedGameRecord(fin);
        game.players = game.players.map((p, i) => ({ ...p, meta: { ...(p.meta || {}), ...(((rec.players || [])[i] || {}).meta || {}) } }));
      }
      const r = await api.saveSharedGame(game, { groupId: payload.group_id || null });
      if (r && !r.ok) console.warn('[social] shared save failed', r.error);
      if (currentUser && currentUser.id === user.id) await refreshSocial();
      return r;
    } catch (e) { console.warn('[social] share failed', e); return null; }
  }

  // Enter key on the add-player input + auto-refresh friends/groups when returning to the app
  document.addEventListener('DOMContentLoaded', () => {
    const input = byId('new-player-name');
    if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addPlayer(); } });
  });
  const maybeRefreshOnResume = () => {
    if (!currentUser || document.hidden) return;
    if (Date.now() - lastSocialRefreshAt < 4000) return;
    refreshSocial();
  };
  // v24.1: games other people link you into (Link players / claim) arrive in the cloud while this app is already open.
  // Nothing used to re-pull them until a 15s-throttled resume, so a signed-in friend kept seeing a stale History.
  // Re-pull (silently) when History/Home opens, on a light poll while visible, and on a realtime ping when available.
  let gamesPollTimer = null;
  function refreshGamesSoon() {
    if (!currentUser || document.hidden || !social.ready) return;
    if (Date.now() - lastSocialRefreshAt < 4000) return;
    refreshSocial(false, true);
  }
  function startGamesPoll() {
    if (gamesPollTimer) return;
    gamesPollTimer = setInterval(() => {
      if (!currentUser || document.hidden) return;
      if (currentView !== 'history' && currentView !== 'new') return;
      if (Date.now() - lastSocialRefreshAt < 9000) return;
      refreshSocial(false, true);
    }, 10000);
  }
  startGamesPoll();
  document.addEventListener('visibilitychange', maybeRefreshOnResume);
  global.addEventListener('focus', maybeRefreshOnResume);

  Object.assign(global, {
    onAuthReady, onAuthSignedOut, showView, selectGame, quickStart, togglePlayer, addPlayer, removePlayer, startGame, discardGame,
    pauseGame, resumeGame, v21BackToGames, v21DiscardSession, v21RenderActiveGames,
    openPad, setPadMode, closePad, flipToggle, updateGenericPreview, commitSimplePoints, commitGenericDetailed,
    selectCatanPlayer, catanStep, catanAction, resetCatanScores,
    f7Select, f7Toggle, f7SetMode, f7Num, f7Close, f7Confirm, f7Undo, f7ToggleSort, f7OpenSheet, f7CloseSheet, f7SetTarget, f7AddPlayer, f7ResetScores,
    ccInput, ccKey, ccCycleColor, ccToggleColorPicker, ccPickColor, ccCloseColorPicker, ccShowAdd, ccHideAdd, ccAddPlayer, ccReset,
    nzSetMode: nzUiSetMode, nzStepNet, nzSetSign, nzSyncPreview, nzToggleGotNertz, nzConfirmRound, nzUndo,
    nzToggleHistory, nzOpenSheet, nzCloseSheet, nzUiSelect, nzUiToggleDeckPop, nzUiPickDeck, nzUiSaveTarget, nzUiAddPlayer, nzUiRemovePlayer, nzUiAddTeam,
    nzUiRemoveTeam, nzUiRenameTeam, nzUiAddPartner, nzUiRemovePartner, nzUiMovePartner,
    rkSelect, rkSetMode, rkSetSign, rkOnDeltaInput, rkStep, rkApplyJoker, rkConfirmRound, rkUndo, rkToggleHistory, rkAddPlayer, rkCycleColor, rkFinishGame,
    rkToggleCalc, rkCalcKey, rkCalcApply,
    swSelectCategory, swStepCategory, swStep, swSetVal, swSci, swSciOverride, swBeginEdit, swToggleExpansionsDrawer, swToggleExpansion, swUndo: swUndoAction, swFinishGame, renderSevenWonders,
    undoLastRound, undoLastAction: undoLastRound, endGame, deleteGame, deleteHistoryEntry, HeartsUI, OhHellUI, renderHearts, renderOhHell, QwirkleUI, renderQwirkle, renderSpoons, v24HandlePendingClaim,
    openDiceModal, closeDiceModal, rollVirtualDice, logPhysicalRoll, undoDiceRoll, resetDiceRolls, renderDiceUI,
    onAuthSignedIn: onAuthReady, removeSelf, addSelf, removeSetupFriend, toggleSetupFriend, includeFriendInNextGame, applyGroupPreset, clearSetupGroup,
    startGameWithGroup, saveDisplayName, sendFriendRequest, respondFriendRequest, removeFriend, openCreateGroup, toggleGroupModalFriend,
    addGroupModalGuest, removeGroupModalGuest, createGroupFromModal, deleteGroup, setHistoryFilter, setGroupLbFilter, refreshSocial,
    getMyFriendShareUrl, handleScannedFriendQr, consumePendingFriendInvite,
    openMyQrModal, closeMyQrModal, copyFriendInviteLink, shareFriendInviteLink, openScanQrModal, closeScanQrModal, handleScanQrFile, submitScannedFriend,
    ScoreTracker: { GAMES, getSetup: () => ({ game: selectedGame, version: selectedVersion, step: v21Step }), persistedActive: persistedActiveRaw, listOpenGames, getState: () => ({ players: [...players], history: [...history], currentGame, currentView, scoringPlayer, padMode, pendingSync,
      selfPlayer, selfIncluded, setupFriends: [...setupFriends], setupGroup, historyFilter, social }) }
  });
})(window);
