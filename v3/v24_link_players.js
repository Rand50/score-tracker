/* TallyIt v24 — Link Players After a Game + Claim Flow (UI controller).
   Pure UI: all persistence goes through a backend adapter set with V24Link.setBackend({...}).
   Adapter contract (all may return Promises):
     getGame(gameId)                       -> { id, label, date, createdBy, players:[{ name, userId?, claimStatus?: 'linked'|'pending'|null }] }
     getFriends()                          -> [{ userId, displayName, friendCode? }]
     getCurrentUserId()                    -> string|null
     assignToFriend(gameId, playerName, friendUserId) -> { ok:true } | throws
     createClaim(gameId, playerName)       -> { code, url, expiresAt? }
     revokeClaim(code)                     -> { ok:true }
     lookupClaim(code)                     -> [{ claimId, gameId, label, date, playerName }]
     getSuggestions()                      -> [{ claimId?, gameId, label, date, playerName }]   (guest names that match the signed-in user)
     confirmClaims(items)                  -> { ok:true, claimed:n }
     onLinked?(gameId)                     -> called after any successful link/claim so the app can re-render History
*/
(function (global) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const initials = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '?';
  const ICON_CHEV = '<svg class="v24-row-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>';
  const ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="5 12.5 10 17 19 7.5"/></svg>';
  const ICON_LINK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2"/></svg>';
  const ICON_GUEST = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6"/></svg>';

  let backend = null;
  const st = { game: null, player: null, friends: [], claim: null, claimItems: [], picked: new Set(), dismissed: false };

  function show(el, on) { if (el) el.hidden = !on; }
  function status(id, msg, isError) { const el = $(id); if (!el) return; el.textContent = msg || ''; el.classList.toggle('is-error', !!isError); el.hidden = !msg; }
  function step(name) { ['players', 'assign', 'claim'].forEach((s) => show($('v24-step-' + s), s === name)); status('v24-link-status', ''); }
  async function call(fn, ...args) { if (!backend || typeof backend[fn] !== 'function') throw new Error('Linking is not available yet.'); return backend[fn](...args); }

  /* ---------- History trigger ---------- */
  function renderLinkButton(game) {
    if (!game || !backend) return '';
    const uid = backend.getCurrentUserId ? backend.getCurrentUserId() : null;
    if (!uid || !game.createdBy || String(game.createdBy) !== String(uid)) return '';
    const guests = (game.players || []).filter((p) => !p.userId && p.claimStatus !== 'linked').length;
    if (!guests) return '';
    return `<button type="button" class="v24-link-trigger" data-v24-game="${esc(game.id)}" onclick="V24Link.openLinkSheet('${esc(game.id)}')">${ICON_LINK}<span>Link players</span><span class="v24-link-count">${guests}</span></button>`;
  }

  /* ---------- Link sheet (creator) ---------- */
  async function openLinkSheet(gameId) {
    try {
      st.game = await call('getGame', gameId);
      if (!st.game) return;
      $('v24-link-game').textContent = [st.game.label, st.game.date].filter(Boolean).join(' · ');
      renderPlayers(); step('players'); show($('v24-link-sheet'), true);
    } catch (e) { alert(e.message || 'Could not open this game.'); }
  }
  function closeLinkSheet() { show($('v24-link-sheet'), false); st.game = null; st.player = null; st.claim = null; }
  function renderPlayers() {
    const uid = backend && backend.getCurrentUserId ? backend.getCurrentUserId() : null;
    $('v24-player-list').innerHTML = (st.game.players || []).map((p, i) => {
      const you = p.userId && uid && String(p.userId) === String(uid);
      const linked = !!p.userId || p.claimStatus === 'linked';
      const pill = you ? '<span class="v24-pill v24-pill-you">You</span>'
        : linked ? '<span class="v24-pill v24-pill-linked">Linked</span>'
        : p.claimStatus === 'pending' ? '<span class="v24-pill v24-pill-pending">Link sent</span>'
        : '<span class="v24-pill v24-pill-guest">Guest</span>';
      return `<button type="button" class="v24-row" role="listitem" ${linked ? 'disabled' : `onclick="V24Link.pickPlayer(${i})"`}>
        <span class="v24-avatar${linked ? '' : ' v24-avatar-guest'}" aria-hidden="true">${linked ? esc(initials(p.name)) : ICON_GUEST}</span>
        <span class="v24-row-main"><span class="v24-row-name">${esc(p.name)}</span></span>${pill}${linked ? '' : ICON_CHEV}</button>`;
    }).join('');
  }
  async function pickPlayer(i) {
    st.player = (st.game.players || [])[i]; if (!st.player) return;
    $('v24-assign-name').textContent = st.player.name;
    $('v24-friend-search').value = '';
    try { st.friends = (await call('getFriends')) || []; } catch (_) { st.friends = []; }
    filterFriends(''); step('assign');
  }
  function filterFriends(q) {
    const needle = String(q || '').trim().toLowerCase();
    const taken = new Set((st.game.players || []).filter((p) => p.userId).map((p) => String(p.userId)));
    const list = st.friends.filter((f) => !taken.has(String(f.userId)) && (!needle || String(f.displayName || '').toLowerCase().includes(needle) || String(f.friendCode || '').toLowerCase().includes(needle)));
    $('v24-friend-list').innerHTML = list.map((f) => `<button type="button" class="v24-row" role="listitem" onclick="V24Link.assignFriend('${esc(f.userId)}')">
      <span class="v24-avatar" aria-hidden="true">${esc(initials(f.displayName))}</span>
      <span class="v24-row-main"><span class="v24-row-name">${esc(f.displayName || 'Friend')}</span>${f.friendCode ? `<span class="v24-row-sub">${esc(f.friendCode)}</span>` : ''}</span>${ICON_CHEV}</button>`).join('');
    show($('v24-friend-empty'), !list.length);
  }
  async function assignFriend(friendUserId) {
    const f = st.friends.find((x) => String(x.userId) === String(friendUserId));
    if (!st.player || !f) return;
    if (!confirm(`Link ${st.player.name} in this game to ${f.displayName}?`)) return;
    try {
      await call('assignToFriend', st.game.id, st.player.name, f.userId);
      st.player.userId = f.userId; st.player.claimStatus = 'linked';
      renderPlayers(); step('players'); status('v24-link-status', `${st.player.name} is now linked to ${f.displayName}.`);
      if (backend.onLinked) backend.onLinked(st.game.id);
    } catch (e) { status('v24-link-status', e.message || 'Could not link that player.', true); }
  }
  async function createClaim() {
    if (!st.player) return;
    try {
      st.claim = await call('createClaim', st.game.id, st.player.name);
      st.player.claimStatus = 'pending';
      $('v24-claim-for').textContent = st.player.name;
      $('v24-claim-code').textContent = st.claim.code || '';
      $('v24-claim-url').value = st.claim.url || '';
      const canRevoke = !!(backend && typeof backend.revokeClaim === 'function');
      show($('v24-btn-revoke'), canRevoke);
      if (st.claim.expiresAt) $('v24-claim-expiry').textContent = `Link expires ${new Date(st.claim.expiresAt).toLocaleDateString()}.` + (canRevoke ? ' You can revoke it anytime.' : ' It works once, for one person.');
      step('claim');
    } catch (e) { status('v24-link-status', e.message || 'Could not create a claim link.', true); }
  }
  async function copyClaim() {
    const txt = (st.claim && (st.claim.url || st.claim.code)) || '';
    try { await navigator.clipboard.writeText(txt); status('v24-link-status', 'Copied.'); }
    catch (_) { const el = $('v24-claim-url'); el.select(); try { document.execCommand('copy'); status('v24-link-status', 'Copied.'); } catch (__) {} }
  }
  async function shareClaim() {
    if (!st.claim) return;
    const text = `I added you to a ${st.game.label || 'game'} on TallyIt. Claim it with code ${st.claim.code}`;
    if (navigator.share) { try { await navigator.share({ title: 'TallyIt game', text, url: st.claim.url }); } catch (_) {} }
    else copyClaim();
  }
  async function revokeClaim() {
    if (!st.claim || !confirm('Revoke this claim link?')) return;
    try { await call('revokeClaim', st.claim.code); st.player.claimStatus = null; st.claim = null; renderPlayers(); step('players'); status('v24-link-status', 'Link revoked.'); }
    catch (e) { status('v24-link-status', e.message || 'Could not revoke.', true); }
  }
  function backToPlayers() { renderPlayers(); step('players'); }

  /* ---------- Claim sheet (newly signed-in player) ---------- */
  function renderClaimItems() {
    const items = st.claimItems;
    $('v24-claim-list').innerHTML = items.map((g, i) => `<button type="button" class="v24-row${st.picked.has(i) ? ' is-picked' : ''}" role="listitem" aria-pressed="${st.picked.has(i)}" onclick="V24Link.toggleClaimItem(${i})">
      <span class="v24-check" aria-hidden="true">${ICON_CHECK}</span>
      <span class="v24-row-main"><span class="v24-row-name">${esc(g.label || 'Game')}</span><span class="v24-row-sub">${esc([g.date, g.playerName ? 'as ' + g.playerName : ''].filter(Boolean).join(' · '))}</span></span></button>`).join('');
    show($('v24-claim-empty'), !items.length);
    $('v24-btn-claim-confirm').disabled = !st.picked.size;
  }
  function toggleClaimItem(i) { st.picked.has(i) ? st.picked.delete(i) : st.picked.add(i); renderClaimItems(); }
  async function openClaimSheet(code) {
    status('v24-claim-status', '');
    st.picked = new Set(); st.claimItems = [];
    show($('v24-code-entry'), !code);
    try { st.claimItems = (code ? await call('lookupClaim', code) : await call('getSuggestions')) || []; } catch (e) { status('v24-claim-status', e.message || 'Could not load games.', true); }
    if (code) st.claimItems.forEach((_, i) => st.picked.add(i));
    $('v24-claim-title').textContent = code ? 'Is this you?' : 'Were you in these games?';
    renderClaimItems(); show($('v24-claim-sheet'), true);
  }
  function closeClaimSheet() { show($('v24-claim-sheet'), false); }
  async function lookupCode() {
    const code = String($('v24-code-input').value || '').trim(); if (!code) return;
    try {
      const found = (await call('lookupClaim', code)) || [];
      const start = st.claimItems.length;
      found.forEach((g) => { if (!st.claimItems.some((x) => x.gameId === g.gameId && x.playerName === g.playerName)) st.claimItems.push(g); });
      for (let i = start; i < st.claimItems.length; i++) st.picked.add(i);
      renderClaimItems(); status('v24-claim-status', found.length ? '' : 'That code did not match any game.', !found.length);
    } catch (e) { status('v24-claim-status', e.message || 'Could not check that code.', true); }
  }
  async function confirmClaims() {
    const items = [...st.picked].map((i) => st.claimItems[i]).filter(Boolean); if (!items.length) return;
    try {
      const r = await call('confirmClaims', items);
      const n = (r && r.claimed) || items.length;
      st.claimItems = st.claimItems.filter((_, i) => !st.picked.has(i)); st.picked = new Set(); renderClaimItems();
      status('v24-claim-status', `${n} ${n === 1 ? 'game' : 'games'} added to your History.`);
      if (backend.onLinked) items.forEach((g) => backend.onLinked(g.gameId));
      refreshSuggestions();
      setTimeout(() => { if (!st.claimItems.length) closeClaimSheet(); }, 1200);
    } catch (e) { status('v24-claim-status', e.message || 'Could not claim those games.', true); }
  }

  /* ---------- Home suggestion banner ---------- */
  async function refreshSuggestions() {
    const b = $('v24-suggest-banner'); if (!b) return;
    if (st.dismissed || !backend || !backend.getSuggestions) { show(b, false); return; }
    try {
      const s = (await backend.getSuggestions()) || [];
      $('v24-suggest-sub').textContent = `${s.length} ${s.length === 1 ? 'game lists' : 'games list'} a player who might be you`;
      show(b, s.length > 0);
    } catch (_) { show(b, false); }
  }
  function dismissSuggestions() { st.dismissed = true; try { sessionStorage.setItem('v24-suggest-dismissed', '1'); } catch (_) {} show($('v24-suggest-banner'), false); }

  /* ---------- Boot: ?claim=CODE deep link (call after sign-in) ---------- */
  function handleClaimUrl() {
    let code = null;
    try { const u = new URL(location.href); code = u.searchParams.get('claim'); if (code) { u.searchParams.delete('claim'); history.replaceState(null, '', u.pathname + u.search + u.hash); } } catch (_) {}
    if (code) { try { sessionStorage.setItem('v24-pending-claim', code); } catch (_) {} }
    try { code = code || sessionStorage.getItem('v24-pending-claim'); } catch (_) {}
    const uid = backend && backend.getCurrentUserId ? backend.getCurrentUserId() : null;
    if (code && uid) { try { sessionStorage.removeItem('v24-pending-claim'); } catch (_) {} openClaimSheet(code); return true; }
    return false;
  }
  function setBackend(b) {
    backend = b || null;
    try { st.dismissed = sessionStorage.getItem('v24-suggest-dismissed') === '1'; } catch (_) {}
  }

  global.V24Link = {
    setBackend, renderLinkButton, openLinkSheet, closeLinkSheet, pickPlayer, filterFriends, assignFriend,
    createClaim, copyClaim, shareClaim, revokeClaim, backToPlayers,
    openClaimSheet, closeClaimSheet, toggleClaimItem, lookupCode, confirmClaims,
    refreshSuggestions, dismissSuggestions, handleClaimUrl,
  };
})(typeof window !== 'undefined' ? window : globalThis);
