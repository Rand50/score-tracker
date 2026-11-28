/* ==========================================================================
   TallyIt v26 - History past-game detail + owner edit (window.TallyItV26History)

   Tap any saved game in History -> read-only scorecard (players, final scores,
   winner, placements, round-by-round, variation, date, Edited marker).
   The creator gets Edit: a per-mode editor (rounds table / category grid /
   elimination order / final scores), a review step with the change summary,
   then save (cloud: TallyItV26Backend.updateGame, local: engine write-back).

   Data layer (Score Tracker Scoring): window.TallyItRecordTools
     describeRecord / recomputeRecord / canEditRecord / buildSharedEdit
   Backend (Score Tracker Auth): window.TallyItV26Backend
     getGameDetail(id) / updateGame(id, payload, {expectedEditedAt}) / canEditGame
   Engine seam (v26 hunk in engine.js): window.TallyItV26HistoryEngine
     entries() / local(id) / user() / games() / applyLocalEdit(id, rec) / refresh() / refreshSocial()

   Every external name goes through ADAPTER / TOOLS below, so a renamed API is
   a one-line swap: TallyItV26History.setAdapter({...}) / setTools({...}).
   No emojis; SVG icons use a 1.75px stroke; selectors are .v26-hist-*.
   ========================================================================== */
