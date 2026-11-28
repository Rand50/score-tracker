// v24: Qwirkle (Bright Playful Tile Grid: quick points, Qwirkle +6, Went Out +6, bag counter, official MindWare cover art) + link players after a game (creator links a guest to a friend or shares a one-time claim link; signed-in players claim past games); v23: custom Hearts (Ivory & Crimson Ledger) and Oh Hell (Ivory & Emerald Ledger) scoring screens, matching Setup themes, History cloud/local delete fix; v22: game & player search, requested-game built notifications, guest email on Request a Game, Customize Rules (House Rules) + community variations, admin moderation; v21: guided game selection -> setup stepper + sticky Start Scoring, multiple open games (In Progress), universal End / Leave sheet (Save & Finish, Keep Open, End Without Recording) on every game; v20.1: clean header (TallyIt brand, 7px sync dot, Full Screen + Menu only, auto-hide Full Screen in standalone); v20: Request a Game form, game variations & popularity tallies, private admin stats, full screen mode; Score Tracker service worker
// v19: TallyIt branding + tallyit.fun custom domain (CNAME, root index redirect preserving ?query/#hash, PNG favicon/apple-touch/PWA icons, dynamic OAuth redirect); v18: 7 Wonders Illuminated Papyrus Ledger (3–7 players, category-by-category ledger, automatic optimal Science with Wilds, coins→VP + official coin tiebreaker, optional Leaders/Cities/Armada, official Repos Production cover art); v17: Friends sync/visibility fixes (incoming requests, sent requests with Cancel, live refresh, error states) + Friend QR codes (offline SVG QR, scan/paste, ?addFriend= deep links); v16: Rummikub Classic Blue & Ivory Rack (2–6 players, Points Up (Lowest Wins) / Classic +/− modes, Joker ±30, built-in tile calculator, official Pressman cover art); v15: reusable 3D Dice Roller + Roll Tracker (Catan + any dice game: CSS 3D dice, physical-dice quick log, live distribution vs expected, diceStats saved to history); v14: Home & shell redesign (obsidian/alabaster/brass, inline SVG nav icons, no emoji), always land on Home with Resume banner, no false Offline banner on non-network Supabase errors; v13: Flip 7 tile uses official full-bleed The Op Games front cover art; v12: Nertz streamlined to signed round add/subtract (−/+ toggle, quick steppers) + Got Nertz! caller highlight; illustrated Flip 7 tile; v11: Nertz Midnight Parlor & Gold Foil (Solo + unlimited Partners/Teams, body.theme-nertz) + illustrated playing-card tiles for Hearts, Oh Hell, Nertz; v10: Carcassonne aged-parchment texture + tap-to-pick meeple color popover, Finish below + Player/Reset; v9: Friends & Groups social layer (you as default player, friends, group presets + leaderboards, shared history); v8: Carcassonne sunlit meadow final-score tally (body.theme-carcassonne); v7: Flip 7 coastal card theme (body.theme-flip7); v6: no tap-zoom + box art for every game; v5: neutral shell + Catan screen matched to the approved rendering (real cropped art in assets/catan). Network-first for HTML so new builds show up immediately; cache is only an offline fallback.
const CACHE_NAME = 'v26-favorites-history-2026-11-28';
const ASSETS = [
  './game_tracker.html',
  './manifest.json',
  './assets/icons/favicon-32.png',
  './assets/icons/apple-touch-icon.png',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/catan/wood-bg.svg',
  './assets/carcassonne/meadow-bg.svg',
  './assets/catan/shield-red.svg',
  './assets/catan/shield-green.svg',
  './assets/catan/shield-blue.svg',
  './assets/catan/shield-purple.svg',
  './assets/catan/icon-settlements.svg',
  './assets/catan/icon-cities.svg',
  './assets/catan/icon-road.svg',
  './assets/catan/icon-army.svg',
  './assets/catan/icon-vpcard.svg',
  './assets/games/flip7.svg',
  './assets/games/catan.svg',
  './assets/games/carcassonne.svg',
  './assets/games/hearts.svg',
  './assets/games/ohhell.svg',
  './assets/games/nertz.svg',
  './assets/games/rummikub.svg',
  './assets/games/7wonders.svg',
  './assets/games/qwirkle.svg',
  './assets/games/spoons.svg',
  './assets/games/custom.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.all(ASSETS.map(url => cache.add(url).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => (k !== CACHE_NAME ? caches.delete(k) : null))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Never intercept cross-origin traffic (Supabase auth/API, CDNs, fonts).
  if (url.origin !== self.location.origin) return;

  const isHTML = req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html') ||
    url.pathname.endsWith('.html') || url.pathname.endsWith('/');

  if (isHTML) {
    // Network-first: always try the fresh page; fall back to cache when offline.
    event.respondWith(
      fetch(req)
        .then(res => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(url.pathname, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(url.pathname).then(r => r || caches.match('./game_tracker.html')))
    );
    return;
  }

  // Static assets: cache-first, then network.
  event.respondWith(
    caches.match(req).then(cached => cached || fetch(req))
  );
});
