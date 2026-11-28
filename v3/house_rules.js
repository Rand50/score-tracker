/* ==========================================================================
   TallyIt — House Rules, Community Variations & Search Helpers (v22)
   ==========================================================================
   Zero-dependency UMD module for v3/engine.js & v3/shell.html.
   Exposes `window.TallyItHouseRules` in browsers and `module.exports` in Node.

   Provides:
   1. Per-game "Customize Rules" schemas (3–4 intuitive knobs per game) for
      all 9 TallyIt games + 6 classic tabletop games.
   2. Auto-generated rule differences (`describeDifferences(gameKey, rules)`)
      and `buildScoringOverrides(gameKey, rules)`.
   3. Local House Rules persistence (`listLocalHouseRules`, `saveLocalHouseRule`,
      `deleteLocalHouseRule`) + `mergeCommunityVariations(gameKey, communityRows,
      localHouseRules, popularityRows)` merging official catalog, published
      community variations, and personal house rules with popularity stats.
   4. Search helpers: `filterGames(games, query)` and `filterPlayers(items, query)`.
   ========================================================================== */

(function (global) {
  'use strict';

  const STORAGE_KEY_HOUSE_RULES = 'tallyit_house_rules_v1';

  // Fallback in-memory storage when localStorage is unavailable (Node/private mode)
  function createMemoryStorage() {
    const map = new Map();
    return {
      getItem(k) { return map.has(k) ? map.get(k) : null; },
      setItem(k, v) { map.set(k, String(v)); },
      removeItem(k) { map.delete(k); },
      clear() { map.clear(); }
    };
  }

  let customStorage = null;
  const fallbackMem = createMemoryStorage();

  function getStorage() {
    if (customStorage) return customStorage;
    try {
      if (global && global.localStorage) {
        const probe = '__tallyit_hr_probe__';
        global.localStorage.setItem(probe, '1');
        global.localStorage.removeItem(probe);
        return global.localStorage;
      }
    } catch (_) {}
    return fallbackMem;
  }

  function configure(opts) {
    if (opts && Object.prototype.hasOwnProperty.call(opts, 'storage')) {
      customStorage = opts.storage || null;
    }
  }

  // ---------------- Utilities ----------------
  function cleanStr(v) {
    return String(v ?? '').trim();
  }

  function slugify(v) {
    return cleanStr(v)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'custom_rule';
  }

  function uid(prefix) {
    return (prefix || 'hr') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
  }

  function deepClone(v) {
    if (v === null || v === undefined) return v;
    try { return JSON.parse(JSON.stringify(v)); } catch (_) { return v; }
  }

  function normalizeGameKey(raw) {
    const k = cleanStr(raw).toLowerCase();
    if (!k) return 'other';
    if (global.TallyItVariations && typeof global.TallyItVariations.normalizeGameKey === 'function') {
      return global.TallyItVariations.normalizeGameKey(k);
    }
    const aliases = {
      seven_wonders: '7wonders', 'seven-wonders': '7wonders', '7_wonders': '7wonders',
      flip_7: 'flip7', 'flip-7': 'flip7',
      oh_hell: 'ohhell', 'oh-hell': 'ohhell',
      custom: 'other',
      'mexican-train': 'mexican_train', mexicantrain: 'mexican_train',
      phase_10: 'phase10', 'phase-10': 'phase10'
    };
    return aliases[k] || k;
  }

  // ---------------- 1. Per-Game Customize Rules Schemas ----------------
  const SCHEMAS = {
    catan: [
      {
        key: 'targetScore', label: 'Winning VP Target', type: 'number',
        defaultValue: 10, min: 5, max: 25, step: 1, unit: 'VP',
        hint: 'Standard Catan plays to 10 VP (Seafarers 12, Cities & Knights 13).',
        diff: (v, d) => `Play to ${v} VP (instead of ${d} VP).`
      },
      {
        key: 'friendlyRobber', label: 'Friendly Robber', type: 'boolean',
        defaultValue: false,
        hint: 'Robber cannot be placed on players with 2 VP or fewer.',
        diff: (v) => v ? 'Friendly Robber enabled (cannot rob players at 2 VP or less).' : 'Friendly Robber disabled.'
      },
      {
        key: 'harbormaster', label: 'Harbormaster (+2 VP)', type: 'boolean',
        defaultValue: false,
        hint: 'Awards +2 VP to the first player with 3+ Harbor points.',
        diff: (v) => v ? 'Harbormaster bonus active (+2 VP for 3+ Harbor points).' : 'Harbormaster disabled.'
      },
      {
        key: 'lowWins', label: 'Lowest Score Wins', type: 'boolean',
        defaultValue: false,
        hint: 'Reverse scoring — lowest VP wins.',
        diff: (v) => v ? 'Lowest score wins (instead of highest VP).' : 'Highest VP wins.'
      }
    ],

    '7wonders': [
      {
        key: 'leaders', label: 'Leaders Expansion', type: 'boolean',
        defaultValue: false,
        hint: 'Includes the White Leaders scoring category.',
        diff: (v) => v ? 'Includes Leaders expansion (White category).' : 'Leaders expansion off.'
      },
      {
        key: 'cities', label: 'Cities Expansion', type: 'boolean',
        defaultValue: false,
        hint: 'Includes the signed Black Cities & Debt category.',
        diff: (v) => v ? 'Includes Cities expansion (Black category & Debt tokens).' : 'Cities expansion off.'
      },
      {
        key: 'armada', label: 'Armada Expansion', type: 'boolean',
        defaultValue: false,
        hint: 'Includes the signed Navy Armada category.',
        diff: (v) => v ? 'Includes Armada expansion (naval conflicts & fleets).' : 'Armada expansion off.'
      },
      {
        key: 'lowWins', label: 'Lowest Score Wins', type: 'boolean',
        defaultValue: false,
        hint: 'Reverse scoring — lowest VP wins.',
        diff: (v) => v ? 'Lowest score wins (instead of highest VP).' : 'Highest VP wins.'
      }
    ],

    flip7: [
      {
        key: 'targetScore', label: 'Target Score', type: 'number',
        defaultValue: 200, min: 50, max: 500, step: 25, unit: 'pts',
        hint: 'Standard Flip 7 ends when someone reaches 200 points.',
        diff: (v, d) => `Play to ${v} points (instead of ${d}).`
      },
      {
        key: 'bustLimit', label: 'Flip Bonus Cards', type: 'number',
        defaultValue: 7, min: 5, max: 10, step: 1, unit: 'cards',
        hint: 'Unique number cards required to trigger the Flip bonus.',
        diff: (v, d) => `Flip bonus triggers at ${v} unique cards (instead of ${d}).`
      },
      {
        key: 'flipBonus', label: 'Flip Bonus Points', type: 'number',
        defaultValue: 15, min: 0, max: 50, step: 5, unit: 'pts',
        hint: 'Bonus points awarded for completing a Flip 7.',
        diff: (v, d) => `Flip bonus awards +${v} pts (instead of +${d}).`
      },
      {
        key: 'lowWins', label: 'Lowest Score Wins', type: 'boolean',
        defaultValue: false,
        hint: 'Reverse scoring — lowest total wins.',
        diff: (v) => v ? 'Lowest score wins (instead of highest).' : 'Highest score wins.'
      }
    ],

    carcassonne: [
      {
        key: 'smallCityTwoPts', label: 'Small Cities = 2 pts', type: 'boolean',
        defaultValue: false,
        hint: '1st-edition rule: 2-tile completed cities score 2 pts instead of 4.',
        diff: (v) => v ? '2-tile cities score 2 points (1st-edition rule).' : '2-tile cities score 4 points.'
      },
      {
        key: 'innsAndCathedrals', label: 'Inns & Cathedrals', type: 'boolean',
        defaultValue: false,
        hint: 'Enables Inn road (2 pts/tile) & Cathedral city (3 pts/tile) scoring.',
        diff: (v) => v ? 'Inns & Cathedrals scoring enabled.' : 'Inns & Cathedrals off.'
      },
      {
        key: 'farmerFourPts', label: 'Farms = 4 pts / City', type: 'boolean',
        defaultValue: false,
        hint: 'Classic 2000 rule: farms score 4 pts per city instead of 3.',
        diff: (v) => v ? 'Farms score 4 points per completed city (instead of 3).' : 'Farms score 3 points per city.'
      },
      {
        key: 'lowWins', label: 'Lowest Score Wins', type: 'boolean',
        defaultValue: false,
        hint: 'Reverse scoring — lowest total wins.',
        diff: (v) => v ? 'Lowest score wins (instead of highest).' : 'Highest score wins.'
      }
    ],

    rummikub: [
      {
        key: 'pointsUp', label: 'Points Up Mode', type: 'boolean',
        defaultValue: true,
        hint: 'Leftover tiles add positive points to your score (lowest wins). Off = Classic (+/−).',
        diff: (v) => v ? 'Points Up mode (leftover tiles add positive penalty points).' : 'Classic (+/−) zero-sum mode (winner gains opponents’ leftover tiles).'
      },
      {
        key: 'jokerPenalty', label: 'Joker Penalty', type: 'number',
        defaultValue: 30, min: 0, max: 100, step: 5, unit: 'pts',
        hint: 'Points per unused Joker left on your rack.',
        diff: (v, d) => `Unused Joker counts as ${v} points (instead of ${d}).`
      },
      {
        key: 'targetScore', label: 'Target Score (0 = Open)', type: 'number',
        defaultValue: 0, min: 0, max: 500, step: 25, unit: 'pts',
        hint: 'Optional match limit; leave 0 for open-ended sessions.',
        diff: (v) => v > 0 ? `Match ends at ${v} points.` : 'Open-ended session (no fixed target score).'
      },
      {
        key: 'lowWins', label: 'Lowest Score Wins', type: 'boolean',
        defaultValue: true,
        hint: 'Lowest total wins (standard for Points Up; turn off for Classic +/−).',
        diff: (v) => v ? 'Lowest cumulative score wins.' : 'Highest cumulative score wins (instead of lowest).'
      }
    ],

    nertz: [
      {
        key: 'targetScore', label: 'Target Score', type: 'number',
        defaultValue: 100, min: 25, max: 300, step: 25, unit: 'pts',
        hint: 'First player or team to reach this score wins.',
        diff: (v, d) => `Play to ${v} points (instead of ${d}).`
      },
      {
        key: 'nertzPenalty', label: 'Nertz Pile Penalty', type: 'number',
        defaultValue: 2, min: 1, max: 5, step: 1, unit: 'pts/card',
        hint: 'Points subtracted per card left in your Nertz pile.',
        diff: (v, d) => `Cards left in Nertz pile subtract ${v} pts each (instead of ${d}).`
      },
      {
        key: 'allowNegative', label: 'Allow Negative Scores', type: 'boolean',
        defaultValue: true,
        hint: 'When off, cumulative scores floor at 0.',
        diff: (v) => v ? 'Scores can go negative.' : 'Scores floor at 0 (no negative totals).'
      },
      {
        key: 'lowWins', label: 'Lowest Score Wins', type: 'boolean',
        defaultValue: false,
        hint: 'Reverse scoring — lowest total wins.',
        diff: (v) => v ? 'Lowest score wins (instead of highest).' : 'Highest score wins.'
      }
    ],

    hearts: [
      {
        key: 'targetScore', label: 'End Threshold', type: 'number',
        defaultValue: 100, min: 25, max: 200, step: 25, unit: 'pts',
        hint: 'Game ends when any player hits this total.',
        diff: (v, d) => `Game ends at ${v} points (instead of ${d}).`
      },
      {
        key: 'jackOfDiamonds', label: 'Jack of Diamonds (−10)', type: 'boolean',
        defaultValue: false,
        hint: 'Omnibus rule: winning the Jack of Diamonds subtracts 10 points.',
        diff: (v) => v ? 'Jack of Diamonds awards −10 points (Omnibus rule).' : 'Jack of Diamonds has no bonus.'
      },
      {
        key: 'shootMoonSubtract', label: 'Shoot Moon = −26 Self', type: 'boolean',
        defaultValue: false,
        hint: 'Subtract 26 from the shooter instead of adding +26 to opponents.',
        diff: (v) => v ? 'Shooting the Moon subtracts 26 from the shooter (instead of +26 to rivals).' : 'Shooting the Moon adds +26 to all opponents.'
      },
      {
        key: 'lowWins', label: 'Lowest Score Wins', type: 'boolean',
        defaultValue: true,
        hint: 'Standard Hearts: lowest score wins.',
        diff: (v) => v ? 'Lowest score wins.' : 'Highest score wins (instead of lowest).'
      }
    ],

    ohhell: [
      {
        key: 'exactBonus', label: 'Exact Bid Bonus', type: 'number',
        defaultValue: 10, min: 0, max: 25, step: 5, unit: 'pts',
        hint: 'Bonus points for hitting your exact bid.',
        diff: (v, d) => `Exact bid awards +${v} bonus points (instead of +${d}).`
      },
      {
        key: 'pointsOnMiss', label: '1 pt/Trick on Miss', type: 'boolean',
        defaultValue: false,
        hint: 'Earn 1 point per trick won even if you miss your bid.',
        diff: (v) => v ? 'Missed bids still earn 1 point per trick won.' : 'Missed bids score 0 points.'
      },
      {
        key: 'screwTheDealer', label: 'Screw the Dealer', type: 'boolean',
        defaultValue: true,
        hint: 'Dealer cannot make total bids equal the number of cards dealt.',
        diff: (v) => v ? 'Screw the Dealer ("Hook" rule) active.' : 'Screw the Dealer disabled (dealer may bid freely).'
      },
      {
        key: 'lowWins', label: 'Lowest Score Wins', type: 'boolean',
        defaultValue: false,
        hint: 'Reverse scoring — lowest total wins.',
        diff: (v) => v ? 'Lowest score wins (instead of highest).' : 'Highest score wins.'
      }
    ],

    qwirkle: [
      {
        key: 'wentOutBonus', label: 'Went Out Bonus', type: 'number',
        defaultValue: 6, min: 0, max: 20, step: 1, unit: 'pts',
        hint: 'Bonus for the first player to play their last tile (ends the game).',
        diff: (v, d) => `Going out awards +${v} points (instead of +${d}).`
      },
      {
        key: 'qwirkleBonus', label: 'Qwirkle Bonus', type: 'number',
        defaultValue: 6, min: 0, max: 20, step: 1, unit: 'pts',
        hint: 'Extra points for completing a line of 6 (on top of the line points).',
        diff: (v, d) => `Each Qwirkle adds +${v} bonus points (instead of +${d}).`
      },
      {
        key: 'targetScore', label: 'Target Score (0 = Play Out)', type: 'number',
        defaultValue: 0, min: 0, max: 500, step: 25, unit: 'pts',
        hint: 'Optional: end the game when a player reaches this score.',
        diff: (v) => v > 0 ? `Game ends when a player reaches ${v} points.` : 'Play until someone goes out.'
      },
      {
        key: 'trackBag', label: 'Track Tiles in Bag', type: 'boolean',
        defaultValue: true,
        hint: 'Count down the 108-tile bag as players draw.',
        diff: (v) => v ? 'Tiles-in-bag counter on.' : 'Tiles-in-bag counter off.'
      }
    ],

    other: [
      {
        key: 'targetScore', label: 'Target Score (0 = Open)', type: 'number',
        defaultValue: 0, min: 0, max: 1000, step: 10, unit: 'pts',
        hint: 'Optional target score; 0 means no fixed target.',
        diff: (v) => v > 0 ? `Play to ${v} points.` : 'Open-ended game (no target score).'
      },
      {
        key: 'lowWins', label: 'Lowest Score Wins', type: 'boolean',
        defaultValue: false,
        hint: 'Turn on for golf-style lowest-score-wins games.',
        diff: (v) => v ? 'Lowest score wins (instead of highest).' : 'Highest score wins.'
      },
      {
        key: 'allowNegative', label: 'Allow Negative Scores', type: 'boolean',
        defaultValue: true,
        hint: 'Allow subtracting below 0.',
        diff: (v) => v ? 'Negative scores allowed.' : 'Scores floor at 0.'
      }
    ],

    // Catalog classics
    mexican_train: [
      {
        key: 'targetScore', label: 'Max Rounds (0 = Full Set)', type: 'number',
        defaultValue: 13, min: 5, max: 16, step: 1, unit: 'rounds',
        hint: 'Double-12 = 13 rounds, Double-9 = 10 rounds, Double-15 = 16 rounds.',
        diff: (v, d) => `Plays ${v} rounds (instead of ${d}).`
      },
      {
        key: 'doubleBlankFifty', label: 'Double-Blank = 50 pts', type: 'boolean',
        defaultValue: true,
        hint: 'Unplayed 0-0 tile counts as 50 points instead of 0.',
        diff: (v) => v ? 'Double-blank counts as 50 points.' : 'Double-blank counts as 0 points.'
      },
      {
        key: 'lowWins', label: 'Lowest Score Wins', type: 'boolean',
        defaultValue: true,
        hint: 'Lowest pip total wins.',
        diff: (v) => v ? 'Lowest score wins.' : 'Highest score wins (instead of lowest).'
      }
    ],

    euchre: [
      {
        key: 'targetScore', label: 'Target Score', type: 'number',
        defaultValue: 10, min: 5, max: 21, step: 1, unit: 'pts',
        hint: 'First team to 10 points wins.',
        diff: (v, d) => `Play to ${v} points (instead of ${d}).`
      },
      {
        key: 'stickTheDealer', label: 'Stick the Dealer', type: 'boolean',
        defaultValue: false,
        hint: 'Dealer must call trump if everyone passes twice.',
        diff: (v) => v ? 'Stick the Dealer enabled (dealer must call trump).' : 'Dealer may pass.'
      },
      {
        key: 'lowWins', label: 'Lowest Score Wins', type: 'boolean',
        defaultValue: false,
        hint: 'Reverse scoring — lowest total wins.',
        diff: (v) => v ? 'Lowest score wins (instead of highest).' : 'Highest score wins.'
      }
    ],

    uno: [
      {
        key: 'targetScore', label: 'Target Score', type: 'number',
        defaultValue: 500, min: 100, max: 1000, step: 50, unit: 'pts',
        hint: 'Classic UNO plays to 500 points.',
        diff: (v, d) => `Play to ${v} points (instead of ${d}).`
      },
      {
        key: 'stackDrawCards', label: 'Stack +2 / +4 Cards', type: 'boolean',
        defaultValue: false,
        hint: 'House rule allowing players to stack Draw cards.',
        diff: (v) => v ? 'Stacking +2 and +4 Draw cards allowed.' : 'No stacking Draw cards.'
      },
      {
        key: 'lowWins', label: 'Lowest Score Wins', type: 'boolean',
        defaultValue: false,
        hint: 'Turn on if everyone keeps their own leftover card points.',
        diff: (v) => v ? 'Lowest score wins (each player keeps their own leftover card points).' : 'Highest score wins.'
      }
    ],

    yahtzee: [
      {
        key: 'upperBonus', label: 'Upper Section Bonus', type: 'number',
        defaultValue: 35, min: 0, max: 100, step: 5, unit: 'pts',
        hint: 'Bonus for scoring 63+ in the Upper section (Yatzy uses +50).',
        diff: (v, d) => `Upper section bonus is +${v} pts (instead of +${d}).`
      },
      {
        key: 'yahtzeeBonus', label: 'Extra Yahtzee Bonus', type: 'number',
        defaultValue: 100, min: 0, max: 200, step: 25, unit: 'pts',
        hint: 'Points per additional Yahtzee.',
        diff: (v, d) => `Extra Yahtzee bonus is +${v} pts (instead of +${d}).`
      },
      {
        key: 'lowWins', label: 'Lowest Score Wins', type: 'boolean',
        defaultValue: false,
        hint: 'Reverse scoring — lowest total wins.',
        diff: (v) => v ? 'Lowest score wins (instead of highest).' : 'Highest score wins.'
      }
    ],

    phase10: [
      {
        key: 'floatingPhases', label: 'Choice / Any-Order Phases', type: 'boolean',
        defaultValue: false,
        hint: 'Complete the 10 Phases in any order instead of strictly 1–10.',
        diff: (v) => v ? 'Phases may be completed in any order (Choice variant).' : 'Phases must be completed in order (1–10).'
      },
      {
        key: 'targetScore', label: 'Total Phases', type: 'number',
        defaultValue: 10, min: 5, max: 10, step: 1, unit: 'phases',
        hint: 'Number of Phases to win (short games often play 5 or 7).',
        diff: (v, d) => `Short game: complete ${v} Phases (instead of ${d}).`
      },
      {
        key: 'lowWins', label: 'Lowest Score Wins Ties', type: 'boolean',
        defaultValue: true,
        hint: 'Lowest penalty points breaks Phase 10 ties.',
        diff: (v) => v ? 'Lowest penalty points wins ties.' : 'Highest score wins (instead of lowest).'
      }
    ],

    scrabble: [
      {
        key: 'bingoBonus', label: '7-Tile Bingo Bonus', type: 'number',
        defaultValue: 50, min: 0, max: 100, step: 10, unit: 'pts',
        hint: 'Bonus for playing all 7 tiles in one turn.',
        diff: (v, d) => `7-tile Bingo awards +${v} pts (instead of +${d}).`
      },
      {
        key: 'targetScore', label: 'Target Score (0 = End of Bag)', type: 'number',
        defaultValue: 0, min: 0, max: 600, step: 50, unit: 'pts',
        hint: 'Optional target score; 0 plays until tiles run out.',
        diff: (v) => v > 0 ? `First player to ${v} points wins.` : 'Plays until the tile bag empties.'
      },
      {
        key: 'lowWins', label: 'Lowest Score Wins', type: 'boolean',
        defaultValue: false,
        hint: 'Reverse scoring — lowest total wins.',
        diff: (v) => v ? 'Lowest score wins (instead of highest).' : 'Highest score wins.'
      }
    ]
  };

  function getRuleSchema(gameKey) {
    const gk = normalizeGameKey(gameKey);
    const list = SCHEMAS[gk] || SCHEMAS.other;
    return list.map(({ diff, ...field }) => ({ ...field }));
  }

  function getDefaultRules(gameKey) {
    const gk = normalizeGameKey(gameKey);
    const list = SCHEMAS[gk] || SCHEMAS.other;
    const defaults = {};
    for (const field of list) {
      defaults[field.key] = field.defaultValue;
    }
    return defaults;
  }

  function sanitizeRules(gameKey, rawRules) {
    const gk = normalizeGameKey(gameKey);
    const list = SCHEMAS[gk] || SCHEMAS.other;
    const src = (rawRules && typeof rawRules === 'object') ? rawRules : {};
    const out = {};
    for (const field of list) {
      const val = Object.prototype.hasOwnProperty.call(src, field.key) ? src[field.key] : field.defaultValue;
      if (field.type === 'boolean') {
        out[field.key] = Boolean(val);
      } else if (field.type === 'number') {
        const n = Number(val);
        if (!Number.isFinite(n)) out[field.key] = field.defaultValue;
        else {
          const min = field.min !== undefined ? field.min : -9999;
          const max = field.max !== undefined ? field.max : 9999;
          out[field.key] = Math.max(min, Math.min(max, Math.trunc(n)));
        }
      } else {
        out[field.key] = val === undefined || val === null ? field.defaultValue : String(val);
      }
    }
    if (src.notes && cleanStr(src.notes)) {
      out.notes = cleanStr(src.notes).slice(0, 160);
    }
    return out;
  }

  // ---------------- 2. Auto-Generated Rule Differences ----------------
  /**
   * Compares `customRules` against the game's defaults and returns an array
   * of crisp, human-readable `differences` bullets.
   */
  function describeDifferences(gameKey, customRules, opts) {
    const options = opts || {};
    const gk = normalizeGameKey(gameKey);
    const schema = SCHEMAS[gk] || SCHEMAS.other;
    const clean = sanitizeRules(gk, customRules);
    const diffs = [];

    for (const field of schema) {
      const val = clean[field.key];
      const def = field.defaultValue;
      if (val !== def) {
        if (typeof field.diff === 'function') {
          diffs.push(field.diff(val, def));
        } else {
          diffs.push(`${field.label}: ${val} (default ${def}).`);
        }
      }
    }

    if (clean.notes) {
      diffs.push(clean.notes);
    }

    if (!diffs.length && options.includeDefaultFallback !== false) {
      diffs.push('Uses standard official rules.');
    }
    return diffs;
  }

  /**
   * Builds a `scoringOverrides` object compatible with `TallyItVariations` & `engine.js`.
   */
  function buildScoringOverrides(gameKey, customRules) {
    const gk = normalizeGameKey(gameKey);
    const clean = sanitizeRules(gk, customRules);
    const overrides = {};

    if (Object.prototype.hasOwnProperty.call(clean, 'targetScore')) {
      overrides.targetScore = clean.targetScore > 0 ? clean.targetScore : null;
    }
    if (Object.prototype.hasOwnProperty.call(clean, 'lowWins')) {
      overrides.lowWins = Boolean(clean.lowWins);
    }
    if (gk === '7wonders') {
      overrides.expansions = {
        leaders: Boolean(clean.leaders),
        cities: Boolean(clean.cities),
        armada: Boolean(clean.armada)
      };
    }
    if (gk === 'rummikub') {
      overrides.scoringMode = clean.pointsUp ? 'points_up' : 'classic';
      if (!Object.prototype.hasOwnProperty.call(customRules || {}, 'lowWins')) {
        overrides.lowWins = Boolean(clean.pointsUp);
      }
    }
    overrides.houseRules = clean;
    if (clean.notes) overrides.notes = clean.notes;
    return overrides;
  }

  // ---------------- 3. Local House Rules Persistence & Community Merge ----------------
  function readLocalStore() {
    try {
      const raw = getStorage().getItem(STORAGE_KEY_HOUSE_RULES);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((x) => x && x.id && x.gameKey) : [];
    } catch (_) {
      return [];
    }
  }

  function writeLocalStore(list) {
    try {
      getStorage().setItem(STORAGE_KEY_HOUSE_RULES, JSON.stringify(list));
    } catch (e) {
      console.warn('[TallyItHouseRules] write failed', e);
    }
    return list;
  }

  function listLocalHouseRules(gameKey) {
    const all = readLocalStore();
    const filterKey = gameKey ? normalizeGameKey(gameKey) : null;
    return all
      .filter((r) => !filterKey || normalizeGameKey(r.gameKey) === filterKey)
      .sort((a, b) => Date.parse(b.updatedAt || b.createdAt || 0) - Date.parse(a.updatedAt || a.createdAt || 0))
      .map(deepClone);
  }

  function saveLocalHouseRule(preset) {
    if (!preset || typeof preset !== 'object') return null;
    const gk = normalizeGameKey(preset.gameKey || preset.game_key || preset.type);
    const name = cleanStr(preset.name) || 'My House Rules';
    const rules = sanitizeRules(gk, preset.rules || preset.customRules || {});
    const differences = Array.isArray(preset.differences) && preset.differences.length
      ? preset.differences.map(cleanStr).filter(Boolean)
      : describeDifferences(gk, rules);
    const scoringOverrides = preset.scoringOverrides && typeof preset.scoringOverrides === 'object'
      ? { ...buildScoringOverrides(gk, rules), ...preset.scoringOverrides }
      : buildScoringOverrides(gk, rules);

    const list = readLocalStore();
    const existingIdx = preset.id
      ? list.findIndex((r) => r.id === preset.id)
      : (preset.key ? list.findIndex((r) => normalizeGameKey(r.gameKey) === gk && r.key === preset.key) : -1);

    const now = new Date().toISOString();
    const id = existingIdx >= 0 ? list[existingIdx].id : (cleanStr(preset.id) || uid('hr'));
    const key = cleanStr(preset.key) || ('house_' + slugify(name));
    const tagline = cleanStr(preset.tagline) || differences[0] || 'Custom table house rules.';

    const entry = {
      id,
      key,
      gameKey: gk,
      name,
      versionLabel: name,
      tagline,
      isDefault: false,
      source: 'local',
      isLocal: true,
      isCommunity: Boolean(preset.isCommunity),
      authorName: cleanStr(preset.authorName) || null,
      rules,
      differences,
      scoringOverrides,
      createdAt: existingIdx >= 0 ? list[existingIdx].createdAt : now,
      updatedAt: now
    };

    if (existingIdx >= 0) list[existingIdx] = entry;
    else list.push(entry);

    writeLocalStore(list);
    return deepClone(entry);
  }

  function deleteLocalHouseRule(idOrKey) {
    const target = cleanStr(idOrKey);
    if (!target) return { ok: false };
    const list = readLocalStore();
    const next = list.filter((r) => r.id !== target && r.key !== target);
    const removed = next.length !== list.length;
    if (removed) writeLocalStore(next);
    return { ok: removed, remaining: next.length };
  }

  function normalizeExternalVariation(gameKey, row, source) {
    if (!row || typeof row !== 'object') return null;
    const gk = normalizeGameKey(row.gameKey || row.game_key || gameKey);
    if (gk !== normalizeGameKey(gameKey)) return null;

    const name = cleanStr(row.name || row.title || row.versionLabel) || 'House Rules';
    const key = cleanStr(row.key || row.slug || row.variation_key || row.id) || (source + '_' + slugify(name));
    const rawRules = row.rules || row.custom_rules || row.customRules || null;
    const rules = rawRules ? sanitizeRules(gk, rawRules) : null;

    const differences = Array.isArray(row.differences) && row.differences.length
      ? row.differences.map(cleanStr).filter(Boolean)
      : (rules ? describeDifferences(gk, rules) : ['Custom house rules variation.']);

    const scoringOverrides = (row.scoringOverrides || row.scoring_overrides)
      ? { ...(rules ? buildScoringOverrides(gk, rules) : {}), ...(row.scoringOverrides || row.scoring_overrides) }
      : (rules ? buildScoringOverrides(gk, rules) : {});

    const playCount = Math.max(0, Math.trunc(Number(row.playCount ?? row.play_count ?? row.plays ?? 0) || 0));

    return {
      id: row.id || key,
      key,
      gameKey: gk,
      versionLabel: cleanStr(row.versionLabel || row.version_label) || name,
      name,
      tagline: cleanStr(row.tagline) || differences[0] || 'Custom house rules.',
      isDefault: false,
      aliases: Array.isArray(row.aliases) ? row.aliases.slice() : [name],
      differences,
      scoringOverrides,
      rules,
      source,
      isLocal: source === 'local',
      isCommunity: source === 'community',
      authorName: cleanStr(row.authorName || row.author_name || row.created_by_name) || null,
      playCount
    };
  }

  /**
   * Merges official catalog variations (`TallyItVariations`), published community
   * variations (`communityRows`), and personal saved House Rules (`localHouseRules`)
   * with optional popularity rows into a single sorted, annotated list.
   */
  function mergeCommunityVariations(gameKey, communityRows, localHouseRules, popularityRows) {
    const gk = normalizeGameKey(gameKey);
    const V = global.TallyItVariations;
    const official = (V && typeof V.getVariationsForGame === 'function')
      ? V.getVariationsForGame(gk).map((v) => ({
          ...v,
          source: 'official',
          isLocal: false,
          isCommunity: false,
          playCount: 0
        }))
      : [];

    const byKey = new Map();
    official.forEach((v, idx) => {
      byKey.set(v.key.toLowerCase(), { ...v, _order: idx });
    });

    // Apply server popularity rows to official / community keys
    const popMap = new Map();
    if (Array.isArray(popularityRows)) {
      for (const p of popularityRows) {
        if (!p || typeof p !== 'object') continue;
        const rawKey = cleanStr(p.variation_key ?? p.variationKey ?? p.variant ?? p.version ?? p.key);
        const cnt = Math.max(0, Math.trunc(Number(p.play_count ?? p.playCount ?? p.count ?? p.plays ?? 0) || 0));
        if (!rawKey || cnt <= 0) continue;
        const resolved = (V && typeof V.getVariation === 'function') ? V.getVariation(gk, rawKey) : null;
        const canonical = (resolved ? resolved.key : rawKey).toLowerCase();
        popMap.set(canonical, (popMap.get(canonical) || 0) + cnt);
      }
    } else if (popularityRows && typeof popularityRows === 'object') {
      for (const [k, cnt] of Object.entries(popularityRows)) {
        const n = Math.max(0, Math.trunc(Number(cnt) || 0));
        if (n <= 0) continue;
        const resolved = (V && typeof V.getVariation === 'function') ? V.getVariation(gk, k) : null;
        const canonical = (resolved ? resolved.key : k).toLowerCase();
        popMap.set(canonical, (popMap.get(canonical) || 0) + n);
      }
    }

    let orderCounter = official.length;
    const commList = Array.isArray(communityRows) ? communityRows : [];
    for (const row of commList) {
      const norm = normalizeExternalVariation(gk, row, 'community');
      if (!norm) continue;
      const k = norm.key.toLowerCase();
      if (!byKey.has(k)) {
        byKey.set(k, { ...norm, _order: orderCounter++ });
      } else {
        const prev = byKey.get(k);
        prev.playCount = Math.max(prev.playCount || 0, norm.playCount || 0);
      }
    }

    const localList = Array.isArray(localHouseRules) ? localHouseRules : listLocalHouseRules(gk);
    for (const row of localList) {
      const norm = normalizeExternalVariation(gk, row, 'local');
      if (!norm) continue;
      const k = norm.key.toLowerCase();
      if (byKey.has(k)) {
        // Already exists (e.g. user published their local rule to community) — mark as both!
        const prev = byKey.get(k);
        prev.isLocal = true;
      } else {
        byKey.set(k, { ...norm, _order: orderCounter++ });
      }
    }

    const merged = Array.from(byKey.values()).map((item) => {
      const popBoost = popMap.get(item.key.toLowerCase()) || 0;
      return {
        ...item,
        playCount: (item.playCount || 0) + popBoost
      };
    });

    const totalPlays = merged.reduce((sum, x) => sum + (x.playCount || 0), 0);
    merged.forEach((item) => {
      item.sharePct = totalPlays > 0 ? Math.round((item.playCount / totalPlays) * 100) : 0;
      item.isMostPopular = false;
    });

    if (totalPlays > 0) {
      merged.sort((a, b) => {
        if (b.playCount !== a.playCount) return b.playCount - a.playCount;
        if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
        return a._order - b._order;
      });
      if (merged[0] && merged[0].playCount > 0) {
        merged[0].isMostPopular = true;
      }
    }

    return merged.map(({ _order, ...rest }) => rest);
  }

  // ---------------- 4. Search Helpers ----------------
  function tokenizeQuery(query) {
    return cleanStr(query).toLowerCase().split(/\s+/).filter(Boolean);
  }

  /**
   * Filters a list of games by name, id, category, tags, versions, and
   * variation names/aliases (case-insensitive multi-token search).
   */
  function filterGames(games, query) {
    const list = Array.isArray(games) ? games : [];
    const tokens = tokenizeQuery(query);
    if (!tokens.length) return list.slice();

    const V = global.TallyItVariations;
    return list.filter((g) => {
      if (!g) return false;
      const parts = [];
      if (typeof g === 'string') {
        parts.push(g);
      } else {
        if (g.name) parts.push(g.name);
        if (g.id) parts.push(g.id);
        if (g.gameKey) parts.push(g.gameKey);
        if (g.category) parts.push(g.category);
        if (Array.isArray(g.tags)) parts.push(...g.tags);
        if (Array.isArray(g.versions)) parts.push(...g.versions);
        if (Array.isArray(g.aliases)) parts.push(...g.aliases);
        if (V && typeof V.getVariationsForGame === 'function') {
          const vars = V.getVariationsForGame(g.id || g.gameKey || g.name);
          for (const v of vars) {
            parts.push(v.name, v.key, v.versionLabel);
            if (Array.isArray(v.aliases)) parts.push(...v.aliases);
          }
        }
      }
      const haystack = parts.filter(Boolean).join(' ').toLowerCase();
      return tokens.every((t) => haystack.includes(t));
    });
  }

  /**
   * Filters saved players (strings), friend/profile objects, or history game
   * records by player name / friend code / group name cleanly.
   */
  function filterPlayers(items, query) {
    const list = Array.isArray(items) ? items : [];
    const tokens = tokenizeQuery(query);
    if (!tokens.length) return list.slice();

    return list.filter((item) => {
      if (item === null || item === undefined) return false;
      const parts = [];
      if (typeof item === 'string') {
        parts.push(item);
      } else if (typeof item === 'object') {
        // Direct player / friend / profile fields
        parts.push(
          item.name,
          item.displayName,
          item.display_name,
          item.friendCode,
          item.friend_code,
          item.email,
          item.winner,
          item.groupName,
          item.group_name
        );
        if (Array.isArray(item.winnerNames)) parts.push(...item.winnerNames);
        // History game entry with nested `players` array
        if (Array.isArray(item.players)) {
          for (const p of item.players) {
            if (typeof p === 'string') parts.push(p);
            else if (p && typeof p === 'object') {
              parts.push(p.name, p.displayName, p.display_name);
              if (Array.isArray(p.members)) {
                for (const m of p.members) {
                  parts.push(typeof m === 'string' ? m : (m && (m.name || m.displayName || m.display_name)));
                }
              }
            }
          }
        }
      }
      const haystack = parts.filter(Boolean).join(' ').toLowerCase();
      return tokens.every((t) => haystack.includes(t));
    });
  }

  // ---------------- Exports ----------------
  const api = {
    STORAGE_KEY_HOUSE_RULES,
    SCHEMAS,
    configure,
    normalizeGameKey,
    getRuleSchema,
    getDefaultRules,
    sanitizeRules,
    describeDifferences,
    buildScoringOverrides,
    listLocalHouseRules,
    saveLocalHouseRule,
    deleteLocalHouseRule,
    mergeCommunityVariations,
    filterGames,
    filterPlayers
  };

  global.TallyItHouseRules = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
