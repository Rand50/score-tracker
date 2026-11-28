/* ==========================================================================
   TallyIt — Oh Hell Scoring Module (v23)
   ==========================================================================
   Zero-dependency UMD module for v3/engine.js & v3/shell.html.
   Exposes `window.TallyItOhHell` in browsers and `module.exports` in Node.

   Features:
   - State initialization & normalization (`initState(game)`) honoring
     `TallyItHouseRules` overrides (`exactBonus`, `missPointsPerTrick` /
     `pointsOnMiss`, `screwTheDealer`, `scheduleMode`, `lowWins`) and legacy
     version strings.
   - Round schedule generator (`buildRoundSchedule(playerCount, mode)`):
       * max = Math.min(10, Math.floor(51 / playerCount))
       * 'down_up' (default): max..1..max
       * 'up_down':           1..max..1
       * 'down_only' / 'up_only'
   - Rotating dealer index (`getDealerIndex(roundIndex, playerCount, startIdx)`)
     and trump suit cycle (`getTrumpSuit(roundIndex)`).
   - Live Screw the Dealer calculation (`getForbiddenDealerBid(cardsDealt,
     bids, dealerIndex, screwTheDealerEnabled)`).
   - Round validation (`sum(tricksWon) === cardsDealt` + Screw the Dealer check),
     scoring (`scoreRound`), `undoLastRound`, `getStandings`, and completion
     detection after the final scheduled round.
   ========================================================================== */

