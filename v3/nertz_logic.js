/* ==========================================================================
   Score Tracker — Nertz Scoring Module (Midnight Parlor & Gold Foil)
   ==========================================================================
   Drop-in logic module for v3/engine.js. Exposes `window.NertzLogic` in
   browsers and `module.exports` in Node.

   Supports:
   - Solo mode (unlimited players; auto-seeds signed-in user as Player 1)
   - Partners / Teams mode (unlimited teams, each with 2+ editable partners;
     auto-pairs Social Group members when started from a group)
   - Pure round-by-round signed delta scoring (+14, -6, 0) — no Lake / Nertz split
   - Per-round Nertz caller highlight (`nertzDraftCallerIdx` + `nzToggleNertzCaller`)
     tracking `calledNertz` per round and running `nertzCalls` count
   - Running totals (can go negative), Undo Last Round, expandable round log
   - 8 parlor deck-back colors per player/team, editable Target Score (100)
   - Leader & target-reached winner banner state
   - History + Supabase `games` / `game_participants` + Group Leaderboard
     compatibility (`members` array + partner expansion in Teams mode)
   ========================================================================== */

(function (global) {
  'use strict';

  const DEFAULT_TARGET = 100;

  const NZ_COLORS = [
    { key: 'crimson',  label: 'Velvet Crimson',    hex: '#8e1d20', foil: '#e6c26b' },
    { key: 'emerald',  label: 'Parlor Emerald',    hex: '#155c47', foil: '#e6c26b' },
    { key: 'sapphire', label: 'Midnight Sapphire', hex: '#1b3b6f', foil: '#e6c26b' },
    { key: 'plum',     label: 'Royal Plum',        hex: '#4b2354', foil: '#e6c26b' },
    { key: 'gold',     label: 'Antique Gold',      hex: '#9a7022', foil: '#1a1209' },
    { key: 'obsidian', label: 'Obsidian Noir',     hex: '#334155', foil: '#e6c26b' },
    { key: 'teal',     label: 'Peacock Teal',      hex: '#146b74', foil: '#e6c26b' },
    { key: 'burgundy', label: 'Bordeaux Wine',     hex: '#6e1d36', foil: '#e6c26b' }
  ];

  // ---------------- Helpers ----------------
  function uid(prefix) {
    return (prefix || 'nz') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
  }

  function cleanStr(v) {
    return String(v ?? '').trim();
  }

  function parseSignedInt(v) {
    const raw = String(v ?? '').trim();
    if (!raw || raw === '-' || raw === '+') return 0;
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n)) return 0;
    return Math.max(-9999, Math.min(9999, n));
  }

  function clampTarget(v) {
    const n = parseInt(String(v ?? '').trim(), 10);
    if (!Number.isFinite(n) || n < 1) return DEFAULT_TARGET;
    return Math.min(9999, n);
  }

  function nzColor(key) {
    return NZ_COLORS.find((c) => c.key === key) || NZ_COLORS[0];
  }

  function nzFreeColor(game, skipIdx, afterKey) {
    const used = new Set(
      ((game && game.players) || [])
        .filter((_, i) => i !== skipIdx)
        .map((p) => p && p.color)
        .filter(Boolean)
    );
    const start = afterKey ? NZ_COLORS.findIndex((c) => c.key === afterKey) : -1;
    for (let step = 1; step <= NZ_COLORS.length; step++) {
      const c = NZ_COLORS[(start + step + NZ_COLORS.length) % NZ_COLORS.length];
      if (!used.has(c.key)) return c.key;
    }
    return NZ_COLORS[(start + 1 + NZ_COLORS.length) % NZ_COLORS.length].key;
  }

  function normalizePartner(raw) {
    if (typeof raw === 'string') {
      const name = cleanStr(raw);
      return name ? { name, userId: null, isSelf: false } : null;
    }
    if (!raw || typeof raw !== 'object') return null;
    const name = cleanStr(raw.name || raw.display_name || raw.displayName || (raw.profile && raw.profile.display_name));
    if (!name) return null;
    const userId = raw.userId ?? raw.user_id ?? (raw.profile && raw.profile.id) ?? null;
    return {
      name,
      userId: userId ? String(userId) : null,
      isSelf: Boolean(raw.isSelf || raw.is_self)
    };
  }

  function dedupePartners(list) {
    const seenUid = new Set();
    const seenName = new Set();
    const out = [];
    for (const raw of (Array.isArray(list) ? list : [])) {
      const p = normalizePartner(raw);
      if (!p) continue;
      const lower = p.name.toLowerCase();
      if (p.userId && seenUid.has(p.userId)) continue;
      if (seenName.has(lower)) continue;
      out.push(p);
      if (p.userId) seenUid.add(p.userId);
      seenName.add(lower);
    }
    return out;
  }

  function emptyDraftEntry() {
    return { delta: 0, touched: false };
  }

  function normalizeCallerIdx(game) {
    const len = Array.isArray(game.players) ? game.players.length : 0;
    const raw = game.nertzDraftCallerIdx;
    if (Number.isInteger(raw) && raw >= 0 && raw < len) {
      game.nertzDraftCallerIdx = raw;
    } else {
      game.nertzDraftCallerIdx = null;
    }
    return game.nertzDraftCallerIdx;
  }

  function ensureDraft(game) {
    if (!game.nertzDraft || typeof game.nertzDraft !== 'object') {
      game.nertzDraft = {};
    }
    const next = {};
    (game.players || []).forEach((_, idx) => {
      const cur = game.nertzDraft[idx];
      if (cur && typeof cur === 'object') {
        const rawDelta = cur.delta !== undefined ? cur.delta : cur.direct;
        next[idx] = {
          delta: parseSignedInt(rawDelta),
          touched: Boolean(cur.touched)
        };
      } else {
        next[idx] = emptyDraftEntry();
      }
    });
    game.nertzDraft = next;
    normalizeCallerIdx(game);
    return game.nertzDraft;
  }

  // ---------------- Initialization & Normalization ----------------
  /**
   * Normalizes a Nertz game object in-place (works for fresh games and
   * legacy gst_active objects). Auto-seeds `opts.selfPlayer` as Player 1
   * when starting fresh with no players.
   */
  function nzNormalize(game, opts) {
    if (!game || typeof game !== 'object') return null;
    const options = opts || {};

    game.type = 'nertz';
    game.target = clampTarget(game.target ?? DEFAULT_TARGET);
    game.nertzMode = game.nertzMode === 'teams' ? 'teams' : 'solo';
    delete game.nertzEntryMode;
    game.nertzLogOpen = Boolean(game.nertzLogOpen);
    game.rounds = Array.isArray(game.rounds) ? game.rounds : [];
    game.players = Array.isArray(game.players) ? game.players : [];

    // Auto-seed signed-in user as Player 1 when starting fresh with empty players
    if (!game.players.length && options.selfPlayer) {
      const self = normalizePartner(options.selfPlayer);
      if (self) {
        self.isSelf = true;
        if (game.nertzMode === 'teams') {
          game.players.push({
            id: uid('team'),
            name: 'Team 1',
            score: 0,
            color: NZ_COLORS[0].key,
            nertzCalls: 0,
            isTeam: true,
            partners: [self]
          });
        } else {
          game.players.push({
            id: uid('pl'),
            ...self,
            score: 0,
            color: NZ_COLORS[0].key,
            nertzCalls: 0
          });
        }
      }
    }

    // Normalize every competitor (solo player or team)
    game.players.forEach((p, idx) => {
      if (!p.id) p.id = uid(game.nertzMode === 'teams' ? 'team' : 'pl');
      p.name = cleanStr(p.name) || (game.nertzMode === 'teams' ? `Team ${idx + 1}` : `Player ${idx + 1}`);
      p.score = Number.isFinite(Number(p.score)) ? Number(p.score) : 0; // CAN be negative!
      p.nertzCalls = Math.max(0, Number(p.nertzCalls) || 0);
      if (!NZ_COLORS.some((c) => c.key === p.color)) {
        p.color = nzFreeColor({ players: game.players.slice(0, idx) }, -1, null);
      }
      if (game.nertzMode === 'teams') {
        p.isTeam = true;
        p.partners = dedupePartners(Array.isArray(p.partners) ? p.partners : []);
      } else {
        p.isTeam = false;
        if (p.userId === undefined) p.userId = p.user_id ?? null;
      }
    });

    if (!Array.isArray(game.soloRoster) && game.nertzMode === 'solo') {
      game.soloRoster = game.players.map((p) => ({
        name: p.name,
        userId: p.userId ?? null,
        isSelf: Boolean(p.isSelf)
      }));
    }

    ensureDraft(game);
    return game;
  }

  // ---------------- Mode Toggle: Solo <-> Teams ----------------
  /**
   * Pairs a flat list of participants into teams of 2 (unlimited teams).
   * If fewer than 2 teams result, ensures at least 2 starter teams for easy setup.
   */
  function pairIntoTeams(roster, existingColors) {
    const clean = dedupePartners(roster);
    const teams = [];
    const colors = Array.isArray(existingColors) ? existingColors : [];

    for (let i = 0; i < clean.length; i += 2) {
      const pair = clean.slice(i, i + 2);
      const tIdx = teams.length;
      teams.push({
        id: uid('team'),
        name: `Team ${tIdx + 1}`,
        score: 0,
        color: colors[tIdx] && NZ_COLORS.some((c) => c.key === colors[tIdx])
          ? colors[tIdx]
          : NZ_COLORS[tIdx % NZ_COLORS.length].key,
        nertzCalls: 0,
        isTeam: true,
        partners: pair
      });
    }

    while (teams.length < 2) {
      const tIdx = teams.length;
      teams.push({
        id: uid('team'),
        name: `Team ${tIdx + 1}`,
        score: 0,
        color: NZ_COLORS[tIdx % NZ_COLORS.length].key,
        nertzCalls: 0,
        isTeam: true,
        partners: []
      });
    }

    return teams;
  }

  /**
   * Switches between `solo` and `teams` mode.
   * Blocks switching if rounds exist unless `opts.force === true`.
   */
  function nzSetMode(game, nextMode, opts) {
    if (!game || (nextMode !== 'solo' && nextMode !== 'teams')) {
      return { ok: false, reason: 'invalid_mode' };
    }
    const options = opts || {};
    if (game.nertzMode === nextMode) return { ok: true, changed: false };

    if (Array.isArray(game.rounds) && game.rounds.length > 0 && !options.force) {
      return { ok: false, reason: 'rounds_exist' };
    }

    const existingColors = (game.players || []).map((p) => p.color);

    if (nextMode === 'teams') {
      const soloList = (game.players || []).map((p) => ({
        name: p.name,
        userId: p.userId ?? null,
        isSelf: Boolean(p.isSelf)
      }));
      game.soloRoster = dedupePartners(soloList);
      const sourceMembers = Array.isArray(options.groupMembers) && options.groupMembers.length
        ? dedupePartners([...soloList, ...options.groupMembers])
        : game.soloRoster;

      game.nertzMode = 'teams';
      game.players = pairIntoTeams(sourceMembers, existingColors);
    } else {
      const fromTeams = (game.players || []).flatMap((t) => Array.isArray(t.partners) ? t.partners : []);
      const restored = dedupePartners(fromTeams.length ? fromTeams : (game.soloRoster || []));

      game.nertzMode = 'solo';
      game.players = restored.map((p, idx) => ({
        id: uid('pl'),
        name: p.name,
        userId: p.userId ?? null,
        isSelf: Boolean(p.isSelf),
        score: 0,
        color: NZ_COLORS[idx % NZ_COLORS.length].key,
        nertzCalls: 0,
        isTeam: false
      }));
    }

    game.rounds = [];
    game.winner = null;
    game.nertzDraft = {};
    game.nertzDraftCallerIdx = null;
    nzNormalize(game, options);
    return { ok: true, changed: true, mode: nextMode };
  }

  // ---------------- Solo & Unlimited Team Management ----------------
  function nzAddSoloPlayer(game, rawPlayer) {
    if (!game || game.nertzMode !== 'solo') return null;
    const p = normalizePartner(rawPlayer);
    if (!p) return null;
    if (game.players.some((ex) => ex.name.toLowerCase() === p.name.toLowerCase())) return null;

    const entry = {
      id: uid('pl'),
      name: p.name,
      userId: p.userId,
      isSelf: p.isSelf,
      score: 0,
      color: nzFreeColor(game, -1, null),
      nertzCalls: 0,
      isTeam: false
    };
    game.players.push(entry);
    game.soloRoster = dedupePartners([...(game.soloRoster || []), p]);
    ensureDraft(game);
    return entry;
  }

  function nzRemoveSoloPlayer(game, idx) {
    if (!game || game.nertzMode !== 'solo' || !game.players[idx]) return false;
    if (game.players.length <= 1) return false;
    game.players.splice(idx, 1);
    game.nertzDraft = {};
    game.nertzDraftCallerIdx = null;
    ensureDraft(game);
    return true;
  }

  function nzAddTeam(game, teamName, initialPartners) {
    if (!game || game.nertzMode !== 'teams') return null;
    const idx = game.players.length;
    const name = cleanStr(teamName) || `Team ${idx + 1}`;
    const entry = {
      id: uid('team'),
      name,
      score: 0,
      color: nzFreeColor(game, -1, null),
      nertzCalls: 0,
      isTeam: true,
      partners: dedupePartners(initialPartners || [])
    };
    game.players.push(entry);
    ensureDraft(game);
    return entry;
  }

  function nzRemoveTeam(game, teamIdx) {
    if (!game || game.nertzMode !== 'teams' || !game.players[teamIdx]) return false;
    if (game.players.length <= 1) return false;
    game.players.splice(teamIdx, 1);
    game.nertzDraft = {};
    game.nertzDraftCallerIdx = null;
    ensureDraft(game);
    return true;
  }

  function nzRenameTeam(game, teamIdx, newName) {
    if (!game || game.nertzMode !== 'teams' || !game.players[teamIdx]) return false;
    const clean = cleanStr(newName);
    if (!clean) return false;
    game.players[teamIdx].name = clean;
    return true;
  }

  function nzAddPartner(game, teamIdx, rawPartner) {
    if (!game || game.nertzMode !== 'teams' || !game.players[teamIdx]) return null;
    const partner = normalizePartner(rawPartner);
    if (!partner) return null;

    const team = game.players[teamIdx];
    team.partners = Array.isArray(team.partners) ? team.partners : [];
    const exists = team.partners.some((p) =>
      (partner.userId && p.userId && p.userId === partner.userId) ||
      p.name.toLowerCase() === partner.name.toLowerCase()
    );
    if (exists) return null;

    team.partners.push(partner);
    return partner;
  }

  function nzRemovePartner(game, teamIdx, partnerIdx) {
    if (!game || game.nertzMode !== 'teams' || !game.players[teamIdx]) return false;
    const team = game.players[teamIdx];
    if (!Array.isArray(team.partners) || !team.partners[partnerIdx]) return false;
    team.partners.splice(partnerIdx, 1);
    return true;
  }

  function nzMovePartner(game, fromTeamIdx, partnerIdx, toTeamIdx) {
    if (!game || game.nertzMode !== 'teams') return false;
    if (fromTeamIdx === toTeamIdx) return false;
    const fromTeam = game.players[fromTeamIdx];
    const toTeam = game.players[toTeamIdx];
    if (!fromTeam || !toTeam || !Array.isArray(fromTeam.partners) || !fromTeam.partners[partnerIdx]) return false;

    const [partner] = fromTeam.partners.splice(partnerIdx, 1);
    toTeam.partners = Array.isArray(toTeam.partners) ? toTeam.partners : [];
    toTeam.partners.push(partner);
    return true;
  }

  /**
   * Lists Social Group members not yet assigned to any team, for quick 1-tap assignment.
   */
  function nzUnassignedGroupMembers(game, groupMembers) {
    const clean = dedupePartners(groupMembers || []);
    if (!game || game.nertzMode !== 'teams') return [];
    const assigned = (game.players || []).flatMap((t) => Array.isArray(t.partners) ? t.partners : []);
    return clean.filter((m) => !assigned.some((a) =>
      (m.userId && a.userId && m.userId === a.userId) ||
      a.name.toLowerCase() === m.name.toLowerCase()
    ));
  }

  // ---------------- Deck-Back Color & Target ----------------
  function nzCycleColor(game, idx) {
    if (!game || !game.players[idx]) return null;
    const p = game.players[idx];
    p.color = nzFreeColor(game, idx, p.color);
    return p.color;
  }

  function nzPickColor(game, idx, colorKey) {
    if (!game || !game.players[idx]) return false;
    if (!NZ_COLORS.some((c) => c.key === colorKey)) return false;
    game.players[idx].color = colorKey;
    return true;
  }

  function nzSetTarget(game, targetVal) {
    if (!game) return DEFAULT_TARGET;
    game.target = clampTarget(targetVal);
    const lead = nzLeaders(game);
    game.winner = lead.reachedTarget ? lead.winners.map((w) => w.name).join(', ') : null;
    return game.target;
  }

  // ---------------- Round Scoring Draft, Nertz Caller & Apply ----------------
  /**
   * Toggles which player/team called Nertz this round (at most one per round;
   * tapping the same idx clears it back to null).
   */
  function nzToggleNertzCaller(game, idx) {
    if (!game || !Array.isArray(game.players)) return null;
    ensureDraft(game);
    if (!Number.isInteger(idx) || idx < 0 || idx >= game.players.length) {
      game.nertzDraftCallerIdx = null;
      return null;
    }
    game.nertzDraftCallerIdx = game.nertzDraftCallerIdx === idx ? null : idx;
    return game.nertzDraftCallerIdx;
  }

  /**
   * Sets a player/team's signed integer round delta (+14, -6, 0).
   */
  function nzSetDraftDelta(game, idx, value) {
    if (!game || !game.players[idx]) return null;
    ensureDraft(game);
    const d = game.nertzDraft[idx];
    d.delta = parseSignedInt(value);
    d.touched = true;
    const p = game.players[idx];
    return {
      delta: d.delta,
      net: d.delta,
      touched: d.touched,
      calledNertz: game.nertzDraftCallerIdx === idx,
      projectedTotal: (Number(p.score) || 0) + d.delta
    };
  }

  /**
   * Adjusts a player/team's signed round delta by `step` (e.g. +1, -1, +5, -5).
   */
  function nzStepDraftDelta(game, idx, step) {
    if (!game || !game.players[idx]) return null;
    ensureDraft(game);
    const d = game.nertzDraft[idx];
    return nzSetDraftDelta(game, idx, d.delta + (Number(step) || 0));
  }

  function nzClearDraft(game) {
    if (!game) return;
    game.nertzDraft = {};
    game.nertzDraftCallerIdx = null;
    ensureDraft(game);
  }

  function nzGetDraftSummary(game) {
    if (!game || !Array.isArray(game.players)) {
      return { rows: [], hasAnyInput: false, callerIdx: null };
    }
    ensureDraft(game);
    const callerIdx = game.nertzDraftCallerIdx;
    let hasAnyInput = callerIdx !== null;

    const rows = game.players.map((p, idx) => {
      const d = game.nertzDraft[idx] || emptyDraftEntry();
      if (d.touched) hasAnyInput = true;
      const delta = d.delta;
      const calledNertz = callerIdx === idx;
      return {
        idx,
        name: p.name,
        delta,
        net: delta,
        touched: d.touched,
        calledNertz,
        projectedTotal: (Number(p.score) || 0) + delta
      };
    });

    return { rows, hasAnyInput, callerIdx };
  }

  function nzApplyRound(game) {
    if (!game || !Array.isArray(game.players) || !game.players.length) return null;
    const summary = nzGetDraftSummary(game);
    if (!summary.hasAnyInput) return null;

    const prev = game.players.map((p) => Number(p.score) || 0);
    const prevNertzCalls = game.players.map((p) => Number(p.nertzCalls) || 0);
    const deltas = summary.rows.map((r) => r.delta);
    const callerIdx = summary.callerIdx;

    game.players.forEach((p, idx) => {
      p.score = prev[idx] + deltas[idx]; // Running totals CAN be negative!
      if (idx === callerIdx) {
        p.nertzCalls = prevNertzCalls[idx] + 1;
      }
    });

    const round = {
      ts: new Date().toISOString(),
      prev,
      deltas,
      prevNertzCalls,
      callerIdx,
      detail: {
        nertzMode: game.nertzMode,
        callerIdx,
        entries: summary.rows.map((r) => ({
          idx: r.idx,
          name: r.name,
          delta: r.delta,
          net: r.delta,
          calledNertz: r.calledNertz
        }))
      }
    };

    game.rounds = Array.isArray(game.rounds) ? game.rounds : [];
    game.rounds.push(round);

    const lead = nzLeaders(game);
    game.winner = lead.reachedTarget ? lead.winners.map((w) => w.name).join(', ') : null;

    nzClearDraft(game);
    return round;
  }

  function nzUndoLastRound(game) {
    if (!game || !Array.isArray(game.rounds) || !game.rounds.length) return null;
    const last = game.rounds.pop();

    game.players.forEach((p, idx) => {
      if (Array.isArray(last.prev) && last.prev[idx] !== undefined) {
        p.score = Number(last.prev[idx]) || 0;
      } else {
        p.score = (Number(p.score) || 0) - ((last.deltas && last.deltas[idx]) || 0);
      }
      if (Array.isArray(last.prevNertzCalls) && last.prevNertzCalls[idx] !== undefined) {
        p.nertzCalls = Math.max(0, Number(last.prevNertzCalls[idx]) || 0);
      }
    });

    // Restore the undone round's Nertz caller highlight cleanly
    const restoredCaller = last.callerIdx !== undefined
      ? last.callerIdx
      : (last.detail && last.detail.callerIdx !== undefined ? last.detail.callerIdx : null);
    game.nertzDraftCallerIdx = Number.isInteger(restoredCaller) && game.players[restoredCaller]
      ? restoredCaller
      : null;

    const lead = nzLeaders(game);
    game.winner = lead.reachedTarget ? lead.winners.map((w) => w.name).join(', ') : null;
    return last;
  }

  function nzResetScores(game) {
    if (!game || !Array.isArray(game.players)) return;
    game.players.forEach((p) => {
      p.score = 0;
      p.nertzCalls = 0;
    });
    game.rounds = [];
    game.winner = null;
    nzClearDraft(game);
  }

  function nzToggleLog(game) {
    if (!game) return false;
    game.nertzLogOpen = !game.nertzLogOpen;
    return game.nertzLogOpen;
  }

  // ---------------- Leaders & Winner Banner ----------------
  function nzLeaders(game) {
    if (!game || !Array.isArray(game.players) || !game.players.length) {
      return { bestScore: null, leaderIndices: [], winners: [], reachedTarget: false };
    }
    const target = clampTarget(game.target ?? DEFAULT_TARGET);
    const scores = game.players.map((p) => Number(p.score) || 0);
    const bestScore = Math.max(...scores);
    const hasActivity = (Array.isArray(game.rounds) && game.rounds.length > 0) || scores.some((s) => s !== 0);
    const leaderIndices = hasActivity
      ? scores.map((s, i) => (s === bestScore ? i : -1)).filter((i) => i >= 0)
      : [];
    const reachedTarget = hasActivity && bestScore >= target;
    const winners = reachedTarget ? leaderIndices.map((i) => game.players[i]) : [];
    return { bestScore, leaderIndices, winners, reachedTarget };
  }

  // ---------------- Finish, History & Shared Supabase Export ----------------
  function formatTeamDisplayName(team) {
    const names = (Array.isArray(team.partners) ? team.partners : []).map((p) => p.name).filter(Boolean);
    return names.length ? `${team.name} (${names.join(' & ')})` : team.name;
  }

  /**
   * Prepares a finished Nertz game object for local history (`score_history`).
   */
  function nzPrepareFinish(game) {
    if (!game) return null;
    const finished = JSON.parse(JSON.stringify(game));
    delete finished.nertzDraft;
    delete finished.nertzDraftCallerIdx;
    finished.endTime = new Date().toISOString();

    const scores = (finished.players || []).map((p) => Number(p.score) || 0);
    const best = scores.length ? Math.max(...scores) : 0;
    const winningEntries = (finished.players || []).filter((p) => (Number(p.score) || 0) === best);

    finished.winner = winningEntries
      .map((p) => (finished.nertzMode === 'teams' ? formatTeamDisplayName(p) : p.name))
      .join(', ');

    // Contract shared with social-auth.js (saveSharedGame) + social_scoring.js (computeGroupLeaderboard):
    // team rows mirror `partners` as `members` so every linked partner is credited; meta.mode marks Solo vs Teams.
    finished.meta = { ...(finished.meta || {}), mode: finished.nertzMode === 'teams' ? 'teams' : 'solo' };
    (finished.players || []).forEach((p) => {
      p.isWinner = (Number(p.score) || 0) === best;
      if (finished.nertzMode === 'teams') {
        p.userId = null;
        p.members = (Array.isArray(p.partners) ? p.partners : []).map((m) => ({
          name: m.name,
          userId: m.userId || null,
          isSelf: !!m.isSelf
        }));
      }
    });

    if (finished.nertzMode === 'teams') {
      finished.teams = finished.players.map((t) => ({
        id: t.id,
        name: t.name,
        color: t.color,
        score: Number(t.score) || 0,
        nertzCalls: Number(t.nertzCalls) || 0,
        partners: Array.isArray(t.partners) ? t.partners : []
      }));
    }

    return finished;
  }

  /**
   * Expands a finished Nertz game into `game_participants` compatible rows for
   * `SocialAPI.saveSharedGame` & `SocialScoring.computeGroupLeaderboard`.
   */
  function nzBuildSharedParticipants(finishedGame) {
    if (!finishedGame || !Array.isArray(finishedGame.players)) return [];
    const scores = finishedGame.players.map((p) => Number(p.score) || 0);
    const best = scores.length ? Math.max(...scores) : 0;

    if (finishedGame.nertzMode !== 'teams') {
      return finishedGame.players.map((p) => {
        const score = Number(p.score) || 0;
        const userId = p.userId ?? p.user_id ?? null;
        return {
          name: p.name,
          display_name: p.name,
          userId,
          user_id: userId,
          score,
          is_winner: score === best,
          meta: {
            nertz_mode: 'solo',
            color: p.color || null,
            nertz_calls: Number(p.nertzCalls) || 0
          }
        };
      });
    }

    const rows = [];
    for (const team of finishedGame.players) {
      const score = Number(team.score) || 0;
      const isWinner = score === best;
      const partners = Array.isArray(team.partners) && team.partners.length
        ? team.partners
        : [{ name: team.name, userId: null, isSelf: false }];
      const partnerNames = partners.map((pt) => pt.name);

      for (const pt of partners) {
        const userId = pt.userId ?? pt.user_id ?? null;
        rows.push({
          name: pt.name,
          display_name: pt.name,
          userId,
          user_id: userId,
          score,
          is_winner: isWinner,
          meta: {
            nertz_mode: 'teams',
            team_id: team.id || null,
            team_name: team.name,
            team_color: team.color || null,
            partners: partnerNames,
            nertz_calls: Number(team.nertzCalls) || 0
          }
        });
      }
    }
    return rows;
  }

  /**
   * Builds the game object ready to pass directly into `SocialAPI.saveSharedGame(game, { groupId })`.
   */
  function nzBuildSharedGameRecord(finishedGame) {
    const fin = finishedGame.endTime ? finishedGame : nzPrepareFinish(finishedGame);
    return {
      ...fin,
      client_game_id: fin.id,
      group_id: fin.groupId || fin.group_id || null,
      players: nzBuildSharedParticipants(fin)
    };
  }

  const api = {
    DEFAULT_TARGET,
    NZ_COLORS,
    nzColor,
    nzFreeColor,
    nzNormalize,
    nzSetMode,
    nzAddSoloPlayer,
    nzRemoveSoloPlayer,
    nzAddTeam,
    nzRemoveTeam,
    nzRenameTeam,
    nzAddPartner,
    nzRemovePartner,
    nzMovePartner,
    nzUnassignedGroupMembers,
    nzCycleColor,
    nzPickColor,
    nzSetTarget,
    nzToggleNertzCaller,
    nzSetDraftDelta,
    nzStepDraftDelta,
    nzClearDraft,
    nzGetDraftSummary,
    nzApplyRound,
    nzUndoLastRound,
    nzResetScores,
    nzToggleLog,
    nzLeaders,
    nzPrepareFinish,
    nzBuildSharedParticipants,
    nzBuildSharedGameRecord
  };

  global.NertzLogic = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
