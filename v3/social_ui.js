window.SocialUI = (function () {
  function esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function initial(name) {
    return esc((String(name || '?').trim().charAt(0) || '?').toUpperCase());
  }

  /**
   * Player chip for Choose Game / Player Setup (#player-chips)
   * player: { name, userId?, isSelf?, isFriend? }
   */
  function renderPlayerChip(player, idx) {
    const p = typeof player === 'string' ? { name: player } : (player || { name: '' });
    const cls = ['player-chip', p.isSelf ? 'is-self' : '', p.isFriend ? 'is-friend' : ''].filter(Boolean).join(' ');
    const dot = (!p.isSelf && p.isFriend) ? '<span class="soc-friend-dot" aria-hidden="true"></span>' : '';
    const you = p.isSelf ? '<span class="soc-you-badge">You</span>' : '';
    return `
      <span class="${cls}">
        ${dot}
        <span>${esc(p.name)}</span>
        ${you}
        <button type="button" class="chip-remove" onclick="removePlayer(${idx})" aria-label="Remove ${esc(p.name)}">×</button>
      </span>
    `;
  }

  /** One-tap Group preset pill for #setup-group-presets */
  function renderGroupPresetPill(group, isActive) {
    const count = (group.members || []).length;
    return `
      <button type="button" class="soc-preset-pill ${isActive ? 'active' : ''}" onclick="applyGroupPreset && applyGroupPreset('${esc(group.id)}')">
        <span>${esc(group.name)}</span>
        <span class="soc-preset-count">${count}</span>
      </button>
    `;
  }

  /** Quick-add Friend pill for #setup-friend-picks */
  function renderFriendPickPill(friend, isIncluded) {
    const label = friend.displayName || friend.name || friend.email || 'Friend';
    return `
      <button type="button" class="soc-friend-pick ${isIncluded ? 'included' : ''}" onclick="toggleSetupFriend && toggleSetupFriend('${esc(friend.userId || friend.id)}')">
        <span>${isIncluded ? '✓' : '+'}</span>
        <span>${esc(label)}</span>
      </button>
    `;
  }

  /** Incoming pending friend request row for #soc-pending-list */
  function renderPendingRequestRow(req) {
    const name = req.displayName || req.name || req.email || 'Player';
    const sub = req.friendCode ? `Code: ${req.friendCode}` : (req.email || 'Wants to connect');
    const rid = esc(req.friendshipId || req.id);
    return `
      <div class="soc-row">
        <div class="soc-row-main">
          <div class="soc-avatar sm" aria-hidden="true">${initial(name)}</div>
          <div class="soc-row-info">
            <div class="soc-row-name">${esc(name)}</div>
            <div class="soc-row-sub">${esc(sub)}</div>
          </div>
        </div>
        <div class="soc-row-actions">
          <button type="button" class="btn success sm" onclick="respondFriendRequest && respondFriendRequest('${rid}', true)">Accept</button>
          <button type="button" class="btn sm" onclick="respondFriendRequest && respondFriendRequest('${rid}', false)">Decline</button>
        </div>
      </div>
    `;
  }

  /** Outgoing sent friend request row for #soc-sent-list (with Cancel -> removeFriend) */
  function renderSentRequestRow(req) {
    const name = req.displayName || req.name || req.email || 'Player';
    const sub = req.friendCode ? `Code: ${req.friendCode}` : (req.email || 'Pending response');
    const fid = esc(req.friendshipId || req.id);
    return `
      <div class="soc-sent-row">
        <div class="soc-row-main">
          <div class="soc-avatar sm" aria-hidden="true">${initial(name)}</div>
          <div class="soc-row-info">
            <div class="soc-row-name">${esc(name)}</div>
            <div class="soc-row-sub">${esc(sub)}</div>
          </div>
        </div>
        <div class="soc-row-actions">
          <span class="soc-sent-tag">Pending</span>
          <button type="button" class="btn sm" onclick="removeFriend && removeFriend('${fid}')">Cancel</button>
        </div>
      </div>
    `;
  }

  /** Accepted friend row for #soc-friends-list */
  function renderFriendRow(friend, isIncluded) {
    const name = friend.displayName || friend.name || friend.email || 'Friend';
    const sub = friend.friendCode ? `Code: ${friend.friendCode}` : (friend.email || 'Friend');
    const uid = esc(friend.userId || friend.id);
    const removeId = esc(friend.friendshipId || friend.userId || friend.id);
    return `
      <div class="soc-row">
        <div class="soc-row-main">
          <div class="soc-avatar sm" aria-hidden="true">${initial(name)}</div>
          <div class="soc-row-info">
            <div class="soc-row-name">${esc(name)}</div>
            <div class="soc-row-sub">${esc(sub)}</div>
          </div>
        </div>
        <div class="soc-row-actions">
          <button type="button" class="btn sm ${isIncluded ? 'success' : ''}" onclick="includeFriendInNextGame && includeFriendInNextGame('${uid}')">
            ${isIncluded ? 'Added' : '+ Include'}
          </button>
          <button type="button" class="soc-icon-btn" title="Remove friend" aria-label="Remove ${esc(name)}" onclick="removeFriend && removeFriend('${removeId}')"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>
      </div>
    `;
  }

  /**
   * Group card with Start Game CTA + Group Leaderboard + Recent Group Games
   * group: {
   *   id, name,
   *   members: [{ name, userId?, isSelf? }],
   *   leaderboard: [{ name, wins, gamesPlayed, winRate, isSelf? }],
   *   recentGames: [{ gameName, winnerName, dateLabel }]
   * }
   */
  function renderGroupCard(group) {
    const memberNames = (group.members || []).map(m => m.name || m).join(', ');
    const lb = group.leaderboard || [];
    const lbRows = lb.length
      ? lb.map((row, idx) => {
          const rate = typeof row.winRate === 'number'
            ? `${Math.round(row.winRate)}%`
            : (row.gamesPlayed ? `${Math.round((row.wins / row.gamesPlayed) * 100)}%` : '0%');
          return `
            <div class="soc-lb-row ${idx === 0 && row.wins > 0 ? 'is-first' : ''}">
              <span class="soc-lb-rank">${idx + 1}</span>
              <span class="soc-lb-player">
                <span>${esc(row.name)}</span>
                ${row.isSelf ? '<span class="soc-you-badge">You</span>' : ''}
              </span>
              <span class="soc-lb-wins">${row.wins || 0}</span>
              <span class="soc-lb-num">${row.gamesPlayed || 0}</span>
              <span class="soc-lb-rate">${rate}</span>
            </div>
          `;
        }).join('')
      : `<div style="padding:0.7rem;font-size:0.84rem;color:var(--muted);text-align:center">No games logged for this group yet.</div>`;

    const recent = group.recentGames || [];
    const recentHtml = recent.length
      ? `
        <div class="soc-group-recent">
          <div class="soc-group-recent-title">Recent Games</div>
          ${recent.slice(0, 3).map(g => `
            <div class="soc-group-recent-item">
              <span>${esc(g.gameName || g.type || 'Game')} <span class="small">· ${esc(g.dateLabel || '')}</span></span>
              <span class="winner">${esc(g.winnerName || '—')}</span>
            </div>
          `).join('')}
        </div>
      `
      : '';

    return `
      <article class="soc-group-card" data-group-id="${esc(group.id)}">
        <div class="soc-group-head">
          <div>
            <h3 class="soc-group-title">${esc(group.name)}</h3>
            <div class="soc-group-members">${esc(memberNames || 'Just you')}</div>
          </div>
          <button type="button" class="soc-icon-btn" title="Delete group" aria-label="Delete ${esc(group.name)}" onclick="deleteGroup && deleteGroup('${esc(group.id)}')">✕</button>
        </div>
        <div class="soc-group-cta-row">
          <button type="button" class="btn primary sm" onclick="startGameWithGroup && startGameWithGroup('${esc(group.id)}')">Start Game with Group</button>
        </div>
        ${group.filterHtml || ''}
        <div class="soc-lb-wrap" role="table" aria-label="${esc(group.name)} leaderboard">
          <div class="soc-lb-head" role="row">
            <span>#</span><span>Player</span><span style="text-align:right">Wins</span><span style="text-align:right">GP</span><span style="text-align:right">Win %</span>
          </div>
          ${lbRows}
        </div>
        ${recentHtml}
      </article>
    `;
  }

  /** Filter pills for #history-filter-bar */
  function renderHistoryFilterBar(groups, activeGroupId) {
    const active = activeGroupId || 'all';
    const pills = [
      `<button type="button" class="soc-filter-pill ${active === 'all' ? 'active' : ''}" data-group-id="all" onclick="setHistoryFilter && setHistoryFilter('all')">All My Games</button>`
    ];
    (groups || []).forEach(g => {
      pills.push(
        `<button type="button" class="soc-filter-pill ${active === g.id ? 'active' : ''}" data-group-id="${esc(g.id)}" onclick="setHistoryFilter && setHistoryFilter('${esc(g.id)}')">${esc(g.name)}</button>`
      );
    });
    return pills.join('');
  }

  /** Subtle badges for a .history-item (group tag + "Shared by <friend>") */
  function renderHistoryBadges(game) {
    const tags = [];
    if (game && game.groupName) {
      tags.push(`<span class="soc-tag-group">${esc(game.groupName)}</span>`);
    }
    if (game && game.sharedByName) {
      tags.push(`<span class="soc-tag-shared">Shared by ${esc(game.sharedByName)}</span>`);
    }
    return tags.length ? `<div class="soc-history-badges">${tags.join('')}</div>` : '';
  }

  /** Sub-tab switcher inside #view-social */
  function switchSocialTab(tab) {
    const isFriends = tab !== 'groups';
    const tF = document.getElementById('soc-tab-friends');
    const tG = document.getElementById('soc-tab-groups');
    const pF = document.getElementById('soc-panel-friends');
    const pG = document.getElementById('soc-panel-groups');
    if (tF) { tF.classList.toggle('active', isFriends); tF.setAttribute('aria-selected', String(isFriends)); }
    if (tG) { tG.classList.toggle('active', !isFriends); tG.setAttribute('aria-selected', String(!isFriends)); }
    if (pF) { pF.classList.toggle('hidden', !isFriends); pF.hidden = !isFriends; }
    if (pG) { pG.classList.toggle('hidden', isFriends); pG.hidden = isFriends; }
  }

  function openCreateGroupModal() {
    const m = document.getElementById('soc-create-group-modal');
    if (!m) return;
    m.classList.remove('hidden');
    m.hidden = false;
    const inp = document.getElementById('soc-group-name');
    if (inp) setTimeout(() => inp.focus(), 60);
  }

  function closeCreateGroupModal() {
    const m = document.getElementById('soc-create-group-modal');
    if (!m) return;
    m.classList.add('hidden');
    m.hidden = true;
  }

  function copyFriendCode() {
    const codeEl = document.getElementById('soc-friend-code');
    const btn = document.getElementById('btn-copy-code');
    const code = codeEl ? codeEl.textContent.trim() : '';
    if (!code || code === '—') return;
    const done = () => {
      if (!btn) return;
      btn.textContent = 'Copied!';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = 'Copy code'; btn.classList.remove('copied'); }, 1800);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(done).catch(done);
    } else {
      done();
    }
  }

  /** Extract a friend code, @handle, or email from raw input or a full ?addFriend=... URL */
  function parseFriendIdentifier(raw) {
    const text = String(raw || '').trim();
    if (!text) return '';
    try {
      if (/^https?:\/\//i.test(text) || text.includes('?')) {
        const u = new URL(text.startsWith('http') ? text : 'https://example.com/' + text.replace(/^\/+/, ''));
        const param = u.searchParams.get('addFriend') || u.searchParams.get('add_friend') || u.searchParams.get('friend') || u.searchParams.get('code');
        if (param && param.trim()) return param.trim();
      }
    } catch (_) {}
    const m = text.match(/[?&](?:addFriend|add_friend|friend|code)=([^&#]+)/i);
    if (m && m[1]) return decodeURIComponent(m[1]).trim();
    return text;
  }

  return {
    esc,
    initial,
    parseFriendIdentifier,
    renderPlayerChip,
    renderGroupPresetPill,
    renderFriendPickPill,
    renderPendingRequestRow,
    renderSentRequestRow,
    renderFriendRow,
    renderGroupCard,
    renderHistoryFilterBar,
    renderHistoryBadges,
    switchSocialTab,
    openCreateGroupModal,
    closeCreateGroupModal,
    copyFriendCode
  };
})();
