/* ==========================================================================
   TallyIt v25 - Spoons UI (window.SpoonsUI). Kitchen Table Linen.
   Renders #sp-shell (spoons_markup.html) from window.TallyItSpoons (spoons_scoring.js, loaded first).

   UI CONTRACT (what this file reads / calls on window.TallyItSpoons)
   ------------------------------------------------------------------
   getState() -> null | {
       gameId: 'spoons',
       round: number,                         // round being played (1-based)
       players: [{ id:'p0', name, userId|null, outRound:number|null, place:number }],   // seat order
       history: [{ round:number, outPlayerId:'pN' }],                                   // one entry per knock-out, undone entries removed
       winnerId: 'pN' | null,                 // set as soon as one player is left
       isGameOver: boolean,
       canUndo: boolean }
   knockOut(playerId)   card tap: that player is out for the current round (throws if already out / game over)
   undo()               reverses the last knock-out (throws when nothing to undo)
   finishAndSave({save?}) -> Promise<record>   builds the standard record, hands it to opts.save or window.TallyItSaveGame,
                                              clears the active game; throws unless exactly one player remains
   Events on document: 'tallyit:spoons-change' (detail = getState(), also fired with null after save/reset)
                       'tallyit:spoons-saved'  (detail = record)

   WHAT THIS FILE EXPOSES: window.SpoonsUI = { render(), knockOut(id), undo(), finish(), toggleHistory() }
   The engine calls SpoonsUI.render() whenever the Spoons screen is shown; the UI re-renders itself on every change event.
   Finish & Save passes window.TallyItSaveGame (defined by the engine) so the game lands in History like every other game.
   No letters, no stepper, no emojis. Names are inserted with textContent (never innerHTML).
   ========================================================================== */
