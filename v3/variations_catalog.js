/* ==========================================================================
   TallyIt — Game Variations Catalog & Popularity Helpers (v20)
   ==========================================================================
   Zero-dependency UMD module for v3/engine.js & v3/shell.html.
   Exposes `window.TallyItVariations` in browsers and `module.exports` in Node.

   Provides:
   - Complete real-world variations catalog for every game in TallyIt
     (Catan, Flip 7, 7 Wonders, Carcassonne, Oh Hell, Hearts, Nertz,
     Rummikub, Custom) plus classic tabletop games (Mexican Train, Euchre,
     Uno, Yahtzee, Phase 10, Scrabble).
   - 100% compatibility with existing `engine.js` version strings via
     `versionLabel` + `aliases` so legacy History / Supabase `variant` rows
     resolve cleanly to canonical variation keys.
   - Pure helpers:
       * getVariationsForGame(gameKey)
       * getVariation(gameKey, variationKey)
       * getDefaultVariation(gameKey)
       * mergePopularity(gameKey, serverRows, localCounts)
   ========================================================================== */

(function (global) {
  'use strict';

  const GAME_KEY_ALIASES = {
    '7wonders': '7wonders',
    'seven_wonders': '7wonders',
    'seven-wonders': '7wonders',
    '7_wonders': '7wonders',
    'flip7': 'flip7',
    'flip_7': 'flip7',
    'flip-7': 'flip7',
    'carcassonne': 'carcassonne',
    'catan': 'catan',
    'settlers': 'catan',
    'ohhell': 'ohhell',
    'oh_hell': 'ohhell',
    'oh-hell': 'ohhell',
    'hearts': 'hearts',
    'nertz': 'nertz',
    'rummikub': 'rummikub',
    'qwirkle': 'qwirkle',
    'spoons': 'spoons',
    'other': 'other',
    'custom': 'other',
    'mexican_train': 'mexican_train',
    'mexican-train': 'mexican_train',
    'mexicantrain': 'mexican_train',
    'euchre': 'euchre',
    'uno': 'uno',
    'yahtzee': 'yahtzee',
    'phase10': 'phase10',
    'phase_10': 'phase10',
    'phase-10': 'phase10',
    'scrabble': 'scrabble'
  };

  const CATALOG = {
    // -----------------------------------------------------------------------
    // 1. CATAN
    // -----------------------------------------------------------------------
    catan: [
      {
        key: 'base',
        versionLabel: 'Base (to 10 VP)',
        name: 'Base Game',
        tagline: 'Classic Catan island — first player to 10 Victory Points wins.',
        isDefault: true,
        aliases: ['Base', 'Base (to 10 VP)', 'Standard', '10 VP'],
        differences: [
          'First to 10 VP wins on your own turn.',
          'Score via Settlements (+1), Cities (+2), Longest Road (+2), Largest Army (+2), and VP Dev Cards (+1).',
          'Standard 3–4 player board with 19 terrain hexes.'
        ],
        scoringOverrides: {
          targetScore: 10,
          playersMin: 3,
          playersMax: 4,
          notes: 'Standard 10 VP target.'
        }
      },
      {
        key: 'cities_knights',
        versionLabel: 'Cities & Knights (to 13 VP)',
        name: 'Cities & Knights',
        tagline: 'Deeper strategy with barbarians, knights, and metropolises — play to 13 VP.',
        isDefault: false,
        aliases: ['Cities & Knights', 'Cities & Knights (to 13 VP)', 'C&K'],
        differences: [
          'Winning target increases from 10 VP to 13 VP.',
          'Metropolises (+2 VP each) and Defender of Catan (+1 VP) replace Largest Army.',
          'Commodity upgrades & Progress Cards replace standard Development Cards.'
        ],
        scoringOverrides: {
          targetScore: 13,
          playersMin: 3,
          playersMax: 4,
          notes: '13 VP target; track Metropolises & Defender points in VP Cards / Simple mode.'
        }
      },
      {
        key: 'seafarers',
        versionLabel: 'Seafarers (to 12 VP)',
        name: 'Seafarers',
        tagline: 'Explore islands by ship — most scenarios play to 12–14 VP.',
        isDefault: false,
        aliases: ['Seafarers', 'Seafarers (to 12 VP)'],
        differences: [
          'Default winning target rises from 10 VP to 12 VP (varies by scenario).',
          'Ships extend trade routes and count toward Longest Road (+2 VP).',
          'Bonus VPs awarded for settling new islands or discovering gold hexes.'
        ],
        scoringOverrides: {
          targetScore: 12,
          playersMin: 3,
          playersMax: 4,
          notes: '12 VP default target; adjustable in setup.'
        }
      },
      {
        key: 'five_six_player',
        versionLabel: '5-6 Player (to 10 VP)',
        name: '5–6 Player Extension',
        tagline: 'Larger island for 5–6 players with Special Building Phase — still to 10 VP.',
        isDefault: false,
        aliases: ['5-6 Player', '5-6 Player (to 10 VP)', '5-6 Players'],
        differences: [
          'Supports 5–6 players on an expanded 30-hex board.',
          'Adds a Special Building Phase (or Paired Player turn) between regular turns.',
          'Same 10 VP winning target as the Base Game.'
        ],
        scoringOverrides: {
          targetScore: 10,
          playersMin: 5,
          playersMax: 6,
          notes: 'Supports up to 6 players; 10 VP target.'
        }
      }
    ],

    // -----------------------------------------------------------------------
    // 2. 7 WONDERS
    // -----------------------------------------------------------------------
    '7wonders': [
      {
        key: 'base',
        versionLabel: 'Base Game',
        name: 'Base Game',
        tagline: 'Classic 7-category drafting — Military, Treasury, Wonder, Blue, Yellow, Guilds & Science.',
        isDefault: true,
        aliases: ['Base', 'Base Game', 'Standard', '7 Wonders'],
        differences: [
          'Score all 7 core categories: Military, Treasury (3 coins = 1 VP), Wonder, Civilian, Commercial, Guilds, and Science.',
          'Raw Treasury coins break Victory Point ties.',
          '3–7 players across three Ages with no expansion boards.'
        ],
        scoringOverrides: {
          targetScore: null,
          playersMin: 3,
          playersMax: 7,
          expansions: { leaders: false, cities: false, armada: false },
          notes: '7 base categories; raw coins break VP ties.'
        }
      },
      {
        key: 'leaders',
        versionLabel: 'With Leaders',
        name: 'With Leaders',
        tagline: 'Draft iconic historical Leaders before Age I for asymmetric powers and bonus VP.',
        isDefault: false,
        aliases: ['Leaders', 'With Leaders'],
        differences: [
          'Adds a Leaders (White) scoring category to the ledger.',
          'Players draft 4 Leaders at setup and recruit one before each Age.',
          'All 7 base categories and coin tiebreaker remain unchanged.'
        ],
        scoringOverrides: {
          targetScore: null,
          playersMin: 3,
          playersMax: 7,
          expansions: { leaders: true, cities: false, armada: false },
          notes: 'Enables the Leaders (White) category.'
        }
      },
      {
        key: 'cities',
        versionLabel: 'With Cities',
        name: 'With Cities',
        tagline: 'Adds Black cards, Diplomacy, Debt tokens, and optional 8-player team play.',
        isDefault: false,
        aliases: ['Cities', 'With Cities'],
        differences: [
          'Adds a signed Cities (Black) scoring category (Debt tokens can subtract VP).',
          'Each Age has 1 extra card per player for espionage, diplomacy, and loss-of-coins effects.',
          'All 7 base categories and coin tiebreaker still apply.'
        ],
        scoringOverrides: {
          targetScore: null,
          playersMin: 3,
          playersMax: 7,
          expansions: { leaders: false, cities: true, armada: false },
          notes: 'Enables the signed Cities (Black) category.'
        }
      },
      {
        key: 'armada',
        versionLabel: 'With Armada',
        name: 'With Armada',
        tagline: 'Adds naval shipyards, fleets, island exploration, and table-wide naval conflicts.',
        isDefault: false,
        aliases: ['Armada', 'With Armada'],
        differences: [
          'Adds a signed Armada (Navy) category covering naval conflict tokens, fleets, and islands.',
          'Naval conflicts pit all players against each other at the end of every Age.',
          'All 7 base categories and coin tiebreaker remain unchanged.'
        ],
        scoringOverrides: {
          targetScore: null,
          playersMin: 3,
          playersMax: 7,
          expansions: { leaders: false, cities: false, armada: true },
          notes: 'Enables the signed Armada (Navy) category.'
        }
      }
    ],

    // -----------------------------------------------------------------------
    // 3. FLIP 7
    // -----------------------------------------------------------------------
    flip7: [
      {
        key: 'standard',
        versionLabel: 'Standard (to 200)',
        name: 'Standard',
        tagline: 'Push-your-luck card drafting — first player to 200 points wins.',
        isDefault: true,
        aliases: ['Standard', 'Standard (to 200)', 'Base'],
        differences: [
          'Play rounds until at least one player reaches 200+ points; highest score wins.',
          'Flipping 7 unique number cards scores a +15 Flip 7 bonus and ends the round.',
          'Busting on a duplicate number scores 0 for the round unless protected by Second Chance.'
        ],
        scoringOverrides: {
          targetScore: 200,
          playersMin: 2,
          playersMax: 18,
          notes: '200-point target with +15 Flip 7 bonus.'
        }
      },
      {
        key: 'vengeance',
        versionLabel: 'With a Vengeance',
        name: 'With a Vengeance',
        tagline: 'Meaner action cards and take-that twists — same 200-point race.',
        isDefault: false,
        aliases: ['With a Vengeance', 'Vengeance'],
        differences: [
          'Adds aggressive action cards that force rivals to draw or drop cards.',
          'Higher bust risk makes banking points early more valuable.',
          'Same 200-point target and +15 Flip 7 bonus.'
        ],
        scoringOverrides: {
          targetScore: 200,
          playersMin: 2,
          playersMax: 18,
          notes: '200-point target.'
        }
      },
      {
        key: 'thematic_promo',
        versionLabel: 'Thematic / Promo',
        name: 'Thematic / Promo',
        tagline: 'Promo or seasonal deck variants with custom modifier cards.',
        isDefault: false,
        aliases: ['Thematic / Promo', 'Promo', 'Thematic'],
        differences: [
          'Includes promo modifier or special action cards not in the core deck.',
          'Use custom delta adjustments on the Card Pad for unique promo effects.',
          'Standard 200-point target.'
        ],
        scoringOverrides: {
          targetScore: 200,
          playersMin: 2,
          playersMax: 18,
          notes: '200-point target.'
        }
      }
    ],

    // -----------------------------------------------------------------------
    // 4. CARCASSONNE
    // -----------------------------------------------------------------------
    carcassonne: [
      {
        key: 'classic',
        versionLabel: 'Classic (current scoring)',
        name: 'Classic (Current Edition)',
        tagline: 'Modern 3rd-edition scoring — 2-tile cities score 4 pts, farms score 3 pts per city.',
        isDefault: true,
        aliases: ['Classic', 'Classic (current scoring)', 'Standard', 'Current Edition'],
        differences: [
          'Completed 2-tile cities score 4 points (2 per tile + 2 per pennant).',
          'Farms score 3 points per completed city touching that field at game end.',
          'Includes the River & Abbot mini-expansions in modern box printings.'
        ],
        scoringOverrides: {
          targetScore: null,
          playersMin: 2,
          playersMax: 5,
          notes: 'Current official scoring rules.'
        }
      },
      {
        key: 'older_edition',
        versionLabel: 'Older edition (small cities)',
        name: '1st Edition (Small Cities)',
        tagline: 'Original 2000 rules where 2-tile cities score 2 points instead of 4.',
        isDefault: false,
        aliases: ['Older edition (small cities)', '1st Edition', 'Small Cities'],
        differences: [
          'Completed 2-tile cities without a pennant score 2 points instead of 4.',
          'Farms score 3 points per city (or 4 per city in the earliest 2000 printing).',
          'Rewards building larger multi-tile cities rather than quick 2-tile caps.'
        ],
        scoringOverrides: {
          targetScore: null,
          playersMin: 2,
          playersMax: 5,
          notes: '2-tile cities score 2 pts.'
        }
      },
      {
        key: 'inns_cathedrals',
        versionLabel: 'With Inns & Cathedrals',
        name: 'Inns & Cathedrals',
        tagline: 'Higher stakes on roads and cities, Big Meeple, and support for a 6th player.',
        isDefault: false,
        aliases: ['With Inns & Cathedrals', 'Inns & Cathedrals'],
        differences: [
          'Completed roads with an Inn score 2 pts/tile (0 if unfinished at game end).',
          'Completed cities with a Cathedral score 3 pts/tile & pennant (0 if unfinished).',
          'Adds the Big Meeple (worth 2 meeples for majority) and supports up to 6 players.'
        ],
        scoringOverrides: {
          targetScore: null,
          playersMin: 2,
          playersMax: 6,
          notes: 'Supports up to 6 players; Inns & Cathedrals multipliers.'
        }
      },
      {
        key: 'other_expansions',
        versionLabel: 'With other expansions',
        name: 'Multi-Expansion',
        tagline: 'Traders & Builders, Princess & Dragon, or custom expansion mixes.',
        isDefault: false,
        aliases: ['With other expansions', 'Other Expansions'],
        differences: [
          'Adds trade goods bonuses (10 pts per majority in Wine, Grain, Cloth).',
          'Supports extra features like Builders, Pigs (+1 per city on farms), or Towers.',
          'Track bonus points cleanly in the Feature pad.'
        ],
        scoringOverrides: {
          targetScore: null,
          playersMin: 2,
          playersMax: 6,
          notes: 'Flexible feature scoring for expansion mixes.'
        }
      }
    ],

    // -----------------------------------------------------------------------
    // 5. OH HELL
    // -----------------------------------------------------------------------
    ohhell: [
      {
        key: 'exact_10_plus_bid',
        versionLabel: 'Exact: 10+bid (miss=0)',
        name: 'Exact 10 + Bid',
        tagline: 'Hit your exact bid for 10 + tricks won; miss by any amount and score 0.',
        isDefault: true,
        aliases: ['Exact: 10+bid (miss=0)', '10+bid', 'Standard'],
        differences: [
          'Exact bid scores 10 + number of tricks bid (e.g., bid 3 & take 3 = 13 pts).',
          'Missing your bid (over or under) scores 0 points for the hand.',
          'Dealer is usually barred from making total bids equal cards dealt ("Hook" rule).'
        ],
        scoringOverrides: {
          targetScore: null,
          playersMin: 3,
          playersMax: 7,
          notes: 'Exact = 10 + bid; miss = 0.'
        }
      },
      {
        key: 'one_per_trick_plus_10',
        versionLabel: '1 per trick +10 if exact',
        name: '1/Trick + 10 Bonus',
        tagline: 'Always earn 1 point per trick taken, plus a +10 bonus for hitting your bid.',
        isDefault: false,
        aliases: ['1 per trick +10 if exact', '1 per trick'],
        differences: [
          'Every trick taken earns 1 point even if you miss your bid.',
          'Hitting your exact bid awards an additional +10 bonus.',
          'Softer punishment for missing by a single trick than pure 10+bid.'
        ],
        scoringOverrides: {
          targetScore: null,
          playersMin: 3,
          playersMax: 7,
          notes: '1 pt per trick won + 10 bonus if exact.'
        }
      },
      {
        key: 'other_variant',
        versionLabel: 'Other variant',
        name: 'House / Penalty Variant',
        tagline: 'Custom table scoring such as 10 + bid², negative misses, or 5 + bid.',
        isDefault: false,
        aliases: ['Other variant', 'House Rules', 'Penalty'],
        differences: [
          'Supports house rules like −10 per trick off bid or 10 + (2 × bid).',
          'Use manual score entry when your table plays custom multipliers.',
          'Highest total after the final hand wins.'
        ],
        scoringOverrides: {
          targetScore: null,
          playersMin: 3,
          playersMax: 7,
          notes: 'Custom round scoring.'
        }
      }
    ],

    // -----------------------------------------------------------------------
    // 6. HEARTS
    // -----------------------------------------------------------------------
    hearts: [
      {
        key: 'standard_100',
        versionLabel: 'Standard (to 100)',
        name: 'Standard (to 100)',
        tagline: 'Classic 4-player Hearts — game ends at 100 points, lowest score wins.',
        isDefault: true,
        aliases: ['Standard', 'Standard (to 100)', 'Classic'],
        differences: [
          'Each Heart = +1 pt, Queen of Spades = +13 pts (26 pts per hand).',
          'Shooting the Moon gives every opponent +26 pts (or −26 to the shooter).',
          'Game ends when any player reaches 100+ points; lowest score wins.'
        ],
        scoringOverrides: {
          targetScore: 100,
          playersMin: 3,
          playersMax: 6,
          lowWins: true,
          notes: 'Ends at 100; lowest score wins.'
        }
      },
      {
        key: 'short_50',
        versionLabel: 'Short (to 50)',
        name: 'Short Game (to 50)',
        tagline: 'Faster match ending at 50 points — great for quick sessions.',
        isDefault: false,
        aliases: ['Short', 'Short (to 50)', '50'],
        differences: [
          'Target threshold drops from 100 points to 50 points.',
          'A single Queen of Spades (+13) or Shoot the Moon (+26) swings the game fast.',
          'Lowest score when someone hits 50+ wins.'
        ],
        scoringOverrides: {
          targetScore: 50,
          playersMin: 3,
          playersMax: 6,
          lowWins: true,
          notes: 'Ends at 50; lowest score wins.'
        }
      },
      {
        key: 'jack_of_diamonds',
        versionLabel: 'With Jack of Diamonds',
        name: 'Omnibus (Jack of Diamonds)',
        tagline: 'Taking the Jack of Diamonds subtracts 10 points from your hand score.',
        isDefault: false,
        aliases: ['With Jack of Diamonds', 'Jack of Diamonds', 'Omnibus'],
        differences: [
          'Capturing the Jack of Diamonds awards −10 points (can make a hand negative).',
          'Creates a thrilling race to win the J♦ without taking Hearts or Q♠.',
          'Game still ends at 100 points; lowest score wins.'
        ],
        scoringOverrides: {
          targetScore: 100,
          playersMin: 3,
          playersMax: 6,
          lowWins: true,
          notes: 'J♦ = −10 pts; ends at 100.'
        }
      }
    ],

    // -----------------------------------------------------------------------
    // 7. NERTZ
    // -----------------------------------------------------------------------
    nertz: [
      {
        key: 'standard_100',
        versionLabel: 'Standard (to 100)',
        name: 'Standard (to 100)',
        tagline: 'Classic frantic solitaire race — +1 per center card, −2 per Nertz left, first to 100.',
        isDefault: true,
        aliases: ['Standard', 'Standard (to 100)'],
        differences: [
          'Score +1 for each card played to the center lake and −2 for each card left in your Nertz pile.',
          'Scores can go negative; play until a player or team hits 100+ points.',
          'Supports Solo play or unlimited Teams/Partners.'
        ],
        scoringOverrides: {
          targetScore: 100,
          playersMin: 2,
          playersMax: 8,
          notes: 'First to 100 points wins.'
        }
      },
      {
        key: 'long_150',
        versionLabel: 'Long game (to 150)',
        name: 'Long Game (to 150)',
        tagline: 'Extended match to 150 points for bigger comeback arcs.',
        isDefault: false,
        aliases: ['Long game (to 150)', 'Long', '150'],
        differences: [
          'Winning target increases from 100 points to 150 points.',
          'Gives players more rounds to recover from an early negative hand.',
          'Same +1 center / −2 Nertz pile scoring.'
        ],
        scoringOverrides: {
          targetScore: 150,
          playersMin: 2,
          playersMax: 8,
          notes: 'First to 150 points wins.'
        }
      },
      {
        key: 'short_50',
        versionLabel: 'Short game (to 50)',
        name: 'Short Game (to 50)',
        tagline: 'Quick 3–5 round sprint to 50 points.',
        isDefault: false,
        aliases: ['Short game (to 50)', 'Short', '50'],
        differences: [
          'Winning target drops from 100 points to 50 points.',
          'Ideal for warm-up games or larger 6+ player tables.',
          'Same +1 center / −2 Nertz pile scoring.'
        ],
        scoringOverrides: {
          targetScore: 50,
          playersMin: 2,
          playersMax: 8,
          notes: 'First to 50 points wins.'
        }
      }
    ],

    // -----------------------------------------------------------------------
    // 8. RUMMIKUB
    // -----------------------------------------------------------------------
    rummikub: [
      {
        key: 'points_up',
        versionLabel: 'Points Up (Lowest Wins)',
        name: 'Points Up (Lowest Wins)',
        tagline: 'Leftover tiles add positive penalty points to your rack — lowest total wins.',
        isDefault: true,
        aliases: ['Points Up (Lowest Wins)', 'Points Up', 'Lowest Wins'],
        differences: [
          'Round winner gets 0; everyone else adds the sum of tiles left on their rack.',
          'Unused Joker on your rack adds a +30 penalty.',
          'Lowest cumulative score at the end of the session wins.'
        ],
        scoringOverrides: {
          targetScore: null,
          playersMin: 2,
          playersMax: 6,
          lowWins: true,
          scoringMode: 'points_up',
          notes: 'Non-negative round deltas, Joker +30, lowest score wins.'
        }
      },
      {
        key: 'classic',
        versionLabel: 'Classic (+/−)',
        name: 'Classic (+/− Official)',
        tagline: 'Official zero-sum scoring — losers subtract leftover tiles and winner gains the sum.',
        isDefault: false,
        aliases: ['Classic (+/−)', 'Classic (+/-)', 'Classic', 'Official'],
        differences: [
          'Losers subtract their remaining tile values (unused Joker = −30).',
          'The player who goes out gains the positive total of all opponents’ leftover tiles.',
          'Highest cumulative score at the end of the session wins.'
        ],
        scoringOverrides: {
          targetScore: null,
          playersMin: 2,
          playersMax: 6,
          lowWins: false,
          scoringMode: 'classic',
          notes: 'Signed round deltas, Joker −30, highest score wins.'
        }
      }
    ],

    // -----------------------------------------------------------------------
    // 9b. QWIRKLE (v24)
    // -----------------------------------------------------------------------
    qwirkle: [
      {
        key: 'standard_play_out',
        versionLabel: 'Standard (play it out)',
        name: 'Standard (Play It Out)',
        tagline: 'Official MindWare rules: score every line, +6 per Qwirkle, +6 for going out first.',
        isDefault: true,
        aliases: ['Standard (play it out)', 'Standard', 'Classic', 'Official'],
        differences: [
          'Each tile line scores 1 point per tile in it (a tile can score in two lines).',
          'Completing a line of all six (a Qwirkle) adds a 6-point bonus.',
          'The first player to empty their hand after the bag runs out scores +6 and ends the game; highest score wins.'
        ],
        scoringOverrides: {
          targetScore: null,
          playersMin: 2,
          playersMax: 6,
          lowWins: false,
          notes: 'Play until someone goes out; highest score wins.'
        }
      },
      {
        key: 'to_300',
        versionLabel: 'Short game (to 300)',
        name: 'Short Game (to 300)',
        tagline: 'Same scoring, but the first player to reach 300 points wins on the spot.',
        isDefault: false,
        aliases: ['Short game (to 300)', 'To 300', '300'],
        differences: [
          'Game ends as soon as any player reaches 300 points.',
          'Qwirkle (+6) and Went Out (+6) bonuses unchanged.',
          'Good for multi-round sessions across a night.'
        ],
        scoringOverrides: {
          targetScore: 300,
          playersMin: 2,
          playersMax: 6,
          lowWins: false,
          notes: 'First to 300 wins.'
        }
      }
    ],

    // -----------------------------------------------------------------------
    // 9. CUSTOM / OTHER
    // -----------------------------------------------------------------------
    other: [
      {
        key: 'custom',
        versionLabel: 'Custom rules',
        name: 'Custom Rules',
        tagline: 'Freeform scorepad for any tabletop, card, or yard game.',
        isDefault: true,
        aliases: ['Custom rules', 'Custom', 'Other'],
        differences: [
          'Enter any positive or negative score per round.',
          'Works with 2–12 players with no fixed target score.',
          'Highest total wins by default.'
        ],
        scoringOverrides: {
          targetScore: null,
          playersMin: 1,
          playersMax: 12,
          notes: 'Open-ended custom scorepad.'
        }
      }
    ],

    // -----------------------------------------------------------------------
    // BONUS CLASSIC CATALOG (ready when these games join TallyIt)
    // -----------------------------------------------------------------------
    mexican_train: [
      {
        key: 'double_12',
        versionLabel: 'Double-12 (13 Rounds)',
        name: 'Double-12 Standard',
        tagline: 'Classic 13-round game counting down from 12-12 to 0-0 — lowest pip total wins.',
        isDefault: true,
        aliases: ['Double-12', 'Standard', '13 Rounds'],
        differences: [
          '13 rounds starting with the double-12 engine down to double-blank.',
          'Add leftover pips in your hand each round; double-blank counts as 50 (or 0 in some tables).',
          'Lowest cumulative score after the 0-0 round wins.'
        ],
        scoringOverrides: { targetScore: null, playersMin: 2, playersMax: 8, lowWins: true, notes: '13 rounds; lowest pip score wins.' }
      },
      {
        key: 'double_9',
        versionLabel: 'Double-9 (10 Rounds)',
        name: 'Double-9 Quick',
        tagline: 'Shorter 10-round set starting from 9-9 — faster rounds for 2–4 players.',
        isDefault: false,
        aliases: ['Double-9', 'Quick', '10 Rounds'],
        differences: [
          '10 rounds starting at double-9 instead of double-12.',
          'Smaller domino set keeps rounds brisk (30–45 minutes total).',
          'Same lowest-score-wins pip tally.'
        ],
        scoringOverrides: { targetScore: null, playersMin: 2, playersMax: 6, lowWins: true, notes: '10 rounds; lowest pip score wins.' }
      },
      {
        key: 'double_15',
        versionLabel: 'Double-15 (16 Rounds)',
        name: 'Double-15 Marathon',
        tagline: 'Big 136-tile set for large 6–12 player tables across 16 rounds.',
        isDefault: false,
        aliases: ['Double-15', 'Marathon', '16 Rounds'],
        differences: [
          '16 rounds starting from the double-15 engine.',
          'Supports larger groups up to 12 players without running short on tiles.',
          'Higher pip totals per round; lowest cumulative score wins.'
        ],
        scoringOverrides: { targetScore: null, playersMin: 4, playersMax: 12, lowWins: true, notes: '16 rounds; supports large tables.' }
      }
    ],

    euchre: [
      {
        key: 'standard_10',
        versionLabel: 'Standard (to 10)',
        name: 'Standard Partnership (to 10)',
        tagline: 'Classic 4-player partnership Euchre — first team to 10 points wins.',
        isDefault: true,
        aliases: ['Standard', 'Standard (to 10)', 'Classic'],
        differences: [
          'Makers score +1 (3–4 tricks), +2 (all 5 tricks / march), or +4 (going alone & taking all 5).',
          'Euchring the makers awards +2 points to the defenders.',
          'First team to 10 points wins.'
        ],
        scoringOverrides: { targetScore: 10, playersMin: 4, playersMax: 4, notes: '2v2 partnership to 10 pts.' }
      },
      {
        key: 'stick_the_dealer',
        versionLabel: 'Stick the Dealer (to 10)',
        name: 'Stick the Dealer',
        tagline: 'If everyone passes twice, the dealer MUST call trump — zero dead hands.',
        isDefault: false,
        aliases: ['Stick the Dealer', 'Screw the Dealer'],
        differences: [
          'Dealer cannot pass in the second round of bidding and must name a trump suit.',
          'Eliminates redeals and creates more high-tension euchres (+2 for defenders).',
          'Same 10-point target and loner (+4) scoring.'
        ],
        scoringOverrides: { targetScore: 10, playersMin: 4, playersMax: 4, notes: 'Forced dealer call; play to 10.' }
      },
      {
        key: 'cutthroat_3p',
        versionLabel: 'Cutthroat (3 Players)',
        name: 'Cutthroat (3-Player)',
        tagline: 'Every player for themselves — maker plays 1 vs 2 each hand.',
        isDefault: false,
        aliases: ['Cutthroat', '3 Players', '3-Player'],
        differences: [
          'Solo maker faces the other two players temporarily allied as defenders.',
          'Maker scores +1 (3–4 tricks) or +3 (all 5 tricks); each defender gets +2 on a euchre.',
          'First individual player to 10 (or 15) points wins.'
        ],
        scoringOverrides: { targetScore: 10, playersMin: 3, playersMax: 3, notes: '3-player solo Euchre.' }
      }
    ],

    uno: [
      {
        key: 'classic_500',
        versionLabel: 'Classic (to 500)',
        name: 'Classic (to 500)',
        tagline: 'Round winner scores the points left in all opponents’ hands — first to 500 wins.',
        isDefault: true,
        aliases: ['Classic', 'Classic (to 500)', 'Standard'],
        differences: [
          'Number cards = face value, Action cards = 20 pts, Wild / Wild Draw 4 = 50 pts.',
          'Only the player who empties their hand scores each round.',
          'First player to reach 500 points wins the match.'
        ],
        scoringOverrides: { targetScore: 500, playersMin: 2, playersMax: 10, notes: 'First to 500 pts wins.' }
      },
      {
        key: 'low_score_200',
        versionLabel: 'Lowest Score (to 200)',
        name: 'Lowest Score Wins',
        tagline: 'Everyone keeps their own leftover card points — game ends at 200, lowest wins.',
        isDefault: false,
        aliases: ['Lowest Score', 'Lowest Score (to 200)', 'Points Up'],
        differences: [
          'Round winner scores 0; every other player adds the point value of cards left in their hand.',
          'Match ends when any player hits 200+ points; lowest total wins.',
          'Popular house variant that punishes holding Wilds (+50) late.'
        ],
        scoringOverrides: { targetScore: 200, playersMin: 2, playersMax: 10, lowWins: true, notes: 'Ends at 200; lowest wins.' }
      },
      {
        key: 'no_mercy',
        versionLabel: 'UNO Show ’em No Mercy',
        name: 'Show ’em No Mercy',
        tagline: 'Stackable +4/+6/+10 penalties and Mercy Rule elimination at 25+ cards.',
        isDefault: false,
        aliases: ['No Mercy', 'UNO No Mercy'],
        differences: [
          'Draw cards stack and include brutal +6 and +10 Wild penalties.',
          'Mercy Rule knocks out any player holding 25 or more cards.',
          'Last player standing or first to empty hand wins the round (play to 1,000 or match wins).'
        ],
        scoringOverrides: { targetScore: 1000, playersMin: 2, playersMax: 6, notes: 'High-scoring No Mercy edition.' }
      }
    ],

    yahtzee: [
      {
        key: 'classic',
        versionLabel: 'Classic Yahtzee',
        name: 'Classic Yahtzee',
        tagline: '13-round dice classic with +35 Upper Bonus and +100 Yahtzee bonuses.',
        isDefault: true,
        aliases: ['Classic', 'Classic Yahtzee', 'Standard'],
        differences: [
          'Upper section total of 63+ awards a +35 bonus.',
          'First Yahtzee scores 50; each additional Yahtzee earns a +100 bonus (when 50 box is filled).',
          'Highest total after all 13 categories wins.'
        ],
        scoringOverrides: { targetScore: null, playersMin: 1, playersMax: 8, notes: '13 categories; +35 upper bonus.' }
      },
      {
        key: 'triple_yahtzee',
        versionLabel: 'Triple Yahtzee',
        name: 'Triple Yahtzee',
        tagline: 'Three columns per player (1×, 2×, 3× multipliers) across 39 rolls.',
        isDefault: false,
        aliases: ['Triple Yahtzee', 'Triple'],
        differences: [
          'Each player fills 3 full columns: Column 1 (1×), Column 2 (2×), and Column 3 (3×).',
          'Upper +35 bonus applies independently to each column before multiplying.',
          'Rewards saving big rolls for the 3× column.'
        ],
        scoringOverrides: { targetScore: null, playersMin: 1, playersMax: 6, notes: '3 columns with 1×/2×/3× multipliers.' }
      },
      {
        key: 'yatzy_scandinavian',
        versionLabel: 'Yatzy (Scandinavian)',
        name: 'Yatzy (Scandinavian)',
        tagline: '15 categories with One Pair, Two Pairs, and +50 Upper Bonus — no Yahtzee joker.',
        isDefault: false,
        aliases: ['Yatzy', 'Scandinavian Yatzy'],
        differences: [
          '15 rounds adding One Pair and Two Pairs; Small Straight is 1–5 (15 pts) and Large Straight is 2–6 (20 pts).',
          'Upper bonus is +50 (still at 63+ upper points) instead of +35.',
          'Full House scores the actual sum of all 5 dice rather than a flat 25.'
        ],
        scoringOverrides: { targetScore: null, playersMin: 1, playersMax: 8, notes: '15 categories; +50 upper bonus.' }
      }
    ],

    phase10: [
      {
        key: 'classic',
        versionLabel: 'Classic (10 Phases)',
        name: 'Classic Phase 10',
        tagline: 'Complete Phases 1–10 in order; lowest penalty score wins ties.',
        isDefault: true,
        aliases: ['Classic', 'Standard', 'Classic (10 Phases)'],
        differences: [
          'Phases must be completed strictly in order from Phase 1 to Phase 10.',
          'Leftover cards score 5 pts (1–9), 10 pts (10–12), 15 pts (Skip), 25 pts (Wild).',
          'First to finish Phase 10 wins (lowest total points breaks same-round ties).'
        ],
        scoringOverrides: { targetScore: null, playersMin: 2, playersMax: 6, lowWins: true, notes: 'Lowest points breaks Phase 10 ties.' }
      },
      {
        key: 'floating_choice',
        versionLabel: 'Choice / Floating Phases',
        name: 'Choice (Any Order)',
        tagline: 'Complete the 10 Phases in any order you choose — faster, less getting stuck.',
        isDefault: false,
        aliases: ['Choice', 'Floating', 'Any Order'],
        differences: [
          'Players may complete any remaining Phase each round instead of going 1→10 strictly.',
          'Dramatically reduces getting stuck on Phase 8 (7 of one color).',
          'Same card penalty values and tiebreaker.'
        ],
        scoringOverrides: { targetScore: null, playersMin: 2, playersMax: 6, lowWins: true, notes: 'Complete phases in any order.' }
      },
      {
        key: 'masters_edition',
        versionLabel: 'Phase 10 Masters',
        name: 'Masters Edition',
        tagline: 'Harder Phase cards plus a Save Card slot for deeper hand planning.',
        isDefault: false,
        aliases: ['Masters', 'Phase 10 Masters'],
        differences: [
          'Includes trickier Master Phases (e.g., 4 of one color + run of 4).',
          'Each player may set aside 1 card per round to carry into the next turn.',
          'Same lowest-score tiebreaker when finishing Phase 10.'
        ],
        scoringOverrides: { targetScore: null, playersMin: 2, playersMax: 6, lowWins: true, notes: 'Master phase deck with Save Card.' }
      }
    ],

    scrabble: [
      {
        key: 'standard',
        versionLabel: 'Standard (TWL / CSW)',
        name: 'Standard Scrabble',
        tagline: 'Classic 15×15 board with +50 Bingo bonus for playing all 7 tiles.',
        isDefault: true,
        aliases: ['Standard', 'Classic', 'TWL', 'CSW'],
        differences: [
          'Using all 7 rack tiles in one play awards a +50 Bingo bonus.',
          'At game end, players subtract unplayed rack tiles; the player who went out gains opponents’ remaining tile values.',
          'Highest final score wins.'
        ],
        scoringOverrides: { targetScore: null, playersMin: 2, playersMax: 4, notes: 'Classic 2–4 player Scrabble.' }
      },
      {
        key: 'super_scrabble',
        versionLabel: 'Super Scrabble',
        name: 'Super Scrabble',
        tagline: 'Expanded 21×21 board with 200 tiles plus Quadruple Letter & Word squares.',
        isDefault: false,
        aliases: ['Super Scrabble', 'Super'],
        differences: [
          '21×21 board with 200 tiles (double the standard tile bag).',
          'Adds Quadruple Letter (4L) and Quadruple Word (4W) premium squares.',
          'Same +50 Bingo bonus and end-game rack scoring.'
        ],
        scoringOverrides: { targetScore: null, playersMin: 2, playersMax: 4, notes: '200 tiles; 4L and 4W squares.' }
      },
      {
        key: 'duplicate',
        versionLabel: 'Duplicate / Tournament',
        name: 'Duplicate Scrabble',
        tagline: 'Everyone plays from the exact same 7-tile rack each turn — pure skill, zero luck.',
        isDefault: false,
        aliases: ['Duplicate', 'Tournament'],
        differences: [
          'All players independently find the best play from the same shared 7-tile rack.',
          'Everyone scores their own word, while the highest-scoring word is placed on the master board.',
          'Eliminates tile-draw luck and scales cleanly to any number of players.'
        ],
        scoringOverrides: { targetScore: null, playersMin: 2, playersMax: 12, notes: 'Shared rack each turn.' }
      }
    ]
  };

  // ---------------- Pure Helpers ----------------
  function normalizeGameKey(gameKey) {
    const raw = String(gameKey || '').trim().toLowerCase();
    if (!raw) return '';
    return GAME_KEY_ALIASES[raw] || raw;
  }

  function normToken(v) {
    return String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function cloneVariation(v) {
    return {
      key: v.key,
      versionLabel: v.versionLabel || v.name,
      name: v.name,
      tagline: v.tagline,
      isDefault: Boolean(v.isDefault),
      aliases: Array.isArray(v.aliases) ? v.aliases.slice() : [],
      differences: Array.isArray(v.differences) ? v.differences.slice() : [],
      scoringOverrides: v.scoringOverrides
        ? {
            ...v.scoringOverrides,
            ...(v.scoringOverrides.expansions ? { expansions: { ...v.scoringOverrides.expansions } } : {})
          }
        : {}
    };
  }

  /**
   * Returns a cloned array of all variations for a gameKey.
   */
  function getVariationsForGame(gameKey) {
    const gk = normalizeGameKey(gameKey);
    const list = CATALOG[gk];
    return Array.isArray(list) ? list.map(cloneVariation) : [];
  }

  /**
   * Returns the default variation for a gameKey (or null if unknown game).
   */
  function getDefaultVariation(gameKey) {
    const list = getVariationsForGame(gameKey);
    if (!list.length) return null;
    return list.find((v) => v.isDefault) || list[0];
  }

  /**
   * Looks up a single variation by canonical `key`, `versionLabel`, `name`, or `aliases`.
   */
  function getVariation(gameKey, variationKey) {
    const list = getVariationsForGame(gameKey);
    if (!list.length) return null;
    const target = normToken(variationKey);
    if (!target) return null;

    // 1. Exact key match
    let hit = list.find((v) => normToken(v.key) === target);
    if (hit) return hit;

    // 2. Exact versionLabel or name match
    hit = list.find((v) => normToken(v.versionLabel) === target || normToken(v.name) === target);
    if (hit) return hit;

    // 3. Alias match
    hit = list.find((v) => v.aliases.some((a) => normToken(a) === target));
    if (hit) return hit;

    return null;
  }

  /**
   * Normalizes server popularity rows or local counts into a map of
   * { [canonicalVariationKey]: count }.
   */
  function accumulateCounts(gameKey, source, countsMap, defaultKey) {
    if (!source) return;
    const add = (rawKey, rawCount) => {
      const n = Math.max(0, Math.trunc(Number(rawCount) || 0));
      if (n <= 0) return;
      const resolved = getVariation(gameKey, rawKey);
      const targetKey = resolved ? resolved.key : (!normToken(rawKey) ? defaultKey : null);
      if (!targetKey) return;
      countsMap.set(targetKey, (countsMap.get(targetKey) || 0) + n);
    };

    if (Array.isArray(source)) {
      for (const row of source) {
        if (!row || typeof row !== 'object') continue;
        // Support server aggregate rows: { variant, play_count } / { variation_key, count } / { key, plays }
        const hasCountField =
          row.play_count !== undefined ||
          row.playCount !== undefined ||
          row.count !== undefined ||
          row.plays !== undefined;
        const rawKey = row.variation_key ?? row.variationKey ?? row.variant ?? row.version ?? row.key ?? '';
        if (hasCountField) {
          const cnt = row.play_count ?? row.playCount ?? row.count ?? row.plays ?? 0;
          add(rawKey, cnt);
        } else {
          // Also supports passing raw local history game objects: [{ type, version, variant }]
          const rowGame = row.type || row.game_type;
          if (rowGame && normalizeGameKey(rowGame) !== normalizeGameKey(gameKey)) continue;
          add(rawKey, 1);
        }
      }
    } else if (typeof source === 'object') {
      for (const [k, v] of Object.entries(source)) {
        add(k, v);
      }
    }
  }

  /**
   * Merges Supabase popularity rows (`serverRows`) and optional local counts
   * (`localCounts`) onto the game's variation catalog.
   *
   * Returns a sorted array of variations annotated with:
   *   - `playCount` (integer >= 0)
   *   - `sharePct` (integer 0–100; 0 when totalPlays === 0)
   *   - `isMostPopular` (boolean; true on the #1 variation when totalPlays > 0)
   */
  function mergePopularity(gameKey, serverRows, localCounts) {
    const variations = getVariationsForGame(gameKey);
    if (!variations.length) return [];

    const defVar = variations.find((v) => v.isDefault) || variations[0];
    const counts = new Map(variations.map((v) => [v.key, 0]));

    accumulateCounts(gameKey, serverRows, counts, defVar.key);
    accumulateCounts(gameKey, localCounts, counts, defVar.key);

    let totalPlays = 0;
    for (const c of counts.values()) totalPlays += c;

    const annotated = variations.map((v, catalogIdx) => {
      const playCount = counts.get(v.key) || 0;
      const sharePct = totalPlays > 0 ? Math.round((playCount / totalPlays) * 100) : 0;
      return {
        ...v,
        playCount,
        sharePct,
        isMostPopular: false,
        _catalogIdx: catalogIdx
      };
    });

    if (totalPlays > 0) {
      annotated.sort((a, b) => {
        if (b.playCount !== a.playCount) return b.playCount - a.playCount;
        if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
        return a._catalogIdx - b._catalogIdx;
      });
      if (annotated[0].playCount > 0) {
        annotated[0].isMostPopular = true;
      }
    }

    return annotated.map(({ _catalogIdx, ...rest }) => rest);
  }

  // ---------------- Exports ----------------
  const api = {
    CATALOG,
    GAME_KEY_ALIASES,
    normalizeGameKey,
    getVariationsForGame,
    getDefaultVariation,
    getVariation,
    mergePopularity
  };

  global.TallyItVariations = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
