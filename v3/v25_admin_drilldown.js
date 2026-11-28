/* =========================================================================
   TallyIt v25 - Admin drill-down (window.TallyItV25AdminDrilldown)

   Makes every stat box on the admin page (#admin-screen) clickable and
   keyboard-accessible (role=button, tabindex=0, Enter / Space). Activating a
   box opens a full-screen sheet (phones) or a centered panel (tablet / desktop):
   title + count, debounced search, sort, paging (25 per page, "x-y of N"),
   loading / empty / notice / error states, row -> detail view, and stacked
   drill levels with a Back button and a breadcrumb (Most Played Games ->
   Catan -> that game's plays). Esc / Back steps out one level, Tab is trapped
   inside, focus returns to the opener on close. Read-only.

   ---------------------------------------------------------------------------
   DATA SOURCE: Auth's window.TallyItV25Admin (v25_admin_backend.js). Nothing is
   hard-coded: boxes, columns, sortable flags, hidden flags, default sort,
   tabs and next-level drill all come from its BOX registry.
   ---------------------------------------------------------------------------
     TallyItV25Admin.boxForKpi(elementId)  -> box   (which boxes are clickable)
     TallyItV25Admin.getBox(key) / listBoxes()
         box = { key, label, method, columns:[{key,label,type,sortable,hidden}],
                 filters, tabs, defaultSort, defaultDir, detail, kpiId }
         column.type: text | number | datetime | date | url | uuid | bool | json
     TallyItV25Admin.drilldown(boxKey, { search, limit, offset, sort, dir, filters })
         -> { ok:true, rows, total, limit, offset, has_more }
          | { ok:false, forbidden:true }       quiet "Admin access required" notice
          | { ok:false, unavailable:true }     quiet "SQL not run yet" notice + Check again
          | { ok:false, error }                error state with Try again
         filters = camelCase keys the backend accepts: window, signup, active,
         status, visibility, gameKey, variationKey, gameType, date, days
     TallyItV25Admin.detailFor(boxKey, row)  -> next drill level for a row:
         { method:'drilldown', box, opts:{ filters } }   (top game / variation / chart day -> its plays)
       | { method:'getSharedGame', id }                  (shared game -> detail + participants)
       | null                                            (row detail only)
     TallyItV25Admin.getSharedGame(id) -> { ok, game, participants[] }

   Rows are rendered from the registry columns: visible columns in the list,
   hidden columns (ids, emails, extra counts) in the detail view.

   ---------------------------------------------------------------------------
   ADAPTER SEAM (optional): TallyItV25AdminDrilldown.setAdapter(partial)
   The default adapter is exactly the API above. Override any subset:
     getBox(key), listBoxes(), boxForKpi(id), detailFor(key,row),
     list(boxKey, { search, sort, dir, limit, offset, filters }) -> Promise<{ok,rows,total,has_more}>,
     getSharedGame(id) -> Promise<{ok, game, participants}>
   (the harness instead stubs window.TallyItV25Admin / its Supabase RPCs).

   Public API: setAdapter, getAdapter, open(boxKey, { filters, title }), close(),
     isOpen(), decorate()
   Zero emojis. Icons are inline SVG, stroke-width 1.75.
   ========================================================================= */
