/* TallyIt v21 controller (window.TallyItV21): universal End / Leave Game sheet shared by EVERY game screen.
   Save & Finish -> endGame() (History + leaderboards, session removed)
   Keep Open (Pause) -> pauseGame() (stays in Home "In Progress")
   End Without Recording -> 2-tap guard -> discardGame() (never touches History / saveData / shareFinishedGame) */
(function (global) {
  'use strict';
  const byId = (id) => document.getElementById(id);
  const DISCARD_TITLE = 'End Without Recording', DISCARD_DESC = 'Discard this game without saving to History';
  const CONFIRM_TITLE = 'Tap again to discard without saving', CONFIRM_DESC = 'This game will not be recorded anywhere';
  let confirmTimer = null, lastFocus = null;

  function setHidden(el, hide) { if (!el) return; el.hidden = !!hide; el.classList.toggle('hidden', !!hide); }
  function state() { try { return global.ScoreTracker && global.ScoreTracker.getState ? global.ScoreTracker.getState() : null; } catch (_) { return null; } }
  function gameName(g) {
    const games = (global.ScoreTracker && global.ScoreTracker.GAMES) || [];
    const m = games.find((x) => x.id === g.type);
    return m ? m.name : 'Game';
  }
  function roundsOf(g) {
    if (g.type === '7wonders') return null;
    return Array.isArray(g.rounds) ? g.rounds.length : 0;
  }
  function summary(g) {
    const n = (g.players || []).length, teams = g.type === 'nertz' && g.nertzMode === 'teams';
    const parts = [`${n} ${teams ? (n === 1 ? 'team' : 'teams') : (n === 1 ? 'player' : 'players')}`];
    const r = roundsOf(g);
    if (r) parts.push(`${r} ${r === 1 ? 'round' : 'rounds'} scored`);
    return parts.join(' · ');
  }
  function resetDiscard() {
    clearTimeout(confirmTimer); confirmTimer = null;
    const b = byId('btn-v21-end-discard'); if (!b) return;
    b.classList.remove('is-confirming'); b.dataset.confirmStep = '0';
    const t = byId('v21-discard-title'), d = byId('v21-discard-desc');
    if (t) t.textContent = DISCARD_TITLE; if (d) d.textContent = DISCARD_DESC;
  }
  function isOpen() { const m = byId('v21-end-game-modal'); return !!(m && !m.hidden); }

  function openEndGameModal() {
    const s = state(), g = s && s.currentGame;
    const m = byId('v21-end-game-modal');
    if (!g || !m) return false;
    const t = byId('v21-end-game-title'), sub = byId('v21-end-game-sub');
    if (t) t.textContent = 'Finish or Leave ' + gameName(g) + '?';
    if (sub) sub.textContent = summary(g);
    resetDiscard();
    lastFocus = document.activeElement;
    setHidden(m, false);
    document.documentElement.classList.add('v21-sheet-open');
    const first = byId('btn-v21-end-save'); if (first && first.focus) { try { first.focus({ preventScroll: true }); } catch (_) {} }
    return true;
  }
  function closeEndGameModal() {
    const m = byId('v21-end-game-modal');
    resetDiscard();
    setHidden(m, true);
    document.documentElement.classList.remove('v21-sheet-open');
    if (lastFocus && lastFocus.isConnected && lastFocus.focus) { try { lastFocus.focus({ preventScroll: true }); } catch (_) {} }
    lastFocus = null;
  }
  function v21ConfirmSaveAndFinish() {
    lastFocus = null; closeEndGameModal();
    return typeof global.endGame === 'function' ? global.endGame() : null;
  }
  function v21KeepOpenAndLeave() {
    lastFocus = null; closeEndGameModal();
    return typeof global.pauseGame === 'function' ? global.pauseGame() : null;
  }
  function v21DiscardWithoutSaving() {
    const b = byId('btn-v21-end-discard');
    if (b && b.dataset.confirmStep !== '1') {
      b.dataset.confirmStep = '1'; b.classList.add('is-confirming');
      const t = byId('v21-discard-title'), d = byId('v21-discard-desc');
      if (t) t.textContent = CONFIRM_TITLE; if (d) d.textContent = CONFIRM_DESC;
      clearTimeout(confirmTimer); confirmTimer = setTimeout(resetDiscard, 4000);
      return false;
    }
    lastFocus = null; closeEndGameModal();
    return typeof global.discardGame === 'function' ? global.discardGame() : false;
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen()) closeEndGameModal(); });

  const api = { openEndGameModal, closeEndGameModal, v21ConfirmSaveAndFinish, v21KeepOpenAndLeave, v21DiscardWithoutSaving, isEndGameModalOpen: isOpen };
  global.TallyItV21 = api;
  Object.assign(global, { openEndGameModal, closeEndGameModal, v21ConfirmSaveAndFinish, v21KeepOpenAndLeave, v21DiscardWithoutSaving });
})(window);
