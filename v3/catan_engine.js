  // ----- Catan (wood + parchment theme, layout from the approved rendering) -----
  const CG_SHIELDS = ['red', 'green', 'blue', 'purple'];
  const CG_TAGS = ['Orange', 'Forest', 'Harbor', 'Desert', 'Hills', 'Pasture'];
  const CG_ICONS = { settlements: 'icon-settlements.png', cities: 'icon-cities.png', longestRoad: 'icon-road.png', largestArmy: 'icon-army.png', vpCards: 'icon-vpcard.png' };
  const CG_ASSET = './assets/catan/';
  const UNIQUE_CATS = ['longestRoad', 'largestArmy'];
  const cgStar = '<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#cg-star"/></svg>';
  const cgCrown = '<svg class="cg-crown" viewBox="0 0 24 24" aria-label="Winner"><use href="#cg-crown"/></svg>';
  function cgSelected() {
    if (!isCatan() || !currentGame.players.length) return null;
    if (scoringPlayer === null || !currentGame.players[scoringPlayer]) scoringPlayer = 0;
    return scoringPlayer;
  }
  function cgFeedback(selectors) {
    try { if (navigator.vibrate) navigator.vibrate(12); } catch (e) { /* ignore */ }
    requestAnimationFrame(() => (selectors || []).forEach((sel) => document.querySelectorAll(sel).forEach((el) => {
      const cls = el.classList.contains('cg-act') ? 'cg-flash' : 'cg-pulse';
      el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
    })));
  }
  let cgToastTimer = null;
  function cgToast(msg) {
    const t = byId('cg-toast'); if (!t) return;
    t.textContent = msg; t.classList.add('show');
    clearTimeout(cgToastTimer); cgToastTimer = setTimeout(() => t.classList.remove('show'), 1600);
  }
  // Every Catan change is one undoable round that snapshots scores + breakdowns.
  function commitCatan(mutate, mode, detail) {
    const prev = currentGame.players.map((p) => p.score);
    const prevBd = currentGame.players.map((p) => ({ ...emptyBreakdown(), ...(p.breakdown || {}) }));
    currentGame.players.forEach((p) => { p.breakdown = { ...emptyBreakdown(), ...(p.breakdown || {}) }; });
    mutate(currentGame.players);
    currentGame.players.forEach((p) => { p.score = Math.max(0, Number(p.score) || 0); });
    const deltas = currentGame.players.map((p, i) => p.score - prev[i]);
    if (deltas.every((d) => d === 0) && JSON.stringify(prevBd) === JSON.stringify(currentGame.players.map((p) => p.breakdown))) return false;
    currentGame.rounds.push({ ts: new Date().toISOString(), by: scoringPlayer, mode, prev, prevBd, deltas, detail: detail || null });
    persistActive();
    renderCatan();
    return true;
  }
  function renderCatan() {
    const t = currentGame.targetVp || 10;
    byId('catan-title').textContent = 'Score Tracker';
    byId('catan-sub').textContent = `FIRST TO ${t} VICTORY POINTS`;
    cgSelected();
    renderCatanLeaderboard();
    renderCatanPad();
    renderCatanActions();
    const u = byId('btn-undo'); if (u) u.disabled = !currentGame.rounds.length;
  }
  function renderCatanLeaderboard() {
    const t = currentGame.targetVp || 10;
    const sorted = currentGame.players.map((p, idx) => ({ ...p, idx })).sort((a, b) => (b.score - a.score) || (a.idx - b.idx));
    byId('leaderboard').innerHTML = sorted.map((p) => {
      const win = p.score >= t, sel = p.idx === scoringPlayer;
      const n = Math.max(0, p.score);
      return `<div class="cg-row player-row${sel ? ' selected' : ''}${win ? ' winner' : ''}" data-player-idx="${p.idx}" role="option" aria-selected="${sel}" tabindex="0"
          onclick="selectCatanPlayer(${p.idx})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();selectCatanPlayer(${p.idx})}">
          <img class="cg-shield" src="${CG_ASSET}shield-${CG_SHIELDS[p.idx % CG_SHIELDS.length]}.png" alt="" width="44" height="47" draggable="false">
          <div class="cg-name">${esc(p.name)}${win ? cgCrown : ''}<small>(${CG_TAGS[p.idx % CG_TAGS.length]})</small></div>
          <div class="cg-stars${n > 7 ? ' sm' : ''}" aria-label="${n} stars">${cgStar.repeat(n)}</div>
          <div class="cg-vp vp-num" data-vp="${p.idx}">${p.score}</div>
        </div>`;
    }).join('');
  }
  function renderCatanPad() {
    const idx = scoringPlayer, p = idx === null ? null : currentGame.players[idx];
    byId('adj-val').textContent = p ? String(p.score) : '0';
    byId('pad-player-banner').innerHTML = p ? `Selected: <b>${esc(p.name)}</b>` : 'Selected: —';
    byId('catan-minus').disabled = !p || p.score <= 0;
    byId('catan-plus').disabled = !p;
  }
  function renderCatanActions() {
    const p = scoringPlayer === null ? null : currentGame.players[scoringPlayer];
    byId('score-form').innerHTML = CATAN_CATS.map((c) => {
      const have = p && p.breakdown ? (p.breakdown[c.key] || 0) : 0;
      const held = UNIQUE_CATS.includes(c.key) && have > 0;
      return `<button type="button" class="cg-act cat-row${held ? ' held' : ''}" data-cat="${c.key}" onclick="catanAction('${c.key}')" aria-label="${c.label}: add ${c.vp} VP">
          <img class="cg-act-ic" src="${CG_ASSET}${CG_ICONS[c.key]}" alt="" width="70" height="46" draggable="false">
          <span class="cg-act-txt"><span class="cg-act-title">${c.label}</span><span class="cg-act-vp">+${c.vp} VP${have ? `<span class="cg-act-count">${held ? '· held' : '· ×' + have}</span>` : ''}</span></span>
          <span class="cg-act-chev" aria-hidden="true">›</span>
        </button>`;
    }).join('');
  }
  function selectCatanPlayer(idx) {
    if (!isCatan() || !currentGame.players[idx]) return;
    scoringPlayer = idx;
    renderCatanLeaderboard(); renderCatanPad(); renderCatanActions();
    try { if (navigator.vibrate) navigator.vibrate(6); } catch (e) { /* ignore */ }
  }
  function catanStep(d) {
    const idx = cgSelected(); if (idx === null) return;
    const ok = commitCatan((ps) => { ps[idx].score += d; }, 'simple', { player: idx, step: d });
    if (ok) cgFeedback([`.cg-vp[data-vp="${idx}"]`, '#adj-val']);
  }
  function catanAction(key) {
    const c = CATAN_CATS.find((x) => x.key === key); const idx = cgSelected();
    if (!c || idx === null) return;
    const me = currentGame.players[idx];
    if (UNIQUE_CATS.includes(key) && (me.breakdown || {})[key] > 0) { cgToast(`${me.name} already holds ${c.label}`); return; }
    let from = null;
    const ok = commitCatan((ps) => {
      if (UNIQUE_CATS.includes(key)) {
        ps.forEach((q, i) => { if (i !== idx && (q.breakdown[key] || 0) > 0) { from = i; q.breakdown[key] = 0; q.score -= c.vp; } });
      }
      ps[idx].breakdown[key] = (ps[idx].breakdown[key] || 0) + 1;
      ps[idx].score += c.vp;
    }, 'detailed', { player: idx, breakdown: { [key]: 1 } });
    if (!ok) return;
    cgFeedback([`.cg-vp[data-vp="${idx}"]`, '#adj-val', `.cg-act[data-cat="${key}"]`].concat(from !== null ? [`.cg-vp[data-vp="${from}"]`] : []));
    cgToast(`+${c.vp} VP ${me.name} · ${c.label}${from !== null ? ` (from ${currentGame.players[from].name})` : ''}`);
  }
  function resetCatanScores() {
    if (!isCatan() || !currentGame.players.some((p) => p.score || Object.values(p.breakdown || {}).some(Boolean))) { cgToast('Scores are already 0'); return; }
    if (!confirm('Reset every player to 0 VP? (You can Undo this.)')) return;
    commitCatan((ps) => ps.forEach((p) => { p.score = 0; p.breakdown = emptyBreakdown(); }), 'reset', { reset: true });
    cgFeedback(['.cg-vp']);
    cgToast('Scores reset');
  }
