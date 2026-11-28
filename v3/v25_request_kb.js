/* TallyIt v25 polish - Request a Game: keyboard-safe sheet (window.TallyItV25RequestKb).
   - never autofocuses a field when the sheet opens (the keyboard used to cover the Submit button)
   - Submit lives in a sticky footer; while an input is focused the sheet is lifted above the keyboard using
     window.visualViewport (offset = innerHeight - visualViewport.height - visualViewport.offsetTop) and the field is scrolled into view
   - Enter / Go submits through the existing <form> submit handler (enterkeyhint="send"); duplicate submits are ignored */
(function (global) {
  'use strict';
  var doc = global.document, modal = null, bound = false, busyTimer = 0, lastKb = 0;
  var $ = function (id) { return doc.getElementById(id); };

  function prep() {
    ['req-game-name', 'req-game-url', 'req-game-email'].forEach(function (id) {
      var el = $(id); if (!el) return;
      el.removeAttribute('autofocus'); el.setAttribute('enterkeyhint', 'send');
    });
    var n = $('req-game-name'); if (n) { n.setAttribute('autocapitalize', 'words'); n.setAttribute('autocorrect', 'off'); }
    var u = $('req-game-url'); if (u) { u.setAttribute('inputmode', 'url'); u.setAttribute('autocapitalize', 'off'); }
    var b = $('btn-submit-game-request'), form = $('req-game-form');
    if (b && form && !(b.parentNode && b.parentNode.classList.contains('v25-rkb-foot'))) {
      var foot = doc.createElement('div'); foot.className = 'v25-rkb-foot';
      b.parentNode.insertBefore(foot, b); foot.appendChild(b);
    }
  }
  function isOpen() { return !!modal && !modal.hidden && !modal.classList.contains('hidden'); }
  function update() {
    if (!modal) return;
    var vv = global.visualViewport;
    if (!vv) { modal.style.removeProperty('--v25-rkb-kb'); modal.style.removeProperty('--v25-rkb-max'); return; }
    var kb = Math.max(0, Math.round(global.innerHeight - vv.height - vv.offsetTop));
    lastKb = kb;
    modal.style.setProperty('--v25-rkb-kb', kb + 'px');
    modal.style.setProperty('--v25-rkb-max', Math.max(240, Math.round(vv.height - 24)) + 'px');
  }
  function reveal(el) {
    update();
    var foot = modal && modal.querySelector('.v25-rkb-foot');
    try { if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (_) {}
    try { if (foot && foot.scrollIntoView) foot.scrollIntoView({ block: 'nearest' }); } catch (_) {}
  }
  function onFocusIn(e) {
    if (!isOpen() || !modal.contains(e.target) || !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    var el = e.target; reveal(el); setTimeout(function () { if (isOpen()) reveal(doc.activeElement === el ? el : null); }, 320);
  }
  function onSubmitCapture(e) {
    var form = $('req-game-form'); if (!form || e.target !== form) return;
    if (form.dataset.v25Busy === '1') { e.preventDefault(); e.stopImmediatePropagation(); return; }
    form.dataset.v25Busy = '1'; clearTimeout(busyTimer);
    busyTimer = setTimeout(function () { form.dataset.v25Busy = ''; }, 900);
  }
  function bind() {
    if (bound) return; bound = true;
    if (global.visualViewport) { global.visualViewport.addEventListener('resize', update); global.visualViewport.addEventListener('scroll', update); }
    global.addEventListener('resize', update); doc.addEventListener('focusin', onFocusIn, true);
  }
  function unbind() {
    if (!bound) return; bound = false;
    if (global.visualViewport) { global.visualViewport.removeEventListener('resize', update); global.visualViewport.removeEventListener('scroll', update); }
    global.removeEventListener('resize', update); doc.removeEventListener('focusin', onFocusIn, true);
    if (modal) { modal.style.removeProperty('--v25-rkb-kb'); modal.style.removeProperty('--v25-rkb-max'); }
    var form = $('req-game-form'); if (form) form.dataset.v25Busy = '';
  }
  function sync() {
    if (isOpen()) {
      prep(); bind(); update();
      var a = doc.activeElement; if (a && modal.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) a.blur();
    } else unbind();
  }
  function init() {
    modal = $('req-game-modal'); if (!modal) return;
    prep();
    doc.addEventListener('submit', onSubmitCapture, true);
    if (global.MutationObserver) new MutationObserver(sync).observe(modal, { attributes: true, attributeFilter: ['hidden', 'class'] });
    sync();
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init, { once: true }); else init();
  global.TallyItV25RequestKb = { update: update, isOpen: isOpen, keyboardHeight: function () { return lastKb; } };
})(window);
