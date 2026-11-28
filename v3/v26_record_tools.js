/* ==========================================================================
   TallyIt v26 - Past game detail + editing (window.TallyItRecordTools + module.exports)

   describeRecord(record, opts)          -> display model (players, placements, rounds, totals)
   recomputeRecord(record, edits, opts)  -> { ok, record, errors, warnings, changes }
   canEditRecord(record, user)           -> { canEdit, readOnly, reason }
   buildSharedEdit(before, after)        -> { game_id, game, participants } for the Supabase save path

   Works with local history records (players + rounds[{prev,deltas,...}]) and
   normalized shared rows (social_auth normalizeGameRow output). Records with
   no usable round data fall back to final scores only.
   Covers all 11 games: flip7, 7wonders, carcassonne, catan, ohhell, hearts,
   nertz, rummikub, qwirkle, spoons, other.
   ========================================================================== */
(function (global) {
  'use strict';

  const GAMES = {
    flip7:       { name: 'Flip 7',      low: false, unit: 'Round' },
    '7wonders':  { name: '7 Wonders',   low: false, unit: null },
    carcassonne: { name: 'Carcassonne', low: false, unit: 'Score' },
    catan:       { name: 'Catan',       low: false, unit: 'Turn' },
    ohhell:      { name: 'Oh Hell',     low: false, unit: 'Round' },
    hearts:      { name: 'Hearts',      low: true,  unit: 'Hand' },
    nertz:       { name: 'Nertz',       low: false, unit: 'Round' },
    rummikub:    { name: 'Rummikub',    low: true,  unit: 'Round' },
    qwirkle:     { name: 'Qwirkle',     low: false, unit: 'Turn' },
    spoons:      { name: 'Spoons',      low: false, unit: 'Round' },
    other:       { name: 'Custom',      low: false, unit: 'Round' }
  };
  const ALIASES = { seven_wonders: '7wonders', 'seven-wonders': '7wonders', '7_wonders': '7wonders', flip_7: 'flip7', 'flip-7': 'flip7',
    oh_hell: 'ohhell', 'oh-hell': 'ohhell', custom: 'other', settlers: 'catan' };
  const CATAN_CATS = [
    { key: 'settlements', label: 'Settlements', vp: 1 }, { key: 'cities', label: 'Cities', vp: 2 },
    { key: 'longestRoad', label: 'Longest Road', vp: 2 }, { key: 'largestArmy', label: 'Largest Army', vp: 2 },
    { key: 'vpCards', label: 'VP Cards', vp: 1 }
  ];
  const SW_CATS = ['military', 'treasury', 'wonder', 'civilian', 'commercial', 'guilds', 'science', 'leaders', 'cities', 'armada'];

  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
  function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
  function gameKeyOf(rec) {
    const k = String((rec && (rec.game_key || rec.type || rec.game_type || (rec.meta && rec.meta.game_key))) || 'other').trim().toLowerCase();
    const g = ALIASES[k] || k;
    return GAMES[g] ? g : 'other';
  }
  function lib(name, path) {
    if (global[name]) return global[name];
    try { if (typeof require === 'function') return require(path); } catch (e) {}
    return null;
  }
  const Hearts = () => lib('TallyItHearts', './hearts_scoring.js');
  const OhHell = () => lib('TallyItOhHell', './ohhell_scoring.js');
  const SW = () => lib('SevenWondersLogic', './seven_wonders_logic.js');

  function isLow(rec, gk) {
    if (typeof rec.lowWins === 'boolean') return rec.lowWins;
    if (typeof rec.low === 'boolean') return rec.low;
    if (rec.meta && typeof rec.meta.low === 'boolean') return rec.meta.low;
    if (gk === 'rummikub') return rec.rkScoringMode === 'points_up';
    return GAMES[gk].low;
  }
  function playerName(rec, p) {
    if (!p) return '';
    if (gameKeyOf(rec) === 'nertz' && Array.isArray(p.members) && p.members.length && !p.name) return p.members.map((m) => m.name).join(' & ');
    return String(p.name || p.display_name || '').trim();
  }
  function playerUserId(p) { return (p && (p.userId || p.user_id)) || null; }

  // ---------------- round data detection ----------------
  // Converts module-style qwirkle rounds ({playerIdx, score}) to engine deltas.
  function normalizeRounds(rec) {
    const n = (rec.players || []).length;
    const raw = Array.isArray(rec.rounds) ? rec.rounds : [];
    return raw.map((r) => {
      if (!r || typeof r !== 'object') return null;
      if (Array.isArray(r.deltas) && r.deltas.length === n) return r;
      if (typeof r.playerIdx === 'number' && r.score != null) {
        const deltas = Array.from({ length: n }, (_, i) => (i === r.playerIdx ? num(r.score) : 0));
        return { ...r, by: r.playerIdx, deltas };
      }
      return null;
    });
  }
  function usableRounds(rec, gk) {
    if (gk === 'spoons' || gk === '7wonders') return false;
    const rs = normalizeRounds(rec);
    return rs.length > 0 && rs.every(Boolean);
  }
  function spoonsEliminations(rec) {
    const m = rec.meta || {};
    const src = (m.spoons && m.spoons.eliminations) || m.eliminations;
    if (Array.isArray(src) && src.length) return src.map((e) => ({ player: e.player, round: num(e.round) }));
    const rs = Array.isArray(rec.rounds) ? rec.rounds : [];
    const fromRounds = rs.map((r, i) => r && (r.eliminated || (r.detail && r.detail.eliminated))
      ? { player: r.eliminated || r.detail.eliminated, round: num(r.round || (r.detail && r.detail.round) || i + 1) } : null).filter(Boolean);
    if (fromRounds.length) return fromRounds;
    return (rec.players || []).filter((p) => p.eliminatedRound != null).map((p) => ({ player: p.name, round: num(p.eliminatedRound) }))
      .sort((a, b) => a.round - b.round);
  }

  // ---------------- placements ----------------
  function rankBy(rows, cmp) {
    const order = rows.map((r, i) => ({ r, i })).sort((a, b) => cmp(a.r, b.r) || a.i - b.i);
    let place = 1;
    order.forEach((o, k) => { if (k > 0 && cmp(order[k - 1].r, o.r) !== 0) place = k + 1; o.r.place = place; });
    return rows;
  }
  function computePlacements(rec, gk, scores, extra) {
    const rows = scores.map((s, i) => ({ index: i, score: s }));
    if (gk === 'spoons') {
      const elim = extra.eliminations || [];
      const n = rows.length;
      const outPos = {}; elim.forEach((e, k) => { outPos[String(e.player).toLowerCase()] = k; });
      const names = (rec.players || []).map((p) => playerName(rec, p).toLowerCase());
      const remaining = names.filter((nm) => !(nm in outPos)).length;
      rows.forEach((r) => {
        const k = outPos[names[r.index]];
        r.place = k == null ? 1 : n - k;
        r.score = n - r.place;
        r.eliminatedRound = k == null ? null : elim[k].round;
      });
      rows.forEach((r) => { r.isWinner = remaining === 1 && r.place === 1; });
      return rows;
    }
    const low = isLow(rec, gk);
    const coins = extra.coins || [];
    rankBy(rows, (a, b) => {
      const d = low ? a.score - b.score : b.score - a.score;
      if (d) return d;
      if (gk === '7wonders') return num(coins[b.index]) - num(coins[a.index]);
      return 0;
    });
    rows.forEach((r) => { r.isWinner = rows.length > 0 && r.place === 1; });
    return rows;
  }

  // ---------------- score computation ----------------
  function catanScore(bd) { return CATAN_CATS.reduce((s, c) => s + num(bd && bd[c.key]) * c.vp, 0); }
  function hasCatanBreakdown(rec) {
    return (rec.players || []).some((p) => p.breakdown && CATAN_CATS.some((c) => num(p.breakdown[c.key])));
  }
  function swTotals(rec) {
    const L = SW();
    return (rec.players || []).map((p) => {
      if (L && p.scores) { const c = L.swComputePlayerTotal(p, rec.expansions || (rec.meta && rec.meta.expansions)); return { score: c.total, coins: c.coins, treasuryVp: c.treasuryVp, scienceVp: c.scienceVp }; }
      return { score: num(p.score), coins: num(p.coins != null ? p.coins : p.tiebreakCoins) };
    });
  }

  // Replays rounds so prev/deltas are consistent; handles Flip 7 resets.
  function rebuildRounds(rounds, n) {
    const running = Array(n).fill(0);
    return rounds.map((r) => {
      const prev = running.slice();
      let deltas = r.deltas.map(num);
      if (r.mode === 'reset') deltas = prev.map((s) => -s);
      deltas.forEach((d, i) => { running[i] += d; });
      return { ...r, prev, deltas };
    });
  }
  function sumRounds(rounds, n) {
    const t = Array(n).fill(0);
    rebuildRounds(rounds, n).forEach((r) => r.deltas.forEach((d, i) => { t[i] += d; }));
    return t;
  }

  function roundLabel(gk, r, k, rec) {
    const names = (rec.players || []).map((p) => playerName(rec, p));
    if (gk === 'hearts') return 'Hand ' + (r.handNumber || k + 1) + (r.passLabel ? ' (' + r.passLabel + ')' : '');
    if (gk === 'ohhell') return 'Round ' + (r.roundNumber || k + 1) + (r.cardsDealt ? ' (' + r.cardsDealt + ' cards' + (r.trump ? ', ' + r.trump : '') + ')' : '');
    if (r.mode === 'reset') return 'Scores reset';
    if (r.mode === 'edit_adjustment') return 'Score correction';
    const by = typeof r.by === 'number' && names[r.by] ? ' (' + names[r.by] + ')' : '';
    return (GAMES[gk].unit || 'Round') + ' ' + (k + 1) + by;
  }
  function roundDetail(gk, r) {
    if (gk === 'hearts' && Array.isArray(r.entries)) return { entries: r.entries, shooterIdx: r.shooterIdx != null ? r.shooterIdx : -1 };
    if (gk === 'ohhell' && Array.isArray(r.entries)) return { entries: r.entries.map((e) => ({ bid: e.bid, tricksWon: e.tricksWon, exact: e.exact })) };
    if (r.detail && typeof r.detail === 'object') return clone(r.detail);
    return null;
  }

  // ======================= describeRecord =======================
  function describeRecord(record, opts) {
    opts = opts || {};
    const rec = record || {};
    const gk = gameKeyOf(rec);
    const players = Array.isArray(rec.players) ? rec.players : [];
    const n = players.length;
    const notes = [];
    let mode = 'final_only';
    let scores = players.map((p) => num(p.score));
    let rounds = [];
    let categories = null;
    const extra = {};

    if (gk === 'spoons') {
      extra.eliminations = spoonsEliminations(rec);
      if (extra.eliminations.length) {
        mode = 'eliminations';
        rounds = extra.eliminations.map((e, k) => ({ number: k + 1, label: 'Round ' + e.round, eliminated: e.player, deltas: null, running: null }));
      }
    } else if (gk === '7wonders') {
      const t = swTotals(rec);
      extra.coins = t.map((x) => x.coins);
      if (players.some((p) => p.scores)) {
        mode = 'categories';
        scores = t.map((x) => x.score);
        const keys = SW_CATS.filter((k) => players.some((p) => (k === 'science' ? p.science : p.scores && p.scores[k] != null)));
        categories = keys.map((k) => ({
          key: k, label: k[0].toUpperCase() + k.slice(1),
          values: players.map((p, i) => (k === 'science' ? t[i].scienceVp : k === 'treasury' ? t[i].treasuryVp : num(p.scores && p.scores[k])))
        }));
        if (keys.includes('treasury')) categories.push({ key: 'coins', label: 'Coins (tiebreak)', values: extra.coins, tiebreakOnly: true });
      }
    } else if (usableRounds(rec, gk)) {
      mode = 'rounds';
      const built = rebuildRounds(normalizeRounds(rec), n);
      const run = Array(n).fill(0);
      rounds = built.map((r, k) => {
        r.deltas.forEach((d, i) => { run[i] += d; });
        return { number: k + 1, index: k, label: roundLabel(gk, r, k, rec), by: typeof r.by === 'number' ? r.by : null, mode: r.mode || null,
          deltas: r.deltas.slice(), running: run.slice(), detail: roundDetail(gk, r), ts: r.ts || null };
      });
      const computed = run.slice();
      if (computed.some((s, i) => s !== scores[i])) notes.push('Round totals differ from the saved final scores; showing saved finals.');
    } else if (Array.isArray(rec.rounds) && rec.rounds.length) {
      notes.push('Round data is incomplete for this game; showing final scores only.');
    } else {
      notes.push('No round data saved for this game; showing final scores only.');
    }

    if (gk === 'catan' && hasCatanBreakdown(rec)) {
      categories = CATAN_CATS.map((c) => ({ key: c.key, label: c.label, vp: c.vp, values: players.map((p) => num(p.breakdown && p.breakdown[c.key])) }));
      if (mode === 'final_only') mode = 'categories';
    }

    const ranked = computePlacements(rec, gk, scores, extra);
    const outRows = players.map((p, i) => {
      const r = ranked[i];
      const o = { index: i, name: playerName(rec, p), userId: playerUserId(p), isGuest: !playerUserId(p) && !(p.members && p.members.some((m) => m.userId)),
        score: gk === 'spoons' ? r.score : scores[i], place: r.place, isWinner: r.isWinner };
      if (Array.isArray(p.members) && p.members.length) o.members = p.members.map((m) => ({ name: m.name, userId: m.userId || m.user_id || null }));
      if (gk === 'spoons') o.eliminatedRound = r.eliminatedRound;
      if (gk === '7wonders') { o.coins = extra.coins[i]; if (p.wonder) o.wonder = p.wonder; }
      if (gk === 'catan' && p.breakdown) o.breakdown = { ...p.breakdown };
      return o;
    });
    const placeMap = {};
    outRows.forEach((r) => { (placeMap[r.place] = placeMap[r.place] || []).push(r.name); });
    const placements = Object.keys(placeMap).map(Number).sort((a, b) => a - b).map((pl) => ({ place: pl, names: placeMap[pl], tied: placeMap[pl].length > 1 }));
    const winnerNames = outRows.filter((r) => r.isWinner).map((r) => r.name);

    return {
      gameKey: gk,
      gameName: rec.gameName || GAMES[gk].name,
      version: rec.version || null,
      variation: rec.variation_name || rec.variationName || (rec.variation && (rec.variation.name || rec.variation)) || rec.variation_key || rec.version || null,
      id: rec.id || rec.client_game_id || null,
      date: rec.endTime || rec.date || rec.ended_at || null,
      lowWins: gk === 'spoons' ? false : isLow(rec, gk),
      target: rec.target != null ? rec.target : null,
      mode,                       // 'rounds' | 'categories' | 'eliminations' | 'final_only'
      hasRounds: mode === 'rounds' || mode === 'eliminations',
      columns: outRows.map((r) => r.name),
      players: outRows,
      placements,
      rounds,
      categories,
      totals: outRows.map((r) => r.score),
      winnerNames,
      winner: winnerNames.join(', '),
      edited: rec.meta && rec.meta.edited ? clone(rec.meta.edited) : null,
      notes
    };
  }

  // ======================= permissions =======================
  function canEditRecord(record, user) {
    const rec = record || {};
    const uid = user && (user.id || user.user_id || user.userId || (typeof user === 'string' ? user : null));
    const creator = rec.created_by || rec.createdBy || (rec.meta && rec.meta.created_by) || null;
    if (!creator) return { canEdit: true, readOnly: false, reason: 'local' };          // local-only record on this device
    if (uid && uid === creator) return { canEdit: true, readOnly: false, reason: 'creator' };
    const linked = uid && (rec.players || []).concat(rec.participants || []).some((p) =>
      playerUserId(p) === uid || (Array.isArray(p.members) && p.members.some((m) => (m.userId || m.user_id) === uid)));
    return { canEdit: false, readOnly: true, reason: linked ? 'linked_player' : 'not_creator' };
  }

  // ======================= recomputeRecord =======================
  /* edits:
       players:   [{ index, name?, score? }]   score only for final-only games (or adds a correction round)
       rounds:    [{ index, deltas?, entries?, delete? }]   entries = hearts/ohhell hand input; replayed through the module
       addRounds: [{ deltas, by?, label? }]
       categories:[{ index, key, value }]       catan breakdown keys / 7 Wonders score keys (+ 'coins', science.{tablets,compasses,gears,wilds})
       eliminationOrder: [names...]             spoons, first out first
       lowWins?, target?
     opts: { user, now, enforcePermission (default true when user given) } */
  function recomputeRecord(record, edits, opts) {
    edits = edits || {}; opts = opts || {};
    const errors = [], warnings = [], changes = [];
    if (!record || !Array.isArray(record.players)) return { ok: false, record: record, errors: ['Record has no players'], warnings, changes };
    if (opts.user && opts.enforcePermission !== false) {
      const perm = canEditRecord(record, opts.user);
      if (!perm.canEdit) return { ok: false, record: record, errors: ['Only the game creator can edit this game (' + perm.reason + ')'], warnings, changes };
    }
    const rec = clone(record);
    const gk = gameKeyOf(rec);
    const n = rec.players.length;
    const oldNames = rec.players.map((p) => playerName(rec, p));
    const hadRounds = usableRounds(rec, gk);
    if (hadRounds) rec.rounds = normalizeRounds(rec);

    if (typeof edits.lowWins === 'boolean' && gk !== 'spoons') { rec.lowWins = edits.lowWins; changes.push('lowWins'); }
    if (edits.target !== undefined) { rec.target = edits.target == null || edits.target === '' ? null : num(edits.target); changes.push('target'); }

    // ---- names ----
    const scoreEdits = [];
    (edits.players || []).forEach((e) => {
      const p = rec.players[e.index];
      if (!p) { errors.push('Unknown player index ' + e.index); return; }
      if (e.name != null && String(e.name).trim() !== oldNames[e.index]) {
        const nm = String(e.name).trim();
        if (!nm) errors.push('Name cannot be blank');
        else if (playerUserId(p)) errors.push(oldNames[e.index] + ' is a linked account; their name comes from their profile');
        else if (oldNames.some((o, i) => i !== e.index && o.toLowerCase() === nm.toLowerCase())) errors.push('Duplicate name: ' + nm);
        else { p.name = nm; if (p.display_name != null) p.display_name = nm; changes.push('rename:' + e.index); }
      }
      if (e.score != null) scoreEdits.push(e);
    });

    // ---- rounds ----
    if (gk === 'spoons') {
      if (edits.eliminationOrder) {
        const order = edits.eliminationOrder.map((x) => String(x).trim());
        const lower = rec.players.map((p) => playerName(rec, p).toLowerCase());
        const bad = order.filter((x) => !lower.includes(x.toLowerCase()));
        const dup = order.length !== new Set(order.map((x) => x.toLowerCase())).size;
        if (bad.length) errors.push('Unknown players in elimination order: ' + bad.join(', '));
        else if (dup) errors.push('A player can only be eliminated once');
        else if (order.length > n - 1) errors.push('At most ' + (n - 1) + ' eliminations (one player must remain)');
        else {
          const elim = order.map((x, k) => ({ player: rec.players[lower.indexOf(x.toLowerCase())].name, playerIndex: lower.indexOf(x.toLowerCase()), round: k + 1 }));
          rec.meta = rec.meta || {};
          rec.meta.spoons = { ...(rec.meta.spoons || {}), eliminations: elim, roundsPlayed: elim.length, finished: elim.length === n - 1 };
          rec.rounds = elim.map((e) => ({ ts: null, by: e.playerIndex, mode: 'spoons', prev: [], deltas: [], detail: { round: e.round, eliminated: e.player } }));
          changes.push('eliminations');
        }
      }
      if (scoreEdits.length) errors.push('Spoons scores come from the elimination order; edit that instead');
    } else if (gk === '7wonders') {
      (edits.categories || []).forEach((c) => {
        const p = rec.players[c.index];
        if (!p) { errors.push('Unknown player index ' + c.index); return; }
        const v = num(c.value);
        if (c.key === 'coins') { p.scores = p.scores || {}; p.scores.treasury = v; }
        else if (/^science\./.test(c.key)) { p.science = p.science || {}; p.science[c.key.split('.')[1]] = v; }
        else if (SW_CATS.includes(c.key)) { p.scores = p.scores || {}; p.scores[c.key] = v; }
        else { errors.push('Unknown 7 Wonders category ' + c.key); return; }
        changes.push('cat:' + c.index + ':' + c.key);
      });
      if (scoreEdits.length && rec.players.some((p) => p.scores)) errors.push('7 Wonders totals come from categories; edit those instead');
      else scoreEdits.forEach((e) => { rec.players[e.index].score = num(e.score); changes.push('score:' + e.index); });
    } else {
      if (gk === 'catan') {
        (edits.categories || []).forEach((c) => {
          const p = rec.players[c.index];
          if (!p) { errors.push('Unknown player index ' + c.index); return; }
          if (!CATAN_CATS.some((x) => x.key === c.key)) { errors.push('Unknown Catan category ' + c.key); return; }
          const v = num(c.value);
          if (v < 0) { errors.push('Catan counts cannot be negative'); return; }
          if ((c.key === 'longestRoad' || c.key === 'largestArmy') && v > 1) { errors.push(c.key + ' is 0 or 1'); return; }
          p.breakdown = { ...(p.breakdown || {}), [c.key]: v };
          changes.push('cat:' + c.index + ':' + c.key);
        });
        ['longestRoad', 'largestArmy'].forEach((k) => {
          if (rec.players.filter((p) => num(p.breakdown && p.breakdown[k]) > 0).length > 1) errors.push('Only one player can hold ' + k);
        });
      }
      const roundEdits = edits.rounds || [];
      const needsReplay = roundEdits.some((r) => r.entries) && (gk === 'hearts' || gk === 'ohhell');
      if ((roundEdits.length || (edits.addRounds || []).length) && !hadRounds) {
        errors.push('This game has no round data; edit final scores instead');
      } else if (hadRounds) {
        roundEdits.forEach((r) => {
          const cur = rec.rounds[r.index];
          if (!cur) { errors.push('Unknown round ' + r.index); return; }
          if (r.delete) { cur._delete = true; changes.push('delround:' + r.index); return; }
          if (r.deltas) {
            if (!Array.isArray(r.deltas) || r.deltas.length !== n || r.deltas.some((d) => !Number.isFinite(Number(d)))) { errors.push('Round ' + (r.index + 1) + ' needs ' + n + ' numeric scores'); return; }
            cur.deltas = r.deltas.map(num);
            if (cur.detail && Array.isArray(cur.detail.entries)) cur.detail.entries.forEach((en) => { if (en && typeof en.idx === 'number') { en.delta = cur.deltas[en.idx]; if ('net' in en) en.net = en.delta; } });
            cur.edited = true; changes.push('round:' + r.index);
          }
          if (r.entries) { cur.entries = clone(r.entries); cur.edited = true; changes.push('entries:' + r.index); }
        });
        rec.rounds = rec.rounds.filter((r) => !r._delete);
        (edits.addRounds || []).forEach((a) => {
          if (!Array.isArray(a.deltas) || a.deltas.length !== n) { errors.push('New round needs ' + n + ' scores'); return; }
          rec.rounds.push({ ts: opts.now || new Date().toISOString(), by: typeof a.by === 'number' ? a.by : null, mode: 'manual', deltas: a.deltas.map(num), detail: a.label ? { label: a.label } : null, edited: true });
          changes.push('addround');
        });
        if (needsReplay && !errors.length) replayCardGame(rec, gk, errors, warnings);
        // direct score edits on a game with rounds -> correction round so history stays consistent
        if (scoreEdits.length && !errors.length) {
          const cur = sumRounds(rec.rounds, n);
          const deltas = Array(n).fill(0);
          scoreEdits.forEach((e) => { deltas[e.index] = num(e.score) - cur[e.index]; });
          if (deltas.some(Boolean)) { rec.rounds.push({ ts: opts.now || new Date().toISOString(), by: null, mode: 'edit_adjustment', deltas, detail: { reason: 'final score edited' }, edited: true }); warnings.push('Added a score-correction round so round totals match the edited finals'); changes.push('adjustment'); }
        }
      } else {
        scoreEdits.forEach((e) => {
          if (!Number.isFinite(Number(e.score))) { errors.push('Score must be a number'); return; }
          rec.players[e.index].score = num(e.score); changes.push('score:' + e.index);
        });
      }
    }

    if (errors.length) return { ok: false, record: clone(record), errors, warnings, changes: [] };

    // ---- recompute totals ----
    let scores = rec.players.map((p) => num(p.score));
    const extra = {};
    if (gk === 'spoons') extra.eliminations = spoonsEliminations(rec);
    else if (gk === '7wonders') {
      const L = SW();
      if (L && rec.players.some((p) => p.scores)) {
        rec.players.forEach((p) => { const c = L.swComputePlayerTotal(p, rec.expansions || (rec.meta && rec.meta.expansions)); p.score = c.total; p.coins = c.coins; p.tiebreakCoins = c.coins; p.treasuryVp = c.treasuryVp; p.scienceVp = c.scienceVp; });
      }
      scores = rec.players.map((p) => num(p.score));
      extra.coins = rec.players.map((p) => num(p.coins != null ? p.coins : p.tiebreakCoins));
    } else if (usableRounds(rec, gk)) {
      rec.rounds = rebuildRounds(rec.rounds, n);
      scores = sumRounds(rec.rounds, n);
      if (gk === 'catan' && (edits.categories || []).length) {
        // breakdown edits: rounds kept as history, final VP follows the breakdown via a correction round
        const target = rec.players.map((p) => catanScore(p.breakdown));
        const d = target.map((t, i) => t - scores[i]);
        if (d.some(Boolean)) { rec.rounds.push({ ts: opts.now || new Date().toISOString(), by: null, mode: 'edit_adjustment', prev: scores.slice(), deltas: d, detail: { reason: 'breakdown edited' }, edited: true }); scores = target; warnings.push('Added a score-correction round to match the edited breakdown'); }
      }
    } else if (gk === 'catan' && hasCatanBreakdown(rec)) {
      scores = rec.players.map((p) => catanScore(p.breakdown));
    }

    const ranked = computePlacements(rec, gk, scores, extra);
    rec.players.forEach((p, i) => {
      p.score = gk === 'spoons' ? ranked[i].score : scores[i];
      p.place = ranked[i].place;
      p.isWinner = ranked[i].isWinner;
      if (gk === 'spoons') p.eliminatedRound = ranked[i].eliminatedRound;
    });
    const winners = rec.players.filter((p) => p.isWinner);
    const winnerNames = winners.map((p) => (gk === 'nertz' && Array.isArray(p.members) && p.members.length ? (p.name || p.members.map((m) => m.name).join(' & ')) : playerName(rec, p)));
    rec.winner = winnerNames.join(', ');
    rec.winnerNames = winnerNames;
    if (rec.winner_names) rec.winner_names = winnerNames.slice();
    if (rec.summary && rec.summary.winner_names) rec.summary.winner_names = winnerNames.slice();

    // renames inside round details
    rec.players.forEach((p, i) => {
      const nm = playerName(rec, p);
      if (nm === oldNames[i]) return;
      (rec.rounds || []).forEach((r) => {
        if (r.detail && Array.isArray(r.detail.entries)) r.detail.entries.forEach((en) => { if (en && en.idx === i) en.name = nm; });
        if (r.detail && r.detail.eliminated === oldNames[i]) r.detail.eliminated = nm;
        if (r.dealerName === oldNames[i]) r.dealerName = nm;
      });
      if (rec.meta && rec.meta.spoons && Array.isArray(rec.meta.spoons.eliminations)) rec.meta.spoons.eliminations.forEach((e) => { if (e.player === oldNames[i]) e.player = nm; });
    });
    if (gk === 'spoons') {
      rec.meta = rec.meta || {};
      rec.meta.spoons = { ...(rec.meta.spoons || {}), placements: rec.players.map((p) => ({ name: p.name, place: p.place })) };
    }

    // shared participants mirror
    if (Array.isArray(rec.participants)) {
      rec.participants.forEach((pp, k) => {
        const p = rec.players[k];
        if (!p || (Array.isArray(p.members) && p.members.length)) return;
        pp.score = p.score; pp.is_winner = p.isWinner;
        if (!pp.user_id) pp.display_name = playerName(rec, p);
      });
      if (gk === 'nertz') syncNertzParticipants(rec);
    }

    rec.meta = rec.meta || {};
    const uid = opts.user && (opts.user.id || opts.user.user_id || opts.user.userId || (typeof opts.user === 'string' ? opts.user : null));
    if (changes.length) {
      const prevCount = rec.meta.edited ? num(rec.meta.edited.count) : 0;
      rec.meta.edited = { at: opts.now || new Date().toISOString(), by: uid || null, count: prevCount + 1 };
    }
    return { ok: true, record: rec, errors, warnings, changes };
  }

  function syncNertzParticipants(rec) {
    rec.participants.forEach((pp) => {
      const team = rec.players.find((p) => Array.isArray(p.members) && p.members.some((m) => (m.userId && m.userId === pp.user_id) || m.name === pp.name || m.name === pp.display_name));
      if (team) { pp.score = team.score; pp.is_winner = team.isWinner; }
    });
  }

  // Hearts / Oh Hell: replay every hand through the scoring module so moon shots,
  // exact bids and house rules stay correct after an entry edit.
  function replayCardGame(rec, gk, errors, warnings) {
    const M = gk === 'hearts' ? Hearts() : OhHell();
    if (!M) { errors.push('Scoring module for ' + gk + ' is not loaded'); return; }
    const missing = rec.rounds.findIndex((r) => !Array.isArray(r.entries));
    if (missing >= 0) { errors.push('Round ' + (missing + 1) + ' has no hand details, so it cannot be replayed; edit its scores instead'); return; }
    const base = { houseRules: rec.houseRules, ohHellRules: rec.ohHellRules, meta: rec.meta && rec.meta.houseRules ? { houseRules: rec.meta.houseRules } : undefined, rules: rec.rules, scoringOverrides: rec.scoringOverrides, target: rec.target, lowWins: rec.lowWins,
      schedule: rec.schedule, initialDealer: rec.initialDealer, variation: rec.variation, version: rec.version };
    Object.keys(base).forEach((k) => base[k] === undefined && delete base[k]);
    const st = M.initState(rec.players.map((p) => ({ name: playerName(rec, p) })), base);
    const out = [];
    for (let k = 0; k < rec.rounds.length; k++) {
      const r = rec.rounds[k];
      let res;
      if (gk === 'hearts') {
        res = M.scoreHand(st, r.entries.map((e) => ({ hearts: e.hearts, queenOfSpades: e.queenOfSpades, jackOfDiamonds: e.jackOfDiamonds, shotMoon: e.shotMoon, overridePoints: e.overridePoints })), { force: true, allowOverride: true });
      } else {
        const o = {}; if (r.cardsDealt) o.cardsDealt = r.cardsDealt; if (r.dealerIndex != null) o.dealerIndex = r.dealerIndex; if (r.trump) o.trump = r.trump;
        res = M.scoreRound(st, r.entries.map((e) => ({ bid: e.bid, tricksWon: e.tricksWon })), { ...o, enforceScrewTheDealer: false });
      }
      if (res && res.ok === false) { errors.push('Round ' + (k + 1) + ': ' + (res.error || 'invalid')); return; }
      const nr = st.rounds[st.rounds.length - 1];
      out.push({ ...nr, edited: r.edited || undefined });
    }
    rec.rounds = out;
    if (gk === 'hearts') rec.hands = out.slice();
    rec.players.forEach((p, i) => {
      ['moonShots', 'queenHits', 'exactHits'].forEach((k) => { if (st.players[i][k] != null) p[k] = st.players[i][k]; });
    });
  }

  // ======================= shared save helper =======================
  // Shape for social_auth saveSharedGame / an UPDATE of score_history + game_participants.
  function buildSharedEdit(before, after) {
    const rec = after || {};
    const gk = gameKeyOf(rec);
    const payload = clone(rec);
    ['id', 'client_game_id', 'group_name', 'participants'].forEach((k) => delete payload[k]);
    const participants = [];
    let seat = 0;
    (rec.players || []).forEach((p) => {
      if (Array.isArray(p.members) && p.members.length) {
        p.members.forEach((m) => participants.push({ seat_order: seat++, user_id: m.userId || m.user_id || null, display_name: m.name, score: p.score, is_winner: !!p.isWinner }));
      } else {
        participants.push({ seat_order: seat++, user_id: playerUserId(p), display_name: playerName(rec, p), score: num(p.score), is_winner: !!p.isWinner });
      }
    });
    const prevWinner = before ? (before.winner || '') : null;
    return {
      game_id: rec.id || null,
      client_game_id: rec.client_game_id || (before && before.client_game_id) || null,
      game: { game_type: gk, winner: rec.winner || '', target: rec.target != null ? rec.target : null, payload },
      participants,
      winnerChanged: before ? prevWinner !== (rec.winner || '') : true
    };
  }

  const api = { GAMES, CATAN_CATS, gameKeyOf, describeRecord, recomputeRecord, canEditRecord, buildSharedEdit };
  global.TallyItRecordTools = api;
  // Convenience aliases requested by Score Tracker UI
  function roundsFor(record) {
    const d = describeRecord(record);
    const rows = d.mode === 'eliminations'
      ? d.rounds.map((r) => ({ label: r.label, cells: d.players.map((p) => (p.name === r.eliminated ? 'Out' : '')), eliminated: r.eliminated }))
      : d.mode === 'categories' && d.categories
        ? d.categories.map((c) => ({ label: c.label, cells: c.values.slice(), key: c.key, tiebreakOnly: !!c.tiebreakOnly }))
        : d.rounds.map((r) => ({ label: r.label, cells: r.deltas.slice(), running: r.running.slice(), index: r.index, detail: r.detail }));
    return { columns: d.columns, rows, totals: d.totals, placements: d.placements, mode: d.mode, notes: d.notes, describe: d };
  }
  global.TallyItScoring = Object.assign(global.TallyItScoring || {}, { roundsFor, recompute: recomputeRecord, describeRecord, canEditRecord });
  api.roundsFor = roundsFor;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
