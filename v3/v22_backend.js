/**
 * TallyIt — v22 Features Backend Client Layer (window.TallyItV22Backend)
 * Drop-in module for game_tracker.html. Uses window.sb (Supabase v2 client).
 *
 * Exposes window.TallyItV22Backend:
 *   - submitGameRequest(gameName, websiteUrl?, requesterEmail?)
 *   - getMyBuiltNotifications()
 *   - dismissBuiltNotification(id)
 *   - publishCustomVariation(inputOrGameKey, name?, tagline?, differences?, scoringOverrides?, authorName?)
 *   - listCommunityVariations(gameKey?, options?)
 *   - moderateCommunityVariation(id, isHidden)
 *   - getAdminCommunityVariations()
 *   - clearCache()
 *   - isMigrationReady()
 *
 * Gracefully falls back to localStorage whenever the v22 SQL migration has not
 * been applied yet or the client is offline, so the UI never breaks.
 */
(function (global) {
  'use strict';

  const ADMIN_EMAIL = 'randw50@gmail.com';
  const LS_REQUESTS = 'gst_v20_game_requests';
  const LS_VARIATIONS = 'gst_v22_community_variations';
  const VARIATIONS_TTL_MS = 60 * 1000;
  const MIGRATION_RETRY_MS = 30 * 1000;

  let migrationReady = null; // null = unknown, true = ready, false = not migrated yet
  let migrationCheckedAt = 0;
  const variationsCache = new Map(); // key ('__all__' or game_key) -> { variations, byGame, fetchedAt }

  function getClient() {
    return global.sb || null;
  }

  async function getAuthUser() {
    if (global.ScoreAuth && typeof global.ScoreAuth.getUser === 'function') {
      try {
        const u = await global.ScoreAuth.getUser();
        if (u && u.id) return u;
      } catch (_) {}
    }
    const client = getClient();
    if (!client || !client.auth || typeof client.auth.getSession !== 'function') return null;
    try {
      const { data: { session } } = await client.auth.getSession();
      return session && session.user ? session.user : null;
    } catch (_) {
      return null;
    }
  }

  function isMissingMigrationError(err) {
    if (!err) return false;
    const code = String(err.code || '').toUpperCase();
    const msg = String(err.message || err.details || err.hint || '').toLowerCase();
    if (code === '42P01' || code === '42883' || code === '42703' || code === 'PGRST202' || code === 'PGRST205') return true;
    return (
      msg.includes('does not exist') ||
      msg.includes('could not find the table') ||
      msg.includes('could not find the function')
    );
  }

  function isForbiddenError(err) {
    if (!err) return false;
    const code = String(err.code || '').toUpperCase();
    const msg = String(err.message || '').toLowerCase();
    return code === '42501' || msg.includes('forbidden');
  }

  function markMigrationMissing() {
    migrationReady = false;
    migrationCheckedAt = Date.now();
  }

  function shouldSkipSupabase(client) {
    if (!client) return true;
    if (migrationReady !== false) return false;
    if (Date.now() - migrationCheckedAt > MIGRATION_RETRY_MS) {
      migrationReady = null;
      return false;
    }
    return true;
  }

  function readLocal(key, fallback) {
    try {
      const raw = global.localStorage && global.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function writeLocal(key, value) {
    try {
      if (global.localStorage) global.localStorage.setItem(key, JSON.stringify(value));
    } catch (_) {}
  }

  function normalizeWebsiteUrl(rawUrl) {
    const trimmed = String(rawUrl || '').trim();
    if (!trimmed) return { ok: true, url: null };
    if (trimmed.length > 500) {
      return { ok: false, url: null, error: 'Website link is too long (max 500 characters).' };
    }
    if (/^https?:\/\//i.test(trimmed)) {
      return { ok: true, url: trimmed };
    }
    if (/^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(trimmed)) {
      return { ok: true, url: 'https://' + trimmed };
    }
    return { ok: false, url: null, error: 'Website link must start with http:// or https://.' };
  }

  function normalizeOptionalEmail(rawEmail) {
    const trimmed = String(rawEmail || '').trim().toLowerCase();
    if (!trimmed) return { ok: true, email: null };
    if (trimmed.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/i.test(trimmed)) {
      return { ok: false, email: null, error: 'Please enter a valid email address or leave it blank.' };
    }
    return { ok: true, email: trimmed };
  }

  function slugify(text) {
    const base = String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 96);
    return base || 'variation';
  }

  function groupVariationsByGame(rows) {
    const byGame = {};
    (rows || []).forEach((v) => {
      const gk = String(v.game_key || '').toLowerCase();
      if (!gk) return;
      if (!byGame[gk]) byGame[gk] = [];
      byGame[gk].push(v);
    });
    return byGame;
  }

  function normalizeVariationRow(row) {
    if (!row || typeof row !== 'object') return null;
    return {
      id: row.id,
      game_key: String(row.game_key || '').toLowerCase(),
      slug: String(row.slug || ''),
      name: String(row.name || ''),
      tagline: row.tagline || null,
      differences: Array.isArray(row.differences) ? row.differences : [],
      scoring_overrides: (row.scoring_overrides && typeof row.scoring_overrides === 'object' && !Array.isArray(row.scoring_overrides))
        ? row.scoring_overrides
        : {},
      author_id: row.author_id || null,
      author_name: row.author_name || null,
      is_hidden: !!row.is_hidden,
      created_at: row.created_at || new Date().toISOString()
    };
  }

  function makeLocalId(prefix) {
    return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  }

  // ---------------------------------------------------------------------------
  // 1. Game Requests with Optional Guest Email + Built Notifications
  // ---------------------------------------------------------------------------
  async function submitGameRequest(gameName, websiteUrl, requesterEmail) {
    const cleanName = String(gameName || '').trim();
    if (cleanName.length < 2) {
      return { ok: false, error: 'Please enter a game name (at least 2 characters).' };
    }
    if (cleanName.length > 120) {
      return { ok: false, error: 'Game name must be 120 characters or fewer.' };
    }

    const urlCheck = normalizeWebsiteUrl(websiteUrl);
    if (!urlCheck.ok) {
      return { ok: false, error: urlCheck.error };
    }

    const emailCheck = normalizeOptionalEmail(requesterEmail);
    if (!emailCheck.ok) {
      return { ok: false, error: emailCheck.error };
    }

    const user = await getAuthUser();
    const resolvedEmail = (user && user.email)
      ? String(user.email).trim().toLowerCase()
      : emailCheck.email;

    const saveLocal = () => {
      const now = new Date().toISOString();
      const item = {
        id: makeLocalId('local_req'),
        game_name: cleanName,
        website_url: urlCheck.url,
        requester_id: user ? user.id : null,
        requester_email: resolvedEmail,
        status: 'new',
        dismissed_at: null,
        created_at: now,
        updated_at: now
      };
      const list = readLocal(LS_REQUESTS, []);
      list.unshift(item);
      writeLocal(LS_REQUESTS, list.slice(0, 100));
      return { ok: true, request: item, isFallback: true };
    };

    const client = getClient();
    if (shouldSkipSupabase(client)) return saveLocal();

    try {
      const { data, error } = await client.rpc('submit_game_request', {
        p_game_name: cleanName,
        p_website_url: urlCheck.url,
        p_requester_email: emailCheck.email
      });

      if (error) {
        if (isMissingMigrationError(error)) {
          // If only v20 2-arg RPC is installed and no guest email was given, try 2-arg gracefully
          if (!emailCheck.email) {
            const retry = await client.rpc('submit_game_request', {
              p_game_name: cleanName,
              p_website_url: urlCheck.url
            });
            if (!retry.error && retry.data && retry.data.ok !== false) {
              return { ok: true, request: retry.data.request || retry.data, isFallback: false };
            }
          }
          markMigrationMissing();
          return saveLocal();
        }
        return { ok: false, error: error.message || 'Could not submit game request.' };
      }

      migrationReady = true;
      if (data && data.ok === false) {
        return { ok: false, error: data.error || 'Could not submit game request.' };
      }
      return { ok: true, request: (data && data.request) || data, isFallback: false };
    } catch (_) {
      return saveLocal();
    }
  }

  async function getMyBuiltNotifications() {
    const user = await getAuthUser();
    if (!user) {
      return { ok: true, notifications: [], isFallback: false };
    }

    const userEmail = String(user.email || '').trim().toLowerCase();
    const localResult = () => {
      const list = readLocal(LS_REQUESTS, []);
      const matches = list
        .filter((r) => {
          if (!r || r.status !== 'built' || r.dismissed_at) return false;
          const byUid = r.requester_id && user.id && r.requester_id === user.id;
          const byEmail = userEmail && r.requester_email && String(r.requester_email).trim().toLowerCase() === userEmail;
          return !!(byUid || byEmail);
        })
        .map((r) => ({
          id: r.id,
          game_name: r.game_name,
          website_url: r.website_url || null,
          status: r.status,
          created_at: r.created_at,
          updated_at: r.updated_at || r.created_at
        }));
      return { ok: true, notifications: matches, isFallback: true };
    };

    const client = getClient();
    if (shouldSkipSupabase(client)) return localResult();

    try {
      const { data, error } = await client.rpc('get_my_built_notifications');
      if (error) {
        if (isMissingMigrationError(error)) {
          markMigrationMissing();
          return localResult();
        }
        return localResult();
      }
      migrationReady = true;
      return { ok: true, notifications: Array.isArray(data) ? data : [], isFallback: false };
    } catch (_) {
      return localResult();
    }
  }

  async function dismissBuiltNotification(id) {
    if (!id) return { ok: false, error: 'Missing notification id.' };
    const user = await getAuthUser();
    if (!user) return { ok: false, error: 'Sign in to dismiss notifications.' };

    const userEmail = String(user.email || '').trim().toLowerCase();
    const localDismiss = () => {
      const list = readLocal(LS_REQUESTS, []);
      const item = list.find((r) => {
        if (!r || r.id !== id || r.status !== 'built') return false;
        const byUid = r.requester_id && r.requester_id === user.id;
        const byEmail = userEmail && r.requester_email && String(r.requester_email).trim().toLowerCase() === userEmail;
        return !!(byUid || byEmail);
      });
      if (!item) return { ok: false, error: 'Notification not found.', isFallback: true };
      item.dismissed_at = new Date().toISOString();
      writeLocal(LS_REQUESTS, list);
      return { ok: true, id: item.id, dismissed_at: item.dismissed_at, isFallback: true };
    };

    const client = getClient();
    if (shouldSkipSupabase(client)) return localDismiss();

    try {
      const { data, error } = await client.rpc('dismiss_built_notification', { p_id: id });
      if (error) {
        if (isMissingMigrationError(error)) {
          markMigrationMissing();
          return localDismiss();
        }
        return { ok: false, error: error.message || 'Could not dismiss notification.' };
      }
      migrationReady = true;
      if (data && data.ok === false) {
        return { ok: false, error: data.error || 'Could not dismiss notification.' };
      }
      return {
        ok: true,
        id: (data && data.id) || id,
        dismissed_at: (data && data.dismissed_at) || new Date().toISOString(),
        isFallback: false
      };
    } catch (_) {
      return localDismiss();
    }
  }

  // ---------------------------------------------------------------------------
  // 2. Community-Published Variations
  // ---------------------------------------------------------------------------
  function parsePublishArgs(inputOrGameKey, name, tagline, differences, scoringOverrides, authorName) {
    if (inputOrGameKey && typeof inputOrGameKey === 'object') {
      return {
        gameKey: inputOrGameKey.gameKey != null ? inputOrGameKey.gameKey : inputOrGameKey.game_key,
        name: inputOrGameKey.name,
        tagline: inputOrGameKey.tagline,
        differences: inputOrGameKey.differences,
        scoringOverrides: inputOrGameKey.scoringOverrides != null
          ? inputOrGameKey.scoringOverrides
          : inputOrGameKey.scoring_overrides,
        authorName: inputOrGameKey.authorName != null
          ? inputOrGameKey.authorName
          : inputOrGameKey.author_name
      };
    }
    return {
      gameKey: inputOrGameKey,
      name,
      tagline,
      differences,
      scoringOverrides,
      authorName
    };
  }

  async function publishCustomVariation(inputOrGameKey, name, tagline, differences, scoringOverrides, authorName) {
    const args = parsePublishArgs(inputOrGameKey, name, tagline, differences, scoringOverrides, authorName);
    const cleanGame = String(args.gameKey || '').trim().toLowerCase();
    const cleanName = String(args.name || '').trim();
    const cleanTagline = args.tagline != null && String(args.tagline).trim() ? String(args.tagline).trim() : null;
    const cleanDiffs = args.differences == null ? [] : args.differences;
    const cleanOverrides = args.scoringOverrides == null ? {} : args.scoringOverrides;
    const cleanAuthor = args.authorName != null && String(args.authorName).trim()
      ? String(args.authorName).trim().slice(0, 60)
      : null;

    if (!cleanGame || cleanGame.length > 60) {
      return { ok: false, error: 'Invalid game key.' };
    }
    if (cleanName.length < 2) {
      return { ok: false, error: 'Variation name must be at least 2 characters.' };
    }
    if (cleanName.length > 80) {
      return { ok: false, error: 'Variation name must be 80 characters or fewer.' };
    }
    if (cleanTagline && cleanTagline.length > 160) {
      return { ok: false, error: 'Tagline must be 160 characters or fewer.' };
    }
    if (!Array.isArray(cleanDiffs)) {
      return { ok: false, error: 'Differences must be an array.' };
    }
    if (cleanDiffs.length > 20) {
      return { ok: false, error: 'Please keep rule differences to 20 items or fewer.' };
    }
    if (!cleanOverrides || typeof cleanOverrides !== 'object' || Array.isArray(cleanOverrides)) {
      return { ok: false, error: 'Scoring overrides must be an object.' };
    }

    const user = await getAuthUser();
    const saveLocal = () => {
      const list = readLocal(LS_VARIATIONS, []);
      const baseSlug = slugify(cleanName);
      let slug = baseSlug;
      let suffix = 1;
      while (list.some((v) => v.game_key === cleanGame && v.slug === slug)) {
        suffix += 1;
        slug = baseSlug + '-' + suffix;
      }
      const item = {
        id: makeLocalId('local_var'),
        game_key: cleanGame,
        slug,
        name: cleanName,
        tagline: cleanTagline,
        differences: cleanDiffs,
        scoring_overrides: cleanOverrides,
        author_id: user ? user.id : null,
        author_name: cleanAuthor || (user && user.user_metadata && user.user_metadata.full_name) || null,
        is_hidden: false,
        created_at: new Date().toISOString()
      };
      list.unshift(item);
      writeLocal(LS_VARIATIONS, list.slice(0, 200));
      variationsCache.clear();
      return { ok: true, variation: item, isFallback: true };
    };

    const client = getClient();
    if (shouldSkipSupabase(client)) return saveLocal();

    try {
      const { data, error } = await client.rpc('publish_custom_variation', {
        p_game_key: cleanGame,
        p_name: cleanName,
        p_tagline: cleanTagline,
        p_differences: cleanDiffs,
        p_scoring_overrides: cleanOverrides,
        p_author_name: cleanAuthor
      });

      if (error) {
        if (isMissingMigrationError(error)) {
          markMigrationMissing();
          return saveLocal();
        }
        return { ok: false, error: error.message || 'Could not publish variation.' };
      }

      migrationReady = true;
      if (data && data.ok === false) {
        return { ok: false, error: data.error || 'Could not publish variation.' };
      }
      variationsCache.clear();
      return {
        ok: true,
        variation: normalizeVariationRow((data && data.variation) || data),
        isFallback: false
      };
    } catch (_) {
      return saveLocal();
    }
  }

  async function listCommunityVariations(gameKey, options) {
    const force = !!(options && options.force);
    const filterKey = gameKey ? String(gameKey).trim().toLowerCase() : null;
    const cacheKey = filterKey || '__all__';
    const cached = variationsCache.get(cacheKey);
    if (!force && cached && (Date.now() - cached.fetchedAt) < VARIATIONS_TTL_MS) {
      return {
        ok: true,
        variations: cached.variations,
        byGame: cached.byGame,
        isFallback: false,
        fromCache: true
      };
    }

    const localList = () => {
      const all = readLocal(LS_VARIATIONS, []);
      const visible = all
        .filter((v) => v && !v.is_hidden && (!filterKey || String(v.game_key || '').toLowerCase() === filterKey))
        .map(normalizeVariationRow)
        .filter(Boolean);
      return { ok: true, variations: visible, byGame: groupVariationsByGame(visible), isFallback: true };
    };

    const client = getClient();
    if (shouldSkipSupabase(client)) return localList();

    try {
      const { data, error } = await client.rpc('list_community_variations', {
        p_game_key: filterKey
      });
      if (error) {
        if (isMissingMigrationError(error)) {
          markMigrationMissing();
          return localList();
        }
        return localList();
      }

      migrationReady = true;
      const variations = (Array.isArray(data) ? data : []).map(normalizeVariationRow).filter(Boolean);
      const byGame = groupVariationsByGame(variations);
      variationsCache.set(cacheKey, { variations, byGame, fetchedAt: Date.now() });
      return { ok: true, variations, byGame, isFallback: false };
    } catch (_) {
      return localList();
    }
  }

  async function moderateCommunityVariation(id, isHidden) {
    if (!id) return { ok: false, error: 'Missing variation id.' };
    const nextHidden = !!isHidden;
    const user = await getAuthUser();
    const isAdminEmail = !!(user && String(user.email || '').trim().toLowerCase() === ADMIN_EMAIL);

    const localModerate = () => {
      if (!isAdminEmail) {
        return { ok: false, forbidden: true, error: 'Admin access required.' };
      }
      const list = readLocal(LS_VARIATIONS, []);
      const item = list.find((v) => v && v.id === id);
      if (!item) return { ok: false, error: 'Community variation not found.', isFallback: true };
      item.is_hidden = nextHidden;
      writeLocal(LS_VARIATIONS, list);
      variationsCache.clear();
      return { ok: true, variation: normalizeVariationRow(item), isFallback: true };
    };

    const client = getClient();
    if (shouldSkipSupabase(client)) return localModerate();

    try {
      const { data, error } = await client.rpc('moderate_community_variation', {
        p_id: id,
        p_is_hidden: nextHidden
      });
      if (error) {
        if (isForbiddenError(error)) {
          return { ok: false, forbidden: true, error: 'Admin access required.' };
        }
        if (isMissingMigrationError(error)) {
          markMigrationMissing();
          return localModerate();
        }
        return { ok: false, error: error.message || 'Could not update variation visibility.' };
      }

      migrationReady = true;
      if (data && data.ok === false) {
        return { ok: false, error: data.error || 'Could not update variation visibility.' };
      }
      variationsCache.clear();
      return {
        ok: true,
        variation: normalizeVariationRow((data && data.variation) || data),
        isFallback: false
      };
    } catch (_) {
      return localModerate();
    }
  }

  async function getAdminCommunityVariations() {
    const user = await getAuthUser();
    const isAdminEmail = !!(user && String(user.email || '').trim().toLowerCase() === ADMIN_EMAIL);
    if (!isAdminEmail) {
      return { ok: false, forbidden: true, error: 'Admin access required.' };
    }

    if (global.TallyItBackend && typeof global.TallyItBackend.getAdminStats === 'function') {
      const res = await global.TallyItBackend.getAdminStats();
      if (res && res.ok && res.stats && Array.isArray(res.stats.community_variations)) {
        return {
          ok: true,
          variations: res.stats.community_variations.map(normalizeVariationRow).filter(Boolean),
          isFallback: !!res.isFallback
        };
      }
    }

    const list = readLocal(LS_VARIATIONS, []).slice(0, 50).map(normalizeVariationRow).filter(Boolean);
    return { ok: true, variations: list, isFallback: true };
  }

  function clearCache() {
    variationsCache.clear();
    migrationReady = null;
    migrationCheckedAt = 0;
  }

  global.TallyItV22Backend = {
    ADMIN_EMAIL,
    submitGameRequest,
    getMyBuiltNotifications,
    dismissBuiltNotification,
    publishCustomVariation,
    listCommunityVariations,
    moderateCommunityVariation,
    getAdminCommunityVariations,
    clearCache,
    isMigrationReady: () => migrationReady
  };
})(typeof window !== 'undefined' ? window : globalThis);