(function (global) {
  'use strict';
  if (global.TallyItV25AdminDrilldown) return;
  var doc = global.document;
  var PAGE_SIZE = 25;
  var DEBOUNCE_MS = 300;

  // ------------------------------------------------------------------ helpers
  function $(id) { return doc.getElementById(id); }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function isNil(v) { return v === null || v === undefined || v === ''; }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function fmtNum(v) { return isNil(v) ? '\u2014' : Number(v).toLocaleString(); }
  function toDate(v) { if (isNil(v)) return null; var d = typeof v === 'number' ? new Date(v) : new Date(String(v).length === 10 ? v + 'T12:00:00' : v); return isNaN(d.getTime()) ? null : d; }
  function fmtDate(v) { var d = toDate(v); return d ? d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '\u2014'; }
  function fmtDateTime(v) { var d = toDate(v); return d ? d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) + ', ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '\u2014'; }
  function fmtRel(v) {
    var d = toDate(v); if (!d) return 'Never';
    var s = Math.max(0, (Date.now() - d.getTime()) / 1000);
    if (s < 3600) return Math.max(1, Math.round(s / 60)) + 'm ago';
    if (s < 86400) return Math.round(s / 3600) + 'h ago';
    if (s < 86400 * 30) return Math.round(s / 86400) + 'd ago';
    return fmtDate(d);
  }
  function humanize(k) { return String(k == null ? '' : k).replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\b\w/g, function (c) { return c.toUpperCase(); }); }
  var GAME_NAMES = { flip7: 'Flip 7', '7wonders': '7 Wonders', 'seven-wonders': '7 Wonders', seven_wonders: '7 Wonders', carcassonne: 'Carcassonne', catan: 'Catan', ohhell: 'Oh Hell', hearts: 'Hearts', nertz: 'Nertz', rummikub: 'Rummikub', qwirkle: 'Qwirkle', other: 'Custom', custom: 'Custom' };
  function gameName(k) { if (isNil(k)) return '\u2014'; var key = String(k).toLowerCase(); return GAME_NAMES[key] || humanize(k); }
  function svg(path, cls) { return '<svg' + (cls ? ' class="' + cls + '"' : '') + ' viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + '</svg>'; }
  var ICON_CHEV = '<polyline points="9 18 15 12 9 6"/>';
  var ICON_SORT = '<line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>';
  var ICON_SPIN = '<path d="M21 12a9 9 0 1 1-6.22-8.56"/>';
  var ICON_X = '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>';
  var ICON_WARN = '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>';
  function pick(o, keys) { for (var i = 0; i < keys.length; i++) { var v = o[keys[i]]; if (v !== undefined && v !== null) return v; } return undefined; }
  var STATUS_TONE = { new: 'warn', reviewing: 'info', planned: 'info', built: 'ok', declined: '', pending: 'warn', accepted: 'ok' };
  function fmtShort(v) {
    var d = toDate(v); if (!d) return '\u2014';
    if (d.getFullYear() === new Date().getFullYear()) return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ', ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return fmtDate(d);
  }

  // ------------------------------------------------------------------ adapter (default = Auth's TallyItV25Admin)
  var PAGE_SIZE = 25;
  var DEBOUNCE_MS = 300;
  var UNAVAILABLE_MSG = 'The admin data service is not available yet.';
  function api() { return global.TallyItV25Admin || null; }
  var defaultAdapter = {
    name: 'TallyItV25Admin',
    getBox: function (k) { var A = api(); return A && A.getBox ? A.getBox(k) : null; },
    listBoxes: function () { var A = api(); return A && A.listBoxes ? A.listBoxes() : []; },
    boxForKpi: function (id) { var A = api(); return A && A.boxForKpi ? A.boxForKpi(id) : null; },
    detailFor: function (k, row) { var A = api(); return A && A.detailFor ? A.detailFor(k, row) : null; },
    list: function (boxKey, o) {
      var A = api();
      if (!A || typeof A.drilldown !== 'function') return Promise.resolve({ ok: false, unavailable: true, error: UNAVAILABLE_MSG });
      return Promise.resolve(A.drilldown(boxKey, { search: o.search, limit: o.limit, offset: o.offset, sort: o.sort, dir: o.dir, filters: o.filters }));
    },
    getSharedGame: function (id) {
      var A = api();
      if (!A || typeof A.getSharedGame !== 'function') return Promise.resolve({ ok: false, unavailable: true, error: UNAVAILABLE_MSG });
      return Promise.resolve(A.getSharedGame(id));
    }
  };
  var adapter = defaultAdapter;
  function setAdapter(partial) { adapter = Object.assign({}, defaultAdapter, partial || {}); return adapter; }
  function getAdapter() { return adapter; }
  function safe(fn, dflt) { try { var v = fn(); return v === undefined ? dflt : v; } catch (_) { return dflt; } }
  function callList(boxKey, o) {
    var p; try { p = Promise.resolve(adapter.list(boxKey, o)); } catch (e) { p = Promise.reject(e); }
    return p.then(function (r) { return r && typeof r === 'object' ? r : { ok: false, error: 'Unexpected reply.' }; }, function (e) { return { ok: false, error: (e && e.message) || 'Something went wrong.' }; });
  }

  // ------------------------------------------------------------------ UI copy per backend method (the rest comes from the registry)
  var WIN = [['all', 'All time'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days']];
  var ANY = [['all', 'Any time'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days']];
  var METHOD_UI = {
    listUsers: { noun: 'user', nouns: 'users', placeholder: 'Search name, email or friend code', filters: [{ key: 'signup', label: 'Signed up', options: ANY }, { key: 'active', label: 'Active', options: ANY }] },
    listPlays: { noun: 'game', nouns: 'games', placeholder: 'Search game, variation or player', rel: 'games played', filters: [{ key: 'window', label: 'Period', options: WIN }] },
    listGameRequests: { noun: 'request', nouns: 'requests', placeholder: 'Search game, link or requester', filters: [{ key: 'status', label: 'Status', options: [['all', 'All'], ['new', 'New'], ['reviewing', 'Reviewing'], ['planned', 'Planned'], ['built', 'Built'], ['declined', 'Declined']] }] },
    listFriendships: { noun: 'friendship', nouns: 'friendships', placeholder: 'Search by name or email', filters: [{ key: 'status', label: 'Status', options: [['accepted', 'Accepted'], ['pending', 'Pending'], ['declined', 'Declined'], ['all', 'All']] }] },
    listGroups: { noun: 'group', nouns: 'groups', placeholder: 'Search groups or owners' },
    listGameBreakdown: { noun: 'game', nouns: 'games', placeholder: 'Search games' },
    listVariationBreakdown: { noun: 'variation', nouns: 'variations', placeholder: 'Search variations' },
    listDailyPlays: { noun: 'day', nouns: 'days', placeholder: 'Search' },
    listSharedGames: { noun: 'shared game', nouns: 'shared games', placeholder: 'Search game, creator or winner', filters: [{ key: 'window', label: 'Period', options: WIN }] },
    listCommunityVariations: { noun: 'variation', nouns: 'variations', placeholder: 'Search name, game or author', filters: [{ key: 'visibility', label: 'Show', options: [['all', 'All'], ['visible', 'Visible'], ['hidden', 'Hidden']] }] }
  };
  function ui(box) { return METHOD_UI[box && box.method] || { noun: 'record', nouns: 'records', placeholder: 'Search' }; }
  var FILTER_LABELS = { gameKey: 'Game', gameType: 'Game', variationKey: 'Variation', date: 'Day', status: 'Status' };
  function filterValue(k, v) { return k === 'gameKey' || k === 'gameType' ? gameName(v) : k === 'variationKey' ? humanize(v) : k === 'date' ? fmtDate(v) : humanize(v); }
  function chipFor(filters) { return Object.keys(filters || {}).map(function (k) { return (FILTER_LABELS[k] || humanize(k)) + ': ' + filterValue(k, filters[k]); }).join(' / '); }
  function titleFor(box, filtered) {
    if (box.method === 'listPlays') return filtered ? 'Games Played' : (/game/i.test(box.label) ? box.label : 'Games, ' + box.label);
    return box.label;
  }
  var WIDTH_BY_TYPE = { datetime: '1.25fr', date: '1fr', number: '0.9fr', text: '1.2fr', url: '1fr', bool: '0.8fr', json: '1fr', uuid: '1fr' };
  function visibleCols(box) { return (box.columns || []).filter(function (c) { return !c.hidden; }); }
  function colWidth(c) { return /email/.test(c.key) ? '1.6fr' : c.key === 'status' ? '0.9fr' : (WIDTH_BY_TYPE[c.type] || '1fr'); }
  // primary = first text column (not status), secondary = the next text column; everything else is meta
  function roles(box) {
    var cols = visibleCols(box), map = {}, prim = null, sec = null;
    cols.forEach(function (c) { if (c.type === 'text' && c.key !== 'status') { if (!prim) prim = c.key; else if (!sec) sec = c.key; } });
    if (!prim && cols.length) prim = cols[0].key;
    cols.forEach(function (c) { map[c.key] = c.key === prim ? 'primary' : c.key === sec ? 'secondary' : 'meta'; });
    return map;
  }

  // ------------------------------------------------------------------ cell rendering
  function badge(text, tone) { return '<span class="v25-admin-badge"' + (tone ? ' data-tone="' + tone + '"' : '') + '>' + esc(text) + '</span>'; }
  var RECENT_KEYS = { last_active_at: 1, last_sign_in_at: 1, last_played_at: 1 };
  function cellHTML(col, row, detail) {
    var k = col.key, t = col.type, v = row[k];
    if (isNil(v) || (t === 'json' && Array.isArray(v) && !v.length && !detail)) {
      if (k === 'last_active_at') return 'Never';
      return detail ? '<span class="v25-admin-dd-null">\u2014</span>' : '\u2014';
    }
    if (t === 'bool') return k === 'is_hidden' ? (v ? badge('Hidden', 'bad') : badge('Visible', 'ok')) : (v ? 'Yes' : 'No');
    if (t === 'number') return esc(fmtNum(v));
    if (t === 'datetime') {
      if (RECENT_KEYS[k]) return detail ? esc(fmtDateTime(v) + ' (' + fmtRel(v) + ')') : '<span title="' + esc(fmtDateTime(v)) + '">' + esc(fmtRel(v)) + '</span>';
      return esc(detail ? fmtDateTime(v) : fmtShort(v));
    }
    if (t === 'date') return esc(fmtDate(v));
    if (t === 'url') {
      var s = String(v), host = s; try { host = new URL(s).hostname.replace(/^www\./, ''); } catch (_) {}
      return /^https?:\/\//i.test(s) ? '<a href="' + esc(s) + '" target="_blank" rel="noopener noreferrer">' + esc(detail ? s : host) + '</a>' : esc(s);
    }
    if (t === 'json') return detail ? generic(v) : esc(Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? Object.keys(v).length + ' items' : v);
    if (t === 'uuid') return '<span class="v25-admin-mono">' + esc(v) + '</span>';
    if (k === 'game_key' || k === 'game_type') return esc(gameName(v));
    if (k === 'variation_key') return esc(humanize(v));
    if (k === 'status') return badge(String(v), STATUS_TONE[String(v)] || '');
    return esc(v);
  }
  function generic(v) {
    if (isNil(v)) return '<span class="v25-admin-dd-null">\u2014</span>';
    if (Array.isArray(v)) {
      if (!v.length) return '<span class="v25-admin-dd-null">None</span>';
      if (v.every(function (x) { return x === null || typeof x !== 'object'; })) return '<div class="v25-admin-chips">' + v.map(function (x) { return badge(x, ''); }).join('') + '</div>';
      return '<ul class="v25-admin-sublist">' + v.map(function (x) {
        if (x === null || typeof x !== 'object') return '<li class="v25-admin-subitem">' + esc(x) + '</li>';
        var tk = ['title', 'name', 'display_name', 'game', 'email', 'id'].filter(function (k) { return !isNil(x[k]); })[0];
        var rest = Object.keys(x).filter(function (k) { return k !== tk && k !== 'id' && x[k] !== null && typeof x[k] !== 'object' && x[k] !== ''; }).slice(0, 5).map(function (k) { return humanize(k) + ': ' + (typeof x[k] === 'boolean' ? (x[k] ? 'Yes' : 'No') : /^\d{4}-\d{2}-\d{2}T/.test(String(x[k])) ? fmtDateTime(x[k]) : x[k]); });
        return '<li class="v25-admin-subitem">' + esc(tk ? x[tk] : JSON.stringify(x)) + (rest.length ? '<small>' + esc(rest.join(' \u00b7 ')) + '</small>' : '') + '</li>';
      }).join('') + '</ul>';
    }
    if (typeof v === 'object') return '<ul class="v25-admin-sublist">' + Object.keys(v).map(function (k) { return '<li class="v25-admin-subitem"><small>' + esc(humanize(k)) + '</small>' + esc(v[k] !== null && typeof v[k] === 'object' ? JSON.stringify(v[k]) : v[k]) + '</li>'; }).join('') + '</ul>';
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    if (typeof v === 'number') return esc(fmtNum(v));
    if (/^\d{4}-\d{2}-\d{2}T/.test(String(v))) return esc(fmtDateTime(v));
    return esc(v);
  }

  // ------------------------------------------------------------------ controller
  var S = { open: false, cur: null, stack: [], opener: null, seq: 0, dseq: 0, timer: null, prevOverflow: '', pushed: false, closingFromPop: false, ro: null };
  var els = {};
  var bound = false;
  var NAMES = ['title', 'count', 'back', 'close', 'refresh', 'crumbs', 'tabs', 'search', 'clear', 'controls', 'sort', 'dir', 'thead', 'skel', 'empty', 'empty-title', 'empty-text', 'notice', 'notice-title', 'notice-text', 'notice-retry', 'error', 'error-text', 'retry', 'rows', 'pager', 'prev', 'next', 'range', 'listview', 'detail', 'detail-body', 'detail-state', 'scroll', 'detail-scroll'];
  function grab() {
    if (els.root && els.root.isConnected) return true;
    els.root = $('v25-admin-drill'); if (!els.root) return false;
    els.panel = els.root.querySelector('.v25-admin-panel');
    NAMES.forEach(function (n) { els[n] = $('v25-admin-' + n); });
    bound = false; bindSheet(); return true;
  }
  function boxOf(c) { return c._box || (c._box = adapter.getBox(c.boxKey)); }
  function newLevel(boxKey, o) {
    var box = adapter.getBox(boxKey); if (!box) return null; o = o || {};
    var filtered = !!(o.filters && Object.keys(o.filters).length);
    return { boxKey: boxKey, _box: box, title: o.title || titleFor(box, filtered && !o.title && o.drill), filters: Object.assign({}, o.filters || {}), chip: o.chip || '', tabs: o.tabs !== undefined ? o.tabs : (box.tabs || null),
      search: '', sort: box.defaultSort || null, dir: box.defaultDir || 'desc', offset: 0, total: null, hasMore: false, rows: [], view: 'list', detailRow: null, detailId: null, detailMerged: null, scrollTop: 0, error: null };
  }
  function effFilters(c) { return Object.assign({}, boxOf(c).filters || {}, c.filters); }
  function lockScroll(on) { var b = doc.body; if (on) { S.prevOverflow = b.style.overflow; b.style.overflow = 'hidden'; } else { b.style.overflow = S.prevOverflow || ''; } }
  function open(boxKey, o) {
    if (!grab()) return;
    var lvl = newLevel(boxKey, o); if (!lvl) return;
    if (!S.open) {
      var ae = doc.activeElement;
      S.opener = ae && ae !== doc.body ? ae : null;
      S.stack = []; S.open = true; els.root.hidden = false; lockScroll(true);
      try { global.history.pushState({ v25drill: 1 }, ''); S.pushed = true; } catch (_) { S.pushed = false; }
      doc.addEventListener('keydown', onKey, true);
      global.addEventListener('popstate', onPop);
      global.addEventListener('resize', measure);
      if (global.ResizeObserver) { S.ro = new global.ResizeObserver(measure); S.ro.observe(els.panel); }
    }
    S.cur = lvl;
    startLevel(); focusPanel();
  }
  function startLevel() { measure(); showList(true); buildChrome(); load({ first: true }); }
  function focusPanel() { try { els.panel.focus({ preventScroll: true }); } catch (_) {} }
  function close(fromPop) {
    if (!S.open) return;
    S.open = false; els.root.hidden = true; lockScroll(false);
    clearTimeout(S.timer); S.seq++; S.dseq++;
    doc.removeEventListener('keydown', onKey, true);
    global.removeEventListener('popstate', onPop); global.removeEventListener('resize', measure);
    if (S.ro) { S.ro.disconnect(); S.ro = null; }
    if (S.pushed && !fromPop) { S.closingFromPop = true; try { global.history.back(); } catch (_) {} setTimeout(function () { S.closingFromPop = false; }, 50); }
    S.pushed = false;
    var o = S.opener; S.opener = null; S.cur = null; S.stack = [];
    if (o && o.isConnected) { try { o.focus({ preventScroll: true }); } catch (_) {} }
  }
  function onPop() { if (S.closingFromPop || !S.open) return; S.pushed = false; if (!stepBack(true)) close(true); }
  function cssEsc(s) { return String(s).replace(/["\\]/g, '\\$&'); }
  function restoreLevel(c) {
    S.cur = c; buildChrome();
    if (c.total != null && c.rows.length) { renderRows(); updateCount(); } else load({ first: true });
    if (c.view === 'detail' && c.detailRow) { showDetailView(c); if (c.detailMerged) renderDetail(c, c.detailMerged, 'none'); els.back.focus({ preventScroll: true }); }
    else { showList(false); var r = c.detailId != null ? els.rows.querySelector('[data-id="' + cssEsc(c.detailId) + '"]') : null; if (r) r.focus({ preventScroll: true }); else focusPanel(); }
  }
  // one step out: detail -> list, stacked level -> previous level; false when nothing is left (caller closes)
  function stepBack(fromPop) {
    if (!S.cur) return false;
    var stepped = false;
    if (S.cur.view === 'detail') {
      S.dseq++; showList(false); stepped = true;
      var row = S.cur.detailId != null ? els.rows.querySelector('[data-id="' + cssEsc(S.cur.detailId) + '"]') : null;
      if (row) row.focus({ preventScroll: true }); else focusPanel();
    } else if (S.stack.length) {
      restoreLevel(S.stack.pop()); stepped = true;
    }
    if (stepped && fromPop) { try { global.history.pushState({ v25drill: 1 }, ''); S.pushed = true; } catch (_) {} }
    syncBack();
    return stepped;
  }
  function popTo(i) { while (S.stack.length > i + 1) S.stack.pop(); if (S.stack.length > i) { var c = S.stack.pop(); c.view = 'list'; restoreLevel(c); } }
  function syncBack() { if (els.back) els.back.hidden = !(S.cur && (S.cur.view === 'detail' || S.stack.length)); }
  function measure() {
    if (!S.open || !els.panel || !S.cur) return;
    var mode = global.innerWidth >= 700 && global.innerHeight >= 520 ? 'panel' : 'sheet';
    if (els.panel.getAttribute('data-mode') !== mode) els.panel.setAttribute('data-mode', mode);
    var n = visibleCols(boxOf(S.cur)).length;
    var layout = els.panel.clientWidth >= Math.max(620, n * 115) ? 'table' : 'stack';
    if (els.panel.getAttribute('data-layout') !== layout) els.panel.setAttribute('data-layout', layout);
  }
  function onKey(e) {
    if (!S.open) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!stepBack(false)) close(); return; }
    if (e.key !== 'Tab') return;
    var f = [].slice.call(els.panel.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter(function (x) { return !x.disabled && x.getClientRects().length > 0; });
    if (!f.length) { e.preventDefault(); focusPanel(); return; }
    var first = f[0], last = f[f.length - 1], a = doc.activeElement;
    if (!els.panel.contains(a)) { e.preventDefault(); first.focus(); return; }
    if (e.shiftKey && (a === first || a === els.panel)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
  }

  // ---- chrome: title, breadcrumb, tabs, search box, filters, sort select, column headers
  function sortableCols(box) { return visibleCols(box).filter(function (c) { return c.sortable; }); }
  function buildChrome() {
    var c = S.cur, box = boxOf(c), u = ui(box);
    els.title.textContent = c.title; els.count.textContent = '';
    els.search.value = c.search; els.search.placeholder = u.placeholder; els.clear.hidden = !c.search;
    els.panel.setAttribute('data-box', c.boxKey);
    // breadcrumb (only while drilled)
    if (S.stack.length) {
      var trail = S.stack.map(function (l, i) { return '<button type="button" class="v25-admin-crumb" data-crumb="' + i + '">' + esc(l.chip || l.title) + '</button>'; });
      trail.push('<span class="v25-admin-crumb" aria-current="page">' + esc(c.chip || c.title) + '</span>');
      els.crumbs.hidden = false; els.crumbs.innerHTML = trail.join(svg(ICON_CHEV, 'v25-admin-crumb-sep'));
    } else { els.crumbs.hidden = true; els.crumbs.innerHTML = ''; }
    if (c.tabs && c.tabs.length > 1) {
      els.tabs.hidden = false;
      els.tabs.innerHTML = c.tabs.map(function (k) { var b = adapter.getBox(k); return '<button type="button" role="tab" class="v25-admin-tab" data-tab="' + esc(k) + '" aria-selected="' + (k === c.boxKey ? 'true' : 'false') + '">' + esc(b ? b.label : k) + '</button>'; }).join('');
    } else { els.tabs.hidden = true; els.tabs.innerHTML = ''; }
    var eff = effFilters(c);
    var html = (u.filters || []).map(function (f) {
      var cur = eff[f.key] != null ? String(eff[f.key]) : f.options[0][0];
      return '<div class="v25-admin-field"><label class="v25-admin-field-label" for="v25-admin-f-' + f.key + '">' + esc(f.label) + '</label><select id="v25-admin-f-' + f.key + '" class="v25-admin-select" data-filter="' + f.key + '">' +
        f.options.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (cur === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></div>';
    }).join('');
    if (c.chip) html += '<button type="button" class="v25-admin-btn v25-admin-chip" data-clear-chip="1" aria-label="Remove filter: ' + esc(c.chip) + '"><span>' + esc(c.chip) + '</span>' + svg(ICON_X) + '</button>';
    els.controls.innerHTML = html;
    var sc = sortableCols(box);
    els.sort.innerHTML = sc.map(function (col) { return '<option value="' + esc(col.key) + '">' + esc(col.label) + '</option>'; }).join('');
    els.panel.style.setProperty('--v25-cols', visibleCols(box).map(function (col) { return 'minmax(0, ' + colWidth(col) + ')'; }).join(' '));
    els.thead.innerHTML = visibleCols(box).map(function (col) {
      return '<button type="button" class="v25-admin-sortbtn" data-sort="' + esc(col.key) + '" data-sortable="' + (col.sortable ? 'true' : 'false') + '"' + (col.sortable ? '' : ' tabindex="-1" aria-disabled="true"') + ' data-align="' + (col.type === 'number' ? 'right' : 'left') + '" aria-sort="none"><span>' + esc(col.label) + '</span>' + svg(ICON_SORT) + '</button>';
    }).join('');
    syncDir(); syncBack();
  }
  function syncDir() {
    var c = S.cur; els.dir.setAttribute('data-dir', c.dir);
    els.dir.setAttribute('aria-label', 'Sort direction: ' + (c.dir === 'asc' ? 'ascending' : 'descending') + '. Activate to reverse.');
    if (c.sort) els.sort.value = c.sort;
    [].forEach.call(els.thead.querySelectorAll('.v25-admin-sortbtn'), function (b) { var on = b.getAttribute('data-sort') === c.sort; b.setAttribute('aria-sort', on ? (c.dir === 'asc' ? 'ascending' : 'descending') : 'none'); });
  }
  function showList(restore) {
    S.cur.view = 'list';
    els.listview.hidden = false; els.detail.hidden = true; els.panel.setAttribute('data-view', 'list');
    els.title.textContent = S.cur.title; updateCount();
    els.scroll.scrollTop = restore ? 0 : (S.cur.scrollTop || 0);
    syncBack();
  }

  // ---- list loading
  function setState(which, info) {
    els.skel.hidden = which !== 'loading'; els.empty.hidden = which !== 'empty'; els.error.hidden = which !== 'error'; els.notice.hidden = which !== 'notice';
    if (which === 'error') els['error-text'].textContent = info || 'Something went wrong.';
    if (which === 'empty') { els['empty-title'].textContent = info.title; els['empty-text'].textContent = info.text; }
    if (which === 'notice') { els['notice-title'].textContent = info.title; els['notice-text'].textContent = info.text; els['notice-retry'].hidden = !info.retry; }
  }
  function updateCount() {
    var c = S.cur; if (!c) return; var u = ui(boxOf(c));
    if (c.total == null) { els.count.textContent = c.error || c.notice ? '' : 'Loading...'; return; }
    els.count.textContent = fmtNum(c.total) + ' ' + (c.total === 1 ? u.noun : u.nouns) + (c.search ? ' matching "' + c.search + '"' : '');
  }
  function spin(on) { var s = els.refresh.querySelector('svg'); if (s) s.classList.toggle('v25-admin-spin', on); }
  function showFailure(c, res) {
    c.error = null; c.notice = null; c.rows = []; c.total = null; els.rows.innerHTML = ''; els.pager.hidden = true; els.count.textContent = '';
    if (res.forbidden) { c.notice = 1; setState('notice', { title: 'Admin access required', text: 'This list is only available to the TallyIt admin account.', retry: false }); }
    else if (res.unavailable) { c.notice = 1; setState('notice', { title: 'Not available yet', text: 'The v25 admin SQL has not been run in Supabase yet, so this list cannot load. Run it, then check again.', retry: true }); }
    else { c.error = res.error || 'Could not load this list.'; setState('error', c.error); }
  }
  function load(o) {
    o = o || {};
    var c = S.cur, seq = ++S.seq;
    c.error = null; c.notice = null;
    if (o.first) { els.rows.innerHTML = ''; els.pager.hidden = true; c.total = null; c.rows = []; setState('loading'); updateCount(); }
    else els.rows.setAttribute('data-busy', 'true');
    spin(true);
    callList(c.boxKey, { search: c.search.trim() || undefined, sort: c.sort || undefined, dir: c.dir, limit: PAGE_SIZE, offset: c.offset, filters: effFilters(c) }).then(function (res) {
      if (seq !== S.seq || !S.open) return;
      if (!res.ok) { showFailure(c, res); return; }
      var rows = Array.isArray(res.rows) ? res.rows : [], total = res.total != null ? num(res.total) : rows.length;
      if (!rows.length && total > 0 && c.offset > 0) { c.offset = Math.max(0, (Math.ceil(total / PAGE_SIZE) - 1) * PAGE_SIZE); load({}); return; }
      c.rows = rows; c.total = total; c.hasMore = res.has_more === true || (c.offset + rows.length) < total;
      renderRows(); updateCount();
    }).then(function () { if (seq === S.seq && S.open) { els.rows.removeAttribute('data-busy'); spin(false); } });
  }
  function rowKey(c, r, i) { return !isNil(r.id) ? r.id : (r.game_key != null ? r.game_key + (r.variation_key != null ? '||' + r.variation_key : '') : r.date != null ? r.date : 'r' + i); }
  function renderRows() {
    var c = S.cur, box = boxOf(c), u = ui(box), rows = c.rows, cols = visibleCols(box), rl = roles(box);
    if (!rows.length) {
      els.rows.innerHTML = ''; els.pager.hidden = true;
      setState('empty', c.search ? { title: 'No matches', text: 'Nothing matches "' + c.search + '". Try a different search.' } : { title: 'No ' + u.nouns + ' yet', text: 'Nothing to show for this view.' });
      return;
    }
    setState('none');
    els.rows.innerHTML = rows.map(function (r, i) {
      var cells = cols.map(function (col) {
        return '<span class="v25-admin-cell" data-role="' + rl[col.key] + '" data-type="' + col.type + '"' + (col.type === 'number' ? ' data-align="right"' : '') + '><span class="v25-admin-cell-label">' + esc(col.label) + '</span><span class="v25-admin-cell-val">' + cellHTML(col, r, false) + '</span></span>';
      }).join('');
      return '<li class="v25-admin-item"><button type="button" class="v25-admin-row" data-i="' + i + '" data-id="' + esc(rowKey(c, r, i)) + '"><span class="v25-admin-row-grid">' + cells + '</span>' + svg(ICON_CHEV, 'v25-admin-row-chev') + '</button></li>';
    }).join('');
    var start = c.offset + 1, end = c.offset + rows.length;
    els.pager.hidden = false;
    els.range.textContent = fmtNum(start) + '\u2013' + fmtNum(end) + ' of ' + fmtNum(c.total);
    els.prev.disabled = c.offset <= 0; els.next.disabled = !c.hasMore;
    els.scroll.scrollTop = 0;
  }

  // ---- detail
  function primaryText(box, row) {
    var rl = roles(box), k = Object.keys(rl).filter(function (x) { return rl[x] === 'primary'; })[0];
    var col = visibleCols(box).filter(function (c) { return c.key === k; })[0];
    return col ? stripTags(cellHTML(col, row, false)) : '';
  }
  function stripTags(h) { var t = doc.createElement('div'); t.innerHTML = h; return t.textContent; }
  function secondaryHTML(box, row) {
    var rl = roles(box), k = Object.keys(rl).filter(function (x) { return rl[x] === 'secondary'; })[0];
    var col = visibleCols(box).filter(function (c) { return c.key === k; })[0];
    return col && !isNil(row[col.key]) ? cellHTML(col, row, false) : '';
  }
  function showDetailView(c) {
    var box = boxOf(c), u = ui(box);
    els.listview.hidden = true; els.detail.hidden = false; els.panel.setAttribute('data-view', 'detail');
    els.title.textContent = primaryText(box, c.detailRow) || c.title;
    els.count.textContent = u.noun.charAt(0).toUpperCase() + u.noun.slice(1) + ' details';
    syncBack();
  }
  function openDetail(i) {
    var c = S.cur, box = boxOf(c), row = c.rows[i]; if (!row) return;
    c.scrollTop = els.scroll.scrollTop; c.view = 'detail'; c.detailRow = row; c.detailId = rowKey(c, row, i); c.detailMerged = null;
    c.detailTarget = safe(function () { return adapter.detailFor(c.boxKey, row); }, null);
    showDetailView(c); els['detail-scroll'].scrollTop = 0; els.back.focus({ preventScroll: true });
    var t = c.detailTarget, seq = ++S.dseq;
    if (t && t.method === 'getSharedGame' && t.id) {
      renderDetail(c, row, 'loading');
      var p; try { p = Promise.resolve(adapter.getSharedGame(t.id)); } catch (e) { p = Promise.reject(e); }
      p.then(function (res) {
        if (seq !== S.dseq || !S.open) return;
        if (res && res.ok) renderDetail(c, Object.assign({}, row, res.game || {}, { participants: res.participants || [] }), 'none');
        else renderDetail(c, row, 'note', res && res.forbidden ? 'Admin access required for the full record.' : res && res.unavailable ? 'Full record is not available yet (v25 SQL pending).' : (res && res.error) || 'Could not load the full record.');
      }, function (e) { if (seq === S.dseq && S.open) renderDetail(c, row, 'note', (e && e.message) || 'Could not load the full record.'); });
    } else renderDetail(c, row, 'none');
  }
  function dlRow(label, valueHtml) { return '<div class="v25-admin-dl-row"><dt class="v25-admin-dt">' + esc(label) + '</dt><dd class="v25-admin-dd">' + valueHtml + '</dd></div>'; }
  function renderDetail(c, row, state, msg) {
    var box = boxOf(c), st = els['detail-state'];
    st.hidden = state === 'none';
    if (state === 'loading') { st.setAttribute('data-kind', 'loading'); st.innerHTML = svg(ICON_SPIN, 'v25-admin-spin') + '<p>Loading full record...</p>'; }
    else if (state === 'note') { st.setAttribute('data-kind', 'info'); st.innerHTML = svg(ICON_WARN) + '<p>' + esc(msg) + '</p>'; }
    var sec = secondaryHTML(box, row);
    var html = '<div class="v25-admin-detail-hero"><h3 class="v25-admin-detail-name">' + esc(primaryText(box, row) || box.label) + '</h3>' + (sec ? '<p class="v25-admin-detail-sub">' + sec + '</p>' : '') + '</div>';
    var cols = (box.columns || []), shown = {}, rowsHtml = '';
    cols.filter(function (x) { return !x.hidden; }).concat(cols.filter(function (x) { return x.hidden; })).forEach(function (col) {
      shown[col.key] = 1; if (row[col.key] === undefined) return;
      if (col.type === 'json' && col.key !== 'guest_names') return;
      rowsHtml += dlRow(col.label, cellHTML(col, row, true));
    });
    var extras = Object.keys(row).filter(function (k) { return !shown[k] && k.charAt(0) !== '_'; });
    extras.filter(function (k) { return row[k] === null || typeof row[k] !== 'object'; }).forEach(function (k) { rowsHtml += dlRow(humanize(k), generic(row[k])); });
    html += '<dl class="v25-admin-dl">' + rowsHtml + '</dl>';
    cols.filter(function (x) { return x.type === 'json' && x.key !== 'guest_names' && row[x.key] !== undefined; }).forEach(function (x) { html += '<h4 class="v25-admin-section-label">' + esc(x.label) + '</h4>' + generic(row[x.key]); });
    extras.filter(function (k) { return row[k] !== null && typeof row[k] === 'object'; }).forEach(function (k) { html += '<h4 class="v25-admin-section-label">' + esc(humanize(k)) + '</h4>' + generic(row[k]); });
    var t = c.detailTarget;
    if (t && t.method === 'drilldown' && t.box && adapter.getBox(t.box)) {
      var tb = adapter.getBox(t.box), rel = ui(tb).rel || ui(tb).nouns;
      html += '<h4 class="v25-admin-section-label">Next level</h4><div class="v25-admin-actions"><button type="button" class="v25-admin-btn" data-related="1">View ' + esc(rel) + svg(ICON_CHEV) + '</button></div>';
    }
    els['detail-body'].innerHTML = html;
    c.detailMerged = row;
  }
  function openRelated() {
    var c = S.cur, t = c.detailTarget; if (!t || t.method !== 'drilldown') return;
    var filters = (t.opts && t.opts.filters) || {};
    var next = newLevel(t.box, { filters: filters, chip: chipFor(filters), drill: true, tabs: null }); if (!next) return;
    S.stack.push(c); S.cur = next; startLevel(); focusPanel();
  }

  // ---- sheet wiring (bound once per DOM node)
  function isTextCol(key) { var col = visibleCols(boxOf(S.cur)).filter(function (x) { return x.key === key; })[0]; return !col || col.type === 'text'; }
  function applySearch() { if (!S.open || !S.cur) return; var v = els.search.value.trim(); if (v === S.cur.search) return; S.cur.search = v; S.cur.offset = 0; load({ first: true }); }
  function switchTab(k) {
    if (!S.cur || k === S.cur.boxKey) return;
    var next = newLevel(k, { tabs: S.cur.tabs, title: S.cur.title }); if (!next) return;
    S.cur = next; startLevel();
    var b = els.tabs.querySelector('[data-tab="' + cssEsc(k) + '"]'); if (b) b.focus({ preventScroll: true });
  }
  function setSort(key) {
    var c = S.cur; if (c.sort === key) c.dir = c.dir === 'asc' ? 'desc' : 'asc'; else { c.sort = key; c.dir = isTextCol(key) ? 'asc' : 'desc'; }
    c.offset = 0; syncDir(); load({});
  }
  function bindSheet() {
    if (bound) return; bound = true;
    els.root.addEventListener('click', function (e) {
      var t = e.target;
      if (t.closest('[data-v25-close]') || t.closest('#v25-admin-close')) { close(); return; }
      if (t.closest('#v25-admin-back')) { if (!stepBack(false)) close(); return; }
      var cr = t.closest('[data-crumb]'); if (cr) { popTo(Number(cr.getAttribute('data-crumb'))); return; }
      var row = t.closest('.v25-admin-row'); if (row) { openDetail(Number(row.getAttribute('data-i'))); return; }
      var tab = t.closest('[data-tab]'); if (tab) { switchTab(tab.getAttribute('data-tab')); return; }
      var sb = t.closest('.v25-admin-sortbtn'); if (sb) { if (sb.getAttribute('data-sortable') === 'true') setSort(sb.getAttribute('data-sort')); return; }
      if (t.closest('#v25-admin-dir')) { S.cur.dir = S.cur.dir === 'asc' ? 'desc' : 'asc'; S.cur.offset = 0; syncDir(); load({}); return; }
      if (t.closest('#v25-admin-clear')) { els.search.value = ''; S.cur.search = ''; els.clear.hidden = true; S.cur.offset = 0; clearTimeout(S.timer); load({ first: true }); els.search.focus(); return; }
      if (t.closest('#v25-admin-prev')) { if (S.cur.offset > 0) { S.cur.offset = Math.max(0, S.cur.offset - PAGE_SIZE); load({}); } return; }
      if (t.closest('#v25-admin-next')) { if (S.cur.hasMore) { S.cur.offset += PAGE_SIZE; load({}); } return; }
      if (t.closest('#v25-admin-retry') || t.closest('#v25-admin-notice-retry') || t.closest('#v25-admin-refresh')) { load({ first: S.cur.rows.length === 0 }); return; }
      if (t.closest('[data-clear-chip]')) { var u = ui(boxOf(S.cur)), keep = {}; (u.filters || []).forEach(function (f) { if (S.cur.filters[f.key] != null) keep[f.key] = S.cur.filters[f.key]; }); S.cur.filters = keep; S.cur.chip = ''; S.cur.offset = 0; buildChrome(); load({ first: true }); return; }
      if (t.closest('[data-related]')) openRelated();
    });
    els.root.addEventListener('change', function (e) {
      var t = e.target;
      if (t.id === 'v25-admin-sort') { if (t.value !== S.cur.sort) setSort(t.value); return; }
      if (t.getAttribute('data-filter')) { S.cur.filters[t.getAttribute('data-filter')] = t.value; S.cur.offset = 0; load({ first: true }); }
    });
    els.search.addEventListener('input', function () { els.clear.hidden = !els.search.value; clearTimeout(S.timer); S.timer = setTimeout(applySearch, DEBOUNCE_MS); });
    els.search.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(S.timer); applySearch(); els.search.blur(); } });
  }

  // ------------------------------------------------------------------ admin page: boxes -> buttons (mapping from boxForKpi / registry kpiId)
  var CHEV = svg(ICON_CHEV, 'v25-admin-box-chev');
  var INTERACTIVE_SEL = '.v20-req-filters, .v20-inbox-list, .v22-mod-list, button, a, select, input';
  function addViewAll(card, boxKey, label) {
    var head = card.querySelector('[class$="-card-head"]'); if (!head) return;
    var meta = head.querySelector('[class$="-card-meta"]');
    var tools = doc.createElement('span'); tools.className = 'v25-admin-card-tools';
    if (meta) { head.replaceChild(tools, meta); tools.appendChild(meta); } else head.appendChild(tools);
    var btn = doc.createElement('button'); btn.type = 'button'; btn.className = 'v25-admin-viewall'; btn.setAttribute('data-v25-box', boxKey); btn.setAttribute('aria-haspopup', 'dialog');
    btn.setAttribute('aria-label', 'View all: ' + label); btn.innerHTML = 'View all' + svg(ICON_CHEV);
    tools.appendChild(btn);
  }
  function decorate() {
    var list = safe(function () { return adapter.listBoxes(); }, []);
    list.forEach(function (b) {
      if (!b || !b.kpiId) return;
      var el = $(b.kpiId); if (!el) return;
      var card = el.closest('.v20-kpi-card, .v20-admin-card, .v22-admin-card') || el;
      if (card.getAttribute('data-v25-done') === '1') {
        if (card.getAttribute('data-v25-anchor') !== b.kpiId && !el.hasAttribute('data-v25-sub')) { el.setAttribute('data-v25-sub', b.key); el.classList.add('v25-admin-sub'); }
        return;
      }
      card.setAttribute('data-v25-done', '1'); card.setAttribute('data-v25-anchor', b.kpiId);
      if (card.querySelector(INTERACTIVE_SEL)) addViewAll(card, b.key, b.label);
      else {
        card.setAttribute('data-v25-box', b.key); card.classList.add('v25-admin-box');
        card.setAttribute('role', 'button'); card.setAttribute('tabindex', '0'); card.setAttribute('aria-haspopup', 'dialog');
        card.insertAdjacentHTML('beforeend', CHEV);
      }
    });
    // the Game Requests Inbox has no KPI id of its own: give it a "View all" for the full requests list
    var inbox = $('admin-requests-list'), rb = adapter.getBox('requests_total');
    var icard = inbox && inbox.closest('.v20-admin-card');
    if (icard && rb && icard.getAttribute('data-v25-done') !== '1') { icard.setAttribute('data-v25-done', '1'); addViewAll(icard, rb.key, rb.label); }
  }
  function openBox(key, opener) {
    var b = adapter.getBox(key); if (!b) return;
    if (b.tabs && b.tabs.length > 1) open(b.tabs[0], { title: b.label, tabs: b.tabs });
    else open(key, { title: titleFor(b, false) });
    if (opener) S.opener = opener;
  }
  doc.addEventListener('click', function (e) {
    if (S.open || !e.target.closest) return;
    var vb = e.target.closest('.v25-admin-viewall');
    if (vb) { openBox(vb.getAttribute('data-v25-box'), vb); return; }
    var box = e.target.closest('.v25-admin-box[data-v25-box]'); if (!box) return;
    var inner = e.target.closest('a, button, select, input, textarea');
    if (inner && inner !== box && box.contains(inner)) return;
    var sub = e.target.closest('[data-v25-sub]');
    openBox(sub && box.contains(sub) ? sub.getAttribute('data-v25-sub') : box.getAttribute('data-v25-box'), box);
  });
  doc.addEventListener('keydown', function (e) {
    if (S.open) return;
    var box = e.target && e.target.classList && e.target.classList.contains('v25-admin-box') ? e.target : null;
    if (!box || box.getAttribute('role') !== 'button') return;
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); openBox(box.getAttribute('data-v25-box'), box); }
  });

  global.TallyItV25AdminDrilldown = {
    version: 'v25.1', setAdapter: setAdapter, getAdapter: getAdapter,
    open: function (key, o) { return open(key, o); }, close: function () { close(); }, isOpen: function () { return S.open; }, decorate: decorate, _state: function () { return S; }
  };

  function init() {
    decorate();
    var scr = $('admin-screen');
    if (scr && global.MutationObserver) { var raf = 0; new global.MutationObserver(function () { if (raf) return; raf = global.requestAnimationFrame(function () { raf = 0; decorate(); }); }).observe(scr, { childList: true, subtree: true }); }
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init); else init();
})(window);
