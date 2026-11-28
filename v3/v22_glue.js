/* TallyIt v22 glue (window.TallyItV22): Game & Player Search, Built Game notifications, guest email on Request a Game,
   Customize Rules (House Rules) drawer + local / community Variations, Admin community moderation.
   Depends on TallyItHouseRules (house_rules.js), TallyItV22Backend (v22_backend.js), TallyItV20, ScoreTracker. Zero emojis. */
(function (global) {
  'use strict';
  const doc = global.document;
  const $ = (id) => doc.getElementById(id);
  const HR = () => global.TallyItHouseRules || null;
  const BE = () => global.TallyItV22Backend || null;
  const ST = () => global.ScoreTracker || null;
  const V20 = () => global.TallyItV20 || null;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const show = (el, on) => { if (!el) return; el.hidden = !on; el.classList.toggle('hidden', !on); };
  const games = () => (ST() && ST().GAMES) || [];
  const gameName = (id) => { const g = games().find((x) => x.id === id); return g ? g.name : String(id || 'Game'); };
  const observe = (el, fn) => { if (el && global.MutationObserver) new MutationObserver(fn).observe(el, { childList: true }); };
  let user = null;

  // ================================================================ 1. Game Search
  let gameQuery = '';
  function applyGameFilter() {
    const grid = $('game-grid'); if (!grid) return;
    const q = gameQuery.trim(), hr = HR();
    const hits = q && hr ? new Set(hr.filterGames(games(), q).map((g) => g.id)) : null;
    let n = 0;
    grid.querySelectorAll('.game-card').forEach((c) => { const on = !hits || hits.has(c.dataset.game); c.style.display = on ? '' : 'none'; c.classList.toggle('v22-filtered-out', !on); if (on) n++; });
    const qEl = $('v22-game-search-query'); if (qEl) qEl.textContent = q;
    show($('v22-game-search-empty'), !!q && n === 0);
    show($('btn-v22-game-search-clear'), !!q);
    const inp = $('v22-game-search'); if (inp && inp.value !== gameQuery && doc.activeElement !== inp) inp.value = gameQuery;
  }
  function v22FilterGames(val) { gameQuery = String(val == null ? '' : val); applyGameFilter(); return visibleGameIds(); }
  function visibleGameIds() { return [...doc.querySelectorAll('#game-grid .game-card')].filter((c) => c.style.display !== 'none').map((c) => c.dataset.game); }
  function v22ClearGameSearch() { gameQuery = ''; const i = $('v22-game-search'); if (i) { i.value = ''; try { i.focus({ preventScroll: true }); } catch (_) {} } applyGameFilter(); }
  function v22RequestSearchedGame() {
    const q = gameQuery.trim();
    if (typeof global.openRequestGameModal === 'function') global.openRequestGameModal();
    const n = $('req-game-name'); if (n) n.value = q;
  }

  // ================================================================ 2. Player Search (Friends + History)
  let friendsQuery = '', historyQuery = '';
  function noneNote(afterEl, id, text) {
    let p = $(id);
    if (!p && afterEl && afterEl.parentNode) { p = doc.createElement('p'); p.id = id; p.className = 'soc-empty-note v22-search-none'; afterEl.parentNode.insertBefore(p, afterEl.nextSibling); }
    if (p) { p.textContent = text || ''; show(p, !!text); }
  }
  function applyFriendsFilter() {
    const list = $('soc-friends-list'); if (!list) return;
    const q = friendsQuery.trim(), hr = HR();
    const rows = [...list.querySelectorAll(':scope > .soc-row')];
    const st = ST() && ST().getState ? ST().getState() : null;
    const accepted = (st && st.social && st.social.friends && st.social.friends.accepted) || [];
    let n = 0;
    rows.forEach((r, i) => {
      let on = true;
      if (q && hr) {
        const f = rows.length === accepted.length ? accepted[i] : null;
        const nm = r.querySelector('.soc-row-name'), sub = r.querySelector('.soc-row-sub');
        on = hr.filterPlayers([f || { name: nm ? nm.textContent : r.textContent, friendCode: sub ? sub.textContent : '' }], q).length > 0
          || hr.filterPlayers([{ name: nm ? nm.textContent : '', friendCode: sub ? sub.textContent.replace(/^Code:\s*/, '') : '' }], q).length > 0;
      }
      r.style.display = on ? '' : 'none'; if (on) n++;
    });
    show($('btn-v22-friends-search-clear'), !!q);
    noneNote(list, 'v22-friends-search-none', q && rows.length && !n ? 'No friends match "' + q + '".' : '');
  }
  function v22FilterFriends(val) { friendsQuery = String(val == null ? '' : val); applyFriendsFilter(); }
  function v22ClearFriendsSearch() { friendsQuery = ''; const i = $('v22-friends-search'); if (i) i.value = ''; applyFriendsFilter(); }
  function applyHistoryFilter() {
    const list = $('history-list'); if (!list) return;
    const q = historyQuery.trim(), hr = HR();
    const items = [...list.querySelectorAll('.history-item')];
    const st = ST() && ST().getState ? ST().getState() : null;
    const hist = (st && st.history) || [];
    let n = 0;
    items.forEach((it) => {
      let on = true;
      if (q && hr) {
        const rec = hist.find((h) => h && h.id && String(h.id) === it.dataset.gameId) || null;
        const label = it.querySelector('strong') ? it.querySelector('strong').textContent : '';
        const ver = (rec && rec.version) || '';
        const obj = rec ? { name: label + ' ' + ver, players: rec.players || [], winner: rec.winner, groupName: rec.groupName } : { name: it.textContent };
        on = hr.filterPlayers([obj], q).length > 0;
      }
      it.style.display = on ? '' : 'none'; if (on) n++;
    });
    show($('btn-v22-history-search-clear'), !!q);
    noneNote(list, 'v22-history-search-none', q && items.length && !n ? 'No games match "' + q + '".' : '');
  }
  function v22FilterHistory(val) { historyQuery = String(val == null ? '' : val); applyHistoryFilter(); }
  function v22ClearHistorySearch() { historyQuery = ''; const i = $('v22-history-search'); if (i) i.value = ''; applyHistoryFilter(); }

  // ================================================================ 3. Built Game notification banner
  let built = [], builtSeq = 0, builtAt = 0;
  async function refreshBuiltNotifications(force) {
    if (!user || !BE()) { built = []; renderBuiltBanner(); return built; }
    if (!force && Date.now() - builtAt < 15000) { renderBuiltBanner(); return built; }
    const seq = ++builtSeq, uid = user.id;
    let res = null;
    try { res = await BE().getMyBuiltNotifications(); } catch (_) { res = null; }
    if (seq !== builtSeq || !user || user.id !== uid) return built;
    builtAt = Date.now();
    built = (res && res.ok && Array.isArray(res.notifications)) ? res.notifications.filter((x) => x && x.id) : [];
    renderBuiltBanner();
    return built;
  }
  function renderBuiltBanner() {
    const b = $('v22-built-banner'); if (!b) return;
    const n = built[0];
    show(b, !!n);
    if (!n) return;
    const t = $('v22-built-banner-title');
    if (t) t.textContent = (n.game_name || 'Your game') + ' is ready to play!' + (built.length > 1 ? ' (1 of ' + built.length + ')' : '');
    b.dataset.notificationId = n.id;
  }
  function matchLiveGame(name) {
    const q = String(name || '').trim().toLowerCase(); if (!q) return null;
    const list = games().filter((g) => g.id !== 'other');
    const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    let hit = list.find((g) => norm(g.name) === norm(q) || norm(g.id) === norm(q));
    if (!hit && HR()) hit = HR().filterGames(list, q)[0] || null;
    return hit || null;
  }
  async function v22DismissBuiltBanner() {
    const n = built[0]; if (!n) { renderBuiltBanner(); return false; }
    built = built.slice(1); renderBuiltBanner();
    try { if (BE()) await BE().dismissBuiltNotification(n.id); } catch (_) {}
    return true;
  }
  function v22PlayBuiltGame() {
    const n = built[0]; if (!n) return null;
    const g = matchLiveGame(n.game_name);
    built = built.slice(1); renderBuiltBanner();
    if (BE()) Promise.resolve().then(() => BE().dismissBuiltNotification(n.id)).catch(() => {});
    if (g && typeof global.quickStart === 'function') { global.quickStart(g.id); return g.id; }
    if (typeof global.showView === 'function') global.showView('new');
    gameQuery = String(n.game_name || ''); applyGameFilter();
    return null;
  }

  // ================================================================ 4. Guest email on Request a Game
  const isGuest = () => !user || !!user.is_anonymous || !String(user.email || '').trim();
  function syncGuestEmail() { show($('v22-req-email-wrap'), isGuest()); }
  let reqBusy = false;
  function setReqError(msg) { const e = $('req-game-error'); if (!e) return; e.textContent = msg || ''; e.hidden = !msg; }
  async function v22SubmitGameRequest() {
    if (reqBusy) return;
    const name = (($('req-game-name') || {}).value || '').trim();
    const url = (($('req-game-url') || {}).value || '').trim();
    const email = isGuest() ? (($('req-game-email') || {}).value || '').trim() : '';
    if (name.length < 2) { setReqError('Please enter the name of the game (at least 2 characters).'); return; }
    if (url && !/^(https?:\/\/)?[^\s/$.?#][^\s]*\.[^\s]+$/i.test(url)) { setReqError('That link does not look right. Try something like https://boardgamegeek.com/...'); return; }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setReqError('That email does not look right. Try something like you@example.com.'); return; }
    setReqError('');
    const b = $('btn-submit-game-request'); if (b) { b.disabled = true; b.textContent = 'Sending...'; }
    reqBusy = true;
    let res;
    try {
      if (BE()) res = await BE().submitGameRequest(name, url || null, email || null);
      else if (global.TallyItBackend) res = await global.TallyItBackend.submitGameRequest(name, url || null);
      else res = { ok: false, error: 'Requests are unavailable right now.' };
    } catch (err) { res = { ok: false, error: (err && err.message) || 'Could not send your request.' }; }
    reqBusy = false;
    if (b) { b.disabled = false; b.textContent = 'Submit Request'; }
    if (!res || !res.ok) { setReqError((res && res.error) || 'Could not send your request. Please try again.'); return; }
    const sn = $('req-game-success-name'); if (sn) sn.textContent = name;
    const f = $('req-game-form'); if (f) f.hidden = true;
    show($('req-game-success'), true);
    return res;
  }

  // ================================================================ 5. Customize Rules (House Rules) + Variations
  const hr = { gameKey: null, version: null, rules: null, dirty: false, open: false, selected: null };
  const community = {}; // gameKey -> rows
  let selecting = false;
  const CUSTOM_ATTR = 'data-v22-custom';
  function resetHouseRules(gk) {
    hr.gameKey = gk; hr.rules = HR() ? HR().getDefaultRules(gk) : {}; hr.dirty = false; hr.selected = null; hr.open = false;
    const nm = $('v22-hr-name'), tg = $('v22-hr-tagline'); if (nm) nm.value = ''; if (tg) tg.value = '';
    setMsg('');
    renderDrawer();
  }
  function setMsg(text, tone) {
    const m = $('v22-hr-msg'); if (!m) return;
    m.textContent = text || ''; m.hidden = !text;
    if (tone) m.dataset.tone = tone; else delete m.dataset.tone;
    m.style.color = tone === 'error' ? 'var(--v22-danger)' : '';
  }
  function diffs() { return HR() && hr.gameKey ? HR().describeDifferences(hr.gameKey, hr.rules, { includeDefaultFallback: false }) : []; }
  function isCustomized() { return diffs().length > 0; }
  const ICO_MINUS = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/></svg>';
  const ICO_PLUS = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
  function knobHtml(f) {
    const v = hr.rules[f.key];
    const label = `<div class="v22-hr-row-label"><span class="v22-hr-row-title">${esc(f.label)}</span>${f.hint ? `<span class="v22-hr-row-hint">${esc(f.hint)}</span>` : ''}</div>`;
    let ctl;
    if (f.type === 'number') {
      ctl = `<div class="v22-hr-stepper"><button type="button" class="v22-hr-step-btn" data-act="step" data-dir="-1" aria-label="Decrease ${esc(f.label)}">${ICO_MINUS}</button>`
        + `<input type="number" inputmode="numeric" class="v22-hr-num" data-key="${esc(f.key)}" value="${esc(v)}" min="${f.min != null ? f.min : ''}" max="${f.max != null ? f.max : ''}" step="${f.step || 1}" aria-label="${esc(f.label)}">`
        + `<button type="button" class="v22-hr-step-btn" data-act="step" data-dir="1" aria-label="Increase ${esc(f.label)}">${ICO_PLUS}</button></div>`;
    } else if (f.key === 'lowWins') {
      ctl = `<div class="v22-hr-seg" role="radiogroup" aria-label="${esc(f.label)}"><button type="button" class="v22-hr-seg-btn${!v ? ' is-active' : ''}" data-act="seg" data-val="0" role="radio" aria-checked="${!v}">Highest</button>`
        + `<button type="button" class="v22-hr-seg-btn${v ? ' is-active' : ''}" data-act="seg" data-val="1" role="radio" aria-checked="${!!v}">Lowest</button></div>`;
    } else {
      ctl = `<label class="v22-hr-switch"><input type="checkbox" data-key="${esc(f.key)}"${v ? ' checked' : ''} aria-label="${esc(f.label)}"><span class="v22-hr-switch-track"></span></label>`;
    }
    return `<div class="v22-hr-row" data-key="${esc(f.key)}" data-type="${esc(f.type)}">${label}${ctl}</div>`;
  }
  function renderKnobs() {
    const box = $('v22-hr-knobs'); if (!box || !HR() || !hr.gameKey) return;
    box.innerHTML = HR().getRuleSchema(hr.gameKey).map(knobHtml).join('');
  }
  function renderDiffs() {
    const list = $('v22-hr-diff-list'), none = $('v22-hr-diff-none');
    const d = diffs();
    if (list) list.innerHTML = d.map((x) => `<li>${esc(x)}</li>`).join('');
    show(none, !d.length);
    const badge = $('v22-hr-badge');
    if (badge) { const lbl = hr.selected ? (hr.selected.source === 'community' ? 'Community' : 'House') : (d.length ? d.length + ' changed' : ''); badge.textContent = lbl; badge.hidden = !lbl; }
  }
  function renderDrawer() {
    const dr = $('v22-hr-drawer'), t = $('btn-v22-house-rules');
    show(dr, hr.open);
    if (t) t.setAttribute('aria-expanded', hr.open ? 'true' : 'false');
    if (hr.open) renderKnobs();
    renderDiffs();
  }
  function v22ToggleHouseRules(force) {
    if (!hr.gameKey) { const s = ST() && ST().getSetup ? ST().getSetup() : null; if (s) resetHouseRules(s.game); }
    hr.open = typeof force === 'boolean' ? force : !hr.open;
    renderDrawer();
    return hr.open;
  }
  function schemaField(key) { return HR() ? HR().getRuleSchema(hr.gameKey).find((f) => f.key === key) : null; }
  function setRule(key, val, rerender) {
    const next = { ...hr.rules, [key]: val };
    hr.rules = HR().sanitizeRules(hr.gameKey, next);
    hr.dirty = true;
    if (rerender) renderKnobs();
    renderDiffs();
  }
  function onKnobClick(e) {
    const btn = e.target.closest('button[data-act]'); if (!btn) return;
    const row = btn.closest('.v22-hr-row'); if (!row) return;
    const key = row.dataset.key, f = schemaField(key); if (!f) return;
    if (btn.dataset.act === 'step') setRule(key, (Number(hr.rules[key]) || 0) + Number(btn.dataset.dir) * (f.step || 1), true);
    else if (btn.dataset.act === 'seg') setRule(key, btn.dataset.val === '1', true);
  }
  function onKnobChange(e) {
    const el = e.target; if (!el || !el.dataset || !el.dataset.key) return;
    if (el.type === 'checkbox') setRule(el.dataset.key, !!el.checked, false);
    else if (el.classList.contains('v22-hr-num')) {
      if (el.value === '' && e.type === 'input') return;
      setRule(el.dataset.key, Number(el.value), e.type === 'change');
    }
  }
  // ---- Variations merge (official + community + local house rules + popularity)
  function communityRowsFor(gk) {
    return (community[gk] || []).filter((r) => r && !r.is_hidden).map((r) => {
      const so = r.scoring_overrides || {};
      return { ...r, key: 'community_' + (r.slug || r.id), versionLabel: r.name, rules: so.houseRules || null, scoringOverrides: so, authorName: r.author_name };
    });
  }
  function augmentVariations(gk, merged, rawRows) {
    const h = HR(); if (!h) return merged;
    try {
      const pop = (merged || []).map((v) => ({ variation_key: v.key, play_count: v.playCount || 0 }));
      const offKeys = new Set((merged || []).map((v) => String(v.key).toLowerCase()));
      (rawRows || []).forEach((r) => { const k = String((r && (r.variation_key || r.variationKey || r.variant)) || '').toLowerCase(); if (k && !offKeys.has(k)) pop.push(r); });
      const out = h.mergeCommunityVariations(gk, communityRowsFor(gk), h.listLocalHouseRules(gk), pop);
      return out.length ? out : merged;
    } catch (_) { return merged; }
  }
  function findCustom(gk, key) {
    if (!gk || !key || !HR()) return null;
    const k = String(key).toLowerCase();
    const list = augmentVariations(gk, [], []);
    return list.find((v) => v.source !== 'official' && String(v.key).toLowerCase() === k) || null;
  }
  function isCustomVariation(gk, key) { return !!findCustom(gk, key); }
  function selectedKey(gk) { return hr.selected && hr.selected.gameKey === gk ? hr.selected.key : null; }
  function customOptionLabel(v) { return v.name + (v.source === 'community' ? ' (Community)' : ' (House Rules)'); }
  function ensureCustomOption() {
    const sel = $('version-select'); if (!sel) return null;
    [...sel.querySelectorAll('option[' + CUSTOM_ATTR + ']')].forEach((o) => { if (!hr.selected || o.value !== hr.selected.name) o.remove(); });
    if (!hr.selected) return null;
    let opt = [...sel.options].find((o) => o.hasAttribute(CUSTOM_ATTR));
    if (!opt) { opt = doc.createElement('option'); opt.setAttribute(CUSTOM_ATTR, '1'); sel.appendChild(opt); }
    opt.value = hr.selected.name; opt.textContent = customOptionLabel(hr.selected);
    return opt;
  }
  function applySelectionToSelect() {
    const sel = $('version-select'); const opt = ensureCustomOption(); if (!sel || !opt) return;
    if (sel.value === opt.value) return;
    selecting = true;
    try { sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true })); } finally { selecting = false; }
  }
  function v22SelectCustomVariation(key, gk) {
    gk = gk || hr.gameKey || (ST() && ST().getSetup().game);
    const v = findCustom(gk, key); if (!v) return null;
    if (hr.gameKey !== gk) resetHouseRules(gk);
    hr.selected = { key: v.key, name: v.name, source: v.source, gameKey: gk, scoringOverrides: v.scoringOverrides || {} };
    const rules = v.rules || (v.scoringOverrides && v.scoringOverrides.houseRules) || null;
    if (rules) { hr.rules = HR().sanitizeRules(gk, rules); hr.dirty = true; }
    global.__v20ScoringOverrides = { gameKey: gk, variationKey: v.key, ...(v.scoringOverrides || {}) };
    applySelectionToSelect();
    renderDrawer();
    if (V20() && V20().refreshVariations) V20().refreshVariations();
    return hr.selected;
  }
  async function loadCommunity(gk) {
    if (!BE() || !gk) return;
    let res = null;
    try { res = await BE().listCommunityVariations(gk); } catch (_) { res = null; }
    if (!res || !res.ok) return;
    const rows = (res.variations || []).filter((r) => r && String(r.game_key || '').toLowerCase() === gk);
    const before = JSON.stringify(community[gk] || []);
    community[gk] = rows;
    if (JSON.stringify(rows) !== before && hr.gameKey === gk && V20() && V20().refreshVariations) V20().refreshVariations();
  }
  function onSetupRendered(gk, version) {
    if (gk !== hr.gameKey) resetHouseRules(gk);
    const sel = $('version-select');
    if (hr.selected && !selecting) {
      const hasOpt = sel && [...sel.options].some((o) => o.hasAttribute(CUSTOM_ATTR));
      if (!hasOpt) { applySelectionToSelect(); }          // setup re-rendered: keep the custom variation selected
      else if (sel.value !== hr.selected.name) { hr.selected = null; ensureCustomOption(); global.__v20ScoringOverrides = null; renderDiffs(); } // user picked another version
    }
    hr.version = version;
    loadCommunity(gk);
    if (hr.open) renderDrawer(); else renderDiffs();
  }
  // Called by engine.startGame(): the overrides to apply to the new session (null = official rules untouched)
  function getStartOverrides(gk) {
    if (!HR() || gk !== hr.gameKey) return null;
    if (!hr.selected && !isCustomized()) return null;
    const o = isCustomized() || !hr.selected ? HR().buildScoringOverrides(gk, hr.rules) : { ...(hr.selected.scoringOverrides || {}) };
    o.variationKey = hr.selected ? hr.selected.key : 'house_custom';
    o.variationName = hr.selected ? hr.selected.name : 'Custom House Rules';
    o.source = hr.selected ? hr.selected.source : 'custom';
    o.differences = diffs();
    return o;
  }
  function onGameStarted(game) {
    if (game && game.type === hr.gameKey) { const gk = hr.gameKey; hr.gameKey = null; resetHouseRules(gk); }
  }
  function validName() {
    const name = (($('v22-hr-name') || {}).value || '').trim();
    if (name.length < 2) { setMsg('Give your variation a name (at least 2 characters).', 'error'); const n = $('v22-hr-name'); if (n) try { n.focus({ preventScroll: true }); } catch (_) {} return null; }
    return name.slice(0, 60);
  }
  function v22SaveHouseRulesLocal() {
    if (!HR() || !hr.gameKey) return null;
    const name = validName(); if (!name) return null;
    const tagline = (($('v22-hr-tagline') || {}).value || '').trim();
    const preset = HR().saveLocalHouseRule({ gameKey: hr.gameKey, name, tagline, rules: hr.rules });
    if (!preset) { setMsg('Could not save these house rules on this device.', 'error'); return null; }
    v22SelectCustomVariation(preset.key, hr.gameKey);
    setMsg('Saved "' + name + '" to your ' + gameName(hr.gameKey) + ' Variations and selected it.', 'ok');
    return preset;
  }
  let pubBusy = false;
  async function v22PublishHouseRules() {
    if (pubBusy || !HR() || !BE() || !hr.gameKey) return null;
    const name = validName(); if (!name) return null;
    const gk = hr.gameKey, rules = hr.rules;
    const tagline = (($('v22-hr-tagline') || {}).value || '').trim();
    const st = ST() && ST().getState ? ST().getState() : null;
    const author = (st && st.selfPlayer && st.selfPlayer.name) || null;
    const b = $('btn-v22-hr-publish'); if (b) { b.disabled = true; b.textContent = 'Publishing...'; }
    pubBusy = true; setMsg('');
    let res;
    try {
      res = await BE().publishCustomVariation({ gameKey: gk, name, tagline: tagline || null, differences: HR().describeDifferences(gk, rules),
        scoringOverrides: HR().buildScoringOverrides(gk, rules), authorName: author });
    } catch (err) { res = { ok: false, error: (err && err.message) || 'Could not publish.' }; }
    pubBusy = false;
    if (b) { b.disabled = false; b.textContent = 'Publish to Variations'; }
    if (!res || !res.ok || !res.variation) { setMsg((res && res.error) || 'Could not publish this variation. Please try again.', 'error'); return null; }
    const row = res.variation;
    community[gk] = [row].concat((community[gk] || []).filter((r) => r.id !== row.id));
    if (hr.gameKey !== gk) return row;
    v22SelectCustomVariation('community_' + (row.slug || row.id), gk);
    setMsg('Published "' + name + '" to ' + gameName(gk) + ' Variations' + (res.isFallback ? ' (saved on this device until cloud sync is enabled).' : ' for everyone.'), 'ok');
    return row;
  }

  // ================================================================ 6. Admin community variations moderation
  let adminRows = [], adminSeq = 0;
  async function renderAdminCommunity(stats) {
    const list = $('v22-admin-comm-list'); if (!list) return;
    const seq = ++adminSeq;
    let rows = stats && Array.isArray(stats.community_variations) ? stats.community_variations : null;
    if (!rows && BE()) { try { const r = await BE().getAdminCommunityVariations(); rows = r && r.ok ? r.variations : []; } catch (_) { rows = []; } }
    if (seq !== adminSeq) return;
    adminRows = (rows || []).slice(0, 50);
    drawAdminRows();
  }
  function drawAdminRows() {
    const list = $('v22-admin-comm-list'), cnt = $('v22-admin-comm-count'); if (!list) return;
    const hidden = adminRows.filter((r) => r.is_hidden).length;
    if (cnt) cnt.textContent = adminRows.length + ' published' + (hidden ? ' · ' + hidden + ' hidden' : '');
    list.innerHTML = adminRows.length ? adminRows.map((r) => {
      const meta = [r.author_name ? 'by ' + r.author_name : 'Anonymous', r.created_at ? new Date(r.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '', (r.differences || []).length + ' rule' + ((r.differences || []).length === 1 ? '' : 's')].filter(Boolean).join(' · ');
      return `<div class="v22-mod-row${r.is_hidden ? ' is-hidden' : ''}" data-id="${esc(r.id)}">
        <div class="v22-mod-info"><div class="v22-mod-top"><span class="v22-mod-name">${esc(r.name)}</span><span class="v22-mod-game">${esc(gameName(r.game_key))}</span></div>
        <div class="v22-mod-meta">${esc(meta)}</div></div>
        <button type="button" class="v22-mod-btn${r.is_hidden ? ' is-restore' : ''}" data-id="${esc(r.id)}" aria-label="${r.is_hidden ? 'Restore' : 'Hide'} ${esc(r.name)}">${r.is_hidden ? 'Restore' : 'Hide'}</button></div>`;
    }).join('') : '<div class="v22-empty-note">No community variations published yet.</div>';
  }
  async function moderate(id) {
    const row = adminRows.find((r) => String(r.id) === String(id)); if (!row || !BE()) return null;
    const next = !row.is_hidden;
    let res;
    try { res = await BE().moderateCommunityVariation(row.id, next); } catch (_) { res = null; }
    if (!res || !res.ok) return null;
    row.is_hidden = next;
    Object.keys(community).forEach((gk) => { community[gk] = (community[gk] || []).map((r) => (r.id === row.id ? { ...r, is_hidden: next } : r)); });
    drawAdminRows();
    return row;
  }

  // ================================================================ wiring
  function onAuthChange(u) {
    user = u || null;
    syncGuestEmail();
    builtAt = 0;
    if (!user) { built = []; renderBuiltBanner(); return; }
    refreshBuiltNotifications(true);
  }
  function hookV20() {
    const v = V20(); if (!v || v.__v22) return;
    v.__v22 = true;
    const oAuth = v.onAuthChange, oSetup = v.onSetupRendered, oStart = v.onGameStarted;
    v.onAuthChange = function (u) { const r = oAuth ? oAuth.apply(v, arguments) : undefined; try { onAuthChange(u); } catch (_) {} return r; };
    v.onSetupRendered = function (gk, ver) { const r = oSetup ? oSetup.apply(v, arguments) : undefined; try { onSetupRendered(gk, ver); } catch (_) {} return r; };
    v.onGameStarted = function (g) { const r = oStart ? oStart.apply(v, arguments) : undefined; try { onGameStarted(g); } catch (_) {} return r; };
    const oOpen = global.openRequestGameModal;
    if (typeof oOpen === 'function') {
      const wrapped = function () { const r = oOpen.apply(this, arguments); syncGuestEmail(); return r; };
      global.openRequestGameModal = wrapped; v.openRequestGameModal = wrapped;
    }
    global.submitGameRequest = v22SubmitGameRequest; v.submitGameRequest = v22SubmitGameRequest;
  }
  hookV20();
  function init() {
    hookV20();
    observe($('game-grid'), applyGameFilter);
    observe($('soc-friends-list'), applyFriendsFilter);
    observe($('history-list'), applyHistoryFilter);
    const knobs = $('v22-hr-knobs');
    if (knobs) { knobs.addEventListener('click', onKnobClick); knobs.addEventListener('change', onKnobChange); knobs.addEventListener('input', onKnobChange); }
    const hn = $('v22-hr-name'); if (hn) hn.addEventListener('input', () => { const m = $('v22-hr-msg'); if (m && m.dataset.tone === 'error') setMsg(''); });
    const ml = $('v22-admin-comm-list');
    if (ml) ml.addEventListener('click', (e) => { const b = e.target.closest('.v22-mod-btn'); if (b) moderate(b.dataset.id); });
    const home = $('view-new');
    if (home && global.MutationObserver) new MutationObserver(() => { if (home.classList.contains('active') && user) refreshBuiltNotifications(false); })
      .observe(home, { attributes: true, attributeFilter: ['class'] });
    syncGuestEmail();
    renderBuiltBanner();
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init, { once: true }); else init();

  const api = { v22FilterGames, v22ClearGameSearch, v22RequestSearchedGame, v22FilterFriends, v22ClearFriendsSearch, v22FilterHistory, v22ClearHistorySearch,
    v22PlayBuiltGame, v22DismissBuiltBanner, refreshBuiltNotifications, v22ToggleHouseRules, v22SaveHouseRulesLocal, v22PublishHouseRules, v22SelectCustomVariation,
    submitGameRequest: v22SubmitGameRequest, getStartOverrides, augmentVariations, isCustomVariation, selectedKey, renderAdminCommunity, moderate, isGuest, matchLiveGame,
    _state: () => ({ gameQuery, friendsQuery, historyQuery, built: built.slice(), hr: { ...hr, rules: { ...(hr.rules || {}) } }, community: { ...community }, adminRows: adminRows.slice(), user }) };
  global.TallyItV22 = api;
  Object.assign(global, { v22FilterGames, v22ClearGameSearch, v22RequestSearchedGame, v22FilterFriends, v22ClearFriendsSearch, v22FilterHistory, v22ClearHistorySearch,
    v22PlayBuiltGame, v22DismissBuiltBanner, v22ToggleHouseRules, v22SaveHouseRulesLocal, v22PublishHouseRules, v22SelectCustomVariation });
})(window);