(function (global) {
  'use strict';

  var doc = global.document;
  var historyOpen = false;
  var msgTimer = null;
  var lastOutId = null;

  function api() { return global.TallyItSpoons || null; }
  function $(id) { return doc.getElementById(id); }
  function el(tag, cls, text) { var e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function icon(id, cls) {
    var s = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('class', 'sp-ico' + (cls ? ' ' + cls : '')); s.setAttribute('aria-hidden', 'true');
    var u = doc.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', '#' + id); s.appendChild(u); return s;
  }
  function initial(name) { var m = String(name || '').trim().match(/[A-Za-z0-9]/); return m ? m[0] : '?'; }
  function ordinal(n) { var v = n % 100; if (v >= 11 && v <= 13) return n + 'th'; return n + ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'); }
  function visible() { var s = $('sp-shell'); return !!(s && s.offsetParent !== null); }

  function showMsg(text) {
    var m = $('sp-msg'); if (!m) return;
    if (msgTimer) { clearTimeout(msgTimer); msgTimer = null; }
    if (!text) { m.hidden = true; m.textContent = ''; return; }
    m.textContent = text; m.hidden = false;
    msgTimer = setTimeout(function () { m.hidden = true; }, 4000);
  }

  function renderEmpty() {
    var list = $('sp-list'); if (!list) return;
    list.textContent = '';
    var e = el('div', 'sp-h-empty', 'No Spoons game in progress. Start one from Play.');
    list.appendChild(e);
    $('sp-round').textContent = 'Round 1';
    $('sp-winner').hidden = true; $('sp-prompt').hidden = false;
    ['sp-btn-undo', 'sp-btn-undo-top', 'sp-btn-finish'].forEach(function (id) { var b = $(id); if (b) b.disabled = true; });
    $('sp-history-list').textContent = ''; $('sp-history-count').textContent = '0 rounds';
  }

  function render() {
    if (!doc || !$('sp-shell')) return;
    var A = api(), st = A ? A.getState() : null;
    if (!st) { renderEmpty(); return; }
    var byId = {}; st.players.forEach(function (p) { byId[p.id] = p; });
    var left = st.players.filter(function (p) { return p.outRound == null; }).length;
    var winner = st.winnerId ? byId[st.winnerId] : null;

    $('sp-round').textContent = st.isGameOver ? 'Round ' + st.round + ' - Final' : 'Round ' + st.round;
    $('sp-prompt').hidden = !!st.isGameOver;
    $('sp-q').textContent = 'Who missed the spoon?';
    $('sp-hint').textContent = left + ' of ' + st.players.length + ' still in. Tap a player to knock them out.';
    var wb = $('sp-winner'); wb.hidden = !st.isGameOver;
    if (st.isGameOver && winner) {
      $('sp-win-name').textContent = winner.name + ' wins';
      $('sp-win-sub').textContent = 'Won after ' + st.history.length + (st.history.length === 1 ? ' round' : ' rounds') + '. Save the game to add it to History.';
    }

    var list = $('sp-list'); list.textContent = '';
    st.players.forEach(function (p) {
      var out = p.outRound != null, isWin = !!(winner && winner.id === p.id);
      var card = el('button', 'sp-card' + (out ? ' is-out' : '') + (isWin ? ' is-winner' : '') + (st.isGameOver ? ' is-final' : '') + (lastOutId === p.id ? ' is-just-out' : ''));
      card.type = 'button'; card.setAttribute('role', 'listitem'); card.dataset.id = p.id;
      var locked = out || st.isGameOver;
      card.disabled = locked;
      card.setAttribute('aria-label', out ? p.name + ', out in round ' + p.outRound : (isWin ? p.name + ', winner' : 'Knock out ' + p.name));
      card.appendChild(el('span', 'sp-seat', initial(p.name)));
      var body = el('span', 'sp-card-body');
      body.appendChild(el('span', 'sp-name', p.name));
      if (out) body.appendChild(el('span', 'sp-sub', 'Finished ' + ordinal(p.place)));
      else if (isWin) body.appendChild(el('span', 'sp-sub', 'Winner'));
      else body.appendChild(el('span', 'sp-sub', 'Still in'));
      card.appendChild(body);
      if (out) card.appendChild(el('span', 'sp-out-pill', 'Out in round ' + p.outRound));
      else { var tag = el('span', 'sp-tag'); tag.appendChild(icon('sp-ico-spoon')); card.appendChild(tag); }
      if (!locked) card.addEventListener('click', function () { knockOut(p.id); });
      list.appendChild(card);
    });
    lastOutId = null;

    var undo = $('sp-btn-undo'), undoTop = $('sp-btn-undo-top'), fin = $('sp-btn-finish');
    if (undo) undo.disabled = !st.canUndo;
    if (undoTop) undoTop.disabled = !st.canUndo;
    if (fin) fin.disabled = !st.isGameOver;

    var hl = $('sp-history-list'); hl.textContent = '';
    $('sp-history-count').textContent = st.history.length + (st.history.length === 1 ? ' round' : ' rounds');
    if (!st.history.length) hl.appendChild(el('li', 'sp-h-empty', 'No one is out yet.'));
    st.history.slice().reverse().forEach(function (h) {
      var who = byId[h.outPlayerId], li = el('li', 'sp-h-row');
      li.appendChild(el('span', 'sp-h-round', 'Round ' + h.round));
      var w = el('span', 'sp-h-who'); w.appendChild(el('b', null, who ? who.name : '?')); w.appendChild(doc.createTextNode(' went out'));
      li.appendChild(w); hl.appendChild(li);
    });
    var hs = $('sp-history'), hb = $('sp-btn-history');
    if (hs) hs.hidden = !historyOpen;
    if (hb) hb.setAttribute('aria-expanded', String(historyOpen));
  }

  function knockOut(id) {
    var A = api(); if (!A) return;
    try { lastOutId = id; A.knockOut(id); showMsg(''); }
    catch (e) { lastOutId = null; showMsg(e && e.message ? e.message : 'Could not knock that player out.'); }
  }
  function undo() {
    var A = api(); if (!A) return;
    try { A.undo(); showMsg(''); } catch (e) { showMsg(e && e.message ? e.message : 'Nothing to undo.'); }
  }
  function finish() {
    var A = api(); if (!A) return;
    var btn = $('sp-btn-finish'); if (btn) btn.disabled = true;
    Promise.resolve().then(function () { return A.finishAndSave({ save: global.TallyItSaveGame }); })
      .catch(function (e) { showMsg(e && e.message ? e.message : 'Could not save the game.'); render(); });
  }
  function toggleHistory() { historyOpen = !historyOpen; render(); }

  if (doc) doc.addEventListener('tallyit:spoons-change', function () { if (visible()) render(); });

  global.SpoonsUI = { render: render, knockOut: knockOut, undo: undo, finish: finish, toggleHistory: toggleHistory };
})(typeof window !== 'undefined' ? window : globalThis);
