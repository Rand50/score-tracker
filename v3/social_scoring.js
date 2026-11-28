/* ==========================================================================
   Score Tracker — Social Scoring, Shared Game Serialization & Leaderboards
   ==========================================================================
   Clean, zero-dependency module designed to integrate into v3/engine.js.
   Exposes `window.SocialScoring` in browsers and `module.exports` in Node.

   Provides:
   1. Participant-Aware Player Model (100% backwards-compatible with legacy
      string player arrays across all 8 games):
      - normalizeParticipant(entry, opts)
      - normalizeRoster(list, currentUserId)
      - participantKey(participant)
      - toLegacyPlayerNames(participants)
      - buildDefaultPlayers(currentUserProfile, savedRoster)
      - applyGroupPreset(group, optsOrActiveGame)
      - buildGamePlayers(gameId, participants)
   2. Shared Game Record Serialization:
      - buildSharedGamePayload(activeGame, currentUser)
   3. Personal History & Group Leaderboard Engine:
      - mergePersonalHistory(sharedGames, legacyHistory, currentUserId, opts)
      - computeGroupLeaderboard(groupGames, groupMembers, optsOrGameType)
   ========================================================================== */

(function (global) {
  'use strict';

  const GAMES_META = {
    flip7:       { id: 'flip7',       name: 'Flip 7',       low: false },
    '7wonders':  { id: '7wonders',    name: '7 Wonders',    low: false },
    carcassonne: { id: 'carcassonne', name: 'Carcassonne',  low: false },
    catan:       { id: 'catan',       name: 'Catan',        low: false },
    ohhell:      { id: 'ohhell',      name: 'Oh Hell',      low: false },
    hearts:      { id: 'hearts',      name: 'Hearts',       low: true  },
    nertz:       { id: 'nertz',       name: 'Nertz',        low: false },
    rummikub:    { id: 'rummikub',    name: 'Rummikub',     low: true  },
    qwirkle:     { id: 'qwirkle',     name: 'Qwirkle',      low: false },
    spoons:      { id: 'spoons',      name: 'Spoons',       low: false },
    other:       { id: 'other',       name: 'Custom',       low: false }
  };

  const CATAN_BREAKDOWN_KEYS = ['settlements', 'cities', 'longestRoad', 'largestArmy', 'vpCards'];
  const CC_DEFAULT_COLORS = ['blue', 'red', 'yellow', 'green', 'black', 'pink'];

  function gameMeta(gameType) {
    const key = String(gameType || 'other').toLowerCase();
    return GAMES_META[key] || { id: key || 'other', name: gameType || 'Custom', low: false };
  }

  function emptyCatanBreakdown() {
    return { settlements: 0, cities: 0, longestRoad: 0, largestArmy: 0, vpCards: 0 };
  }

  function cleanName(val) {
    return String(val ?? '').trim();
  }

  function extractProfileName(profile) {
    if (!profile) return '';
    if (typeof profile === 'string') return cleanName(profile);
    const direct =
      cleanName(profile.display_name) ||
      cleanName(profile.displayName) ||
      cleanName(profile.name) ||
      cleanName(profile.full_name) ||
      cleanName(profile.fullName) ||
      cleanName(profile.username);
    if (direct) return direct;
    const meta = profile.user_metadata;
    if (meta && typeof meta === 'object') {
      const fromMeta =
        cleanName(meta.display_name) ||
        cleanName(meta.full_name) ||
        cleanName(meta.name);
      if (fromMeta) return fromMeta;
    }
    const email = cleanName(profile.email);
    if (email && email.includes('@')) return email.split('@')[0];
    return '';
  }

  function extractUserId(obj, allowGenericId) {
    if (!obj || typeof obj !== 'object') return null;
    const raw =
      obj.userId !== undefined ? obj.userId :
      obj.user_id !== undefined ? obj.user_id :
      (obj.profile && obj.profile.id !== undefined ? obj.profile.id :
      (allowGenericId && obj.id !== undefined ? obj.id : null));
    if (raw === null || raw === undefined || raw === '') return null;
    return String(raw);
  }

  // =========================================================================
  // 1. Participant-Aware Player Model
  // =========================================================================

  /**
   * Normalizes a legacy string name OR any participant/member/profile object
   * into `{ name, userId, isSelf, isGuest }` (optionally keeping extra game fields).
   */
  function normalizeParticipant(entry, opts) {
    const options = opts || {};
    const currentUserId = options.currentUserId ? String(options.currentUserId) : null;

    if (typeof entry === 'string') {
      const name = cleanName(entry);
      if (!name) return null;
      return { name, userId: null, isSelf: false, isGuest: true };
    }

    if (!entry || typeof entry !== 'object') return null;

    const nestedProfile = entry.profile && typeof entry.profile === 'object' ? entry.profile : null;
    const userId = extractUserId(entry, Boolean(options.allowIdAsUserId));
    const name =
      extractProfileName(entry) ||
      extractProfileName(nestedProfile) ||
      (userId ? 'Player' : '');

    if (!name) return null;

    const isSelf = Boolean(
      entry.isSelf ||
      entry.is_self ||
      (currentUserId && userId && userId === currentUserId)
    );
    const isGuest =
      entry.isGuest !== undefined ? Boolean(entry.isGuest) :
      entry.is_guest !== undefined ? Boolean(entry.is_guest) :
      !userId;

    const base = { name, userId, isSelf, isGuest };

    if (options.preserveExtras) {
      return { ...entry, ...base };
    }
    return base;
  }

  /**
   * Stable dedupe/selection key for a participant or legacy string name.
   */
  function participantKey(entry) {
    if (typeof entry === 'string') return 'name:' + cleanName(entry).toLowerCase();
    if (!entry || typeof entry !== 'object') return '';
    const uid = extractUserId(entry, false);
    if (uid) return 'uid:' + uid;
    return 'name:' + extractProfileName(entry).toLowerCase();
  }

  /**
   * Normalizes and deduplicates a mixed roster of strings and participant objects.
   * When a linked participant (userId != null) and a guest share a name, the
   * linked participant wins.
   */
  function normalizeRoster(list, currentUserId) {
    const out = [];
    const byUserId = new Map();
    const byName = new Map();

    for (const raw of (Array.isArray(list) ? list : [])) {
      const p = normalizeParticipant(raw, { currentUserId });
      if (!p) continue;

      const lower = p.name.toLowerCase();
      if (p.userId && byUserId.has(p.userId)) {
        const idx = byUserId.get(p.userId);
        if (p.isSelf) out[idx].isSelf = true;
        continue;
      }

      if (byName.has(lower)) {
        const idx = byName.get(lower);
        const existing = out[idx];
        // Upgrade guest entry to linked entry if same name
        if (!existing.userId && p.userId) {
          out[idx] = p;
          byUserId.set(p.userId, idx);
        } else if (p.isSelf) {
          existing.isSelf = true;
        }
        continue;
      }

      const idx = out.length;
      out.push(p);
      byName.set(lower, idx);
      if (p.userId) byUserId.set(p.userId, idx);
    }

    return out;
  }

  function toLegacyPlayerNames(participants) {
    return (Array.isArray(participants) ? participants : [])
      .map((p) => (typeof p === 'string' ? cleanName(p) : extractProfileName(p)))
      .filter(Boolean);
  }

  /**
   * Always defaults the signed-in user in as Player 1 (while allowing them to be
   * removed/deselected later), followed by the deduplicated saved roster.
   */
  function buildDefaultPlayers(currentUserProfile, savedRoster) {
    const selfId = extractUserId(currentUserProfile, true);
    const selfName = extractProfileName(currentUserProfile) || (selfId ? 'Me' : '');

    const list = [];
    if (selfName) {
      list.push({
        name: selfName,
        userId: selfId,
        isSelf: true,
        isGuest: !selfId
      });
    }

    const roster = normalizeRoster(savedRoster, selfId);
    for (const p of roster) {
      if (selfId && p.userId && p.userId === selfId) continue;
      if (selfName && !p.userId && p.name.toLowerCase() === selfName.toLowerCase()) continue;
      list.push({ ...p, isSelf: Boolean(selfId && p.userId === selfId) });
    }

    return list;
  }

  /**
   * Loads a group's members (linked friends + any guests) into participant entries
   * and tags `activeGame.groupId` and `activeGame.groupName` if an activeGame is provided.
   *
   * Supports:
   *   applyGroupPreset(group)
   *   applyGroupPreset(group, activeGame)
   *   applyGroupPreset(group, { activeGame, currentUserId, includeSelfIfMissing, currentUserProfile })
   */
  function applyGroupPreset(group, optsOrActiveGame) {
    const isDirectGame = Boolean(
      optsOrActiveGame &&
      typeof optsOrActiveGame === 'object' &&
      Array.isArray(optsOrActiveGame.players)
    );
    const opts = isDirectGame ? { activeGame: optsOrActiveGame } : (optsOrActiveGame || {});
    const currentUserId = opts.currentUserId
      ? String(opts.currentUserId)
      : extractUserId(opts.currentUserProfile, true);

    if (!group || typeof group !== 'object') {
      return { players: [], groupId: null, groupName: '', activeGame: opts.activeGame || null };
    }

    const groupId = group.id !== undefined && group.id !== null ? String(group.id) : null;
    const groupName = cleanName(group.name || group.title || '');
    const rawMembers =
      Array.isArray(group.members) ? group.members :
      Array.isArray(group.group_members) ? group.group_members :
      Array.isArray(group.players) ? group.players : [];

    const normalizedMembers = normalizeRoster(rawMembers, currentUserId);

    // Optional: ensure signed-in user is first if they are in the group
    normalizedMembers.sort((a, b) => (b.isSelf ? 1 : 0) - (a.isSelf ? 1 : 0));

    if (opts.includeSelfIfMissing && opts.currentUserProfile) {
      const hasSelf = normalizedMembers.some((m) => m.isSelf);
      if (!hasSelf) {
        const selfEntry = normalizeParticipant(opts.currentUserProfile, {
          currentUserId,
          allowIdAsUserId: true
        });
        if (selfEntry) {
          selfEntry.isSelf = true;
          normalizedMembers.unshift(selfEntry);
        }
      }
    }

    const activeGame = opts.activeGame || null;
    if (activeGame && typeof activeGame === 'object') {
      activeGame.groupId = groupId;
      activeGame.groupName = groupName;
    }

    return {
      players: normalizedMembers,
      groupId,
      groupName,
      activeGame
    };
  }

  /**
   * Builds game-specific initial player objects for any of the 8 games while
   * keeping participant identity fields (`userId`, `isSelf`, `isGuest`).
   */
  function buildGamePlayers(gameId, participants, opts) {
    const type = String(gameId || 'other').toLowerCase();
    const list = normalizeRoster(participants, opts && opts.currentUserId);

    return list.map((p, idx) => {
      const base = {
        name: p.name,
        userId: p.userId,
        isSelf: Boolean(p.isSelf),
        isGuest: Boolean(p.isGuest),
        score: 0
      };
      if (type === 'catan') {
        return { ...base, breakdown: emptyCatanBreakdown() };
      }
      if (type === 'flip7') {
        return { ...base, flip7Count: 0 };
      }
      if (type === 'carcassonne') {
        return { ...base, color: CC_DEFAULT_COLORS[idx % CC_DEFAULT_COLORS.length] };
      }
      return base;
    });
  }

  // =========================================================================
  // 2. Shared Game Record Serialization
  // =========================================================================

  function extractTiebreakCoins(p) {
    if (!p || typeof p !== 'object') return null;
    const candidates = [
      p.tiebreakCoins,
      p.coins,
      p.meta && p.meta.tiebreakCoins,
      p.meta && p.meta.coins,
      p.scores && p.scores.treasury
    ];
    for (const c of candidates) {
      if (c !== null && c !== undefined && c !== '' && Number.isFinite(Number(c))) {
        return Number(c);
      }
    }
    return null;
  }

  function computeWinnersForGame(game) {
    const players = Array.isArray(game && game.players) ? game.players : [];
    if (!players.length) return { winnerIndices: new Set(), winnerNames: [] };

    const meta = gameMeta(game.type || game.game_type);
    const scores = players.map((p) => Number(p.score) || 0);
    const isLow = typeof game.low === 'boolean'
      ? game.low
      : (game.meta && typeof game.meta.low === 'boolean' ? game.meta.low : meta.low);
    const best = isLow ? Math.min(...scores) : Math.max(...scores);

    let topIndices = [];
    players.forEach((p, idx) => {
      if ((Number(p.score) || 0) === best) topIndices.push(idx);
    });

    // Official 7 Wonders tiebreaker: highest raw Treasury coins breaks VP ties
    const is7Wonders = meta.id === '7wonders' || meta.id === 'seven_wonders';
    if (is7Wonders && topIndices.length > 1) {
      const coinEntries = topIndices.map((idx) => ({
        idx,
        coins: extractTiebreakCoins(players[idx])
      }));
      if (coinEntries.some((e) => e.coins !== null)) {
        const bestCoins = Math.max(...coinEntries.map((e) => (e.coins === null ? 0 : e.coins)));
        topIndices = coinEntries
          .filter((e) => (e.coins === null ? 0 : e.coins) === bestCoins)
          .map((e) => e.idx);
      } else {
        // Coins not carried on this record (e.g. merged shared rows): honor the saved tiebreak winner flags
        const flagged = topIndices.filter((idx) => {
          const p = players[idx];
          return Boolean(p && (p.is_winner === true || p.isWinner === true));
        });
        if (flagged.length && flagged.length < topIndices.length) topIndices = flagged;
      }
    }

    const winnerIndices = new Set();
    const winnerNames = [];
    topIndices.forEach((idx) => {
      winnerIndices.add(idx);
      winnerNames.push(extractProfileName(players[idx]) || 'Player');
    });
    return { winnerIndices, winnerNames };
  }

  function extractPlayerRoundScores(rounds, playerIdx) {
    if (!Array.isArray(rounds) || !rounds.length) return [];
    const out = [];
    for (const r of rounds) {
      if (!r || typeof r !== 'object') continue;
      if (Array.isArray(r.deltas) && r.deltas[playerIdx] !== undefined) {
        out.push(Number(r.deltas[playerIdx]) || 0);
      } else if (Array.isArray(r.scores) && r.scores[playerIdx] !== undefined) {
        out.push(Number(r.scores[playerIdx]) || 0);
      } else if (r.playerIdx === playerIdx && r.delta !== undefined) {
        out.push(Number(r.delta) || 0);
      }
    }
    return out;
  }

  /**
   * Serializes an active/finished game from v3/engine.js into the shared
   * Supabase payload shape across all 8 games:
   * `{ game_type, variant, group_id, played_at, winner_names, summary, participants }`
   */
  function buildSharedGamePayload(activeGame, currentUser) {
    if (!activeGame || typeof activeGame !== 'object') {
      throw new Error('buildSharedGamePayload requires an activeGame object');
    }

    const gameType = String(activeGame.type || activeGame.game_type || 'other').toLowerCase();
    const meta = gameMeta(gameType);
    const creatorId =
      typeof currentUser === 'string'
        ? currentUser
        : extractUserId(currentUser, true);
    const playedAt = activeGame.endTime || activeGame.played_at || new Date().toISOString();
    const rounds = Array.isArray(activeGame.rounds) ? activeGame.rounds : [];
    const { winnerIndices, winnerNames } = computeWinnersForGame(activeGame);

    const participants = (Array.isArray(activeGame.players) ? activeGame.players : []).map((rawP, idx) => {
      const p = normalizeParticipant(rawP, { currentUserId: creatorId, preserveExtras: true }) || {
        name: 'Player',
        userId: null,
        isSelf: false,
        isGuest: true
      };
      const score = Number(rawP && rawP.score) || 0;
      const pMeta = {
        is_guest: !p.userId,
        is_self: Boolean(p.isSelf)
      };

      if (gameType === 'catan') {
        const bd = rawP && rawP.breakdown && typeof rawP.breakdown === 'object' ? rawP.breakdown : {};
        const normalizedBd = emptyCatanBreakdown();
        for (const k of CATAN_BREAKDOWN_KEYS) {
          normalizedBd[k] = Math.max(0, Number(bd[k]) || 0);
        }
        pMeta.breakdown = normalizedBd;
        pMeta.target_vp = activeGame.targetVp ?? activeGame.target ?? 10;
      } else if (gameType === 'flip7') {
        pMeta.flip7Count = Math.max(0, Number(rawP && rawP.flip7Count) || 0);
        const busts = rounds.filter((r) => {
          if (!r || !r.detail) return false;
          if (r.playerIdx === idx && r.detail.bust) return true;
          if (Array.isArray(r.detail.busts) && r.detail.busts[idx]) return true;
          return false;
        }).length;
        if (busts > 0) pMeta.busts = busts;
      } else if (gameType === 'carcassonne') {
        pMeta.scoring_mode = 'final_tally';
        if (rawP && rawP.color) pMeta.color = rawP.color;
      } else if (gameType === '7wonders' || gameType === 'seven_wonders') {
        const tbCoins = extractTiebreakCoins(rawP);
        if (tbCoins !== null) {
          pMeta.tiebreakCoins = tbCoins;
          pMeta.coins = tbCoins;
        }
        if (rawP && rawP.treasuryVp !== undefined) pMeta.treasuryVp = Number(rawP.treasuryVp) || 0;
        if (rawP && rawP.scienceVp !== undefined) pMeta.scienceVp = Number(rawP.scienceVp) || 0;
        if (rawP && rawP.wonder) pMeta.wonder = rawP.wonder;
        if (rawP && rawP.scores && typeof rawP.scores === 'object') pMeta.scores = { ...rawP.scores };
        if (rawP && rawP.science && typeof rawP.science === 'object') pMeta.science = { ...rawP.science };
      }

      const roundScores = extractPlayerRoundScores(rounds, idx);
      if (roundScores.length) {
        pMeta.round_scores = roundScores;
      }

      return {
        user_id: p.userId,
        display_name: p.name,
        score,
        is_winner: winnerIndices.has(idx),
        meta: pMeta
      };
    });

    const summary = {
      local_game_id: activeGame.id || null,
      game_name: meta.name,
      version: activeGame.version || activeGame.variant || null,
      target: activeGame.target ?? activeGame.targetVp ?? null,
      low_wins: Boolean(meta.low),
      rounds_count: rounds.length,
      rounds,
      start_time: activeGame.startTime || null,
      end_time: playedAt,
      group_name: activeGame.groupName || activeGame.group_name || null,
      created_by: creatorId,
      ...(activeGame.meta ? { meta: activeGame.meta } : {})
    };

    return {
      game_type: gameType,
      variant: activeGame.version || activeGame.variant || null,
      group_id: activeGame.groupId ?? activeGame.group_id ?? null,
      played_at: playedAt,
      winner_names: winnerNames,
      summary,
      participants
    };
  }

  // =========================================================================
  // 3. Personal History & Group Leaderboard Engine
  // =========================================================================

  function normalizeSharedGameRecord(raw, currentUserId) {
    if (!raw || typeof raw !== 'object') return null;
    const summary = (raw.summary && typeof raw.summary === 'object') ? raw.summary : {};
    const gameType = String(raw.game_type || raw.type || 'other').toLowerCase();
    const meta = gameMeta(gameType);
    const rawParticipants = Array.isArray(raw.participants)
      ? raw.participants
      : (Array.isArray(raw.game_participants) ? raw.game_participants : []);

    const players = rawParticipants.map((p) => {
      const userId = extractUserId(p, false);
      const name = extractProfileName(p) || 'Player';
      const pMeta = (p && p.meta && typeof p.meta === 'object') ? p.meta : {};
      const out = {
        name,
        userId,
        isSelf: Boolean(currentUserId && userId && userId === currentUserId),
        isGuest: !userId,
        score: Number(p && p.score) || 0,
        isWinner: Boolean(p && (p.is_winner ?? p.isWinner)),
        meta: pMeta
      };
      if (gameType === 'catan' && pMeta.breakdown) out.breakdown = { ...emptyCatanBreakdown(), ...pMeta.breakdown };
      if (gameType === 'flip7' && pMeta.flip7Count !== undefined) out.flip7Count = Number(pMeta.flip7Count) || 0;
      if (gameType === 'carcassonne' && pMeta.color) out.color = pMeta.color;
      if (gameType === '7wonders' || gameType === 'seven_wonders') {
        const tbCoins = extractTiebreakCoins({ meta: pMeta });
        if (tbCoins !== null) {
          out.tiebreakCoins = tbCoins;
          out.coins = tbCoins;
        }
        if (pMeta.wonder) out.wonder = pMeta.wonder;
        if (pMeta.scores) out.scores = pMeta.scores;
        if (pMeta.science) out.science = pMeta.science;
      }
      // Team rows (e.g. Nertz partners) keep their members for display + per-partner leaderboard credit
      if (p && Array.isArray(p.members) && p.members.length) {
        out.members = p.members.map((m) => ({ name: extractProfileName(m) || 'Player', userId: extractUserId(m, false), isSelf: Boolean(currentUserId && extractUserId(m, false) === currentUserId) }));
        out.isTeam = true;
        if (out.members.some((m) => m.isSelf)) out.isSelf = true;
      }
      return out;
    });

    const winnerNames = Array.isArray(raw.winner_names) && raw.winner_names.length
      ? raw.winner_names
      : players.filter((p) => p.isWinner).map((p) => p.name);

    const endTime = raw.played_at || summary.end_time || raw.endTime || raw.created_at || null;
    const myEntry = currentUserId
      ? players.find((p) => p.userId === currentUserId) || players.find((p) => p.isTeam && p.isSelf) || null
      : null;

    return {
      id: summary.local_game_id || raw.id || ('shared_' + (endTime || Date.now())),
      sharedGameId: raw.id ? String(raw.id) : null,
      source: 'shared',
      isShared: true,
      type: gameType,
      gameName: summary.game_name || meta.name,
      version: raw.variant || summary.version || null,
      target: summary.target ?? null,
      groupId: raw.group_id !== undefined && raw.group_id !== null ? String(raw.group_id) : null,
      groupName: raw.group_name || summary.group_name || null,
      createdBy: raw.created_by || summary.created_by || null,
      startTime: summary.start_time || endTime,
      endTime,
      playedAt: endTime,
      winner: winnerNames.join(', '),
      winnerNames,
      players,
      meta: raw.meta || summary.meta || null,
      rounds: Array.isArray(summary.rounds) ? summary.rounds : [],
      roundsCount: summary.rounds_count ?? (Array.isArray(summary.rounds) ? summary.rounds.length : 0),
      myScore: myEntry ? myEntry.score : null,
      didIWin: myEntry ? Boolean(myEntry.isWinner) : false
    };
  }

  function normalizeLegacyGameRecord(raw, currentUserId) {
    if (!raw || typeof raw !== 'object') return null;
    const gameType = String(raw.type || raw.game_type || 'other').toLowerCase();
    const meta = gameMeta(gameType);
    const { winnerIndices, winnerNames } = computeWinnersForGame(raw);

    const players = (Array.isArray(raw.players) ? raw.players : []).map((p, idx) => {
      const userId = extractUserId(p, false);
      const name = typeof p === 'string' ? cleanName(p) : (extractProfileName(p) || 'Player');
      return {
        ...(typeof p === 'object' && p ? p : {}),
        name,
        userId,
        isSelf: Boolean((p && p.isSelf) || (currentUserId && userId && userId === currentUserId)),
        isGuest: !userId,
        score: Number(p && p.score) || 0,
        isWinner: winnerIndices.has(idx)
      };
    });

    const endTime = raw.endTime || raw.played_at || raw.startTime || null;
    const myEntry = currentUserId
      ? players.find((p) => p.userId === currentUserId || p.isSelf) || null
      : null;

    return {
      ...raw,
      id: raw.id || ('legacy_' + (endTime || Date.now())),
      sharedGameId: raw.sharedGameId || null,
      source: 'legacy',
      isShared: false,
      type: gameType,
      gameName: meta.name,
      version: raw.version || raw.variant || null,
      target: raw.target ?? raw.targetVp ?? null,
      groupId: raw.groupId ?? raw.group_id ?? null,
      groupName: raw.groupName ?? raw.group_name ?? null,
      createdBy: raw.createdBy || currentUserId || null,
      startTime: raw.startTime || endTime,
      endTime,
      playedAt: endTime,
      winner: raw.winner || winnerNames.join(', '),
      winnerNames,
      players,
      rounds: Array.isArray(raw.rounds) ? raw.rounds : [],
      roundsCount: Array.isArray(raw.rounds) ? raw.rounds.length : 0,
      myScore: myEntry ? myEntry.score : null,
      didIWin: myEntry ? Boolean(myEntry.isWinner) : false
    };
  }

  function gameContentSignature(rec) {
    const type = String(rec.type || 'other').toLowerCase();
    const ts = Date.parse(rec.endTime || rec.playedAt || rec.startTime || 0) || 0;
    // Bucket timestamp to 5-second window to match local vs server save skew
    const bucket = Math.round(ts / 5000);
    const sigPlayers = [...(rec.players || [])]
      .map((p) => `${String(p.name || '').toLowerCase()}:${Number(p.score) || 0}`)
      .sort()
      .join('|');
    return `${type}::${bucket}::${sigPlayers}`;
  }

  /**
   * Produces a deduplicated, newest-first personal timeline combining:
   * - `sharedGames`: games from Supabase where the user participated (or created)
   * - `legacyHistory`: existing `score_history.history` items
   */
  function mergePersonalHistory(sharedGames, legacyHistory, currentUserId, opts) {
    const uid = currentUserId ? String(currentUserId) : null;
    const options = opts || {};
    const byLocalId = new Map();
    const bySharedId = new Map();
    const bySignature = new Map();
    const merged = [];

    const addRecord = (rec) => {
      if (!rec) return;
      if (rec.sharedGameId && bySharedId.has(rec.sharedGameId)) return;
      if (rec.id && byLocalId.has(rec.id)) {
        // If shared record already exists, merge missing rounds from legacy
        const existing = byLocalId.get(rec.id);
        if (existing.source === 'shared' && rec.source === 'legacy') {
          if (!existing.rounds.length && rec.rounds.length) {
            existing.rounds = rec.rounds;
            existing.roundsCount = rec.rounds.length;
          }
        }
        return;
      }
      const sig = gameContentSignature(rec);
      if (bySignature.has(sig)) {
        const existing = bySignature.get(sig);
        if (existing.source === 'shared' && rec.source === 'legacy') {
          if (!existing.rounds.length && rec.rounds.length) {
            existing.rounds = rec.rounds;
            existing.roundsCount = rec.rounds.length;
          }
        }
        return;
      }

      merged.push(rec);
      if (rec.sharedGameId) bySharedId.set(rec.sharedGameId, rec);
      if (rec.id) byLocalId.set(rec.id, rec);
      bySignature.set(sig, rec);
    };

    // 1. Add shared games first so they take precedence over legacy duplicates
    for (const raw of (Array.isArray(sharedGames) ? sharedGames : [])) {
      const rec = normalizeSharedGameRecord(raw, uid);
      if (!rec) continue;
      if (uid && !options.includeAllShared) {
        const participated = rec.players.some((p) => p.userId === uid || (Array.isArray(p.members) && p.members.some((m) => String(m.userId || m.user_id || '') === uid)));
        const created = rec.createdBy && String(rec.createdBy) === uid;
        if (!participated && !created) continue;
      }
      addRecord(rec);
    }

    // 2. Add legacy history items (deduplicated against shared)
    for (const raw of (Array.isArray(legacyHistory) ? legacyHistory : [])) {
      const rec = normalizeLegacyGameRecord(raw, uid);
      if (!rec) continue;
      addRecord(rec);
    }

    // 3. Optional gameType filter
    const filterType = options.gameType && options.gameType !== 'all'
      ? String(options.gameType).toLowerCase()
      : null;

    const filtered = filterType
      ? merged.filter((g) => g.type === filterType)
      : merged;

    filtered.sort((a, b) => {
      const ta = Date.parse(a.endTime || a.playedAt || a.startTime || 0) || 0;
      const tb = Date.parse(b.endTime || b.playedAt || b.startTime || 0) || 0;
      return tb - ta;
    });

    return filtered;
  }

  /**
   * Computes ranked per-player statistics for a group's games.
   *
   * Supports:
   *   computeGroupLeaderboard(groupGames, groupMembers)
   *   computeGroupLeaderboard(groupGames, groupMembers, 'catan')
   *   computeGroupLeaderboard(groupGames, groupMembers, { gameType: 'catan', recentFormLength: 5 })
   *
   * Returns array of:
   *   { rank, name, userId, gamesPlayed, wins, winRate, winRatePct, avgScore, bestScore, recentForm }
   */
  function computeGroupLeaderboard(groupGames, groupMembers, optsOrGameType) {
    const opts = typeof optsOrGameType === 'string'
      ? { gameType: optsOrGameType }
      : (optsOrGameType || {});
    const gameTypeFilter = opts.gameType && opts.gameType !== 'all'
      ? String(opts.gameType).toLowerCase()
      : null;
    const recentFormLength = Number(opts.recentFormLength) > 0 ? Number(opts.recentFormLength) : 5;
    const isLowFilter = Boolean(gameTypeFilter && gameMeta(gameTypeFilter).low);

    // Seed stats map from groupMembers so 0-game members still appear
    const statsList = [];
    const byUserId = new Map();
    const byName = new Map();

    const ensureBucket = (name, userId) => {
      const clean = cleanName(name) || 'Player';
      const lower = clean.toLowerCase();
      const uid = userId ? String(userId) : null;

      if (uid && byUserId.has(uid)) {
        return byUserId.get(uid);
      }
      if (byName.has(lower)) {
        const existing = byName.get(lower);
        if (!existing.userId && uid) {
          existing.userId = uid;
          byUserId.set(uid, existing);
        }
        return existing;
      }

      const bucket = {
        name: clean,
        userId: uid,
        gamesPlayed: 0,
        wins: 0,
        totalScore: 0,
        bestScore: null,
        recentForm: []
      };
      statsList.push(bucket);
      byName.set(lower, bucket);
      if (uid) byUserId.set(uid, bucket);
      return bucket;
    };

    for (const rawMember of (Array.isArray(groupMembers) ? groupMembers : [])) {
      const p = normalizeParticipant(rawMember, {});
      if (p) ensureBucket(p.name, p.userId);
    }

    // Filter games by gameType and sort chronologically (oldest -> newest) for recentForm
    const normalizedGames = (Array.isArray(groupGames) ? groupGames : [])
      .map((raw) => {
        if (!raw || typeof raw !== 'object') return null;
        if (Array.isArray(raw.participants) || Array.isArray(raw.game_participants)) {
          return normalizeSharedGameRecord(raw, null);
        }
        return normalizeLegacyGameRecord(raw, null);
      })
      .filter((g) => g && (!gameTypeFilter || g.type === gameTypeFilter))
      .sort((a, b) => {
        const ta = Date.parse(a.endTime || a.playedAt || a.startTime || 0) || 0;
        const tb = Date.parse(b.endTime || b.playedAt || b.startTime || 0) || 0;
        return ta - tb;
      });

    for (const game of normalizedGames) {
      const players = Array.isArray(game.players) ? game.players : [];
      if (!players.length) continue;

      const meta = gameMeta(game.type);
      const hasExplicitWinners = players.some((p) => p.isWinner === true);
      const fallbackWinners = hasExplicitWinners ? null : computeWinnersForGame(game).winnerIndices;

      // Team rows (e.g. Nertz partners) credit every member; dedupe so a person counts once per game.
      const credited = new Set();
      players.forEach((p, idx) => {
        const score = Number(p.score) || 0;
        const won = hasExplicitWinners ? Boolean(p.isWinner) : fallbackWinners.has(idx);
        const targets = Array.isArray(p.members) && p.members.length ? p.members : [p];
        targets.forEach((m) => {
          const mp = normalizeParticipant(m, {}) || { name: cleanName(m && m.name) || 'Player', userId: null };
          const key = mp.userId ? 'id:' + mp.userId : 'name:' + cleanName(mp.name).toLowerCase();
          if (credited.has(key)) return;
          credited.add(key);
          const bucket = ensureBucket(mp.name, mp.userId);

          bucket.gamesPlayed += 1;
          if (won) bucket.wins += 1;
          bucket.totalScore += score;

          if (bucket.bestScore === null) {
            bucket.bestScore = score;
          } else if (isLowFilter || (gameTypeFilter && meta.low)) {
            bucket.bestScore = Math.min(bucket.bestScore, score);
          } else {
            bucket.bestScore = Math.max(bucket.bestScore, score);
          }

          bucket.recentForm.push(won ? 'W' : 'L');
          if (bucket.recentForm.length > recentFormLength) {
            bucket.recentForm.shift();
          }
        });
      });
    }

    const ranked = statsList.map((b) => {
      const winRate = b.gamesPlayed > 0 ? Number((b.wins / b.gamesPlayed).toFixed(4)) : 0;
      const winRatePct = b.gamesPlayed > 0 ? Math.round((b.wins / b.gamesPlayed) * 100) : 0;
      const avgScore = b.gamesPlayed > 0 ? Number((b.totalScore / b.gamesPlayed).toFixed(1)) : 0;
      return {
        name: b.name,
        userId: b.userId,
        gamesPlayed: b.gamesPlayed,
        wins: b.wins,
        winRate,
        winRatePct,
        avgScore,
        bestScore: b.bestScore,
        recentForm: [...b.recentForm]
      };
    });

    ranked.sort((a, b) => {
      // Active players before 0-game members
      const aHas = a.gamesPlayed > 0 ? 1 : 0;
      const bHas = b.gamesPlayed > 0 ? 1 : 0;
      if (bHas !== aHas) return bHas - aHas;
      // Wins desc
      if (b.wins !== a.wins) return b.wins - a.wins;
      // Win rate desc
      if (b.winRate !== a.winRate) return b.winRate - a.winRate;
      // Games played desc
      if (b.gamesPlayed !== a.gamesPlayed) return b.gamesPlayed - a.gamesPlayed;
      // Average score (asc for Hearts, desc otherwise)
      if (b.avgScore !== a.avgScore) {
        return isLowFilter ? a.avgScore - b.avgScore : b.avgScore - a.avgScore;
      }
      return a.name.localeCompare(b.name);
    });

    return ranked.map((row, idx) => ({ rank: idx + 1, ...row }));
  }

  // =========================================================================
  // Exports
  // =========================================================================

  const api = {
    GAMES_META,
    normalizeParticipant,
    normalizeRoster,
    participantKey,
    toLegacyPlayerNames,
    buildDefaultPlayers,
    applyGroupPreset,
    buildGamePlayers,
    computeWinnersForGame,
    buildSharedGamePayload,
    mergePersonalHistory,
    computeGroupLeaderboard
  };

  global.SocialScoring = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