(function (global) {
  'use strict';
  const doc = global.document;
  if (!doc) return;
  const ENG = () => global.TallyItV26HistoryEngine || null;
  const BE = () => global.TallyItV26Backend || null;
  const THEMES = { flip7: 'theme-flip7', '7wonders': 'theme-seven-wonders', carcassonne: 'theme-carcassonne', catan: 'theme-catan',
    ohhell: 'theme-ohhell', hearts: 'theme-hearts', nertz: 'theme-nertz', rummikub: 'theme-rummikub', qwirkle: 'theme-qwirkle', spoons: 'theme-spoons', other: null };

  // ---------------- small utils ----------------
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
  // UI-only keys fromDetail() adds; never sent back to the server
  const UI_KEYS = ['_v26links', 'createdByName', 'edited_by_name', 'source', 'isShared', 'roundsCount', 'myScore', 'didIWin', 'playedAt', 'sharedByName'];
  const stripUi = (rec) => { const o = clone(rec) || {}; UI_KEYS.forEach((k) => delete o[k]); return o; };
  // Marks a local History copy as edited so the old share path (saveSharedGame) never re-uploads it over the edit
  const markEdited = (rec, at, byName) => { rec.edited = true; rec.edited_at = at || rec.edited_at || new Date().toISOString(); if (byName) rec.edited_by_name = byName; rec.meta = { ...(rec.meta || {}), edited_at: rec.edited_at }; return rec; };
  const isPlainStandard = (v) => /^\s*standard\s*$/i.test(String(v || ''));
  const fmtDate = (d) => { const t = Date.parse(d || ''); if (!t) return ''; try { return new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); } catch (_) { return new Date(t).toDateString(); } };
  const ordinal = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
  const svg = (inner, cls) => `<svg class="v26-hist-ic${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${inner}</svg>`;
  const IC = {
    back: svg('<path d="M15 18l-6-6 6-6"/>'),
    close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
    edit: svg('<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>'),
    crown: svg('<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5L3 8z"/>'),
    lock: svg('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
    up: svg('<path d="M12 19V5M6 11l6-6 6 6"/>'),
    down: svg('<path d="M12 5v14M6 13l6 6 6-6"/>'),
    trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    check: svg('<path d="M5 12.5l4.5 4.5L19 7"/>'),
    refresh: svg('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>'),
    pencilSm: svg('<path d="M4 20h4L19 9l-4-4L4 16v4z"/>', 'v26-hist-ic-sm'),
    chev: svg('<path d="M9 6l6 6-6 6"/>', 'v26-hist-ic-sm'),
    info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>', 'v26-hist-ic-sm'),
    link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>', 'v26-hist-ic-xs')
  };

  // ---------------- swappable tools (Score Tracker Scoring) ----------------
  const TOOLS = {
    describe: (rec) => global.TallyItRecordTools.describeRecord(rec),
    recompute: (rec, edits, opts) => global.TallyItRecordTools.recomputeRecord(rec, edits, opts),
    canEdit: (rec, user) => global.TallyItRecordTools.canEditRecord(rec, user),
    // Auth's update_game_record takes buildSharedEdit() output (or a bare payload, back-compat)
    sharedEdit: (before, after) => { const b = stripUi(before), a = stripUi(after); delete b.sharedGameId; delete a.sharedGameId; const RT = global.TallyItRecordTools; return RT && RT.buildSharedEdit ? RT.buildSharedEdit(b, a) : a; },
    ready: () => !!(global.TallyItRecordTools && global.TallyItRecordTools.describeRecord)
  };

  // ---------------- backend adapter (Score Tracker Auth) ----------------
  // All calls resolve; never throw. Shapes: {ok:true,...} | {ok:false, error, unavailable?, forbidden?, conflict?}
  const norm = (r) => {
    if (!r || typeof r !== 'object') return { ok: false, error: 'error' };
    if (r.ok) return r;
    const e = String(r.error || (r.unavailable ? 'unavailable' : 'error'));
    return { ...r, ok: false, error: e, unavailable: !!r.unavailable || e === 'unavailable', forbidden: e === 'forbidden', conflict: e === 'conflict', tooMany: e === 'too_many' };
  };
  const ADAPTER = {
    async getDetail(sharedId) {
      const b = BE(); if (!b || typeof b.getGameDetail !== 'function') return { ok: false, error: 'unavailable', unavailable: true };
      try { return norm(await b.getGameDetail(sharedId)); } catch (e) { return { ok: false, error: 'error', message: String(e && e.message || e) }; }
    },
    async update(sharedId, edit, opts) {
      const b = BE(); if (!b || typeof b.updateGame !== 'function') return { ok: false, error: 'unavailable', unavailable: true };
      try { return norm(await b.updateGame(sharedId, edit, opts || {})); } catch (e) { return { ok: false, error: 'error', message: String(e && e.message || e) }; }
    },
    user: () => { const E = ENG(); return E && E.user ? E.user() : null; },
    entries: () => { const E = ENG(); try { return E ? E.entries() : []; } catch (_) { return []; } },
    local: (id) => { const E = ENG(); return E && E.local ? E.local(id) : null; },
    saveLocal: (id, rec) => { const E = ENG(); return !!(E && E.applyLocalEdit && E.applyLocalEdit(id, rec)); },
    refresh: () => { const E = ENG(); if (E && E.refresh) E.refresh(); },
    refreshSocial: () => { const E = ENG(); if (E && E.refreshSocial) { try { E.refreshSocial(); } catch (_) {} } },
    games: () => { const E = ENG(); return (E && E.games && E.games()) || (global.ScoreTracker && global.ScoreTracker.GAMES) || []; },
    // v27: owner-only Delete + Link players moved here from the History rows (engine's existing deleteHistoryEntry + confirm)
    canDelete: (e) => { const E = ENG(); try { return !!(E && E.canDelete && e && E.canDelete(e)); } catch (_) { return false; } },
    remove: async (gid, sid) => { const E = ENG(); if (!E || !E.deleteEntry) return false; try { return !!(await E.deleteEntry(gid, sid)); } catch (_) { return false; } },
    linkButton: (e) => { const E = ENG(); try { return (E && E.linkButton && e && E.linkButton(e)) || ''; } catch (_) { return ''; } }
  };

  // Build one record from Auth's detail row (+ the local copy for anything the payload lacks).
  function fromDetail(game, base) {
    const payload = (game && game.payload && typeof game.payload === 'object') ? game.payload : {};
    const rec = { ...(base || {}), ...clone(payload) };
    const gk = game.game_key || game.game_type || payload.type || (base && base.type) || 'other';
    rec.type = gk; rec.game_key = gk;
    rec.id = (base && base.id) || payload.id || game.id;
    rec.sharedGameId = String(game.id || (base && base.sharedGameId) || '');
    rec.version = payload.version || game.variation_name || (base && base.version) || null;
    if (game.variation_name && !rec.v22VariationName && game.variation_key && /^house|custom/i.test(String(game.variation_key))) rec.v22VariationName = game.variation_name;
    rec.endTime = payload.endTime || game.played_at || (base && base.endTime) || game.created_at || null;
    if (!Array.isArray(rec.rounds) || !rec.rounds.length) rec.rounds = Array.isArray(game.rounds) ? game.rounds : (rec.rounds || []);
    if (!Array.isArray(rec.players) || !rec.players.length) {
      rec.players = (game.players || []).map((p) => ({ name: p.name || p.display_name, score: num(p.score), userId: p.user_id || null, isWinner: !!p.is_winner }));
    }
    if (game.winner != null) rec.winner = game.winner;
    rec.created_by = game.created_by || rec.created_by || rec.createdBy || null;
    rec.createdBy = rec.created_by;
    rec.createdByName = game.created_by_name || null;
    rec.edited_at = game.edited_at || null;
    rec.edited_by_name = game.edited_by_name || null;
    if (rec.target == null && game.target != null) rec.target = game.target;
    if (!rec.client_game_id && game.client_game_id) rec.client_game_id = game.client_game_id;
    // linked-account badges: per-member participants (teams) + top-level player rows
    const links = {};
    const addLink = (p) => { if (!p) return; const label = p.account_name || (p.linked_via ? 'Linked' : '') || (p.user_id ? 'Linked' : ''); if (!label) return;
      [p.display_name, p.name, p.name_key].forEach((n) => { if (n) links[String(n).trim().toLowerCase()] = label; }); };
    (game.participants || []).forEach(addLink);
    (game.players || []).forEach((p) => { addLink(p); (p.members || []).forEach(addLink); });
    rec._v26links = links;
    return rec;
  }

  // ---------------- public seam: getGame / isOwner / updateGame ----------------
  async function getGame(id) {
    const sid = String(id || '');
    const entry = ADAPTER.entries().find((g) => g && (String(g.id || '') === sid || String(g.sharedGameId || '') === sid)) || null;
    const local = ADAPTER.local(entry ? entry.id : sid);
    const user = ADAPTER.user();
    const sharedId = entry && entry.sharedGameId ? String(entry.sharedGameId) : (!entry && !local ? sid : '');
    const fallback = local || entry;
    if (sharedId && user) {
      const r = await ADAPTER.getDetail(sharedId);
      if (r.ok && r.game) {
        const rec = fromDetail(r.game, fallback);
        const be = !!(r.game.can_edit || r.game.is_owner);
        let rt = true; try { rt = TOOLS.ready() ? !!TOOLS.canEdit(rec, user).canEdit : be; } catch (_) { rt = be; }
        return { ok: true, record: rec, original: clone(rec), game: r.game, source: 'cloud', sharedId, localId: local ? local.id : null, canEdit: be && rt, notice: '' };
      }
      if (!fallback) return { ok: false, forbidden: !!r.forbidden, error: r.error || 'error' };
      const notice = r.forbidden ? 'You can view this game but only its creator can change it.'
        : r.unavailable ? '' : 'Showing the copy saved on this device.';
      return { ok: true, record: clone(fallback), original: clone(fallback), game: null, source: 'local', sharedId, localId: local ? local.id : null, canEdit: false, notice };
    }
    if (!fallback) return { ok: false, error: 'not_found' };
    // local-only game (never synced): the creator is this device
    let can = false; try { can = !!(local && TOOLS.ready() && TOOLS.canEdit(local, user).canEdit); } catch (_) { can = false; }
    if (sharedId) can = false; // a cloud game with no signed-in user stays read-only
    return { ok: true, record: clone(fallback), original: clone(fallback), game: null, source: 'local', sharedId: '', localId: local ? local.id : null, canEdit: can, notice: '' };
  }
  function isOwner(record, game) {
    const user = ADAPTER.user();
    let rt = false; try { rt = !!(TOOLS.ready() && TOOLS.canEdit(record, user).canEdit); } catch (_) { rt = false; }
    if (game) return rt && !!(game.can_edit || game.is_owner);
    const b = BE(); if (b && typeof b.canEditGame === 'function' && record && (record.sharedGameId || record.created_by)) { try { return rt && !!b.canEditGame(record); } catch (_) { return false; } }
    return rt;
  }
  async function updateGame(id, payload, opts) { return ADAPTER.update(id, payload, opts); }

  // ---------------- view state ----------------
  let S = null; // { id, data, mode:'view'|'edit'|'review', draft, result, msg, busy, theme, prevFocus }
  let root = null;

  function ensureRoot() {
    if (root && doc.body.contains(root)) return root;
    root = doc.createElement('div');
    root.id = 'v26-hist-sheet';
    root.className = 'v26-hist-sheet';
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'v26-hist-title');
    doc.body.appendChild(root);
    root.addEventListener('click', onSheetClick);
    root.addEventListener('input', onSheetInput);
    root.addEventListener('change', onSheetInput);
    root.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); if (S && S.mode !== 'view') { S.mode = 'view'; S.result = null; render(); } else close(); } });
    return root;
  }
  function setTheme(gk) {
    const cls = THEMES[gk] || null;
    if (S && S.theme && S.theme !== cls && S.themeAdded) doc.body.classList.remove(S.theme);
    if (cls && !doc.body.classList.contains(cls)) { doc.body.classList.add(cls); S.themeAdded = true; } else if (cls) S.themeAdded = false;
    S.theme = cls;
  }
  function clearTheme() { if (S && S.theme && S.themeAdded) doc.body.classList.remove(S.theme); }

  async function open(id, opts) {
    if (!id) return false;
    ensureRoot();
    const prevFocus = (opts && opts.returnFocus) || doc.activeElement;
    if (S) clearTheme();
    S = { id: String(id), data: null, mode: 'view', draft: null, result: null, msg: '', busy: true, theme: null, themeAdded: false, prevFocus };
    root.hidden = false;
    root.classList.toggle('v26-hist-reduced', !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches));
    root.classList.remove('v26-hist-enter'); void root.offsetWidth; root.classList.add('v26-hist-enter');
    clearTimeout(root._v26EnterTimer);
    root._v26EnterTimer = setTimeout(function () { root.classList.remove('v26-hist-enter'); }, 320);
    doc.documentElement.style.setProperty('overflow', 'hidden');
    render();
    const data = await getGame(id);
    if (!S || S.id !== String(id)) return false;
    S.data = data; S.busy = false;
    if (data.ok) setTheme(gameKey(data.record));
    render();
    const t = root.querySelector('#v26-hist-title'); if (t) { try { t.focus({ preventScroll: true }); } catch (_) { t.focus(); } }
    return true;
  }
  function close() {
    if (!root) return;
    clearTheme();
    const pf = S && S.prevFocus;
    S = null; root.hidden = true; root.innerHTML = '';
    doc.documentElement.style.removeProperty('overflow');
    if (pf && pf.focus && doc.body.contains(pf)) { try { pf.focus({ preventScroll: true }); } catch (_) {} }
  }
  async function reload() { if (!S) return; const id = S.id, pf = S.prevFocus; await open(id, { returnFocus: pf }); }

  function gameKey(rec) { try { return global.TallyItRecordTools ? global.TallyItRecordTools.gameKeyOf(rec) : String(rec.type || 'other'); } catch (_) { return 'other'; } }
  function gameMeta(gk) { return (ADAPTER.games() || []).find((g) => g.id === gk) || null; }

  // ---------------- rendering ----------------
  function render() {
    if (!root || !S) return;
    if (S.busy) { root.innerHTML = frame('Game details', '', `<div class="v26-hist-quiet" role="status">Loading game...</div>`); return; }
    const d = S.data;
    if (!d || !d.ok) {
      const msg = d && d.forbidden ? 'This game is private to its players.' : 'This game could not be found.';
      root.innerHTML = frame('Game details', '', `<div class="v26-hist-quiet" role="status">${esc(msg)}</div>`); return;
    }
    if (!TOOLS.ready()) { root.innerHTML = frame('Game details', '', `<div class="v26-hist-quiet" role="status">Game details are not available yet.</div>`); return; }
    let model;
    try { model = TOOLS.describe(d.record); } catch (e) { root.innerHTML = frame('Game details', '', `<div class="v26-hist-quiet" role="status">This game could not be displayed.</div>`); return; }
    LINKS = (d.record && d.record._v26links) || {};
    root.setAttribute('data-game', model.gameKey);
    root.setAttribute('data-mode', S.mode);
    if (S.mode === 'view') root.innerHTML = frame(model.gameName, d.canEdit ? `<button type="button" class="v26-hist-btn v26-hist-btn-edit" data-act="edit">${IC.edit}<span>Edit</span></button>` : '', viewBody(model, d));
    else if (S.mode === 'edit') root.innerHTML = frame('Edit ' + model.gameName, '', editBody(model, d), editFoot());
    else root.innerHTML = frame('Review changes', '', reviewBody(model, d), reviewFoot());
  }
  function frame(title, right, body, foot) {
    return `<div class="v26-hist-panel">
      <div class="v26-hist-bar">
        <button type="button" class="v26-hist-iconbtn" data-act="${S && S.mode !== 'view' ? 'cancel' : 'close'}" aria-label="${S && S.mode !== 'view' ? 'Back to scorecard' : 'Back to History'}">${IC.back}</button>
        <h2 id="v26-hist-title" class="v26-hist-title" tabindex="-1">${esc(title)}</h2>
        <div class="v26-hist-bar-right">${right || ''}</div>
      </div>
      <div class="v26-hist-body"><div class="v26-hist-col">${body}</div></div>
      ${foot ? `<div class="v26-hist-foot"><div class="v26-hist-col v26-hist-foot-row">${foot}</div></div>` : ''}
    </div>`;
  }
  function variationOf(rec, model) { const v = rec.v22VariationName || model.version || rec.version || ''; return isPlainStandard(v) ? '' : v; }
  function editedInfo(rec, model) {
    const at = rec.edited_at || (model.edited && model.edited.at) || rec.editedAt || null;
    if (!at) return null;
    return { at, by: rec.edited_by_name || rec.editedByName || null };
  }
  function headerCard(model, d) {
    const rec = d.record, meta = gameMeta(model.gameKey);
    const img = meta && (meta.art || meta.img);
    const ed = editedInfo(rec, model);
    const bits = [variationOf(rec, model), fmtDate(model.date || rec.endTime || rec.startTime)].filter(Boolean);
    return `<div class="v26-hist-head">
      ${img ? `<img class="v26-hist-art" src="${esc(img)}" alt="" width="56" height="56" decoding="async">` : `<span class="v26-hist-art v26-hist-art-ph" aria-hidden="true">${esc((model.gameName || '?').slice(0, 1))}</span>`}
      <div class="v26-hist-head-txt">
        <div class="v26-hist-game">${esc(model.gameName)}</div>
        <div class="v26-hist-sub">${bits.map(esc).join(' <span aria-hidden="true">&middot;</span> ')}</div>
        ${rec.createdByName ? `<div class="v26-hist-sub">Recorded by ${esc(rec.createdByName)}</div>` : ''}
        ${ed ? `<div class="v26-hist-edited" data-edited-at="${esc(ed.at)}">${IC.pencilSm}<span>Edited ${esc(fmtDate(ed.at))}${ed.by ? ' by ' + esc(ed.by) : ''}</span></div>` : ''}
      </div>
    </div>`;
  }
  function winnerBanner(model) {
    if (!model.winnerNames || !model.winnerNames.length) return `<div class="v26-hist-winner v26-hist-winner-none">No winner recorded</div>`;
    const label = model.gameKey === 'spoons' ? 'Last one standing' : model.winnerNames.length > 1 ? 'Winners (tied)' : 'Winner';
    return `<div class="v26-hist-winner" data-winner="${esc(model.winner)}">${IC.crown}<div><div class="v26-hist-winner-k">${label}</div><div class="v26-hist-winner-v">${esc(model.winner)}</div></div></div>`;
  }
  let LINKS = {};
  const linkBadge = (name, userId) => { const l = LINKS[String(name || '').trim().toLowerCase()] || (userId ? 'Linked' : ''); return l ? `<span class="v26-hist-link" title="Linked account">${IC.link}<span>${esc(l)}</span></span>` : ''; };
  function playerLabel(p) {
    const team = p.members && p.members.length;
    return `<span class="v26-hist-pname">${esc(p.name)}${team ? '' : linkBadge(p.name, p.userId)}</span>${team ? `<span class="v26-hist-members">${p.members.map((m) => `<span class="v26-hist-member">${esc(m.name)}${linkBadge(m.name, m.userId)}</span>`).join('')}</span>` : ''}`;
  }
  function standings(model) {
    const rows = model.players.slice().sort((a, b) => a.place - b.place || a.index - b.index);
    const tied = {}; rows.forEach((r) => { tied[r.place] = (tied[r.place] || 0) + 1; });
    const unit = model.gameKey === 'spoons' ? '' : (model.lowWins ? 'Lowest score wins' : '');
    return `<section class="v26-hist-sec" aria-label="Final standings">
      <div class="v26-hist-sec-h"><h3>Final standings</h3>${unit ? `<span class="v26-hist-hint">${unit}</span>` : ''}</div>
      <ol class="v26-hist-standings">${rows.map((p) => {
        const right = model.gameKey === 'spoons'
          ? (p.eliminatedRound != null ? `<span class="v26-hist-out">Out in round ${p.eliminatedRound}</span>` : `<span class="v26-hist-alive">${p.isWinner ? 'Winner' : 'Still in'}</span>`)
          : `<span class="v26-hist-score">${esc(p.score)}</span>`;
        return `<li class="v26-hist-st${p.isWinner ? ' is-winner' : ''}" data-player="${p.index}" data-place="${p.place}">
          <span class="v26-hist-place" aria-label="${ordinal(p.place)} place${tied[p.place] > 1 ? ', tied' : ''}">${p.isWinner ? IC.crown : esc(p.place)}</span>
          <span class="v26-hist-st-name">${playerLabel(p)}${model.gameKey === '7wonders' && p.wonder ? `<span class="v26-hist-members">${esc(p.wonder)}</span>` : ''}</span>
          <span class="v26-hist-st-right">${right}<span class="v26-hist-ord">${ordinal(p.place)}${tied[p.place] > 1 ? ' (tie)' : ''}</span></span>
        </li>`;
      }).join('')}</ol>
    </section>`;
  }
  function shortLabel(r) {
    const L = String(r.label || '');
    if (r.mode === 'reset' || /^Scores reset/i.test(L)) return { top: 'Reset', sub: '' };
    if (r.mode === 'edit_adjustment' || /correction/i.test(L)) return { top: 'Adj.', sub: '' };
    const m = /^(\S+)\s+(\d+)\s*(?:\((.*)\))?/.exec(L);
    if (!m) return { top: L || 'R' + r.number, sub: '' };
    return { top: m[1].charAt(0).toUpperCase() + m[2], sub: m[3] || '' };
  }
  function cellView(model, r, i) {
    const d = r.deltas ? r.deltas[i] : 0;
    const det = r.detail || {};
    if (model.gameKey === 'ohhell' && det.entries && det.entries[i]) {
      const e = det.entries[i];
      return `<span class="v26-hist-pts${e.exact ? ' is-hit' : ''}">${esc(d)}</span><span class="v26-hist-cellsub">${esc(e.bid)}/${esc(e.tricksWon)}</span>`;
    }
    if (model.gameKey === 'hearts' && det.entries && det.entries[i]) {
      const e = det.entries[i], moon = det.shooterIdx === i;
      return `<span class="v26-hist-pts">${esc(d)}</span><span class="v26-hist-cellsub">${moon ? 'Moon' : (num(e.hearts) + 'h' + (e.queenOfSpades ? ' Q' : ''))}</span>`;
    }
    if (r.by != null && r.by !== i && !d) return '<span class="v26-hist-nil" aria-label="no score">&middot;</span>';
    return `<span class="v26-hist-pts${d < 0 ? ' is-neg' : ''}">${esc(d > 0 && r.mode !== 'reset' ? d : d)}</span>`;
  }
  function roundsTable(model) {
    const rounds = model.rounds || [];
    const head = rounds.map((r) => { const s = shortLabel(r); return `<th scope="col" title="${esc(r.label)}"><span class="v26-hist-th">${esc(s.top)}</span>${s.sub ? `<span class="v26-hist-thsub">${esc(s.sub)}</span>` : ''}</th>`; }).join('');
    const body = model.players.map((p) => `<tr class="${p.isWinner ? 'is-winner' : ''}"><th scope="row" class="v26-hist-sticky">${playerLabel(p)}</th>${rounds.map((r) => `<td>${cellView(model, r, p.index)}</td>`).join('')}<td class="v26-hist-total">${esc(p.score)}</td></tr>`).join('');
    const legend = model.gameKey === 'ohhell' ? '<p class="v26-hist-legend">Points, then bid/tricks taken.</p>' : model.gameKey === 'hearts' ? '<p class="v26-hist-legend">Points, then hearts taken (Q = queen of spades).</p>' : '';
    return `<section class="v26-hist-sec" aria-label="Round by round">
      <div class="v26-hist-sec-h"><h3>Round by round</h3><span class="v26-hist-hint">${rounds.length} ${rounds.length === 1 ? 'entry' : 'entries'}</span></div>
      <div class="v26-hist-scroll" tabindex="0" role="region" aria-label="Round by round table, scrolls sideways">
        <table class="v26-hist-table"><thead><tr><th scope="col" class="v26-hist-sticky">Player</th>${head}<th scope="col" class="v26-hist-total">Total</th></tr></thead><tbody>${body}</tbody></table>
      </div>${legend}
    </section>`;
  }
  function categoriesTable(model, title) {
    const cats = model.categories || [];
    const head = cats.map((c) => `<th scope="col" class="${c.tiebreakOnly ? 'is-muted' : ''}"><span class="v26-hist-th v26-hist-th-cat">${esc(c.label)}</span>${c.vp ? `<span class="v26-hist-thsub">${c.vp} VP</span>` : ''}</th>`).join('');
    const body = model.players.map((p) => `<tr class="${p.isWinner ? 'is-winner' : ''}"><th scope="row" class="v26-hist-sticky">${playerLabel(p)}</th>${cats.map((c) => `<td class="${c.tiebreakOnly ? 'is-muted' : ''}"><span class="v26-hist-pts">${esc(c.values[p.index])}</span></td>`).join('')}<td class="v26-hist-total">${esc(p.score)}</td></tr>`).join('');
    return `<section class="v26-hist-sec" aria-label="${esc(title)}">
      <div class="v26-hist-sec-h"><h3>${esc(title)}</h3>${model.gameKey === '7wonders' ? '<span class="v26-hist-hint">Coins break ties</span>' : ''}</div>
      <div class="v26-hist-scroll" tabindex="0" role="region" aria-label="${esc(title)} table, scrolls sideways">
        <table class="v26-hist-table v26-hist-table-cat"><thead><tr><th scope="col" class="v26-hist-sticky">Player</th>${head}<th scope="col" class="v26-hist-total">Total</th></tr></thead><tbody>${body}</tbody></table>
      </div>
    </section>`;
  }
  function eliminationList(model) {
    const rows = model.rounds || [];
    return `<section class="v26-hist-sec" aria-label="Rounds">
      <div class="v26-hist-sec-h"><h3>Round by round</h3><span class="v26-hist-hint">Who went out each round</span></div>
      <ol class="v26-hist-elim">${rows.map((r) => `<li><span class="v26-hist-elim-r">${esc(r.label)}</span><span class="v26-hist-elim-n">${esc(r.eliminated)}</span><span class="v26-hist-out">Out</span></li>`).join('')}
      ${model.winnerNames && model.winnerNames.length ? `<li class="is-winner"><span class="v26-hist-elim-r">Last one standing</span><span class="v26-hist-elim-n">${esc(model.winner)}</span>${IC.crown}</li>` : ''}</ol>
    </section>`;
  }
  function viewBody(model, d) {
    const notes = (model.notes || []).concat(d.notice ? [d.notice] : []);
    let main = '';
    if (model.mode === 'rounds') main = roundsTable(model) + (model.categories && model.categories.length ? categoriesTable(model, model.gameKey === 'catan' ? 'Victory points by category' : 'Categories') : '');
    else if (model.mode === 'categories') main = categoriesTable(model, model.gameKey === 'catan' ? 'Victory points by category' : 'Score by category');
    else if (model.mode === 'eliminations') main = eliminationList(model);
    return headerCard(model, d) + winnerBanner(model)
      + (notes.length ? `<div class="v26-hist-note" role="note">${IC.info}<span>${notes.map(esc).join(' ')}</span></div>` : '')
      + standings(model) + main
      + (!d.canEdit ? `<p class="v26-hist-ro">${IC.lock}<span>Read-only${d.record && (d.record.createdByName) ? '. Only ' + esc(d.record.createdByName) + ' can edit this game.' : '. Only the player who recorded this game can edit it.'}</span></p>` : '')
      + footerArea(d);
  }
  // v27: muted dice-roll line in the detail footer when meta.diceStats has rolls (list cards no longer show this)
  function diceStatsOf(d) {
    const rec = d && d.record, e = entryFor(d);
    const st = (rec && rec.meta && rec.meta.diceStats) || (e && e.meta && e.meta.diceStats) || null;
    return (st && Number(st.totalRolls) > 0) ? st : null;
  }
  function diceLine(d) {
    const st = diceStatsOf(d); if (!st) return '';
    const n = Number(st.totalRolls);
    return `<p class="v26-hist-dice">${n} dice ${n === 1 ? 'roll' : 'rolls'}</p>`;
  }
  function footerArea(d) {
    const dice = diceLine(d), owner = ownerActions(d);
    if (!dice && !owner) return '';
    return `<div class="v26-hist-foot">${dice}${owner}</div>`;
  }
  // v27: the History list entry behind this sheet (by list id, shared id or local id)
  function entryFor(d) {
    const ids = [S && S.id, d && d.sharedId, d && d.localId].filter(Boolean).map(String);
    return ADAPTER.entries().find((g) => g && (ids.includes(String(g.id || '')) || (g.sharedGameId && ids.includes(String(g.sharedGameId))))) || null;
  }
  // v27: quiet owner-only actions at the end of the scorecard. Non-owners (group members, friends) never get them.
  function ownerActions(d) {
    const e = entryFor(d);
    if (!e || !ADAPTER.canDelete(e)) return '';
    const link = ADAPTER.linkButton(e);
    return `<div class="v26-hist-owner">${link || ''}<button type="button" class="v26-hist-del" data-act="delete"${S && S.deleting ? ' disabled aria-busy="true"' : ''}>${IC.trash}<span>${S && S.deleting ? 'Deleting...' : 'Delete game'}</span></button></div>`;
  }
  async function removeGame() {
    if (!S || !S.data || S.deleting) return;
    const e = entryFor(S.data); if (!e || !ADAPTER.canDelete(e)) return;
    const sid = e.sharedGameId || (e.source === 'shared' ? e.id : '');
    const id = S.id; S.deleting = true;
    // engine's deleteHistoryEntry shows the existing "Delete this game from history?" confirm and drops the entry
    // synchronously when accepted (the cloud delete finishes in the background), so close as soon as it is gone
    const p = ADAPTER.remove(String(e.id || ''), String(sid || ''));
    if (S && S.id === id && !entryFor(S.data)) { S.deleting = false; close(); return; }
    const ok = await p;
    if (!S || S.id !== id) return;
    S.deleting = false;
    if (ok) close(); else render();
  }

  // ---------------- edit ----------------
  function startEdit() {
    const model = TOOLS.describe(S.data.record);
    const rec = S.data.record;
    const draft = { mode: model.mode, names: model.players.map((p) => p.name), locked: model.players.map((p) => !!p.userId || !!(p.members && p.members.some((m) => m.userId))),
      scores: model.players.map((p) => p.score), rounds: [], del: {}, add: [], cats: {}, order: [] };
    if (model.mode === 'rounds') {
      draft.rounds = model.rounds.map((r) => ({ index: r.index, label: r.label, deltas: r.deltas.slice(), entries: entriesFor(model, rec, r) }));
    }
    if (model.categories) model.categories.forEach((c) => { if (!c.tiebreakOnly || c.key === 'coins') draft.cats[c.key] = c.values.slice(); });
    if (model.gameKey === '7wonders') {
      draft.cats.coins = model.players.map((p, i) => num(((rec.players[i] || {}).scores || {}).treasury));
    }
    if (model.mode === 'eliminations' || model.gameKey === 'spoons') {
      const out = model.players.filter((p) => p.eliminatedRound != null).sort((a, b) => a.eliminatedRound - b.eliminatedRound).map((p) => p.name);
      const rest = model.players.filter((p) => p.eliminatedRound == null).map((p) => p.name);
      draft.order = out.concat(rest); // first out first; the last name is the winner
    }
    S.draft = draft; S.mode = 'edit'; S.result = null; S.msg = '';
    render();
  }
  function entriesFor(model, rec, r) {
    const raw = (rec.rounds || [])[r.index] || {};
    if (model.gameKey === 'ohhell' && Array.isArray(raw.entries)) return raw.entries.map((e) => ({ bid: num(e.bid), tricksWon: num(e.tricksWon) }));
    if (model.gameKey === 'hearts' && Array.isArray(raw.entries)) return raw.entries.map((e) => ({ hearts: num(e.hearts), queenOfSpades: !!e.queenOfSpades, jackOfDiamonds: !!e.jackOfDiamonds }));
    return null;
  }
  const numIn = (attrs, v, label) => `<input class="v26-hist-in" type="number" inputmode="numeric" step="1" ${attrs} value="${esc(v)}" aria-label="${esc(label)}" enterkeyhint="next">`;
  function nameCell(i) {
    const D = S.draft;
    return D.locked[i]
      ? `<th scope="row" class="v26-hist-sticky"><span class="v26-hist-lockname" title="Linked account; name comes from their profile">${IC.lock}<span class="v26-hist-pname">${esc(D.names[i])}</span></span></th>`
      : `<th scope="row" class="v26-hist-sticky"><input class="v26-hist-in v26-hist-in-name" type="text" data-k="name" data-i="${i}" value="${esc(D.names[i])}" aria-label="Player ${i + 1} name" maxlength="40" autocomplete="off" enterkeyhint="next"></th>`;
  }
  function editBody(model, d) {
    const D = S.draft, gk = model.gameKey;
    let main = '';
    if (gk === 'spoons') {
      const n = D.order.length;
      main = `<section class="v26-hist-sec"><div class="v26-hist-sec-h"><h3>Elimination order</h3><span class="v26-hist-hint">First out at the top</span></div>
        <ol class="v26-hist-order">${D.order.map((nm, k) => `<li class="${k === n - 1 ? 'is-winner' : ''}" data-k="${k}">
          <span class="v26-hist-order-r">${k === n - 1 ? 'Winner' : 'Out in round ' + (k + 1)}</span><span class="v26-hist-order-n">${esc(nm)}</span>
          <span class="v26-hist-order-btns"><button type="button" class="v26-hist-iconbtn v26-hist-sm" data-act="up" data-k="${k}" aria-label="Move ${esc(nm)} earlier"${k === 0 ? ' disabled' : ''}>${IC.up}</button><button type="button" class="v26-hist-iconbtn v26-hist-sm" data-act="down" data-k="${k}" aria-label="Move ${esc(nm)} later"${k === n - 1 ? ' disabled' : ''}>${IC.down}</button></span>
        </li>`).join('')}</ol></section>`;
    } else if (model.mode === 'rounds' && !(gk === 'catan' && model.categories)) {
      const card = gk === 'hearts' || gk === 'ohhell';
      const live = D.rounds.filter((r) => !D.del[r.index]);
      const head = live.map((r) => { const s = shortLabel({ label: r.label, number: r.index + 1 }); return `<th scope="col" title="${esc(r.label)}"><span class="v26-hist-th">${esc(s.top)}</span><button type="button" class="v26-hist-iconbtn v26-hist-xs" data-act="delround" data-r="${r.index}" aria-label="Delete ${esc(r.label)}">${IC.trash}</button></th>`; }).join('')
        + D.add.map((a, k) => `<th scope="col"><span class="v26-hist-th">New</span><button type="button" class="v26-hist-iconbtn v26-hist-xs" data-act="delnew" data-a="${k}" aria-label="Remove new round">${IC.trash}</button></th>`).join('');
      const rows = model.players.map((p, i) => `<tr>${nameCell(i)}${live.map((r) => {
        if (card && r.entries) {
          const e = r.entries[i];
          return gk === 'ohhell'
            ? `<td class="v26-hist-ecell"><label class="v26-hist-mini"><span>Bid</span>${numIn(`data-k="bid" data-r="${r.index}" data-i="${i}" min="0"`, e.bid, D.names[i] + ' bid, ' + r.label)}</label><label class="v26-hist-mini"><span>Took</span>${numIn(`data-k="took" data-r="${r.index}" data-i="${i}" min="0"`, e.tricksWon, D.names[i] + ' tricks, ' + r.label)}</label></td>`
            : `<td class="v26-hist-ecell"><label class="v26-hist-mini"><span>Hearts</span>${numIn(`data-k="hearts" data-r="${r.index}" data-i="${i}" min="0" max="13"`, e.hearts, D.names[i] + ' hearts, ' + r.label)}</label><label class="v26-hist-chk"><input type="checkbox" data-k="queen" data-r="${r.index}" data-i="${i}"${e.queenOfSpades ? ' checked' : ''}><span>Queen</span></label></td>`;
        }
        return `<td>${numIn(`data-k="delta" data-r="${r.index}" data-i="${i}"`, r.deltas[i], D.names[i] + ', ' + r.label)}</td>`;
      }).join('')}${D.add.map((a, k) => `<td>${numIn(`data-k="adddelta" data-a="${k}" data-i="${i}"`, a[i], D.names[i] + ', new round')}</td>`).join('')}</tr>`).join('');
      main = `<section class="v26-hist-sec"><div class="v26-hist-sec-h"><h3>Rounds</h3>${card ? '<span class="v26-hist-hint">Points are recalculated from each hand</span>' : '<span class="v26-hist-hint">Points per round</span>'}</div>
        <div class="v26-hist-scroll" tabindex="0" role="region" aria-label="Editable rounds table, scrolls sideways"><table class="v26-hist-table v26-hist-table-edit"><thead><tr><th scope="col" class="v26-hist-sticky">Player</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>
        ${card ? '' : `<button type="button" class="v26-hist-btn v26-hist-btn-ghost" data-act="addround">${IC.plus}<span>Add a round</span></button>`}</section>`;
    } else if (model.categories && model.categories.length) {
      const cats = gk === '7wonders' ? model.categories.filter((c) => c.key !== 'treasury' && c.key !== 'coins').concat([{ key: 'coins', label: 'Coins' }]) : model.categories;
      const keyFor = (c) => (gk === '7wonders' && c.key === 'science' ? 'science.override' : c.key);
      const head = cats.map((c) => `<th scope="col"><span class="v26-hist-th v26-hist-th-cat">${esc(c.label)}</span>${c.vp ? `<span class="v26-hist-thsub">${c.vp} VP each</span>` : c.key === 'coins' ? '<span class="v26-hist-thsub">3 = 1 VP</span>' : c.key === 'science' ? '<span class="v26-hist-thsub">VP</span>' : ''}</th>`).join('');
      const rows = model.players.map((p, i) => `<tr>${nameCell(i)}${cats.map((c) => {
        const k = c.key, v = (D.cats[k] || [])[i];
        const lim = k === 'longestRoad' || k === 'largestArmy' ? ' min="0" max="1"' : gk === 'catan' ? ' min="0"' : '';
        return `<td>${numIn(`data-k="cat" data-c="${esc(keyFor(c))}" data-ck="${esc(k)}" data-i="${i}"${lim}`, v == null ? 0 : v, D.names[i] + ', ' + c.label)}</td>`;
      }).join('')}</tr>`).join('');
      main = `<section class="v26-hist-sec"><div class="v26-hist-sec-h"><h3>${gk === 'catan' ? 'Victory points by category' : 'Score by category'}</h3><span class="v26-hist-hint">${gk === 'catan' ? 'Counts; one player each for Longest Road and Largest Army' : 'Totals are recalculated'}</span></div>
        <div class="v26-hist-scroll" tabindex="0" role="region" aria-label="Editable category table, scrolls sideways"><table class="v26-hist-table v26-hist-table-edit"><thead><tr><th scope="col" class="v26-hist-sticky">Player</th>${head}</tr></thead><tbody>${rows}</tbody></table></div></section>`;
    } else {
      main = `<section class="v26-hist-sec"><div class="v26-hist-sec-h"><h3>Final scores</h3></div>
        <div class="v26-hist-scroll" tabindex="0" role="region" aria-label="Editable final scores"><table class="v26-hist-table v26-hist-table-edit"><thead><tr><th scope="col" class="v26-hist-sticky">Player</th><th scope="col">Score</th></tr></thead>
        <tbody>${model.players.map((p, i) => `<tr>${nameCell(i)}<td>${numIn(`data-k="score" data-i="${i}"`, D.scores[i], D.names[i] + ' final score')}</td></tr>`).join('')}</tbody></table></div></section>`;
    }
    const names = gk === 'spoons' ? `<section class="v26-hist-sec"><div class="v26-hist-sec-h"><h3>Player names</h3></div><div class="v26-hist-names">${model.players.map((p, i) => D.locked[i]
      ? `<span class="v26-hist-lockname">${IC.lock}<span class="v26-hist-pname">${esc(D.names[i])}</span></span>`
      : `<input class="v26-hist-in v26-hist-in-name" type="text" data-k="name" data-i="${i}" value="${esc(D.names[i])}" aria-label="Player ${i + 1} name" maxlength="40" autocomplete="off">`).join('')}</div></section>` : '';
    const err = S.result && !S.result.ok ? `<div class="v26-hist-err" role="alert">${S.result.errors.map((e) => `<div>${esc(e)}</div>`).join('')}</div>` : '';
    return `${err}<p class="v26-hist-legend">${model.players.some((p, i) => D.locked[i]) ? 'Names with a lock belong to linked accounts and come from their profile. ' : ''}Winner, totals and placements are recalculated when you review.</p>${main}${names}`;
  }
  function editFoot() {
    return `<button type="button" class="v26-hist-btn v26-hist-btn-ghost" data-act="cancel">Cancel</button><button type="button" class="v26-hist-btn v26-hist-btn-primary" data-act="review">${IC.check}<span>Review changes</span></button>`;
  }
  function buildEdits(model) {
    const D = S.draft, gk = model.gameKey, edits = {};
    const players = [];
    model.players.forEach((p, i) => { if (!D.locked[i] && String(D.names[i]).trim() !== p.name) players.push({ index: i, name: D.names[i] }); });
    if (gk === 'spoons') {
      const was = model.players.filter((p) => p.eliminatedRound != null).sort((a, b) => a.eliminatedRound - b.eliminatedRound).map((p) => p.name);
      const now = D.order.slice(0, D.order.length - 1);
      // names in the order list follow renames by index
      const ren = now.map((nm) => { const i = model.players.findIndex((p) => p.name === nm); return i >= 0 ? model.players[i].name : nm; });
      if (ren.join('\u0001') !== was.join('\u0001')) edits.eliminationOrder = ren;
    } else if (model.mode === 'rounds' && !(gk === 'catan' && model.categories)) {
      const rounds = [];
      D.rounds.forEach((r) => {
        const orig = model.rounds.find((x) => x.index === r.index);
        if (D.del[r.index]) { rounds.push({ index: r.index, delete: true }); return; }
        if (r.entries) { const o = entriesFor(model, S.data.record, orig); if (JSON.stringify(o) !== JSON.stringify(r.entries)) rounds.push({ index: r.index, entries: r.entries }); return; }
        if (r.deltas.some((v, i) => num(v) !== num(orig.deltas[i]))) rounds.push({ index: r.index, deltas: r.deltas.map(num) });
      });
      // card games: a deleted hand with entry edits elsewhere still needs every remaining hand replayed
      if (rounds.length) edits.rounds = rounds;
      if (D.add.length) edits.addRounds = D.add.map((a) => ({ deltas: a.map(num) }));
    } else if (model.categories && model.categories.length) {
      const cats = [];
      const orig = {}; model.categories.forEach((c) => { orig[c.key] = c.values; });
      if (gk === '7wonders') orig.coins = model.players.map((p, i) => num(((S.data.record.players[i] || {}).scores || {}).treasury));
      Object.keys(D.cats).forEach((k) => {
        if (gk === '7wonders' && k === 'treasury') return;
        const key = gk === '7wonders' && k === 'science' ? 'science.override' : k;
        D.cats[k].forEach((v, i) => { if (num(v) !== num((orig[k] || [])[i])) cats.push({ index: i, key, value: num(v) }); });
      });
      if (cats.length) edits.categories = cats;
    } else {
      model.players.forEach((p, i) => { if (num(D.scores[i]) !== num(p.score)) { const e = players.find((x) => x.index === i); if (e) e.score = num(D.scores[i]); else players.push({ index: i, score: num(D.scores[i]) }); } });
    }
    if (players.length) edits.players = players;
    return edits;
  }
  function review() {
    const model = TOOLS.describe(S.data.record);
    const edits = buildEdits(model);
    if (!Object.keys(edits).length) { S.result = { ok: false, errors: ['Nothing has changed yet.'], warnings: [], changes: [] }; render(); return; }
    let res;
    try { res = TOOLS.recompute(S.data.record, edits, { user: ADAPTER.user() || undefined, enforcePermission: !!ADAPTER.user() }); }
    catch (e) { res = { ok: false, errors: ['These changes could not be applied.'], warnings: [], changes: [] }; }
    S.result = res; S.edits = edits;
    if (!res || !res.ok) { S.mode = 'edit'; render(); return; }
    S.mode = 'review'; S.msg = ''; render();
  }
  function reviewBody(model) {
    const res = S.result, after = TOOLS.describe(res.record);
    const rows = model.players.map((p, i) => {
      const a = after.players[i];
      const isSp = model.gameKey === 'spoons';
      const was = isSp ? (p.eliminatedRound != null ? 'Out R' + p.eliminatedRound : 'Winner') : p.score;
      const now = isSp ? (a.eliminatedRound != null ? 'Out R' + a.eliminatedRound : 'Winner') : a.score;
      const changed = String(was) !== String(now) || p.place !== a.place || p.name !== a.name;
      return `<tr class="${changed ? 'is-changed' : ''}"><th scope="row" class="v26-hist-sticky">${a.name !== p.name ? `<span class="v26-hist-was">${esc(p.name)}</span> ` : ''}<span class="v26-hist-pname">${esc(a.name)}</span></th>
        <td>${String(was) !== String(now) ? `<span class="v26-hist-was">${esc(was)}</span> ${esc(now)}` : esc(now)}</td><td>${p.place !== a.place ? `<span class="v26-hist-was">${ordinal(p.place)}</span> ` : ''}${ordinal(a.place)}</td></tr>`;
    }).join('');
    const winChanged = model.winner !== after.winner;
    const msg = S.msg ? `<div class="v26-hist-err" role="alert">${S.msg}</div>` : '';
    const nRounds = (res.changes || []).filter((c) => /^(round|entries|delround|addround|adjustment)/.test(c)).length;
    const nCats = (res.changes || []).filter((c) => /^cat:/.test(c)).length;
    const lines = [];
    if (nRounds) lines.push(nRounds + ' round ' + (nRounds === 1 ? 'change' : 'changes'));
    if (nCats) lines.push(nCats + ' category ' + (nCats === 1 ? 'change' : 'changes'));
    if ((res.changes || []).some((c) => /^rename/.test(c))) lines.push('player renamed');
    if ((res.changes || []).includes('eliminations')) lines.push('elimination order changed');
    return `${msg}<div class="v26-hist-winner${winChanged ? ' is-changed' : ''}" data-winner="${esc(after.winner)}">${IC.crown}<div><div class="v26-hist-winner-k">${winChanged ? 'New winner' : 'Winner unchanged'}</div><div class="v26-hist-winner-v">${winChanged ? `<span class="v26-hist-was">${esc(model.winner || 'None')}</span> ` : ''}${esc(after.winner || 'None')}</div></div></div>
      ${lines.length ? `<p class="v26-hist-legend">${esc(lines.join(', '))}.</p>` : ''}
      ${(res.warnings || []).length ? `<div class="v26-hist-note" role="note">${IC.info}<span>${res.warnings.map(esc).join(' ')}</span></div>` : ''}
      <section class="v26-hist-sec"><div class="v26-hist-sec-h"><h3>Totals after your changes</h3></div>
      <div class="v26-hist-scroll" tabindex="0" role="region" aria-label="Change summary"><table class="v26-hist-table v26-hist-table-sum"><thead><tr><th scope="col" class="v26-hist-sticky">Player</th><th scope="col">${model.gameKey === 'spoons' ? 'Result' : 'Score'}</th><th scope="col">Place</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
  }
  function reviewFoot() {
    const busy = S.busy;
    if (S.conflict) return `<button type="button" class="v26-hist-btn v26-hist-btn-ghost" data-act="cancel">Discard</button><button type="button" class="v26-hist-btn v26-hist-btn-primary" data-act="reload">${IC.refresh}<span>Reload</span></button>`;
    return `<button type="button" class="v26-hist-btn v26-hist-btn-ghost" data-act="backedit"${busy ? ' disabled' : ''}>Keep editing</button><button type="button" class="v26-hist-btn v26-hist-btn-primary" data-act="save"${busy ? ' disabled aria-busy="true"' : ''}>${IC.check}<span>${busy ? 'Saving...' : 'Save changes'}</span></button>`;
  }
  // Keep the device copy in step with the server after an edit (and flag it edited so no re-share can revert it)
  function syncLocal(localId, game, fallbackRec) {
    const cur = ADAPTER.local(localId); if (!cur) return false;
    const payload = game && game.payload && typeof game.payload === 'object' ? game.payload : stripUi(fallbackRec || {});
    const next = { ...cur, ...clone(payload), id: cur.id };
    ['type', 'version', 'startTime', 'endTime', 'groupId', 'groupName'].forEach((k) => { if (cur[k] != null && next[k] == null) next[k] = cur[k]; });
    if (game && game.winner != null) next.winner = game.winner;
    markEdited(next, game && game.edited_at, game && game.edited_by_name);
    return ADAPTER.saveLocal(localId, stripUi(next));
  }
  async function save() {
    if (!S || !S.result || !S.result.ok || S.busy) return;
    const d = S.data, rec = S.result.record;
    S.busy = true; S.msg = ''; render();
    let ok = false;
    if (d.source === 'cloud' && d.sharedId) {
      const edit = TOOLS.sharedEdit(d.original, rec);
      const r = await ADAPTER.update(d.sharedId, edit, { expectedEditedAt: d.game ? (d.game.edited_at || null) : null });
      if (!S) return;
      S.busy = false;
      if (r.ok) {
        ok = true;
        const next = r.game ? fromDetail(r.game, rec) : markEdited({ ...rec }, null, null);
        if (d.localId) syncLocal(d.localId, r.game, rec);
        S.data = { ...d, record: next, original: clone(next), game: r.game || d.game, canEdit: r.game ? !!(r.game.can_edit || r.game.is_owner) : d.canEdit };
        ADAPTER.refreshSocial();
      } else if (r.conflict) { S.conflict = true; S.msg = 'This game was edited elsewhere. Reload to see the latest version, then make your change again.'; }
      else if (r.forbidden) S.msg = 'Only the player who recorded this game can edit it.';
      else if (r.error === 'not_signed_in') S.msg = 'Sign in again to save changes.';
      else if (r.error === 'not_found') S.msg = 'This game no longer exists.';
      else if (r.error === 'invalid_payload' || r.error === 'invalid_input') S.msg = 'These changes could not be saved. Check the numbers and try again.';
      else if (r.tooMany) S.msg = 'Too many changes at once. Try again in a moment.';
      else if (r.unavailable) S.msg = 'Editing is not available yet.';
      else S.msg = 'Could not save right now. Try again in a moment.';
    } else {
      S.busy = false;
      if (d.localId && ADAPTER.saveLocal(d.localId, markEdited(stripUi(rec), (rec.meta && rec.meta.edited && rec.meta.edited.at) || null, null))) {
        ok = true;
        const saved = ADAPTER.local(d.localId) || rec;
        S.data = { ...d, record: clone(saved), original: clone(saved) };
      } else S.msg = 'Could not save this game on this device.';
    }
    if (ok) { S.mode = 'view'; S.result = null; S.draft = null; S.conflict = false; ADAPTER.refresh(); decorate(); }
    render();
    if (ok) { const t = root.querySelector('.v26-hist-edited'); if (t) t.classList.add('is-fresh'); }
  }

  // ---------------- sheet events ----------------
  function onSheetClick(e) {
    const b = e.target.closest('[data-act]'); if (!b || !root.contains(b) || b.disabled) return;
    const a = b.getAttribute('data-act');
    if (a === 'close') close();
    else if (a === 'edit') startEdit();
    else if (a === 'delete') removeGame();
    else if (a === 'cancel') { S.mode = 'view'; S.result = null; S.draft = null; S.conflict = false; S.msg = ''; render(); }
    else if (a === 'review') review();
    else if (a === 'backedit') { S.mode = 'edit'; S.msg = ''; render(); }
    else if (a === 'save') save();
    else if (a === 'reload') reload();
    else if (a === 'addround') { S.draft.add.push(S.draft.names.map(() => 0)); render(); }
    else if (a === 'delnew') { S.draft.add.splice(Number(b.getAttribute('data-a')), 1); render(); }
    else if (a === 'delround') { S.draft.del[Number(b.getAttribute('data-r'))] = true; render(); }
    else if (a === 'up' || a === 'down') {
      const k = Number(b.getAttribute('data-k')), j = a === 'up' ? k - 1 : k + 1, o = S.draft.order;
      if (j < 0 || j >= o.length) return;
      const t = o[k]; o[k] = o[j]; o[j] = t; render();
      const nb = root.querySelector(`[data-act="${a}"][data-k="${j}"]`) || root.querySelector(`[data-k="${j}"] [data-act]`); if (nb) nb.focus();
    }
  }
  function onSheetInput(e) {
    const el = e.target; if (!S || !S.draft || !el.getAttribute) return;
    const k = el.getAttribute('data-k'); if (!k) return;
    const i = Number(el.getAttribute('data-i')), D = S.draft;
    const r = el.hasAttribute('data-r') ? D.rounds.find((x) => x.index === Number(el.getAttribute('data-r'))) : null;
    const v = el.type === 'checkbox' ? el.checked : el.value;
    if (k === 'name') {
      const old = D.names[i]; D.names[i] = v;
      if (D.order) D.order = D.order.map((nm) => (nm === old ? v : nm));
    }
    else if (k === 'delta' && r) r.deltas[i] = v;
    else if (k === 'adddelta') D.add[Number(el.getAttribute('data-a'))][i] = v;
    else if (k === 'bid' && r) r.entries[i].bid = num(v);
    else if (k === 'took' && r) r.entries[i].tricksWon = num(v);
    else if (k === 'hearts' && r) r.entries[i].hearts = num(v);
    else if (k === 'queen' && r) { r.entries[i].queenOfSpades = !!v; if (v) r.entries.forEach((en, j) => { if (j !== i) en.queenOfSpades = false; }); if (e.type === 'change') { root.querySelectorAll(`input[data-k="queen"][data-r="${r.index}"]`).forEach((c) => { c.checked = r.entries[Number(c.getAttribute('data-i'))].queenOfSpades; }); } }
    else if (k === 'cat') { const ck = el.getAttribute('data-ck'); (D.cats[ck] = D.cats[ck] || [])[i] = v; }
    else if (k === 'score') D.scores[i] = v;
  }

  // ---------------- History list integration ----------------
  function decorate() {
    const list = doc.getElementById('history-list'); if (!list) return;
    const byId = {}; ADAPTER.entries().forEach((g) => { if (g && g.id != null) byId[String(g.id)] = g; });
    list.querySelectorAll('.history-item').forEach((row) => {
      const id = row.getAttribute('data-game-id') || '';
      const g = byId[id] || null;
      if (!row.classList.contains('v26-hist-row')) {
        row.classList.add('v26-hist-row');
        row.setAttribute('tabindex', '0');
        row.setAttribute('role', 'button');
        const t = row.querySelector('strong');
        row.setAttribute('aria-label', 'Open ' + (t ? t.textContent : 'game') + ' details');
        const foot = doc.createElement('div'); foot.className = 'v26-hist-rowfoot'; foot.innerHTML = `<span class="v26-hist-edchip" hidden>Edited</span><span class="v26-hist-more">Details${IC.chev}</span>`;
        row.appendChild(foot);
      }
      const chip = row.querySelector('.v26-hist-edchip');
      const ed = g && ((g.meta && g.meta.edited && g.meta.edited.at) || g.edited_at || g.editedAt);
      if (chip) chip.hidden = !ed;
    });
  }
  function onDocClick(e) {
    const row = e.target.closest && e.target.closest('#history-list .history-item');
    if (!row) return;
    if (e.target.closest('button, a, input, select, textarea, label, .v24-link-slot, [role="menu"]')) return;
    const id = row.getAttribute('data-game-id') || row.getAttribute('data-shared-id');
    if (id) open(id, { returnFocus: row });
  }
  function onDocKey(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const row = e.target && e.target.classList && e.target.classList.contains('v26-hist-row') ? e.target : null;
    if (!row) return;
    e.preventDefault();
    const id = row.getAttribute('data-game-id') || row.getAttribute('data-shared-id');
    if (id) open(id, { returnFocus: row });
  }
  function init() {
    doc.addEventListener('click', onDocClick);
    doc.addEventListener('keydown', onDocKey);
    const list = doc.getElementById('history-list');
    if (list && global.MutationObserver) new MutationObserver(() => decorate()).observe(list, { childList: true });
    decorate();
    // close the sheet if the app navigates away from History underneath it
    global.addEventListener('tallyit:game-edited', (ev) => {
      const det = (ev && ev.detail) || {};
      if (det.game_id && det.game) {
        const e = ADAPTER.entries().find((g) => g && String(g.sharedGameId || '') === String(det.game_id));
        if (e && ADAPTER.local(e.id)) syncLocal(e.id, det.game, null);
      }
      ADAPTER.refresh();
      if (S && S.mode === 'view' && S.data && S.data.ok && (String(det.game_id || '') === String(S.data.sharedId || '') || String(det.game_id || '') === S.id)) {
        if (det.game) { const next = fromDetail(det.game, S.data.record); S.data = { ...S.data, record: next, original: clone(next), game: det.game }; render(); }
        else reload();
      }
    });
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init, { once: true }); else init();

  global.TallyItV26History = {
    open, close, reload, getGame, isOwner, updateGame, decorate,
    setAdapter(o) { Object.assign(ADAPTER, o || {}); },
    setTools(o) { Object.assign(TOOLS, o || {}); },
    get adapter() { return ADAPTER; }, get tools() { return TOOLS; },
    themes: THEMES,
    _state: () => S
  };
})(typeof window !== 'undefined' ? window : globalThis);