(function (global) {
  'use strict';

  const DEFAULT_EXACT_BONUS = 10;
  const TRUMP_SUITS = [
    { key: 'spades',   label: 'Spades',   symbol: '♠', color: '#111827' },
    { key: 'hearts',   label: 'Hearts',   symbol: '♥', color: '#dc2626' },
    { key: 'clubs',    label: 'Clubs',    symbol: '♣', color: '#111827' },
    { key: 'diamonds', label: 'Diamonds', symbol: '♦', color: '#dc2626' },
    { key: 'notrump',  label: 'No Trump', symbol: 'NT', color: '#475569' }
  ];

  function cleanStr(v) {
    return String(v ?? '').trim();
  }

  function clampInt(v, min, max) {
    const n = typeof v === 'number' ? Math.trunc(v) : parseInt(String(v ?? '').trim(), 10);
    if (!Number.isFinite(n)) return 0;
    return Math.max(min, Math.min(max, n));
  }

  function resolveRules(game) {
    const g = (game && typeof game === 'object') ? game : {};
    const hr =
      (g.ohHellRules && typeof g.ohHellRules === 'object' ? g.ohHellRules : null) ||
      (g.houseRules && typeof g.houseRules === 'object' ? g.houseRules : null) ||
      (g.scoringOverrides && g.scoringOverrides.houseRules && typeof g.scoringOverrides.houseRules === 'object' ? g.scoringOverrides.houseRules : null) ||
      (g.meta && g.meta.houseRules && typeof g.meta.houseRules === 'object' ? g.meta.houseRules : null) ||
      {};
    const ov = (g.scoringOverrides && typeof g.scoringOverrides === 'object') ? g.scoringOverrides : {};
    const version = cleanStr(g.version || g.versionLabel || g.variant);

    const exactBonus = hr.exactBonus !== undefined
      ? clampInt(hr.exactBonus, 0, 100)
      : DEFAULT_EXACT_BONUS;

    let missPointsPerTrick = 0;
    if (hr.missPointsPerTrick !== undefined) {
      missPointsPerTrick = clampInt(hr.missPointsPerTrick, 0, 10);
    } else if (hr.pointsOnMiss !== undefined) {
      missPointsPerTrick = hr.pointsOnMiss ? 1 : 0;
    } else if (/1 per trick/i.test(version)) {
      missPointsPerTrick = 1;
    }

    const screwTheDealer = hr.screwTheDealer !== undefined ? Boolean(hr.screwTheDealer) : true;
    const scheduleMode = cleanStr(hr.scheduleMode || g.scheduleMode || 'down_up').toLowerCase();
    const lowWins =
      hr.lowWins !== undefined
        ? Boolean(hr.lowWins)
        : (ov.lowWins !== undefined ? Boolean(ov.lowWins) : (typeof g.low === 'boolean' ? g.low : false));

    return {
      exactBonus,
      missPointsPerTrick,
      screwTheDealer,
      scheduleMode,
      lowWins
    };
  }

  /**
   * Generates the cards-per-round schedule for `playerCount`.
   * max = Math.min(10, Math.floor(51 / playerCount)) (keeps 1 card for trump).
   * Modes: 'down_up' (max..1..max, default), 'up_down' (1..max..1),
   *        'down_only' (max..1), 'up_only' (1..max).
   */
  function buildRoundSchedule(playerCount, mode) {
    const n = Math.max(2, Math.trunc(Number(playerCount) || 4));
    const max = Math.max(1, Math.min(10, Math.floor(51 / n)));
    const m = cleanStr(mode || 'down_up').toLowerCase();

    const up = [];
    for (let i = 1; i <= max; i++) up.push(i);
    const down = up.slice().reverse();

    if (m === 'up_down') {
      return up.concat(down.slice(1));
    }
    if (m === 'up_only') {
      return up;
    }
    if (m === 'down_only') {
      return down;
    }
    // Default 'down_up': max..1..max
    return down.concat(up.slice(1));
  }

  /**
   * Returns rotating dealer index for 0-based `roundIndex`.
   */
  function getDealerIndex(roundIndex, playerCount, initialDealer) {
    const n = Math.max(1, Math.trunc(Number(playerCount) || 4));
    const start = Math.max(0, Math.trunc(Number(initialDealer) || 0));
    const r = Math.max(0, Math.trunc(Number(roundIndex) || 0));
    return (start + r) % n;
  }

  /**
   * Returns suggested trump suit descriptor for 0-based `roundIndex`.
   */
  function getTrumpSuit(roundIndex) {
    const r = Math.max(0, Math.trunc(Number(roundIndex) || 0));
    return { ...TRUMP_SUITS[r % TRUMP_SUITS.length] };
  }

  /**
   * Live Screw the Dealer calculation.
   * Returns the exact integer bid the dealer is forbidden from making,
   * or `null` if Screw the Dealer is disabled, non-dealer bids are incomplete,
   * or the remaining difference is outside `0..cardsDealt`.
   */
  function getForbiddenDealerBid(cardsDealt, bids, dealerIndex, screwTheDealerEnabled) {
    if (!screwTheDealerEnabled) return null;
    const cards = Math.max(0, Math.trunc(Number(cardsDealt) || 0));
    const list = Array.isArray(bids) ? bids : [];
    if (!list.length || dealerIndex < 0 || dealerIndex >= list.length) return null;

    let otherSum = 0;
    for (let i = 0; i < list.length; i++) {
      if (i === dealerIndex) continue;
      const raw = list[i];
      if (raw === null || raw === undefined || raw === '' || !Number.isFinite(Number(raw))) {
        return null; // Wait until every non-dealer has entered a bid
      }
      otherSum += Math.trunc(Number(raw));
    }

    const forbidden = cards - otherSum;
    if (forbidden < 0 || forbidden > cards) return null;
    return forbidden;
  }

  function getStandings(state) {
    const players = Array.isArray(state && state.players) ? state.players : [];
    const rules = resolveRules(state);
    const list = players.map((p, idx) => ({
      playerIdx: idx,
      name: cleanStr(p && p.name) || `Player ${idx + 1}`,
      userId: (p && (p.userId || p.user_id)) || null,
      score: Number(p && p.score) || 0,
      exactHits: Number(p && p.exactHits) || 0
    }));

    list.sort((a, b) => {
      const cmp = rules.lowWins ? (a.score - b.score) : (b.score - a.score);
      return cmp !== 0 ? cmp : (a.playerIdx - b.playerIdx);
    });

    let rank = 1;
    list.forEach((entry, i) => {
      if (i > 0 && entry.score !== list[i - 1].score) {
        rank = i + 1;
      }
      entry.rank = rank;
      entry.isWinner = rank === 1;
    });

    return list;
  }

  function recomputeCompletion(state) {
    const rules = resolveRules(state);
    state.ohHellRules = rules;
    state.low = rules.lowWins;

    const totalRounds = Array.isArray(state.schedule) ? state.schedule.length : 0;
    const completed = (state.rounds || []).length;
    state.currentRoundIndex = completed;
    const isGameOver = totalRounds > 0 && completed >= totalRounds;
    const standings = getStandings(state);
    const winners = standings.filter((s) => s.isWinner);

    state.isGameOver = isGameOver;
    state.winnerNames = isGameOver ? winners.map((w) => w.name) : [];
    state.winner = state.winnerNames.join(', ');
    state.currentCards = !isGameOver && totalRounds > 0 ? state.schedule[completed] : null;
    state.currentDealerIndex = state.players.length
      ? getDealerIndex(completed, state.players.length, state.initialDealer || 0)
      : 0;
    state.currentTrump = getTrumpSuit(completed);

    return {
      isGameOver,
      standings,
      winnerNames: state.winnerNames,
      currentRoundIndex: completed,
      totalRounds,
      currentCards: state.currentCards,
      currentDealerIndex: state.currentDealerIndex,
      currentTrump: state.currentTrump
    };
  }

  /**
   * Initializes or normalizes an Oh Hell game state object.
   */
  function initState(gameOrPlayers, opts) {
    const isArray = Array.isArray(gameOrPlayers);
    const state = isArray
      ? {
          id: (opts && opts.id) || ('oh_' + Date.now().toString(36)),
          type: 'ohhell',
          gameName: 'Oh Hell',
          players: gameOrPlayers.map((p, i) =>
            typeof p === 'string'
              ? { name: cleanStr(p) || `Player ${i + 1}`, score: 0 }
              : { ...p, name: cleanStr(p && p.name) || `Player ${i + 1}`, score: Number(p && p.score) || 0 }
          ),
          ...(opts || {})
        }
      : (gameOrPlayers && typeof gameOrPlayers === 'object' ? gameOrPlayers : { players: [] });

    state.type = 'ohhell';
    state.gameName = state.gameName || 'Oh Hell';
    if (!Array.isArray(state.players)) state.players = [];
    state.players.forEach((p, i) => {
      p.name = cleanStr(p.name) || `Player ${i + 1}`;
      p.score = Number(p.score) || 0;
      p.exactHits = Math.max(0, Math.trunc(Number(p.exactHits) || 0));
    });

    const rules = resolveRules(state);
    state.ohHellRules = rules;
    if (!Array.isArray(state.schedule) || !state.schedule.length) {
      state.schedule = buildRoundSchedule(state.players.length || 4, rules.scheduleMode);
    }
    if (!Array.isArray(state.rounds)) state.rounds = [];
    if (typeof state.initialDealer !== 'number') state.initialDealer = 0;

    recomputeCompletion(state);
    return state;
  }

  /**
   * Validates and scores one Oh Hell round.
   * Each entry: `{ bid: number, tricksWon: number }` (or `{ bid, tricks }`).
   */
  function scoreRound(state, entries, opts) {
    initState(state);
    const options = opts || {};
    const rules = resolveRules(state);
    const players = state.players;
    const list = Array.isArray(entries) ? entries : [];

    if (!players.length) {
      return { ok: false, error: 'No players in game.' };
    }
    if (list.length !== players.length) {
      return { ok: false, error: `Expected ${players.length} round entries, got ${list.length}.` };
    }

    const roundIndex = state.rounds.length;
    const cardsDealt =
      options.cardsDealt !== undefined && Number(options.cardsDealt) > 0
        ? Math.trunc(Number(options.cardsDealt))
        : (state.schedule[roundIndex] || 1);
    const dealerIndex =
      options.dealerIndex !== undefined
        ? clampInt(options.dealerIndex, 0, players.length - 1)
        : getDealerIndex(roundIndex, players.length, state.initialDealer || 0);

    const normalized = [];
    let tricksSum = 0;
    const bids = [];

    for (let i = 0; i < list.length; i++) {
      const raw = (list[i] && typeof list[i] === 'object') ? list[i] : {};
      const bidRaw = raw.bid;
      const tricksRaw = raw.tricksWon !== undefined ? raw.tricksWon : raw.tricks;

      if (bidRaw === null || bidRaw === undefined || bidRaw === '' || !Number.isFinite(Number(bidRaw))) {
        return { ok: false, error: `Missing bid for ${players[i].name}.` };
      }
      if (tricksRaw === null || tricksRaw === undefined || tricksRaw === '' || !Number.isFinite(Number(tricksRaw))) {
        return { ok: false, error: `Missing tricks won for ${players[i].name}.` };
      }

      const bid = Math.trunc(Number(bidRaw));
      const tricksWon = Math.trunc(Number(tricksRaw));

      if (bid < 0 || bid > cardsDealt) {
        return { ok: false, error: `${players[i].name}'s bid (${bid}) must be between 0 and ${cardsDealt}.` };
      }
      if (tricksWon < 0 || tricksWon > cardsDealt) {
        return { ok: false, error: `${players[i].name}'s tricks (${tricksWon}) must be between 0 and ${cardsDealt}.` };
      }

      bids.push(bid);
      tricksSum += tricksWon;
      normalized.push({ bid, tricksWon });
    }

    if (tricksSum !== cardsDealt) {
      return {
        ok: false,
        error: `Total tricks won (${tricksSum}) must equal cards dealt (${cardsDealt}).`
      };
    }

    if (rules.screwTheDealer && options.enforceScrewTheDealer !== false) {
      const forbidden = getForbiddenDealerBid(cardsDealt, bids, dealerIndex, true);
      if (forbidden !== null && bids[dealerIndex] === forbidden) {
        return {
          ok: false,
          error: `Screw the Dealer: total bids cannot equal ${cardsDealt} (${players[dealerIndex].name} cannot bid ${forbidden}).`,
          forbiddenBid: forbidden
        };
      }
    }

    const prevScores = players.map((p) => Number(p.score) || 0);
    const prevExactHits = players.map((p) => Number(p.exactHits) || 0);

    const deltas = normalized.map((e) => {
      const hit = e.tricksWon === e.bid;
      if (hit) return rules.exactBonus + e.tricksWon;
      return rules.missPointsPerTrick > 0 ? e.tricksWon * rules.missPointsPerTrick : 0;
    });

    players.forEach((p, idx) => {
      p.score = prevScores[idx] + deltas[idx];
      if (normalized[idx].tricksWon === normalized[idx].bid) {
        p.exactHits = prevExactHits[idx] + 1;
      }
    });

    const trump = options.trump || getTrumpSuit(roundIndex).key;
    const record = {
      roundNumber: roundIndex + 1,
      ts: new Date().toISOString(),
      cardsDealt,
      dealerIndex,
      dealerName: players[dealerIndex].name,
      trump,
      prev: prevScores,
      prevExactHits,
      deltas,
      entries: normalized.map((e, i) => ({
        ...e,
        exact: e.tricksWon === e.bid,
        points: deltas[i]
      }))
    };

    state.rounds.push(record);
    const status = recomputeCompletion(state);
    return {
      ok: true,
      round: record,
      deltas,
      ...status
    };
  }

  /**
   * Undoes the most recent Oh Hell round and restores exact previous totals.
   */
  function undoLastRound(state) {
    initState(state);
    if (!state.rounds.length) {
      return { ok: false, error: 'No rounds to undo.' };
    }
    const last = state.rounds.pop();
    state.players.forEach((p, idx) => {
      if (Array.isArray(last.prev) && last.prev[idx] !== undefined) {
        p.score = Number(last.prev[idx]) || 0;
      } else if (Array.isArray(last.deltas) && last.deltas[idx] !== undefined) {
        p.score = (Number(p.score) || 0) - (Number(last.deltas[idx]) || 0);
      }
      if (Array.isArray(last.prevExactHits) && last.prevExactHits[idx] !== undefined) {
        p.exactHits = last.prevExactHits[idx];
      }
    });

    const status = recomputeCompletion(state);
    return { ok: true, undone: last, ...status };
  }

  const api = {
    DEFAULT_EXACT_BONUS,
    TRUMP_SUITS,
    resolveRules,
    buildRoundSchedule,
    getDealerIndex,
    getTrumpSuit,
    getForbiddenDealerBid,
    initState,
    scoreRound,
    undoLastRound,
    getStandings
  };

  global.TallyItOhHell = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
