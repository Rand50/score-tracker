/* TallyIt v26.2: one uniform Leave / Log / Delete control bar for EVERY game's scoring screen, plus iPhone standalone
   safe-area fallback.
   Leave  -> Play (the game stays in In Progress, nothing is lost)           [same as the old per-game Play/Games buttons]
   Log    -> the universal End Game sheet (Save & Finish writes History; Keep Open; Discard) [same as the old per-game End/Finish]
   Delete -> its own confirm sheet, then discardGame() (never touches History) */
(function (global) {
  'use strict';
  var doc = document, root = doc.documentElement;
  function byId(id) { return doc.getElementById(id); }
  function st() { try { return global.ScoreTracker && global.ScoreTracker.getState ? global.ScoreTracker.getState() : null; } catch (_) { return null; } }
  function cur() { var s = st(); return s && s.currentGame ? s.currentGame : null; }
  function gameName(g) {
    var games = (global.ScoreTracker && global.ScoreTracker.GAMES) || [];
    for (var i = 0; i < games.length; i++) if (games[i].id === g.type) return games[i].name;
    return 'Game';
  }
  function activeViewId() { var v = doc.querySelector('#app-shell .view.active'); return v ? v.id : ''; }
  function wanted() { return activeViewId() === 'view-active' && !!cur(); }

  var raf = 0;
  function sync() {
    raf = 0;
    var on = wanted(), bar = byId('v262-ctl');
    if (!bar) return;
    bar.hidden = !on;
    root.classList.toggle('v262-ctl-on', on);
    if (on) { var g = cur(); bar.setAttribute('data-game', g.type || ''); }
    else if (!byId('v262-del-modal').hidden) closeDelete();
  }
  function schedule() { if (!raf) raf = global.requestAnimationFrame ? global.requestAnimationFrame(sync) : global.setTimeout(sync, 16); }

  function leave() { if (typeof global.showView === 'function') global.showView('new'); }
  function log() { if (typeof global.openEndGameModal === 'function') global.openEndGameModal(); }
  function askDelete() {
    var g = cur(), m = byId('v262-del-modal'); if (!g || !m) return false;
    var n = (g.players || []).length, r = Array.isArray(g.rounds) ? g.rounds.length : 0;
    var bits = [gameName(g), n + (n === 1 ? ' player' : ' players')];
    if (r) bits.push(r + (r === 1 ? ' round' : ' rounds'));
    byId('v262-del-title').textContent = 'Delete ' + gameName(g) + '?';
    byId('v262-del-sub').textContent = bits.join(' \u00b7 ') + '. It will be discarded and will not be saved to History.';
    m.setAttribute('data-game', g.type || '');
    m.hidden = false; root.classList.add('v262-sheet-open');
    var c = byId('v262-del-cancel'); if (c && c.focus) { try { c.focus({ preventScroll: true }); } catch (_) {} }
    return true;
  }
  function closeDelete() { var m = byId('v262-del-modal'); if (m) m.hidden = true; root.classList.remove('v262-sheet-open'); }
  function confirmDelete() { closeDelete(); return typeof global.discardGame === 'function' ? global.discardGame() : false; }
  doc.addEventListener('keydown', function (e) { var m = byId('v262-del-modal'); if (e.key === 'Escape' && m && !m.hidden) closeDelete(); });

  // ---- safe-area fallback: an iPhone Home Screen web app whose env(safe-area-inset-*) reads 0 would draw under the status bar ----
  function probe(side) {
    var d = doc.createElement('div');
    d.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding-' + side + ':env(safe-area-inset-' + side + ',0px)';
    doc.body.appendChild(d); var v = parseFloat(getComputedStyle(d)['padding' + (side === 'top' ? 'Top' : 'Bottom')]) || 0; d.remove(); return v;
  }
  function safeAreaFallback() {
    var standalone = (global.navigator && global.navigator.standalone === true) || (global.matchMedia && global.matchMedia('(display-mode: standalone)').matches);
    var iphone = /iPhone/.test(global.navigator.userAgent || '');
    var portrait = global.innerHeight > global.innerWidth;
    var needTop = 0, needBottom = 0;
    if (standalone && iphone && portrait) {
      if (probe('top') < 20) needTop = 50;
      if (probe('bottom') < 10) needBottom = 0; // leave the home-indicator inset to the system; only the top has a known failure mode
    }
    root.style.setProperty('--tt-sat-fb', needTop + 'px');
    root.style.setProperty('--tt-sab-fb', needBottom + 'px');
    root.classList.toggle('v262-sat-fallback', needTop > 0);
  }

  function init() {
    var shell = byId('app-shell'); if (!shell || !byId('v262-ctl')) return;
    var mo = new MutationObserver(schedule);
    mo.observe(shell, { subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });
    mo.observe(doc.body, { attributes: true, attributeFilter: ['class'] });
    doc.addEventListener('click', schedule, true);
    global.addEventListener('pageshow', schedule);
    safeAreaFallback();
    global.addEventListener('resize', safeAreaFallback); global.addEventListener('orientationchange', safeAreaFallback);
    sync();
  }
  global.TallyItV262 = { leave: leave, log: log, askDelete: askDelete, closeDelete: closeDelete, confirmDelete: confirmDelete, sync: sync, safeAreaFallback: safeAreaFallback };
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init); else init();
})(window);
