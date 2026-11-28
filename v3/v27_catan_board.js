/* TallyIt v27: Catan board generator UI (window.TallyItV27CatanBoard).
   UI only. Board logic is Score Tracker Scoring's window.TallyItCatanBoard (scoring/catan_board.js, shipped as
   v3/catan_board.js): generateBoard / validateBoard / sizeFor / boardSupported. This file never decides the rules. Two entry points open ONE sheet:
     - "Generate board" row on Catan Setup, right after Customize Rules
     - "Board" button next to Dice on the Catan tracker (#catan-dice-slot)
   Board size = TallyItCatanBoard.sizeFor(version, players) (a known version beats player count). Seafarers: no entry points.
   No engine.js changes. */
(function (global) {
  'use strict';
  const doc = global.document;
  const STORE = 'tallyit_v27_catan_board';
  const R = 40, W = Math.sqrt(3) * R;
  const RES = {
    wood: { fill: '#3f6a3a', name: 'Forest', res: 'Wood' }, sheep: { fill: '#a9c768', name: 'Pasture', res: 'Sheep' },
    wheat: { fill: '#e6bf45', name: 'Fields', res: 'Wheat' }, brick: { fill: '#c0623a', name: 'Hills', res: 'Brick' },
    ore: { fill: '#8b919a', name: 'Mountains', res: 'Ore' }, desert: { fill: '#e2c98f', name: 'Desert', res: '' },
  };
  const HELP = {
    balanced: 'Rulebook rules, plus no three tiles of one resource joined together. Pairs are fine.',
    random: 'Rulebook fully random: 6 and 8 never touch, and no two same numbers touch. The rest is the luck of the draw.',
  };
  const byId = (id) => doc.getElementById(id);
  const f = (n) => Math.round(n * 100) / 100;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------------- board SVG (presentation only) ----------------
  const GLYPH = {
    wood: () => { const t = (x, y, k) => `<path d="M${x} ${y - .46 * k}L${x - .2 * k} ${y - .08 * k}H${x - .1 * k}L${x - .26 * k} ${y + .24 * k}H${x + .26 * k}L${x + .1 * k} ${y - .08 * k}H${x + .2 * k}Z" fill="#244a25"/><rect x="${x - .04 * k}" y="${y + .24 * k}" width="${.08 * k}" height="${.14 * k}" fill="#1a331b"/>`; return t(-.3, .06, .9) + t(.28, .1, .8) + t(0, -.05, 1.05); },
    sheep: () => '<g fill="#f8f3e1" stroke="#7b8a43" stroke-width=".03"><circle cx="-.16" cy=".04" r=".17"/><circle cx=".04" cy="-.04" r=".19"/><circle cx="0" cy=".13" r=".16"/><circle cx="-.04" cy=".02" r=".2"/></g><ellipse cx=".3" cy=".08" rx=".1" ry=".12" fill="#3d3d2f"/><path d="M-.14 .24v.18M.06 .24v.18" stroke="#3d3d2f" stroke-width=".07" stroke-linecap="round"/>',
    wheat: () => { const s = (x, h) => `<path d="M${x} .42V${-h}" stroke="#a5760f" stroke-width=".05" stroke-linecap="round"/>` + [0, 1, 2, 3].map((i) => { const y = -h + .12 + i * .15; return `<ellipse cx="${f(x - .07)}" cy="${f(y)}" rx=".05" ry=".1" transform="rotate(-28 ${f(x - .07)} ${f(y)})" fill="#a5760f"/><ellipse cx="${f(x + .07)}" cy="${f(y)}" rx=".05" ry=".1" transform="rotate(28 ${f(x + .07)} ${f(y)})" fill="#a5760f"/>`; }).join('') + `<ellipse cx="${x}" cy="${f(-h - .02)}" rx=".05" ry=".1" fill="#a5760f"/>`; return s(-.24, .22) + s(0, .38) + s(.24, .26); },
    brick: () => { const b = (x, y) => `<rect x="${x}" y="${y}" width=".3" height=".16" rx=".02" fill="#8a3a1c"/>`; return b(-.32, .16) + b(.02, .16) + b(-.15, 0) + b(.17, 0) + b(-.32, -.16) + b(.02, -.16); },
    ore: () => '<path d="M-.5 .34L-.16 -.3L.1 .1L.2 -.05L.5 .34Z" fill="#5b626c"/><path d="M-.16 -.3L-.28 -.06L-.2 -.1L-.14 -.02L-.06 -.1L.02 0Z" fill="#f2f4f6"/><path d="M.2 -.05L.12 .08L.2 .04L.26 .1L.31 .03Z" fill="#f2f4f6"/>',
    desert: () => '<path d="M-.5 .2Q-.25 -.02 0 .2T.5 .2" fill="none" stroke="#b58f4a" stroke-width=".06" stroke-linecap="round"/><path d="M-.45 .38Q-.2 .16 .05 .38T.5 .38" fill="none" stroke="#b58f4a" stroke-width=".06" stroke-linecap="round"/><path d="M-.36 -.02Q-.18 -.2 0 -.02" fill="none" stroke="#b58f4a" stroke-width=".05" stroke-linecap="round"/>',
  };
  const glyph = (res, x, y, s) => `<g transform="translate(${f(x)} ${f(y)}) scale(${f(s)})">${GLYPH[res]()}</g>`;
  const pips = (n) => 6 - Math.abs(7 - n);
  function hexPath(cx, cy, r) { let d = ''; for (let k = 0; k < 6; k++) { const a = (-90 + 60 * k) * Math.PI / 180; d += (k ? 'L' : 'M') + f(cx + Math.cos(a) * r) + ' ' + f(cy + Math.sin(a) * r); } return d + 'Z'; }
  function token(cx, cy, n, tr) {
    const red = n === 6 || n === 8, col = red ? '#b3261e' : '#2f1c0a', pc = pips(n), gap = tr * .25, x0 = cx - (pc - 1) * gap / 2;
    let dots = ''; for (let i = 0; i < pc; i++) dots += `<circle cx="${f(x0 + i * gap)}" cy="${f(cy + tr * .62)}" r="${f(tr * .075)}" fill="${col}"/>`;
    return `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(tr)}" fill="#f5e8c4" stroke="#4a3218" stroke-width="1.2"/><circle cx="${f(cx)}" cy="${f(cy)}" r="${f(tr - 2)}" fill="none" stroke="#c9a96a" stroke-width=".6"/>` +
      `<text x="${f(cx)}" y="${f(cy + tr * .22)}" text-anchor="middle" font-family="'Crimson Text',Georgia,'Times New Roman',serif" font-weight="700" font-size="${f(tr * 1.28)}" fill="${col}">${n}</text>${dots}`;
  }
  const robber = (cx, cy, s) => `<g transform="translate(${f(cx)} ${f(cy)}) scale(${f(s)})"><ellipse cx="0" cy=".5" rx=".38" ry=".1" fill="#000" opacity=".25"/><path d="M-.3 .48C-.3 .1 -.14 0 -.12 -.14C-.3 -.2 -.18 -.62 0 -.62C.18 -.62 .3 -.2 .12 -.14C.14 0 .3 .1 .3 .48Z" fill="#2c2724" stroke="#f2e4bd" stroke-width=".05" stroke-linejoin="round"/></g>`;
  function centres(rows) { const out = []; rows.forEach((n, r) => { for (let i = 0; i < n; i++) out.push({ row: r, col: i, x: (i - (n - 1) / 2) * W, y: (r - (rows.length - 1) / 2) * 1.5 * R }); }); return out; }
  function hull(pts) {
    pts = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); const lo = [], up = [];
    pts.forEach((p) => { while (lo.length > 1 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 1e-6) lo.pop(); lo.push(p); });
    for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length > 1 && cr(up[up.length - 2], up[up.length - 1], p) <= 1e-6) up.pop(); up.push(p); }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  }
  // Scoring's validator decides; a board the UI shows must return [] from validateBoard (stale or foreign boards are dropped)
  const API = () => global.TallyItCatanBoard || null;
  const numOf = (h) => (h.number !== undefined ? h.number : h.num);
  function valid(b) {
    const api = API();
    if (!b || !Array.isArray(b.rows) || !Array.isArray(b.hexes) || !Array.isArray(b.harbors)) return false;
    if (!b.hexes.every((h) => RES[h.resource])) return false;
    if (!api || typeof api.validateBoard !== 'function') return false;
    try { return api.validateBoard(b).length === 0; } catch (e) { return false; }
  }
  function renderSVG(b) {
    const cs = centres(b.rows), at = (row, col) => cs.find((c) => c.row === row && c.col === col);
    const hexById = {}; b.hexes.forEach((h) => { hexById[h.id] = Object.assign({}, h, at(h.row, h.col)); });
    const tokByHex = {}; b.hexes.forEach((h) => { const n = numOf(h); if (n != null) tokByHex[h.id] = n; });
    const SEA = 2.74 * R, WOOD = .3 * R, tr = .47 * R;
    const xs = cs.map((c) => c.x), ys = cs.map((c) => c.y), pad = SEA + WOOD + 3;
    const minx = Math.min(...xs) - pad, maxx = Math.max(...xs) + pad, miny = Math.min(...ys) - pad, maxy = Math.max(...ys) + pad;
    const d = hull(cs.map((c) => [c.x, c.y])).map((p, i) => (i ? 'L' : 'M') + f(p[0]) + ' ' + f(p[1])).join('') + 'Z';
    const label = `Generated Catan board, ${b.hexes.length} land hexes, ${b.mode === 'random' ? 'random' : 'balanced'} layout${b.code ? ', code ' + b.code : ''}`;
    let s = `<svg xmlns="http://www.w3.org/2000/svg" class="v27-cb-svg" viewBox="${f(minx)} ${f(miny)} ${f(maxx - minx)} ${f(maxy - miny)}" role="img" aria-label="${esc(label)}">`;
    s += `<path d="${d}" fill="#4a2f18" stroke="#4a2f18" stroke-width="${f(2 * (SEA + WOOD))}" stroke-linejoin="round"/>`;
    s += `<path d="${d}" fill="#c99a3e" stroke="#c99a3e" stroke-width="${f(2 * (SEA + WOOD * .22))}" stroke-linejoin="round"/>`;
    s += `<path d="${d}" fill="#3a7690" stroke="#3a7690" stroke-width="${f(2 * SEA)}" stroke-linejoin="round"/>`;
    b.harbors.forEach((hb) => {
      // position comes from the board (Scoring's official slots, unit-radius coords); nothing hardcoded here
      if (!Array.isArray(hb.p) || !Array.isArray(hb.q) || hb.nx == null) return;
      const p = [hb.p[0] * R, hb.p[1] * R], q = [hb.q[0] * R, hb.q[1] * R];
      const nx = hb.nx, ny = hb.ny, mx = hb.mx * R, my = hb.my * R, cr = .66 * R, cx = mx + nx * 1.06 * R, cy = my + ny * 1.06 * R;
      const generic = hb.type === 'any' || !RES[hb.type], col = generic ? '#f1e2b9' : RES[hb.type].fill, txt = generic || hb.type === 'wheat' || hb.type === 'sheep' ? '#2a190a' : '#fff8e6';
      const ratio = (hb.ratio ? hb.ratio + ':1' : (generic ? '3:1' : '2:1')), ex = cx - nx * cr * .55, ey = cy - ny * cr * .55;
      s += `<path d="M${f(p[0])} ${f(p[1])}L${f(ex)} ${f(ey)}M${f(q[0])} ${f(q[1])}L${f(ex)} ${f(ey)}" stroke="#e9d7a4" stroke-width="2.4" stroke-linecap="round"/>`;
      s += `<g><title>${generic ? 'Any resource, ' + ratio : RES[hb.type].res + ', ' + ratio}</title><circle cx="${f(cx)}" cy="${f(cy)}" r="${f(cr)}" fill="${col}" stroke="#2a190a" stroke-width="1.4"/><circle cx="${f(cx)}" cy="${f(cy)}" r="${f(cr - 2.6)}" fill="none" stroke="${generic ? '#b69455' : 'rgba(255,248,230,.55)'}" stroke-width=".8"/>`;
      s += generic ? `<text x="${f(cx)}" y="${f(cy + cr * .2)}" text-anchor="middle" font-family="'Crimson Text',Georgia,serif" font-weight="700" font-size="${f(cr * .86)}" fill="${txt}">${esc(ratio)}</text>` :
        glyph(hb.type, cx, cy - cr * .26, cr * .62) + `<text x="${f(cx)}" y="${f(cy + cr * .66)}" text-anchor="middle" font-family="'Crimson Text',Georgia,serif" font-weight="700" font-size="${f(cr * .66)}" fill="${txt}">${esc(ratio)}</text>`;
      s += '</g>';
    });
    b.hexes.forEach((h0) => {
      const h = hexById[h0.id], p = RES[h.resource], n = tokByHex[h.id];
      s += `<g><title>${p.name}${n ? ', ' + n : ''}</title><path d="${hexPath(h.x, h.y, R - .6)}" fill="${p.fill}" stroke="#2a190a" stroke-width="1.6" stroke-linejoin="round"/>`;
      s += glyph(h.resource, h.x, h.y - R * .68, R * .6) + glyph(h.resource, h.x, h.y + R * .7, R * .6);
      if (n) s += token(h.x, h.y, n, tr); if (h0.hasRobber) s += robber(h.x, h.y, R * .72); // robber from hasRobber only (5-6 has 2 deserts)
      s += '</g>';
    });
    return s + '</svg>';
  }

  // ---------------- context: where we are, what size ----------------
  const ST = () => global.ScoreTracker || null;
  function trackerGame() { const st = ST(); const g = st && st.getState ? st.getState().currentGame : null; return g && g.type === 'catan' ? g : null; }
  function onTracker() { return !!(doc.body.classList.contains('theme-catan') && trackerGame()); }
  function context() {
    if (opener === 'tracker' && trackerGame()) { const g = trackerGame(); return { version: g.version || '', players: (g.players || []).length }; }
    const sel = byId('version-select'), meta = byId('v21-cta-meta'), m = meta ? /(\d+)\s+players?/i.exec(meta.textContent || '') : null;
    return { version: sel ? (sel.value || '') : '', players: m ? +m[1] : 0 };
  }
  // size and support are Scoring's calls; '34'/'56' internally, '3-4'/'5-6' on screen
  function sizeFor(ctx) { ctx = ctx || context(); const api = API(); return api && api.sizeFor ? api.sizeFor(ctx.version, ctx.players) : (ctx.players >= 5 ? '56' : '34'); }
  function supported(version) { const api = API(); return api && api.boardSupported ? api.boardSupported(version) : !/seafarer/i.test(version || ''); }
  const sizeLabel = (sz) => (sz === '56' ? '5-6' : '3-4');

  // ---------------- state ----------------
  let state = { mode: 'balanced', board: null };
  let opener = 'setup', lastFocus = null;
  try { const s = JSON.parse(global.localStorage.getItem(STORE) || 'null'); if (s && (s.mode === 'random' || s.mode === 'balanced')) state = { mode: s.mode, board: valid(s.board) ? s.board : null }; } catch (e) { /* private mode: keep defaults */ }
  const save = () => { try { global.localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { /* quota or private mode: board just isn't remembered */ } };

  function layoutClass() {
    const sh = byId('v27-cb-sheet'); if (!sh) return;
    const w = global.innerWidth, h = global.innerHeight;
    const cls = w < 700 ? 'v27-cb-phone' : (w < 1100 && h >= w * .9 ? 'v27-cb-tablet' : 'v27-cb-desk');
    ['v27-cb-phone', 'v27-cb-tablet', 'v27-cb-desk'].forEach((c) => sh.classList.toggle(c, c === cls));
  }
  function paint() {
    const ctx = context(), size = sizeFor(ctx), wrap = byId('v27-cb-board'), err = byId('v27-cb-error');
    byId('v27-cb-eyebrow').textContent = 'Catan  ·  ' + (ctx.players ? ctx.players + (ctx.players === 1 ? ' player' : ' players') + '  ·  ' : '') + sizeLabel(size) + ' board';
    doc.querySelectorAll('#v27-cb-sheet .v27-cb-seg-btn').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === state.mode)));
    byId('v27-cb-help').textContent = HELP[state.mode];
    const cv = byId('v27-cb-code-v'), cd = byId('v27-cb-code');
    if (state.board && valid(state.board)) { wrap.innerHTML = renderSVG(state.board); err.hidden = true; if (cv) cv.textContent = state.board.code; if (cd) cd.hidden = false; }
    else { wrap.innerHTML = ''; err.hidden = false; if (cd) cd.hidden = true; }
  }
  function generate() {
    const api = API(), size = sizeFor();
    try {
      if (!api || typeof api.generateBoard !== 'function') throw new Error('no generator');
      const b = api.generateBoard({ size, mode: state.mode });
      if (!valid(b)) throw new Error('invalid board');
      state.board = b;
    } catch (e) { state.board = null; }
    save(); paint();
  }
  function open(from) {
    if (from === 'tracker' ? !(trackerGame() ? supported(trackerGame().version || '') : true) : !supported(context().version)) return;
    opener = from === 'tracker' ? 'tracker' : 'setup';
    const sh = byId('v27-cb-sheet'); if (!sh) return;
    lastFocus = doc.activeElement;
    if (!state.board || state.board.size !== sizeFor()) generate(); else paint();
    layoutClass(); sh.hidden = false; doc.body.style.overflow = 'hidden';
    const x = byId('v27-cb-close'); if (x) x.focus({ preventScroll: true });
  }
  function close() {
    const sh = byId('v27-cb-sheet'); if (!sh || sh.hidden) return;
    sh.hidden = true; doc.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }
  function setMode(m) { if (m !== 'random' && m !== 'balanced') return; state.mode = m; generate(); }

  // ---------------- entry points ----------------
  function updateRow() {
    const wrap = byId('v27-cb-entry-wrap'), scr = byId('setup-screen'); if (!wrap || !scr) return;
    const ver = (byId('version-select') || {}).value || '';
    const on = scr.dataset.game === 'catan' && supported(ver); wrap.hidden = !on;
    const sub = byId('v27-cb-entry-sub'); if (on && sub) sub.textContent = 'Shuffle the island for this table (' + sizeLabel(sizeFor({ version: ver, players: context().players })) + ' board)';
    if (!on && opener === 'setup') close();
  }
  function mountRow() {
    if (byId('v27-cb-entry-wrap')) return;
    const anchor = byId('v22-house-rules-wrap'), tpl = byId('v27-cb-tpl-row'); if (!anchor || !tpl) return;
    anchor.parentNode.insertBefore(tpl.content.cloneNode(true), anchor.nextSibling);
    byId('v27-cb-entry').addEventListener('click', () => open('setup'));
    const scr = byId('setup-screen'); if (scr) new MutationObserver(updateRow).observe(scr, { attributes: true, attributeFilter: ['data-game', 'class'] });
    const meta = byId('v21-cta-meta'); if (meta) new MutationObserver(updateRow).observe(meta, { childList: true, characterData: true, subtree: true });
    const vs = byId('version-select'); if (vs) vs.addEventListener('change', updateRow);
    updateRow();
  }
  function mountButton() {
    if (byId('v27-cb-board-btn')) return;
    const slot = byId('catan-dice-slot'), tpl = byId('v27-cb-tpl-btn'); if (!slot || !tpl) return;
    slot.appendChild(tpl.content.cloneNode(true));
    byId('v27-cb-board-btn').addEventListener('click', () => open('tracker'));
    updateButton();
    // the tracker re-renders its header per game: re-check Seafarers etc. on any change there
    new MutationObserver(updateButton).observe(slot.parentNode || doc.body, { childList: true, subtree: true, characterData: true });
  }
  function updateButton() {
    const btn = byId('v27-cb-board-btn'), slot = byId('catan-dice-slot'); if (!btn || !slot) return;
    const g = trackerGame(), on = !g || supported(g.version || '');
    if (btn.hidden === !on && slot.classList.contains('v27-cb-has-board') === on) return;
    btn.hidden = !on; slot.classList.toggle('v27-cb-has-board', on);
    if (!on && opener === 'tracker') close();
  }
  function mountSheet() {
    const sh = byId('v27-cb-sheet'); if (!sh || sh.dataset.v27Wired) return; sh.dataset.v27Wired = '1';
    byId('v27-cb-close').addEventListener('click', close);
    byId('v27-cb-scrim').addEventListener('click', close);
    byId('v27-cb-regen').addEventListener('click', generate);
    sh.querySelectorAll('.v27-cb-seg-btn').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
    sh.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key === 'Tab') { // keep focus inside the dialog
        const f2 = [...sh.querySelectorAll('button')].filter((b) => b.offsetParent !== null); if (!f2.length) return;
        const first = f2[0], last = f2[f2.length - 1];
        if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
      }
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && e.target.classList.contains('v27-cb-seg-btn')) { e.preventDefault(); setMode(e.key === 'ArrowLeft' ? 'random' : 'balanced'); const t = sh.querySelector(`.v27-cb-seg-btn[data-mode="${state.mode}"]`); if (t) t.focus(); }
    });
    global.addEventListener('resize', layoutClass);
  }
  // the sheet belongs to Catan: close it when the Catan screen it was opened from goes away
  function watchContext() {
    const obs = new MutationObserver(() => {
      updateButton();
      const sh = byId('v27-cb-sheet'); if (!sh || sh.hidden) return;
      const scr = byId('setup-screen');
      if (opener === 'tracker' ? !onTracker() : !(scr && scr.dataset.game === 'catan')) close();
    });
    obs.observe(doc.body, { attributes: true, attributeFilter: ['class'] });
    const scr = byId('setup-screen'); if (scr) obs.observe(scr, { attributes: true, attributeFilter: ['data-game'] });
  }
  function init() { mountSheet(); mountRow(); mountButton(); watchContext(); layoutClass(); }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init); else init();

  global.TallyItV27CatanBoard = { open, close, regenerate: generate, setMode, sizeFor, renderSVG, isValidBoard: valid, getState: () => JSON.parse(JSON.stringify(state)) };
})(window);
