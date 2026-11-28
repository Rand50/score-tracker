/*
 * TallyIt v24 — Player linking helpers (pure, no DOM / no network).
 * Exposes `window.TallyItPlayerLink` in browsers and `module.exports` in Node.
 *
 * Use case: someone played as a guest ("Audrey") and later creates an account.
 * These helpers find their past games, re-attribute the guest name to their
 * user_id + display name in both local history records and shared-game
 * (Supabase) records, including Nertz team members, and recompute
 * leaderboards/stats afterwards (delegating to SocialScoring when available).
 *
 * Supported record shapes:
 *   Local/legacy: { id, type, players: [ 'Name' | { name, score, userId?, members?[] } ], winnerNames?, winner?, rounds? }
 *   Shared:       { id, game_type, winner_names?, participants|game_participants: [ { user_id, display_name, score, is_winner, members?[], meta? } ] }
 *   Normalized:   SocialScoring merged records ({ players: [{ name, userId, members? }] , winnerNames })
 */
(function (global) {
  'use strict';

  function getSocial() {
    if (global.SocialScoring) return global.SocialScoring;
    try { if (typeof require === 'function') return require('./social_scoring.js'); } catch (_) {}
    return null;
  }

  function clone(v) { return v === undefined || v === null ? v : JSON.parse(JSON.stringify(v)); }

  function cleanName(v) { return String(v ?? '').trim().replace(/\s+/g, ' '); }

  function normName(v) {
    return cleanName(v)
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9 ]+/g, '')
      .trim();
  }

  // ---------- Fuzzy matching ----------
  function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let prev = new Array(b.length + 1);
    for (let j = 0; j <= b.length; j++) prev[j] = j;
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[b.length];
  }

  /**
   * nameSimilarity(a, b) -> { score 0..1, reason }
   *   1.0 exact (case/accents/punctuation-insensitive)
   *   0.9 first-name match ("Audrey" vs "Audrey Wilkinson"), or initial-dot match ("Rand W." vs "Rand Wilkinson")
   *   0.85 prefix/nickname ("Zach" vs "Zachary")
   *   0.8 first-name typo vs full name ("Audry" vs "Audrey Wilkinson")
   *   else 1 - levenshtein/maxLen (typos: "Audry" vs "Audrey" ≈ 0.83)
   */
  function nameSimilarity(a, b) {
    const x = normName(a);
    const y = normName(b);
    if (!x || !y) return { score: 0, reason: 'empty' };
    if (x === y) return { score: 1, reason: 'exact' };
    const xt = x.split(' ');
    const yt = y.split(' ');
    if (xt.length !== yt.length && xt[0] === yt[0]) {
      const shorter = xt.length < yt.length ? xt : yt;
      const longer = xt.length < yt.length ? yt : xt;
      const ok = shorter.every((t, i) => t === longer[i] || (t.length === 1 && longer[i] && longer[i][0] === t));
      if (ok) return { score: 0.9, reason: 'first_name' };
    }
    if (xt.length === yt.length && xt.length > 1 && xt[0] === yt[0]) {
      const ok = xt.every((t, i) => t === yt[i] || (t.length === 1 && yt[i][0] === t) || (yt[i].length === 1 && t[0] === yt[i]));
      if (ok) return { score: 0.9, reason: 'initial' };
    }
    const fx = xt[0];
    const fy = yt[0];
    if (Math.min(fx.length, fy.length) >= 3 && (fx.startsWith(fy) || fy.startsWith(fx))) {
      return { score: 0.85, reason: 'prefix' };
    }
    if (xt.length !== yt.length && Math.min(fx.length, fy.length) >= 4 && levenshtein(fx, fy) === 1 &&
        (xt.length === 1 || yt.length === 1)) {
      return { score: 0.8, reason: 'first_name_typo' };
    }
    const d = levenshtein(x, y);
    const score = Math.max(0, 1 - d / Math.max(x.length, y.length));
    return { score: Number(score.toFixed(3)), reason: 'fuzzy' };
  }

  // ---------- Shape helpers ----------
  function isShared(rec) {
    return Boolean(rec && (Array.isArray(rec.participants) || Array.isArray(rec.game_participants)));
  }

  function participantList(rec) {
    if (!rec || typeof rec !== 'object') return [];
    if (Array.isArray(rec.participants)) return rec.participants;
    if (Array.isArray(rec.game_participants)) return rec.game_participants;
    if (Array.isArray(rec.players)) return rec.players;
    return [];
  }

  function entryName(p) {
    if (typeof p === 'string') return cleanName(p);
    if (!p || typeof p !== 'object') return '';
    return cleanName(p.display_name || p.displayName || p.name || (p.profile && (p.profile.display_name || p.profile.name)) || '');
  }

  function entryUserId(p) {
    if (!p || typeof p !== 'object') return null;
    const v = p.user_id !== undefined ? p.user_id : (p.userId !== undefined ? p.userId : (p.profile && p.profile.id));
    return v === undefined || v === null || v === '' ? null : String(v);
  }

  /** Iterates every person slot in a record (top-level rows and team members). */
  function forEachSlot(rec, fn) {
    const list = participantList(rec);
    list.forEach((p, idx) => {
      fn({ entry: p, index: idx, memberIndex: null, isTeam: Boolean(p && Array.isArray(p.members) && p.members.length) });
      if (p && typeof p === 'object' && Array.isArray(p.members)) {
        p.members.forEach((m, mi) => fn({ entry: m, index: idx, memberIndex: mi, isTeam: false, parent: p }));
      }
    });
  }

  function recordId(rec) {
    return rec && (rec.id || rec.sharedGameId || rec.shared_game_id || rec.local_game_id || (rec.summary && rec.summary.local_game_id)) || null;
  }

  function recordWhen(rec) {
    return rec && (rec.played_at || rec.endTime || rec.playedAt || rec.startTime || rec.created_at) || null;
  }

  function recordType(rec) {
    return String((rec && (rec.game_type || rec.type)) || 'other').toLowerCase();
  }

  // ---------- 1. Suggest matching past games ----------
  /**
   * suggestMatchingGames(account, records, opts)
   *   account: { userId|user_id|id, displayName|display_name|name, aliases?: [] }
   *   records: array of local and/or shared game records
   *   opts: { threshold = 0.8, includeLinked = false }
   * Returns [{ recordId, record, gameType, playedAt, matches: [{ index, memberIndex, guestName, score, reason }], bestScore }]
   * Only guest slots (no user_id) are suggested; slots already linked to this user are skipped.
   * Sorted by bestScore desc, then most recent first.
   */
  function suggestMatchingGames(account, records, opts) {
    opts = opts || {};
    const threshold = opts.threshold !== undefined ? Number(opts.threshold) : 0.8;
    const uid = account && (account.userId || account.user_id || account.id) ? String(account.userId || account.user_id || account.id) : null;
    const names = [account && (account.displayName || account.display_name || account.name)]
      .concat(Array.isArray(account && account.aliases) ? account.aliases : [])
      .map(cleanName).filter(Boolean);
    if (!names.length) return [];
    const out = [];
    (Array.isArray(records) ? records : []).forEach((rec) => {
      if (!rec || typeof rec !== 'object') return;
      let alreadyIn = false;
      const matches = [];
      forEachSlot(rec, (slot) => {
        if (slot.isTeam) return; // team rows are matched through their members
        const sid = entryUserId(slot.entry);
        if (uid && sid === uid) { alreadyIn = true; return; }
        if (sid && !opts.includeLinked) return;
        const nm = entryName(slot.entry);
        let best = { score: 0, reason: 'none' };
        names.forEach((n) => { const s = nameSimilarity(n, nm); if (s.score > best.score) best = s; });
        if (best.score >= threshold) {
          matches.push({ index: slot.index, memberIndex: slot.memberIndex, guestName: nm, score: best.score, reason: best.reason, linkedTo: sid });
        }
      });
      if (alreadyIn && !opts.includeLinked) return;
      if (!matches.length) return;
      matches.sort((a, b) => b.score - a.score);
      out.push({
        recordId: recordId(rec),
        record: rec,
        source: isShared(rec) ? 'shared' : 'local',
        gameType: recordType(rec),
        playedAt: recordWhen(rec),
        matches,
        bestScore: matches[0].score
      });
    });
    out.sort((a, b) => (b.bestScore - a.bestScore) || ((Date.parse(b.playedAt || 0) || 0) - (Date.parse(a.playedAt || 0) || 0)));
    return out;
  }

  // ---------- 2. Re-attribute a guest slot ----------
  function renameInList(list, from, to) {
    if (!Array.isArray(list)) return list;
    const f = normName(from);
    return list.map((n) => (typeof n === 'string' && normName(n) === f ? to : n));
  }

  function applyLinkToEntry(entry, shared, userId, displayName) {
    if (typeof entry === 'string') {
      return { name: displayName, userId, isGuest: false, linkedFromGuest: entry };
    }
    const out = { ...entry };
    const prevName = entryName(entry);
    if (shared) {
      out.user_id = userId;
      out.display_name = displayName;
      if ('userId' in out) out.userId = userId;
      if ('name' in out) out.name = displayName;
      if (out.meta && typeof out.meta === 'object') {
        out.meta = { ...out.meta, is_guest: false, linked_from_guest: prevName };
      } else {
        out.meta = { is_guest: false, linked_from_guest: prevName };
      }
    } else {
      out.name = displayName;
      out.userId = userId;
      if ('user_id' in out) out.user_id = userId;
      if ('display_name' in out) out.display_name = displayName;
      out.isGuest = false;
      out.linkedFromGuest = prevName;
    }
    return out;
  }

  /**
   * linkParticipant(record, target, user, opts) -> { ok, error?, record, changed: [{ index, memberIndex, from }] }
   *   target: guest name string (case-insensitive) or { index, memberIndex? } or { name }
   *   user: { userId|user_id|id, displayName|display_name|name }
   *   opts: { fuzzy = false, threshold = 0.8, overwriteLinked = false, mutate = false }
   * Returns a NEW record by default (pure). Renames winner name lists too, and
   * team display names that embed the guest name ("Rand & Audrey").
   */
  function linkParticipant(record, target, user, opts) {
    opts = opts || {};
    if (!record || typeof record !== 'object') return { ok: false, error: 'No game record.' };
    const userId = user && (user.userId || user.user_id || user.id) ? String(user.userId || user.user_id || user.id) : null;
    const displayName = cleanName(user && (user.displayName || user.display_name || user.name));
    if (!userId) return { ok: false, error: 'A user_id is required to link a player.' };
    if (!displayName) return { ok: false, error: 'A display name is required to link a player.' };

    const rec = opts.mutate ? record : clone(record);
    const shared = isShared(rec);
    const listKey = Array.isArray(rec.participants) ? 'participants' : (Array.isArray(rec.game_participants) ? 'game_participants' : 'players');
    const list = Array.isArray(rec[listKey]) ? rec[listKey] : [];

    // Resolve target slots
    const slots = [];
    if (target && typeof target === 'object' && Number.isInteger(target.index)) {
      slots.push({ index: target.index, memberIndex: Number.isInteger(target.memberIndex) ? target.memberIndex : null });
    } else {
      const guest = typeof target === 'string' ? target : (target && target.name);
      if (!cleanName(guest)) return { ok: false, error: 'Specify a guest name or slot index to link.' };
      const threshold = opts.threshold !== undefined ? Number(opts.threshold) : 0.8;
      const cands = [];
      forEachSlot(rec, (slot) => {
        if (slot.isTeam) return;
        const sim = nameSimilarity(guest, entryName(slot.entry));
        if (sim.score === 1 || (opts.fuzzy && sim.score >= threshold)) cands.push({ index: slot.index, memberIndex: slot.memberIndex, score: sim.score });
      });
      if (!cands.length) return { ok: false, error: 'No participant named "' + cleanName(guest) + '" in this game.' };
      const top = Math.max(...cands.map((c) => c.score));
      cands.filter((c) => c.score === top).forEach((c) => slots.push(c));
    }

    // Guard: user already appears in this game in another slot
    const occupied = [];
    forEachSlot(rec, (slot) => {
      if (entryUserId(slot.entry) === userId) occupied.push(slot.index + ':' + slot.memberIndex);
    });

    const changed = [];
    for (const s of slots) {
      const row = list[s.index];
      if (row === undefined) return { ok: false, error: 'No participant at index ' + s.index + '.' };
      let entry = s.memberIndex === null ? row : (row && Array.isArray(row.members) ? row.members[s.memberIndex] : undefined);
      if (entry === undefined) return { ok: false, error: 'No team member at ' + s.index + '/' + s.memberIndex + '.' };
      if (s.memberIndex === null && row && Array.isArray(row.members) && row.members.length) {
        return { ok: false, error: 'That row is a team; link one of its members instead (memberIndex).' };
      }
      const existing = entryUserId(entry);
      if (existing === userId) continue;
      if (existing && !opts.overwriteLinked) {
        return { ok: false, error: '"' + entryName(entry) + '" is already linked to another account.' };
      }
      if (occupied.some((k) => k !== s.index + ':' + s.memberIndex)) {
        return { ok: false, error: displayName + ' is already a participant in this game.' };
      }
      const from = entryName(entry);
      const linked = applyLinkToEntry(entry, shared, userId, displayName);
      if (s.memberIndex === null) {
        list[s.index] = linked;
      } else {
        row.members[s.memberIndex] = linked;
        // Update team label if it embeds the guest name
        ['name', 'display_name', 'displayName'].forEach((k) => {
          if (typeof row[k] === 'string' && from) {
            const re = new RegExp('\\b' + from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
            if (re.test(row[k])) row[k] = row[k].replace(re, displayName);
          }
        });
      }
      changed.push({ index: s.index, memberIndex: s.memberIndex, from });
      // Winner name lists (top-level slots only — teams keep their team label)
      if (s.memberIndex === null && from) {
        if (Array.isArray(rec.winner_names)) rec.winner_names = renameInList(rec.winner_names, from, displayName);
        if (Array.isArray(rec.winnerNames)) rec.winnerNames = renameInList(rec.winnerNames, from, displayName);
        if (typeof rec.winner === 'string' && normName(rec.winner) === normName(from)) rec.winner = displayName;
        if (rec.summary && Array.isArray(rec.summary.winner_names)) rec.summary.winner_names = renameInList(rec.summary.winner_names, from, displayName);
      }
    }
    rec[listKey] = list;
    if (changed.length) {
      rec.linkedParticipants = (Array.isArray(rec.linkedParticipants) ? rec.linkedParticipants : [])
        .concat(changed.map((c) => ({ ...c, userId, displayName, at: opts.at || new Date().toISOString() })));
    }
    return { ok: true, record: rec, changed };
  }

  /**
   * linkAcrossRecords(records, links, user, opts)
   *   links: output of suggestMatchingGames (or [{ recordId, matches:[{index, memberIndex}] }]) — the ones the user confirmed.
   * Returns { records: newArray, linked: [{ recordId, changed }], errors: [{ recordId, error }] }
   */
  function linkAcrossRecords(records, links, user, opts) {
    const list = Array.isArray(records) ? records.slice() : [];
    const linked = [];
    const errors = [];
    (Array.isArray(links) ? links : []).forEach((ln) => {
      const pos = list.findIndex((r) => (ln.record && r === ln.record) || (ln.recordId && recordId(r) === ln.recordId));
      if (pos < 0) { errors.push({ recordId: ln.recordId, error: 'Record not found.' }); return; }
      const top = (ln.matches || [])[0];
      if (!top) { errors.push({ recordId: ln.recordId, error: 'No match to link.' }); return; }
      const res = linkParticipant(list[pos], { index: top.index, memberIndex: top.memberIndex }, user, opts);
      if (!res.ok) { errors.push({ recordId: ln.recordId, error: res.error }); return; }
      list[pos] = res.record;
      linked.push({ recordId: recordId(res.record), changed: res.changed });
    });
    return { records: list, linked, errors };
  }

  /** Builds the Supabase row updates for linked shared games: [{ game_id, participant_index, member_index, user_id, display_name }]. */
  function buildSharedLinkUpdates(linkResults, user) {
    const userId = String(user.userId || user.user_id || user.id);
    const displayName = cleanName(user.displayName || user.display_name || user.name);
    const out = [];
    (linkResults || []).forEach((r) => (r.changed || []).forEach((c) => out.push({
      game_id: r.recordId, participant_index: c.index, member_index: c.memberIndex, user_id: userId, display_name: displayName, previous_name: c.from
    })));
    return out;
  }

  // ---------- 3. Recompute leaderboards & stats ----------
  /**
   * recomputeAfterLink(records, opts) -> { leaderboard, byGameType: { [type]: leaderboard }, playerStats(userId|name) }
   *   Delegates to SocialScoring.computeGroupLeaderboard (team members credited individually).
   *   opts: { members, gameTypes: ['catan', ...], recentFormLength }
   */
  function recomputeAfterLink(records, opts) {
    opts = opts || {};
    const social = getSocial();
    const recs = Array.isArray(records) ? records : [];
    const compute = (gameType) => {
      if (social && typeof social.computeGroupLeaderboard === 'function') {
        return social.computeGroupLeaderboard(recs, opts.members || [], { gameType: gameType || 'all', recentFormLength: opts.recentFormLength });
      }
      return fallbackLeaderboard(recs, gameType);
    };
    const leaderboard = compute(null);
    const types = Array.isArray(opts.gameTypes) ? opts.gameTypes : Array.from(new Set(recs.map(recordType)));
    const byGameType = {};
    types.forEach((t) => { byGameType[t] = compute(t); });
    return {
      leaderboard,
      byGameType,
      playerStats(idOrName) {
        const key = String(idOrName || '');
        const row = leaderboard.find((r) => (r.userId && r.userId === key) || normName(r.name) === normName(key));
        if (!row) return null;
        const perGame = {};
        Object.keys(byGameType).forEach((t) => {
          const g = byGameType[t].find((r) => (r.userId && r.userId === key) || normName(r.name) === normName(key));
          if (g && g.gamesPlayed) perGame[t] = g;
        });
        return { ...row, perGame };
      }
    };
  }

  function fallbackLeaderboard(recs, gameType) {
    const map = new Map();
    recs.filter((r) => !gameType || recordType(r) === gameType).forEach((rec) => {
      const winners = new Set((rec.winner_names || rec.winnerNames || []).map(normName));
      participantList(rec).forEach((p) => {
        const targets = p && Array.isArray(p.members) && p.members.length ? p.members : [p];
        const won = Boolean(p && (p.is_winner || p.isWinner)) || winners.has(normName(entryName(p)));
        targets.forEach((m) => {
          const uid = entryUserId(m);
          const key = uid ? 'id:' + uid : 'n:' + normName(entryName(m));
          const b = map.get(key) || { name: entryName(m), userId: uid, gamesPlayed: 0, wins: 0, totalScore: 0 };
          b.gamesPlayed += 1; if (won) b.wins += 1; b.totalScore += Number(p && p.score) || 0;
          map.set(key, b);
        });
      });
    });
    return Array.from(map.values()).sort((a, b) => b.wins - a.wins || b.gamesPlayed - a.gamesPlayed)
      .map((r, i) => ({ rank: i + 1, ...r, avgScore: r.gamesPlayed ? Number((r.totalScore / r.gamesPlayed).toFixed(1)) : 0 }));
  }

  const api = {
    normName,
    nameSimilarity,
    suggestMatchingGames,
    linkParticipant,
    linkAcrossRecords,
    buildSharedLinkUpdates,
    recomputeAfterLink
  };

  global.TallyItPlayerLink = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
