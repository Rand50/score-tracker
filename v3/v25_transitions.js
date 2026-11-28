/* TallyIt v25 polish - smooth page transitions (window.TallyItV25Fx).
   engine.js calls TallyItV25Fx.wrap(fn) around every view / setup-step change. wrap() stays synchronous:
   it runs fn, tints the backdrop, then (only when the page surface really changed) paints a curtain in the destination
   colour (plus a faint trace of the outgoing surface) over the swap frame and fades it out (~280ms) so the new view dissolves in.
   Destination colour is always painted in the same frame as the swap (no black flash).
   prefers-reduced-motion: instant swap (class v25-fx-reduced), still no flash. */
(function (global) {
  'use strict';
  var MS = 280, DARK = [12, 13, 16];
  var depth = 0, reduced = false, veil = null, veilTimer = 0, mql = null;
  var root = document.documentElement;

  function byId(id) { return document.getElementById(id); }
  function parse(c) {
    c = String(c || '').trim(); var m;
    if ((m = /^#([0-9a-f]{3})$/i.exec(c))) return [parseInt(m[1][0] + m[1][0], 16), parseInt(m[1][1] + m[1][1], 16), parseInt(m[1][2] + m[1][2], 16), 1];
    if ((m = /^#([0-9a-f]{6})$/i.exec(c))) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16), 1];
    if ((m = /^rgba?\(([^)]+)\)$/i.exec(c))) { var p = m[1].split(/[ ,\/]+/).filter(Boolean).map(parseFloat); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; }
    return null;
  }
  function mix(a, b, t) { return 'rgb(' + [0, 1, 2].map(function (i) { return Math.round(a[i] * (1 - t) + b[i] * t); }).join(',') + ')'; }

  function setupVisible() {
    var vn = byId('view-new'), sc = byId('setup-screen');
    return !!(vn && sc && vn.classList.contains('active') && vn.dataset.v21Step === 'setup' && /setup-theme-/.test(sc.className));
  }
  // Effective surface behind the content: Setup panel (when on the Setup step) or the body (themed or neutral).
  function surface() {
    var el = setupVisible() ? byId('setup-screen') : document.body, cs = getComputedStyle(el), v = '';
    if (el === document.body) v = cs.getPropertyValue('--v25-bg'); else v = cs.getPropertyValue('--st-bg');
    var color = cs.backgroundColor, p = parse(color);
    if ((!p || p[3] === 0) && v) color = v.trim();
    return {
      key: (el === document.body ? 'b:' : 's:') + document.body.className + '|' + (el.dataset ? el.dataset.game || '' : ''),
      color: color, flat: parse(v) ? v.trim() : color,
      image: cs.backgroundImage, size: cs.backgroundSize, pos: cs.backgroundPosition, repeat: cs.backgroundRepeat
    };
  }

  // Tint the dark body toward the Setup game's table colour so dark and light never butt up (bg var read generically).
  function syncTint() {
    var b = document.body, on = setupVisible();
    if (on) {
      var st = parse(getComputedStyle(byId('setup-screen')).getPropertyValue('--st-bg'));
      if (st) { root.style.setProperty('--v25-fx-edge', mix(DARK, st, 0.2)); root.style.setProperty('--v25-fx-bg', mix(DARK, st, 1)); }
    } else {
      var v = getComputedStyle(b).getPropertyValue('--v25-bg').trim();
      root.style.setProperty('--v25-fx-bg', v || getComputedStyle(b).backgroundColor);
    }
    if (b.classList.contains('v25-fx-tinted') !== on) b.classList.toggle('v25-fx-tinted', on);
  }

  function removeVeil() { if (veil && veil.parentNode) veil.parentNode.removeChild(veil); veil = null; clearTimeout(veilTimer); }
  function paint(el, sf) {
    el.style.backgroundColor = sf.flat;
    if (sf.image && sf.image !== 'none') { el.style.backgroundImage = sf.image; el.style.backgroundSize = sf.size; el.style.backgroundPosition = sf.pos; el.style.backgroundRepeat = sf.repeat; }
  }
  // Curtain painted in the swap frame: the DESTINATION surface (never black) with a faint trace of the outgoing one,
  // faded away over ~280ms so the new view dissolves in instead of cutting.
  function curtain(prev, next) {
    removeVeil();
    var v = document.createElement('div'); v.id = 'v25-fx-veil'; v.setAttribute('aria-hidden', 'true');
    paint(v, next);
    var g = document.createElement('div'); g.className = 'v25-fx-ghost'; paint(g, prev); v.appendChild(g);
    v.style.setProperty('--v25-fx-ms', MS + 'ms');
    document.body.appendChild(v); veil = v;
    v.addEventListener('animationend', removeVeil); veilTimer = setTimeout(removeVeil, MS + 220);
  }
  function differs(a, b) {
    var p = parse(a.flat), q = parse(b.flat); if (!p || !q) return a.color !== b.color;
    return Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]) > 24;
  }

  function wrap(fn) {
    if (depth > 0 || !document.body) { depth++; try { return fn(); } finally { depth--; } }
    var before = null; try { before = surface(); } catch (_) {}
    var res; depth++; try { res = fn(); } finally { depth--; }
    try {
      syncTint();
      if (before && !reduced) { var after = surface(); if (differs(before, after)) curtain(before, after); }
    } catch (_) {}
    return res;
  }

  function setReduced(on) { reduced = !!on; root.classList.toggle('v25-fx-reduced', reduced); if (reduced) removeVeil(); }
  try { mql = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)'); } catch (_) {}
  if (mql) { setReduced(mql.matches); var ch = function (e) { setReduced(e.matches); }; if (mql.addEventListener) mql.addEventListener('change', ch); else if (mql.addListener) mql.addListener(ch); }

  // Keep the tint right even for paths that never go through wrap() (auth sign-out, direct class edits).
  function observe() {
    if (!global.MutationObserver) return;
    var mo = new MutationObserver(function () { if (!depth) { try { syncTint(); } catch (_) {} } });
    var vn = byId('view-new'), sc = byId('setup-screen');
    if (vn) mo.observe(vn, { attributes: true, attributeFilter: ['class', 'data-v21-step'] });
    if (sc) mo.observe(sc, { attributes: true, attributeFilter: ['class', 'data-game'] });
    mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observe, { once: true }); else observe();

  global.TallyItV25Fx = { wrap: wrap, syncTint: syncTint, duration: MS, isReduced: function () { return reduced; }, _surface: surface };
})(window);
