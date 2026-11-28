/* =========================================================================
   TallyIt v27 - History list (hybrid): mini scorecards in each game's palette,
   grouped by date, with search + multi-select game strip + Filter sheet/popover
   (date presets, player, group) and a plain-text active-filter summary.
   - Reads the merged history through the existing engine seam
     window.TallyItV26HistoryEngine (entries/user/games/groups/canDelete).
   - Builds each card from Score Tracker Scoring's describeRecord (read only).
   - Opens the existing v26 detail sheet (window.TallyItV26History.open).
   - Rows carry no actions: Delete and Link players live in the detail view.
   No emoji. Icons are 1.75px-stroke inline SVG. No blur anywhere.
   ========================================================================= */
(function (global) {
  'use strict';
  const doc = global.document;
  if (!doc || global.TallyItV27HistoryList) return;

  const ENG = () => global.TallyItV26HistoryEngine || null;
  const RT = () => global.TallyItRecordTools || null;
  const DET = () => global.TallyItV26History || null;
  const SS_KEY = 'tallyit.v27.historyFilters';
  const WIDE_Q = '(min-width: 720px)';
  const DAY = 86400000;

  // ---------------- utils ----------------
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const lc = (s) => String(s == null ? '' : s).trim().toLowerCase();
  const svg = (inner, cls) => `<svg class="v27-hl-ic${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${inner}</svg>`;
  const IC = {
    crown: svg('<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5L3 8z"/>', 'v27-hl-ic-crown'),
    search: svg('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>'),
    x: svg('<path d="M7 7l10 10M17 7L7 17"/>', 'v27-hl-ic-x'),
    close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
    filter: svg('<path d="M4 6h16M7 12h10M10 18h4"/>')
  };
  const minus = (v) => String(v).replace(/^-/, '\u2212');
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const startOfWeek = (now) => { const d = new Date(startOfDay(now)); d.setDate(d.getDate() - d.getDay()); return d.getTime(); }; // weeks start Sunday
  const startOfMonth = (now) => { const d = new Date(now); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); };
  const parseDay = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '')); return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : NaN; };
  const shortDay = (t, withYear) => { try { return new Date(t).toLocaleDateString(undefined, withYear ? { month: 'short', day: 'numeric', year: 'numeric' } : { month: 'short', day: 'numeric' }); } catch (_) { return new Date(t).toDateString(); } };
  const nowMs = () => (typeof global.__v27Now === 'number' ? global.__v27Now : Date.now()); // test hook only

  // ---------------- filters (session-persistent) ----------------
  const DATE_PRESETS = [['any', 'Any time'], ['week', 'This week'], ['month', 'This month'], ['3m', 'Last 3 months'], ['custom', 'Custom']];
  const F = { q: '', games: [], date: 'any', from: '', to: '', player: '', group: 'all' };
  function loadF() {
    try {
      const o = JSON.parse(global.sessionStorage.getItem(SS_KEY) || 'null');
      if (!o || typeof o !== 'object') return;
      F.q = typeof o.q === 'string' ? o.q.slice(0, 80) : '';
      F.games = Array.isArray(o.games) ? o.games.map(String).slice(0, 20) : [];
      F.date = DATE_PRESETS.some((p) => p[0] === o.date) ? o.date : 'any';
      F.from = typeof o.from === 'string' ? o.from : ''; F.to = typeof o.to === 'string' ? o.to : '';
      F.player = typeof o.player === 'string' ? o.player.slice(0, 60) : '';
      F.group = o.group ? String(o.group) : 'all';
    } catch (_) {}
  }
  function saveF() { try { global.sessionStorage.setItem(SS_KEY, JSON.stringify(F)); } catch (_) {} }
  function resetF() { F.q = ''; F.games = []; F.date = 'any'; F.from = ''; F.to = ''; F.player = ''; F.group = 'all'; saveF(); }

  // ---------------- data ----------------
  function entries() { const E = ENG(); try { return (E && E.entries && E.entries()) || []; } catch (_) { return []; } }
  function gamesList() { const E = ENG(); try { return (E && E.games && E.games()) || []; } catch (_) { return []; } }
  function groupsList() {
    const E = ENG(); let gs = [];
    try { gs = (E && E.groups && E.groups()) || []; } catch (_) { gs = []; }
    const seen = new Map(); gs.forEach((g) => { if (g && g.id != null && !seen.has(String(g.id))) seen.set(String(g.id), String(g.name || 'Group')); });
    return [...seen].map(([id, name]) => ({ id, name }));
  }
  function gameKeyOf(g) { const R = RT(); try { if (R && R.gameKeyOf) return R.gameKeyOf(g); } catch (_) {} return String((g && (g.type || g.game_type)) || 'other'); }
  function metaOf(gk) { return gamesList().find((x) => x && x.id === gk) || { id: gk, name: gk === 'other' ? 'Custom' : gk, img: '' }; }
  function whenOf(g) { const t = Date.parse((g && (g.endTime || g.startTime || g.played_at || g.ended_at || g.created_at)) || ''); return Number.isFinite(t) ? t : NaN; }
  function editedOf(g) { return !!(g && ((g.meta && g.meta.edited && g.meta.edited.at) || g.edited_at || g.editedAt || (g.meta && g.meta.edited_at))); }

  function fallbackModel(g, gk) {
    const low = !!(g.low != null ? g.low : g.meta && g.meta.low != null ? g.meta.low : metaOf(gk).low);
    const ps = (g.players || []).map((p, i) => ({ index: i, name: p.name, score: Number(p.score) || 0, members: p.members }));
    ps.sort((a, b) => (low ? a.score - b.score : b.score - a.score));
    let place = 0, last = null;
    ps.forEach((p, k) => { if (p.score !== last) { place = k + 1; last = p.score; } p.place = place; p.isWinner = place === 1; });
    return { gameKey: gk, gameName: metaOf(gk).name, version: g.version || null, players: ps };
  }
  function modelOf(g) {
    const gk = gameKeyOf(g), R = RT();
    if (R && R.describeRecord) { try { return R.describeRecord(g); } catch (_) {} }
    return fallbackModel(g, gk);
  }
  function variationOf(g, m) {
    const v = (g && g.v22VariationName) || (m && m.version) || (g && g.version) || '';
    return /^\s*standard\s*$/i.test(String(v)) ? '' : String(v || '');
  }
  function playerNames(g) {
    const out = [];
    (g.players || []).forEach((p) => { if (p && p.name) out.push(String(p.name)); (p && p.members || []).forEach((m) => { if (m && m.name) out.push(String(m.name)); }); });
    return out;
  }

  // ---------------- filtering ----------------
  function dateRange() {
    const now = nowMs();
    if (F.date === 'week') return [startOfWeek(now), Infinity];
    if (F.date === 'month') return [startOfMonth(now), Infinity];
    if (F.date === '3m') { const d = new Date(startOfDay(now)); d.setMonth(d.getMonth() - 3); return [d.getTime(), Infinity]; }
    if (F.date === 'custom') {
      const a = parseDay(F.from), b = parseDay(F.to);
      return [Number.isFinite(a) ? a : -Infinity, Number.isFinite(b) ? b + DAY - 1 : Infinity];
    }
    return null;
  }
  function dateLabel() {
    if (F.date === 'custom') {
      const a = parseDay(F.from), b = parseDay(F.to);
      if (Number.isFinite(a) && Number.isFinite(b)) return shortDay(a) + ' to ' + shortDay(b);
      if (Number.isFinite(a)) return 'From ' + shortDay(a);
      if (Number.isFinite(b)) return 'Until ' + shortDay(b);
      return '';
    }
    const p = DATE_PRESETS.find((x) => x[0] === F.date); return p && F.date !== 'any' ? p[1] : '';
  }
  function activeGroup(groups) { return F.group !== 'all' && groups.some((g) => g.id === F.group) ? F.group : 'all'; }
  function matches(g, gk, groups) {
    if (F.games.length && !F.games.includes(gk)) return false;
    const r = dateRange();
    if (r) { const t = whenOf(g); if (!Number.isFinite(t) || t < r[0] || t > r[1]) return false; }
    const grp = activeGroup(groups);
    if (grp !== 'all' && String(g.groupId || g.group_id || '') !== grp) return false;
    const names = playerNames(g).map(lc);
    if (F.player && !names.some((n) => n.includes(lc(F.player)))) return false;
    const q = lc(F.q);
    if (q) {
      const m = metaOf(gk);
      const hay = [m.name, g.gameName, g.version, g.v22VariationName].concat(names).map(lc).join(' \u0001 ');
      if (!hay.includes(q)) return false;
    }
    return true;
  }

  // ---------------- grouping ----------------
  function sectionOf(t, now) {
    if (!Number.isFinite(t)) return { key: 'undated', label: 'Undated' };
    const wk = startOfWeek(now), mo = startOfMonth(now), d = new Date(t), n = new Date(now);
    if (t >= wk) return { key: 'week', label: 'This week' };
    if (t >= mo) return { key: 'early', label: 'Earlier in ' + MONTHS[n.getMonth()] };
    const label = MONTHS[d.getMonth()] + (d.getFullYear() === n.getFullYear() ? '' : ' ' + d.getFullYear());
    return { key: d.getFullYear() + '-' + d.getMonth(), label };
  }
  function dayLabel(t, now) {
    if (!Number.isFinite(t)) return '';
    const d0 = startOfDay(now), td = startOfDay(t);
    if (td === d0) return 'Today';
    if (td === d0 - DAY || (td < d0 && td > d0 - DAY - 3600000 * 2)) return 'Yesterday';
    const d = new Date(t), n = new Date(now);
    try { return d.toLocaleDateString(undefined, d.getFullYear() === n.getFullYear() ? { weekday: 'short', month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' }); } catch (_) { return d.toDateString(); }
  }

  // ---------------- rendering ----------------
  const MAX_ROWS = 4;
  function cardHtml(g, now) {
    const gk = gameKeyOf(g), meta = metaOf(gk), m = modelOf(g) || fallbackModel(g, gk);
    const name = (m && m.gameName) || meta.name;
    const ver = variationOf(g, m);
    const t = whenOf(g);
    const rows = (m.players || []).slice().sort((a, b) => (a.place - b.place) || (a.index - b.index));
    const shown = rows.slice(0, MAX_ROWS), extra = rows.length - shown.length;
    const spoons = gk === 'spoons';
    const li = shown.map((p) => {
      const right = spoons
        ? `<span class="v27-hl-out">${p.isWinner ? 'Winner' : p.eliminatedRound != null ? 'Out in round ' + esc(p.eliminatedRound) : 'Still in'}</span>`
        : `<span class="v27-hl-score">${esc(minus(p.score))}</span>`;
      const disc = p.isWinner ? IC.crown : esc(p.place);
      return `<li class="v27-hl-st${p.isWinner ? ' is-winner' : ''}"><span class="v27-hl-place" aria-label="${p.isWinner ? 'Winner' : 'Place ' + esc(p.place)}">${disc}</span><span class="v27-hl-pname">${esc(p.name)}</span>${right}</li>`;
    }).join('');
    const foot = [editedOf(g) ? 'Edited' : '', g.sharedByName ? 'Shared by ' + g.sharedByName : '', g.groupName || ''];
    const ft = foot.filter(Boolean);
    const sharedId = g.sharedGameId || (g.source === 'shared' ? g.id : '');
    const winners = rows.filter((p) => p.isWinner).map((p) => p.name);
    const aria = [name, dayLabel(t, now), winners.length ? 'won by ' + winners.join(' and ') : ''].filter(Boolean).join(', ') + '. Open details';
    const img = meta.art || meta.img;
    return `<article class="v27-hl-card" data-game="${esc(gk)}" data-game-id="${esc(g.id)}"${sharedId ? ` data-shared-id="${esc(sharedId)}"` : ''} role="button" tabindex="0" aria-label="${esc(aria)}">
      <div class="v27-hl-hd">${img ? `<img class="v27-hl-art" src="${esc(img)}" alt="" width="44" height="44" decoding="async" loading="lazy">` : `<span class="v27-hl-art v27-hl-art-ph" aria-hidden="true">${esc(String(name).slice(0, 1))}</span>`}
        <div class="v27-hl-nm"><div class="v27-hl-gn">${esc(name)}</div>${ver ? `<div class="v27-hl-vr" title="${esc(ver)}">${esc(ver)}</div>` : ''}</div>
        <div class="v27-hl-dt">${esc(dayLabel(t, now))}</div></div>
      ${shown.length ? `<ol class="v27-hl-sts">${li}</ol>` : ''}${extra > 0 ? `<div class="v27-hl-more">+${extra} more</div>` : ''}
      ${ft.length ? `<div class="v27-hl-ft">${ft.map(esc).join(' <span aria-hidden="true">&middot;</span> ')}</div>` : ''}
    </article>`;
  }

  let wideMq = null, sheetOpen = false, lastFocus = null;
  const isWide = () => !!(wideMq && wideMq.matches);

  function ensureTools(list) {
    let tools = doc.getElementById('v27-hl-tools');
    if (tools && tools.nextElementSibling === list) return tools;
    if (!tools) {
      tools = doc.createElement('div');
      tools.id = 'v27-hl-tools'; tools.className = 'v27-hl-tools';
      tools.innerHTML = `<div class="v27-hl-bar">
          <div class="v27-hl-sw"><label class="v27-hl-search">${IC.search}<span class="v27-hl-sr">Search history</span>
            <input type="search" id="v27-hl-q" class="v27-hl-q" placeholder="Search game or player" autocomplete="off" enterkeyhint="search"></label>
          <button type="button" class="v27-hl-qx" id="v27-hl-qx" aria-label="Clear search" hidden>${IC.x}</button></div>
          <button type="button" class="v27-hl-fbtn" id="v27-hl-fbtn" aria-haspopup="dialog" aria-expanded="false" aria-controls="v27-hl-filter">${IC.filter}<span>Filter</span></button>
        </div>
        <div class="v27-hl-strip" id="v27-hl-strip" role="group" aria-label="Filter by game"></div>
        <div class="v27-hl-sum" id="v27-hl-sum" aria-live="polite"></div>`;
      tools.addEventListener('input', onToolsInput);
      tools.addEventListener('click', onToolsClick);
    }
    list.parentNode.insertBefore(tools, list);
    return tools;
  }

  function stripHtml(all) {
    const counts = new Map();
    all.forEach((x) => counts.set(x.gk, (counts.get(x.gk) || 0) + 1));
    F.games.forEach((k) => { if (!counts.has(k)) counts.set(k, 0); });
    const keys = [...counts.keys()].sort((a, b) => (counts.get(b) - counts.get(a)) || String(metaOf(a).name).localeCompare(String(metaOf(b).name)));
    if (keys.length < 2 && !F.games.length) return '';
    const btn = (k, label, img, on) => `<button type="button" class="v27-hl-gt${on ? ' is-on' : ''}" data-gk="${esc(k)}" aria-pressed="${on}">${img ? `<img class="v27-hl-gti" src="${esc(img)}" alt="" width="22" height="22" decoding="async">` : ''}<span>${esc(label)}</span></button>`;
    return btn('all', 'All', '', !F.games.length) + keys.map((k) => { const m = metaOf(k); return btn(k, m.name, m.art || m.img, F.games.includes(k)); }).join('');
  }

  function summaryItems(groups) {
    const items = F.games.map((k) => ({ kind: 'game', key: k, label: metaOf(k).name }));
    const dl = dateLabel(); if (dl) items.push({ kind: 'date', label: dl });
    if (F.player) items.push({ kind: 'player', label: 'Player: ' + F.player });
    const grp = activeGroup(groups);
    if (grp !== 'all') { const gg = groups.find((x) => x.id === grp); items.push({ kind: 'group', label: 'Group: ' + (gg ? gg.name : 'Group') }); }
    return items;
  }
  function summaryHtml(items) {
    if (!items.length) return '';
    return items.map((it) => `<span class="v27-hl-si">${esc(it.label)}<button type="button" class="v27-hl-sx" data-rm="${esc(it.kind)}"${it.key ? ` data-key="${esc(it.key)}"` : ''} aria-label="Remove filter ${esc(it.label)}">${IC.x}</button></span>`).join('')
      + `<button type="button" class="v27-hl-clear" data-clear="1">Clear</button>`;
  }
  const sheetCount = (groups) => (dateLabel() ? 1 : 0) + (F.player ? 1 : 0) + (activeGroup(groups) !== 'all' ? 1 : 0);

  function render(listEl) {
    const list = listEl || doc.getElementById('history-list'); if (!list) return false;
    const view = doc.getElementById('view-history'); if (view) view.classList.add('v27-hl-on');
    const tools = ensureTools(list);
    const now = nowMs(), groups = groupsList();
    const all = entries().filter(Boolean).map((g) => ({ g, gk: gameKeyOf(g), t: whenOf(g) }));
    all.sort((a, b) => (Number.isFinite(b.t) ? b.t : -Infinity) - (Number.isFinite(a.t) ? a.t : -Infinity));
    const shown = all.filter((x) => matches(x.g, x.gk, groups));

    // toolbar state
    const q = tools.querySelector('#v27-hl-q'); if (q && doc.activeElement !== q && q.value !== F.q) q.value = F.q;
    const qx = tools.querySelector('#v27-hl-qx'); if (qx) qx.hidden = !F.q;
    const strip = tools.querySelector('#v27-hl-strip'); const sh = stripHtml(all);
    if (strip) { const keep = strip.scrollLeft; strip.innerHTML = sh; strip.hidden = !sh; strip.scrollLeft = keep; }
    const items = summaryItems(groups);
    const sum = tools.querySelector('#v27-hl-sum'); if (sum) { sum.innerHTML = summaryHtml(items); sum.hidden = !items.length; }
    const fb = tools.querySelector('#v27-hl-fbtn');
    if (fb) { const n = sheetCount(groups); fb.classList.toggle('is-on', n > 0); fb.setAttribute('aria-label', n ? 'Filter, ' + n + ' active' : 'Filter'); }
    tools.hidden = !all.length;

    // list
    if (!all.length) {
      list.innerHTML = `<div class="v27-hl-empty" role="status"><p class="v27-hl-empty-t">No finished games yet.</p><p class="v27-hl-empty-s">Games you finish and save show up here.</p><button type="button" class="v27-hl-link" data-go="new">Start a game</button></div>`;
    } else if (!shown.length) {
      list.innerHTML = `<div class="v27-hl-empty" role="status"><p class="v27-hl-empty-t">No games match these filters.</p><p class="v27-hl-empty-s">Remove a filter, or clear them all.</p><button type="button" class="v27-hl-link" data-clear="1">Clear filters</button></div>`;
    } else {
      const secs = []; const byKey = new Map();
      shown.forEach((x) => { const s = sectionOf(x.t, now); let b = byKey.get(s.key); if (!b) { b = { label: s.label, items: [] }; byKey.set(s.key, b); secs.push(b); } b.items.push(x); });
      list.innerHTML = secs.map((s) => `<section class="v27-hl-sec" aria-label="${esc(s.label)}"><h3 class="v27-hl-sec-h">${esc(s.label)}</h3><div class="v27-hl-cards">${s.items.map((x) => cardHtml(x.g, now)).join('')}</div></section>`).join('');
    }
    list.setAttribute('data-v27-count', String(shown.length));
    if (sheetOpen) renderSheet();
    return true;
  }
  function rerender() { const E = ENG(); if (E && E.refresh) { try { E.refresh(); return; } catch (_) {} } render(); }

  // ---------------- filter sheet / popover ----------------
  let sheet = null, scrim = null;
  function ensureSheet() {
    if (sheet && doc.body.contains(sheet)) return sheet;
    scrim = doc.createElement('div'); scrim.className = 'v27-hl-scrim'; scrim.hidden = true;
    scrim.addEventListener('click', closeSheet);
    sheet = doc.createElement('div'); sheet.id = 'v27-hl-filter'; sheet.className = 'v27-hl-sheet'; sheet.hidden = true;
    sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true'); sheet.setAttribute('aria-labelledby', 'v27-hl-sheet-t');
    sheet.addEventListener('click', onSheetClick); sheet.addEventListener('change', onSheetChange); sheet.addEventListener('input', onSheetInput);
    sheet.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); closeSheet(); } else if (e.key === 'Tab') trapTab(e); });
    doc.body.appendChild(scrim); doc.body.appendChild(sheet);
    return sheet;
  }
  function trapTab(e) {
    const f = [...sheet.querySelectorAll('button, input, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled && x.offsetParent !== null);
    if (!f.length) return; const a = f[0], z = f[f.length - 1];
    if (e.shiftKey && doc.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && doc.activeElement === z) { e.preventDefault(); a.focus(); }
  }
  function renderSheet() {
    if (!sheet) return;
    const groups = groupsList(), grp = activeGroup(groups);
    const names = new Map(); entries().forEach((g) => playerNames(g).forEach((n) => { const k = lc(n); if (k && !names.has(k)) names.set(k, n); }));
    const radio = (name, val, label, on) => `<label class="v27-hl-opt"><input class="v27-hl-radio" type="radio" name="${name}" value="${esc(val)}"${on ? ' checked' : ''}><span>${esc(label)}</span></label>`;
    const focusId = doc.activeElement && sheet.contains(doc.activeElement) ? doc.activeElement.id || (doc.activeElement.name + ':' + doc.activeElement.value) : '';
    sheet.innerHTML = `<div class="v27-hl-sheet-in">
      <div class="v27-hl-grab" aria-hidden="true"></div>
      <div class="v27-hl-sheet-bar"><h2 id="v27-hl-sheet-t" class="v27-hl-sheet-t" tabindex="-1">Filters</h2>
        <button type="button" class="v27-hl-iconbtn" data-act="close" aria-label="Close filters">${IC.close}</button></div>
      <div class="v27-hl-sheet-body">
        <fieldset class="v27-hl-fs"><legend class="v27-hl-k">Date</legend>
          ${DATE_PRESETS.map((p) => radio('v27-date', p[0], p[1], F.date === p[0])).join('')}
          <div class="v27-hl-range"${F.date === 'custom' ? '' : ' hidden'}>
            <label class="v27-hl-dl"><span>From</span><input type="date" id="v27-hl-from" class="v27-hl-in" value="${esc(F.from)}"${F.to ? ` max="${esc(F.to)}"` : ''}></label>
            <label class="v27-hl-dl"><span>To</span><input type="date" id="v27-hl-to" class="v27-hl-in" value="${esc(F.to)}"${F.from ? ` min="${esc(F.from)}"` : ''}></label>
          </div>
        </fieldset>
        <div class="v27-hl-fs"><label class="v27-hl-k" for="v27-hl-player">Player</label>
          <input type="text" id="v27-hl-player" class="v27-hl-in v27-hl-in-wide" list="v27-hl-players" placeholder="Player name" autocomplete="off" value="${esc(F.player)}">
          <datalist id="v27-hl-players">${[...names.values()].sort((a, b) => a.localeCompare(b)).map((n) => `<option value="${esc(n)}"></option>`).join('')}</datalist>
        </div>
        ${groups.length ? `<fieldset class="v27-hl-fs"><legend class="v27-hl-k">Group</legend>${radio('v27-group', 'all', 'All games', grp === 'all')}${groups.map((g) => radio('v27-group', g.id, g.name, grp === g.id)).join('')}</fieldset>` : ''}
      </div>
      <div class="v27-hl-sheet-foot">
        <button type="button" class="v27-hl-btn v27-hl-btn-ghost" data-act="reset"${sheetCount(groups) ? '' : ' disabled'}>Reset</button>
        <button type="button" class="v27-hl-btn v27-hl-btn-primary" data-act="close">Done</button>
      </div></div>`;
    if (focusId) {
      const el = focusId.includes(':') ? sheet.querySelector(`input[name="${focusId.split(':')[0]}"][value="${focusId.split(':').slice(1).join(':')}"]`) : sheet.querySelector('#' + focusId);
      if (el) { try { el.focus({ preventScroll: true }); if (el.id === 'v27-hl-player') { const v = el.value.length; el.setSelectionRange(v, v); } } catch (_) {} }
    }
    position();
  }
  function position() {
    if (!sheet) return;
    const wide = isWide();
    sheet.classList.toggle('is-popover', wide); scrim.classList.toggle('is-popover', wide);
    if (!wide) { sheet.style.removeProperty('top'); sheet.style.removeProperty('left'); sheet.style.removeProperty('right'); return; }
    const b = doc.getElementById('v27-hl-fbtn'); if (!b) return;
    const r = b.getBoundingClientRect(), W = global.innerWidth;
    const w = Math.min(360, W - 24);
    sheet.style.top = Math.round(r.bottom + 8) + 'px';
    sheet.style.left = Math.round(Math.max(12, Math.min(r.right - w, W - w - 12))) + 'px';
  }
  function openSheet() {
    ensureSheet(); lastFocus = doc.activeElement; sheetOpen = true;
    renderSheet(); sheet.hidden = false; scrim.hidden = false;
    if (!isWide()) doc.documentElement.classList.add('v27-hl-lock');
    const fb = doc.getElementById('v27-hl-fbtn'); if (fb) fb.setAttribute('aria-expanded', 'true');
    const t = sheet.querySelector('#v27-hl-sheet-t'); if (t) { try { t.focus({ preventScroll: true }); } catch (_) {} }
  }
  function closeSheet() {
    if (!sheet || !sheetOpen) return;
    sheetOpen = false; sheet.hidden = true; scrim.hidden = true; sheet.innerHTML = '';
    doc.documentElement.classList.remove('v27-hl-lock');
    const fb = doc.getElementById('v27-hl-fbtn'); if (fb) fb.setAttribute('aria-expanded', 'false');
    const f = lastFocus && doc.body.contains(lastFocus) ? lastFocus : fb; if (f && f.focus) { try { f.focus({ preventScroll: true }); } catch (_) {} }
  }
  function onSheetClick(e) {
    const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
    const a = b.getAttribute('data-act');
    if (a === 'close') closeSheet();
    else if (a === 'reset') { F.date = 'any'; F.from = ''; F.to = ''; F.player = ''; F.group = 'all'; saveF(); rerender(); }
  }
  function onSheetChange(e) {
    const el = e.target;
    if (el.name === 'v27-date') { F.date = el.value; saveF(); rerender(); }
    else if (el.name === 'v27-group') { F.group = el.value; saveF(); rerender(); }
    else if (el.id === 'v27-hl-from' || el.id === 'v27-hl-to') { F[el.id === 'v27-hl-from' ? 'from' : 'to'] = el.value || ''; saveF(); rerender(); }
  }
  let playerTimer = 0;
  function onSheetInput(e) {
    const el = e.target;
    if (el.id === 'v27-hl-player') { clearTimeout(playerTimer); playerTimer = setTimeout(() => { F.player = el.value.trim().slice(0, 60); saveF(); rerender(); }, 160); }
  }

  // ---------------- toolbar + list events ----------------
  let qTimer = 0;
  function onToolsInput(e) {
    if (e.target.id !== 'v27-hl-q') return;
    const v = e.target.value;
    clearTimeout(qTimer); qTimer = setTimeout(() => { F.q = v.slice(0, 80); saveF(); rerender(); }, 120);
  }
  function onToolsClick(e) {
    const t = e.target;
    const gt = t.closest('.v27-hl-gt');
    if (gt) {
      const k = gt.getAttribute('data-gk');
      if (k === 'all') F.games = [];
      else F.games = F.games.includes(k) ? F.games.filter((x) => x !== k) : F.games.concat(k);
      saveF(); rerender(); return;
    }
    if (t.closest('#v27-hl-qx')) { F.q = ''; const q = doc.getElementById('v27-hl-q'); if (q) { q.value = ''; q.focus(); } saveF(); rerender(); return; }
    if (t.closest('#v27-hl-fbtn')) { if (sheetOpen) closeSheet(); else openSheet(); return; }
    const rm = t.closest('[data-rm]');
    if (rm) {
      const kind = rm.getAttribute('data-rm');
      if (kind === 'game') F.games = F.games.filter((x) => x !== rm.getAttribute('data-key'));
      else if (kind === 'date') { F.date = 'any'; F.from = ''; F.to = ''; }
      else if (kind === 'player') F.player = '';
      else if (kind === 'group') F.group = 'all';
      saveF(); rerender();
      const s = doc.getElementById('v27-hl-sum'); const nx = s && s.querySelector('button'); const fb = doc.getElementById('v27-hl-fbtn');
      try { (nx || fb).focus({ preventScroll: true }); } catch (_) {}
      return;
    }
    if (t.closest('[data-clear]')) { clearAll(); }
  }
  function clearAll() { resetF(); const q = doc.getElementById('v27-hl-q'); if (q) q.value = ''; rerender(); const fb = doc.getElementById('v27-hl-q'); if (fb) { try { fb.focus({ preventScroll: true }); } catch (_) {} } }
  function openCard(card) {
    const id = card.getAttribute('data-game-id') || card.getAttribute('data-shared-id');
    const D = DET(); if (id && D && D.open) D.open(id, { returnFocus: card });
  }
  function onDocClick(e) {
    const list = doc.getElementById('history-list'); if (!list || !list.contains(e.target)) return;
    const card = e.target.closest('.v27-hl-card'); if (card) { openCard(card); return; }
    if (e.target.closest('[data-clear]')) { clearAll(); return; }
    const go = e.target.closest('[data-go]'); if (go && typeof global.showView === 'function') global.showView(go.getAttribute('data-go'));
  }
  function onDocKey(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const c = e.target && e.target.classList && e.target.classList.contains('v27-hl-card') ? e.target : null;
    if (!c) return; e.preventDefault(); openCard(c);
  }

  function init() {
    loadF();
    try { wideMq = global.matchMedia ? global.matchMedia(WIDE_Q) : null; } catch (_) { wideMq = null; }
    const onWide = () => { if (sheetOpen) { position(); doc.documentElement.classList.toggle('v27-hl-lock', !isWide()); } };
    if (wideMq) { if (wideMq.addEventListener) wideMq.addEventListener('change', onWide); else if (wideMq.addListener) wideMq.addListener(onWide); }
    global.addEventListener('resize', () => { if (sheetOpen) position(); });
    doc.addEventListener('click', onDocClick);
    doc.addEventListener('keydown', onDocKey);
    // close the sheet if History is left underneath it
    const view = doc.getElementById('view-history');
    if (view && global.MutationObserver) new MutationObserver(() => { if (sheetOpen && !view.classList.contains('active')) closeSheet(); }).observe(view, { attributes: true, attributeFilter: ['class'] });
    const E = ENG(); if (E && E.refresh) { try { E.refresh(); } catch (_) {} }
  }

  global.TallyItV27HistoryList = {
    render, openFilters: openSheet, closeFilters: closeSheet, clearFilters: clearAll,
    getFilters: () => JSON.parse(JSON.stringify(F)),
    setFilters(o) { Object.assign(F, o || {}); saveF(); rerender(); },
    _sectionOf: sectionOf, _dayLabel: dayLabel
  };
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})(typeof window !== 'undefined' ? window : globalThis);
