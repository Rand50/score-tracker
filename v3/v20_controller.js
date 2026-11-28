/* TallyIt v20 controller (window.TallyItV20): Request a Game, Variations & Popularity, Private Admin Stats, Full Screen.
   Depends on window.TallyItBackend (v20_backend.js) + window.TallyItVariations (variations_catalog.js). Zero emojis. */
(function (global) {
  'use strict';
  const doc = global.document;
  const $ = (id) => doc.getElementById(id);
  const BE = () => global.TallyItBackend || null;
  const VC = () => global.TallyItVariations || null;
  const ST = () => global.ScoreTracker || null;
  const V22 = () => global.TallyItV22 || null;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => (Number(n) || 0).toLocaleString('en-US');
  const show = (el, on) => { if (!el) return; el.hidden = !on; el.classList.toggle('hidden', !on); };
  const STATUS_LABELS = { new: 'New', reviewing: 'Reviewing', planned: 'Planned', built: 'Built', declined: 'Declined' };
  const statuses = () => (BE() && BE().REQUEST_STATUSES) || ['new', 'reviewing', 'planned', 'built', 'declined'];
  const gameName = (key) => {
    const st = ST(), g = st && st.GAMES ? st.GAMES.find((x) => x.id === key) : null;
    if (g) return g.name;
    return String(key || 'Game').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  };
  const variationFor = (gameKey, label) => { const vc = VC(); return vc ? (vc.getVariation(gameKey, label) || null) : null; };
  const variationKeyFor = (gameKey, label) => { const v = variationFor(gameKey, label); return v ? v.key : (String(label || '').trim() || 'standard'); };
  const variationName = (gameKey, key) => { const v = variationFor(gameKey, key); return v ? v.name : String(key || 'Standard'); };

  // ---------------------------------------------------------------- Request a Game
  function setReqError(msg) { const e = $('req-game-error'); if (!e) return; e.textContent = msg || ''; e.hidden = !msg; }
  function resetRequestGameForm() {
    const f = $('req-game-form'); if (f) { f.reset(); f.hidden = false; }
    show($('req-game-success'), false); setReqError('');
    const b = $('btn-submit-game-request'); if (b) { b.disabled = false; b.textContent = 'Submit Request'; }
    // v25 polish: no autofocus on open (the iPhone keyboard used to cover the Submit button); the user taps a field when ready
  }
  function openRequestGameModal() {
    show($('req-game-modal'), true); doc.body.classList.add('v20-modal-open');
    resetRequestGameForm();
  }
  function closeRequestGameModal() { show($('req-game-modal'), false); syncBodyLock(); }
  let reqBusy = false;
  async function submitGameRequest() {
    if (reqBusy) return;
    const name = (($('req-game-name') || {}).value || '').trim();
    const url = (($('req-game-url') || {}).value || '').trim();
    if (name.length < 2) { setReqError('Please enter the name of the game (at least 2 characters).'); return; }
    if (url && !/^(https?:\/\/)?[^\s/$.?#][^\s]*\.[^\s]+$/i.test(url)) { setReqError('That link does not look right. Try something like https://boardgamegeek.com/...'); return; }
    setReqError('');
    const b = $('btn-submit-game-request'); if (b) { b.disabled = true; b.textContent = 'Sending...'; }
    reqBusy = true;
    let res;
    try { res = BE() ? await BE().submitGameRequest(name, url || null) : { ok: false, error: 'Requests are unavailable right now.' }; }
    catch (err) { res = { ok: false, error: (err && err.message) || 'Could not send your request.' }; }
    reqBusy = false;
    if (b) { b.disabled = false; b.textContent = 'Submit Request'; }
    if (!res || !res.ok) { setReqError((res && res.error) || 'Could not send your request. Please try again.'); return; }
    const sn = $('req-game-success-name'); if (sn) sn.textContent = name;
    const f = $('req-game-form'); if (f) f.hidden = true;
    show($('req-game-success'), true);
  }

  // ---------------------------------------------------------------- Variations & Popularity
  let setupGame = null, setupVersion = null, lastMerged = [], popSeq = 0;
  function localHistoryCounts(gameKey) {
    const st = ST(); if (!st || !st.getState) return [];
    // Only legacy games (finished before v20 tracking) count locally, so plays recorded server-side are never double counted.
    return (st.getState().history || []).filter((g) => g && g.type === gameKey && !g.v20Recorded).map((g) => ({ type: g.type, version: g.version }));
  }
  async function loadPopularity(gameKey, force) {
    const vc = VC(); if (!vc) return [];
    let rows = [];
    try { const r = BE() ? await BE().getVariationPopularity(gameKey, { force: !!force }) : null; rows = (r && r.byGame && r.byGame[gameKey]) || (r && r.rows) || []; } catch (_) { rows = []; }
    rows = rows.filter((x) => !x.game_key || vc.normalizeGameKey(x.game_key) === vc.normalizeGameKey(gameKey));
    const merged = vc.mergePopularity(gameKey, rows, localHistoryCounts(gameKey));
    return V22() && V22().augmentVariations ? V22().augmentVariations(gameKey, merged, rows) : merged;
  }
  function currentVariationKey() { const ck = setupGame && V22() && V22().selectedKey ? V22().selectedKey(setupGame) : null; return ck || (setupGame ? variationKeyFor(setupGame, setupVersion) : null); }
  const augmented = (gameKey) => { const vc = VC(); const m = vc ? vc.mergePopularity(gameKey, [], localHistoryCounts(gameKey)) : []; return V22() && V22().augmentVariations ? V22().augmentVariations(gameKey, m, []) : m; };
  function renderVariationBar(merged) {
    const bar = $('v20-variation-bar'), pill = $('var-pop-pill'), txt = $('var-pop-text');
    if (!bar) return;
    const list = merged || [];
    show(bar, list.length > 0);
    if (!list.length || !txt) return;
    const top = list[0], total = list.reduce((a, v) => a + v.playCount, 0), curKey = currentVariationKey();
    const isTop = total > 0 && top.isMostPopular && top.key === curKey;
    if (pill) pill.classList.toggle('is-top', isTop);
    if (!total) txt.textContent = list.length > 1 ? list.length + ' variations' : 'Standard rules';
    else if (isTop) txt.textContent = '#1 Most Popular · ' + top.sharePct + '%';
    else txt.textContent = 'Most popular: ' + top.name + ' · ' + top.sharePct + '%';
    const cmp = $('btn-compare-variations'); if (cmp) cmp.hidden = false;
  }
  function onSetupRendered(gameKey, version) {
    setupGame = gameKey; setupVersion = version;
    const vc = VC();
    const base = vc ? augmented(gameKey) : [];
    if (!lastMerged.length || lastMerged.gameKey !== gameKey) { lastMerged = base; lastMerged.gameKey = gameKey; }
    renderVariationBar(lastMerged);
    const seq = ++popSeq;
    loadPopularity(gameKey).then((m) => { if (seq !== popSeq) return; lastMerged = m; lastMerged.gameKey = gameKey; renderVariationBar(m); if (!$('var-compare-modal').hidden) renderVariationCards(m); }).catch(() => {});
  }
  function renderVariationCards(merged) {
    const list = $('var-compare-list'); if (!list) return;
    const curKey = currentVariationKey(), total = merged.reduce((a, v) => a + v.playCount, 0);
    const title = $('var-compare-title'); if (title) title.textContent = gameName(setupGame) + ' Variations';
    const sub = $('var-compare-sub'); if (sub) sub.textContent = total ? fmt(total) + ' tracked ' + (total === 1 ? 'play' : 'plays') + ' · tap a variation to select it' : 'No plays tracked yet · tap a variation to select it';
    list.innerHTML = merged.map((v) => {
      const sel = v.key === curKey;
      return `<button type="button" class="v20-var-card${sel ? ' is-selected' : ''}${v.isMostPopular ? ' is-top' : ''}" role="radio" aria-checked="${sel}" data-key="${esc(v.key)}" data-label="${esc(v.versionLabel)}">
        <div class="v20-var-card-head">
          <span class="v20-var-name">${esc(v.name)}</span>
          ${v.isMostPopular && v.playCount > 0 ? '<span class="v20-pop-badge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2.5 15 8.8 21.8 9.6 16.8 14.3 18.1 21 12 17.7 5.9 21 7.2 14.3 2.2 9.6 9 8.8 12 2.5"/></svg>#1 Most Popular</span>' : ''}
          ${v.source === 'community' || v.source === 'local' ? `<span class="v22-var-src">${v.source === 'community' ? 'Community' : 'House Rules'}</span>` : ''}
          ${sel ? '<span class="v20-selected-badge">Selected</span>' : ''}
        </div>
        ${v.tagline ? `<p class="v20-var-tagline">${esc(v.tagline)}</p>` : ''}
        <div class="v20-share-row"><span class="v20-share-count">${fmt(v.playCount)} ${v.playCount === 1 ? 'play' : 'plays'}</span><span class="v20-share-pct">${total ? v.sharePct : 0}% of plays</span></div><div class="v20-share-track"><div class="v20-share-fill" style="width:${total ? v.sharePct : 0}%"></div></div>
        ${v.differences && v.differences.length ? `<div class="v20-diff-title">What's different</div><ul class="v20-diff-list">${v.differences.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}
      </button>`;
    }).join('') || '<div class="v20-empty-note">No variations listed for this game yet.</div>';
    list.querySelectorAll('.v20-var-card').forEach((b) => b.addEventListener('click', () => selectVariation(b.dataset.label, b.dataset.key)));
  }
  async function openVariationsModal() {
    if (!setupGame) { const st = ST(); const s = st && st.getSetup ? st.getSetup() : null; if (s) { setupGame = s.game; setupVersion = s.version; } }
    if (!setupGame) return;
    renderVariationCards(lastMerged.gameKey === setupGame ? lastMerged : (VC() ? augmented(setupGame) : []));
    show($('var-compare-modal'), true); doc.body.classList.add('v20-modal-open');
    const m = await loadPopularity(setupGame);
    lastMerged = m; lastMerged.gameKey = setupGame;
    if (!$('var-compare-modal').hidden) renderVariationCards(m);
    renderVariationBar(m);
  }
  // v22: re-merge official + community + local house rules and redraw the bar / open picker
  function refreshVariations() {
    if (!setupGame) return;
    lastMerged = augmented(setupGame); lastMerged.gameKey = setupGame; renderVariationBar(lastMerged);
    const md = $('var-compare-modal'); if (md && !md.hidden) renderVariationCards(lastMerged);
    const gk = setupGame, seq = ++popSeq;
    loadPopularity(gk).then((m) => { if (seq !== popSeq || gk !== setupGame) return; lastMerged = m; lastMerged.gameKey = gk; renderVariationBar(m); const mm = $('var-compare-modal'); if (mm && !mm.hidden) renderVariationCards(m); }).catch(() => {});
  }
  function closeVariationsModal() { show($('var-compare-modal'), false); syncBodyLock(); }
  function selectVariation(label, key) {
    if (V22() && V22().isCustomVariation && V22().isCustomVariation(setupGame, key)) { V22().v22SelectCustomVariation(key, setupGame); closeVariationsModal(); return; }
    const sel = $('version-select'); if (!sel) return;
    const opt = [...sel.options].find((o) => o.value === label || o.textContent === label);
    const v = variationFor(setupGame, key || label);
    if (opt) {
      sel.value = opt.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
    global.__v20ScoringOverrides = v ? { gameKey: setupGame, variationKey: v.key, ...v.scoringOverrides } : null;
    closeVariationsModal();
  }
  function onGameStarted(game) {
    if (!game || !BE()) return;
    const vk = game.v22VariationKey || variationKeyFor(game.type, game.version);
    const n = (game.players || []).length || 1;
    Promise.resolve().then(() => BE().recordGamePlay(game.type, vk, n)).then(() => { if (setupGame === game.type) lastMerged = []; }).catch(() => {});
  }

  // ---------------------------------------------------------------- Admin Stats
  let adminOk = false, adminStats = null, adminFilter = 'all', adminSeq = 0;
  async function onAuthChange(user) {
    const trig = $('btn-open-admin');
    adminOk = false; show(trig, false);
    const em = $('v20-hmenu-email'); if (em) em.textContent = user && user.email ? user.email : '';
    syncStatusMirror();
    if (!user) { closeHeaderMenu(); if (BE()) BE().clearCache(); closeAdminScreen(true); return; }
    const seq = ++adminSeq;
    let ok = false;
    try { ok = BE() ? await BE().isAdmin({ force: true }) : false; } catch (_) { ok = false; }
    if (seq !== adminSeq) return;
    adminOk = ok === true;
    show(trig, adminOk);
  }
  function openAdminScreen() {
    if (!adminOk) return;
    const scr = $('admin-screen'); if (!scr) return;
    doc.querySelectorAll('#app-shell .view').forEach((el) => el.classList.toggle('active', el === scr));
    doc.querySelectorAll('.bottom-nav button').forEach((b) => b.classList.remove('active'));
    show(scr, true);
    global.scrollTo(0, 0);
    loadAdminStats(false);
  }
  function closeAdminScreen(silent) {
    const scr = $('admin-screen'); if (!scr) return;
    const wasOpen = !scr.hidden;
    show(scr, false); scr.classList.remove('active');
    if (wasOpen && !silent && typeof global.showView === 'function') global.showView('new');
  }
  function banner(msg, tone) { const b = $('admin-status-banner'); if (!b) return; b.textContent = msg || ''; b.hidden = !msg; if (tone) b.dataset.tone = tone; else delete b.dataset.tone; }
  async function loadAdminStats() {
    if (!adminOk || !BE()) return;
    const upd = $('admin-last-updated'); if (upd) upd.textContent = 'Loading...';
    let res;
    try { res = await BE().getAdminStats(); } catch (err) { res = { ok: false, error: (err && err.message) || 'Could not load stats' }; }
    if (!res || !res.ok || !res.stats) {
      if (res && res.forbidden) { adminOk = false; show($('btn-open-admin'), false); closeAdminScreen(); return; }
      banner((res && res.error) || 'Could not load admin stats.', 'error'); if (upd) upd.textContent = 'Private TallyIt telemetry'; return;
    }
    adminStats = res.stats;
    banner(res.isFallback ? 'Showing this device\'s local data. Run supabase_v20_features_migration.sql in Supabase to see all-time stats for every player.' : '', res.isFallback ? 'info' : null);
    renderAdminStats(adminStats);
    if (upd) upd.textContent = 'Updated ' + new Date(adminStats.generated_at || Date.now()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  function setText(id, v) { const el = $(id); if (el) el.textContent = v; }
  function bkRow(name, sub, stat, pct) {
    return `<div class="v20-bk-row"><div class="v20-bk-top"><div><div class="v20-bk-name">${esc(name)}</div>${sub ? `<div class="v20-bk-sub">${esc(sub)}</div>` : ''}</div><div class="v20-bk-stat">${esc(stat)}</div></div><div class="v20-bk-track"><div class="v20-bk-fill" style="width:${Math.max(0, Math.min(100, pct))}%"></div></div></div>`;
  }
  function renderAdminStats(s) {
    const t = s.totals || {};
    setText('kpi-games-total', fmt(t.total_plays));
    setText('kpi-games-7d', fmt(t.plays_7d));
    setText('kpi-games-30d', fmt(t.plays_30d));
    setText('kpi-users-total', fmt(t.users_total));
    setText('kpi-requests-total', fmt(t.game_requests_total));
    setText('kpi-requests-new', fmt(t.game_requests_new) + ' new');
    const fr = Number(t.friendships_accepted) || 0, gr = Number(t.groups_total) || 0;
    setText('kpi-social-total', fmt(fr + gr));
    setText('kpi-social-sub', fmt(fr) + (fr === 1 ? ' friendship' : ' friends') + ' · ' + fmt(gr) + (gr === 1 ? ' group' : ' groups'));
    // 30-day chart
    const days = (s.daily_plays_30d || []).slice(-30);
    while (days.length < 30) days.unshift({ date: '', play_count: 0 });
    const peak = Math.max(0, ...days.map((d) => Number(d.play_count) || 0));
    const chart = $('admin-daily-chart');
    if (chart) chart.innerHTML = days.map((d) => { const c = Number(d.play_count) || 0, h = peak ? Math.max(4, Math.round((c / peak) * 100)) : 0;
      return `<div class="v20-chart-col" title="${esc(d.date)}: ${c}"><div class="v20-chart-bar${c ? '' : ' is-zero'}" style="height:${c ? h : 4}%"></div></div>`; }).join('');
    setText('admin-chart-peak', 'Peak: ' + fmt(peak) + '/day');
    const first = days.find((d) => d.date);
    if (first && first.date) { const dt = new Date(first.date + 'T12:00:00'); if (!isNaN(dt)) setText('admin-chart-start', dt.toLocaleDateString([], { month: 'short', day: 'numeric' })); }
    // Top games
    const games = (s.by_game || []).slice().sort((a, b) => (b.play_count || 0) - (a.play_count || 0));
    const gTotal = games.reduce((a, g) => a + (Number(g.play_count) || 0), 0);
    const tg = $('admin-top-games');
    if (tg) tg.innerHTML = games.length ? games.slice(0, 10).map((g) => { const pct = gTotal ? Math.round((g.play_count / gTotal) * 100) : 0;
      return bkRow(gameName(g.game_key), (g.avg_players ? 'Avg ' + g.avg_players + ' players · ' : '') + fmt(g.plays_30d || 0) + ' in 30d', fmt(g.play_count) + ' · ' + pct + '%', pct); }).join('')
      : '<div class="v20-empty-note">No games played yet.</div>';
    // Top variations
    const vars = (s.by_variation || []).slice().sort((a, b) => (b.play_count || 0) - (a.play_count || 0));
    const vTotal = vars.reduce((a, v) => a + (Number(v.play_count) || 0), 0);
    const tv = $('admin-top-variations');
    if (tv) tv.innerHTML = vars.length ? vars.slice(0, 12).map((v) => { const pct = vTotal ? Math.round((v.play_count / vTotal) * 100) : 0;
      return bkRow(variationName(v.game_key, v.variation_key), gameName(v.game_key), fmt(v.play_count) + ' · ' + pct + '%', pct); }).join('')
      : '<div class="v20-empty-note">No variation plays tracked yet.</div>';
    renderRequests();
    if (V22() && V22().renderAdminCommunity) { try { V22().renderAdminCommunity(s); } catch (_) {} }
  }
  function setAdminRequestFilter(f) {
    adminFilter = f || 'all';
    doc.querySelectorAll('#admin-req-filters .v20-filter-pill').forEach((p) => { const on = p.dataset.filter === adminFilter; p.classList.toggle('is-active', on); p.setAttribute('aria-selected', on ? 'true' : 'false'); });
    renderRequests();
  }
  function renderRequests() {
    const listEl = $('admin-requests-list'); if (!listEl) return;
    const all = (adminStats && adminStats.recent_game_requests) || [];
    const list = adminFilter === 'all' ? all : all.filter((r) => (r.status || 'new') === adminFilter);
    setText('admin-inbox-count', list.length + (list.length === 1 ? ' item' : ' items'));
    listEl.innerHTML = list.length ? list.map((r) => {
      const st = statuses().includes(r.status) ? r.status : 'new';
      const when = r.created_at ? new Date(r.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '';
      const who = r.requester_email || (r.requester_id ? 'Signed-in player' : 'Guest');
      let host = '';
      if (r.website_url) { try { host = new URL(r.website_url).hostname.replace(/^www\./, ''); } catch (_) { host = r.website_url; } }
      return `<div class="v20-req-item" data-id="${esc(r.id)}"><div class="v20-req-item-top"><div class="v20-req-item-info"><div class="v20-req-item-name">${esc(r.game_name)}</div><div class="v20-req-item-meta">${esc(who)}${when ? ' · ' + esc(when) : ''}</div>
        ${r.website_url && /^https?:\/\//i.test(r.website_url) ? `<a class="v20-req-link" href="${esc(r.website_url)}" target="_blank" rel="noopener noreferrer"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg><span>${esc(host)}</span></a>` : ''}</div>
        <select class="v20-status-select" data-status="${st}" data-id="${esc(r.id)}" aria-label="Status for ${esc(r.game_name)}">${statuses().map((s) => `<option value="${s}"${s === st ? ' selected' : ''}>${STATUS_LABELS[s] || s}</option>`).join('')}</select></div></div>`;
    }).join('') : `<div class="v20-empty-note">${adminFilter === 'all' ? 'No game requests yet.' : 'No ' + esc((STATUS_LABELS[adminFilter] || adminFilter).toLowerCase()) + ' requests.'}</div>`;
    listEl.querySelectorAll('.v20-status-select').forEach((sel) => sel.addEventListener('change', () => changeRequestStatus(sel)));
  }
  async function changeRequestStatus(sel) {
    const id = sel.dataset.id, next = sel.value, prev = sel.dataset.status;
    sel.disabled = true;
    let res;
    try { res = await BE().updateGameRequestStatus(id, next); } catch (err) { res = { ok: false, error: err && err.message }; }
    sel.disabled = false;
    if (!res || !res.ok) { sel.value = prev; banner((res && res.error) || 'Could not update status.', 'error'); return; }
    sel.dataset.status = next;
    const all = (adminStats && adminStats.recent_game_requests) || [];
    const r = all.find((x) => String(x.id) === String(id)); if (r) r.status = next;
    if (adminStats && adminStats.totals) adminStats.totals.game_requests_new = all.filter((x) => x.status === 'new').length;
    setText('kpi-requests-new', fmt(adminStats.totals.game_requests_new) + ' new');
    if (adminFilter !== 'all') renderRequests();
  }

  // ---------------------------------------------------------------- Full Screen
  const fsEl = () => doc.fullscreenElement || doc.webkitFullscreenElement || null;
  const fsSupported = () => { const el = doc.documentElement; return !!(el.requestFullscreen || el.webkitRequestFullscreen) && doc.fullscreenEnabled !== false; };
  const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = () => (global.matchMedia && global.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  function syncFullscreenUI() {
    const on = !!fsEl() || isStandalone();
    const b = $('btn-fullscreen-toggle'); if (!b) return;
    b.classList.toggle('is-fullscreen', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.title = on ? 'Exit Full Screen' : 'Full Screen';
    doc.documentElement.classList.toggle('v20-is-fullscreen', on);
    const standalone = isStandalone();
    doc.documentElement.classList.toggle('v20-standalone', standalone);
    const wrap = b.closest('.v20-fs-wrap'); if (wrap) wrap.hidden = standalone;
    b.hidden = standalone;
    const mi = $('btn-menu-fullscreen'); if (mi) mi.hidden = standalone;
    const ml = $('btn-menu-fullscreen-label'); if (ml) ml.textContent = fsEl() ? 'Exit Full Screen' : 'Full Screen';
  }
  function showIosFullscreenHint() { show($('v20-ios-fs-popover'), true); }
  function closeIosFullscreenHint() { show($('v20-ios-fs-popover'), false); }
  async function toggleFullscreen() {
    if (isStandalone() && !fsEl()) { syncFullscreenUI(); return; }
    if (!fsSupported() || (isIOS() && !doc.documentElement.requestFullscreen)) {
      const pop = $('v20-ios-fs-popover'); if (pop && !pop.hidden) closeIosFullscreenHint(); else showIosFullscreenHint();
      return;
    }
    try {
      if (fsEl()) { if (doc.exitFullscreen) await doc.exitFullscreen(); else if (doc.webkitExitFullscreen) doc.webkitExitFullscreen(); }
      else { const el = doc.documentElement; if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' }); else el.webkitRequestFullscreen(); }
    } catch (_) {
      if (isIOS()) showIosFullscreenHint();
    }
    syncFullscreenUI();
  }

  // ---------------------------------------------------------------- Header menu + sync dot (v20.1)
  function syncStatusMirror() {
    const el = $('sync-status'); if (!el) return;
    const txt = (el.textContent || '').trim(), err = el.dataset.state === 'error';
    const label = txt || 'Signed in';
    if (el.getAttribute('title') !== label) el.setAttribute('title', label);
    if (el.getAttribute('aria-label') !== label) el.setAttribute('aria-label', label);
    const ms = $('v20-hmenu-sync'); if (ms) ms.textContent = label;
    const md = $('v20-hmenu-dot'); if (md) md.dataset.state = err ? 'error' : 'ok';
  }
  function headerMenuOpen() { const m = $('v20-header-menu'); return !!(m && !m.hidden); }
  function openHeaderMenu() {
    syncStatusMirror(); syncFullscreenUI();
    show($('v20-header-menu'), true);
    const b = $('btn-header-menu'); if (b) b.setAttribute('aria-expanded', 'true');
  }
  function closeHeaderMenu() {
    show($('v20-header-menu'), false);
    const b = $('btn-header-menu'); if (b) b.setAttribute('aria-expanded', 'false');
  }
  function toggleHeaderMenu() { if (headerMenuOpen()) closeHeaderMenu(); else { closeIosFullscreenHint(); openHeaderMenu(); } }

  // ---------------------------------------------------------------- Shared
  function syncBodyLock() { const anyOpen = ['req-game-modal', 'var-compare-modal'].some((id) => $(id) && !$(id).hidden); doc.body.classList.toggle('v20-modal-open', anyOpen); }
  function init() {
    doc.addEventListener('fullscreenchange', syncFullscreenUI);
    doc.addEventListener('webkitfullscreenchange', syncFullscreenUI);
    doc.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeRequestGameModal(); closeVariationsModal(); closeIosFullscreenHint(); closeHeaderMenu(); } });
    doc.addEventListener('click', (e) => { if (headerMenuOpen() && !e.target.closest('.v20-hmenu-wrap')) closeHeaderMenu(); }, true);
    if (global.matchMedia) { try { global.matchMedia('(display-mode: standalone)').addEventListener('change', syncFullscreenUI); } catch (_) {} }
    const se = $('sync-status');
    if (se && global.MutationObserver) new MutationObserver(syncStatusMirror).observe(se, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['data-state'] });
    syncStatusMirror();
    syncFullscreenUI();
    setAdminRequestFilter('all');
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init, { once: true }); else init();

  const api = { refreshVariations, openRequestGameModal, closeRequestGameModal, submitGameRequest, resetRequestGameForm, openVariationsModal, closeVariationsModal, selectVariation,
    onSetupRendered, onGameStarted, onAuthChange, openAdminScreen, closeAdminScreen, loadAdminStats, setAdminRequestFilter, renderAdminStats,
    toggleFullscreen, closeIosFullscreenHint, showIosFullscreenHint, openHeaderMenu, closeHeaderMenu, toggleHeaderMenu, isAdminVisible: () => adminOk, _state: () => ({ setupGame, setupVersion, lastMerged, adminFilter, adminStats }) };
  global.TallyItV20 = api;
  Object.assign(global, { openRequestGameModal, closeRequestGameModal, submitGameRequest, resetRequestGameForm, openVariationsModal, closeVariationsModal,
    openAdminScreen, closeAdminScreen, loadAdminStats, setAdminRequestFilter, toggleFullscreen, closeIosFullscreenHint, openHeaderMenu, closeHeaderMenu, toggleHeaderMenu });
})(window);
