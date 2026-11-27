// Score Tracker service worker
// v12: Nertz streamlined to signed round add/subtract (−/+ toggle, quick steppers) + Got Nertz! caller highlight; illustrated Flip 7 tile; v11: Nertz Midnight Parlor & Gold Foil (Solo + unlimited Partners/Teams, body.theme-nertz) + illustrated playing-card tiles for Hearts, Oh Hell, Nertz; v10: Carcassonne aged-parchment texture + tap-to-pick meeple color popover, Finish below + Player/Reset; v9: Friends & Groups social layer (you as default player, friends, group presets + leaderboards, shared history); v8: Carcassonne sunlit meadow final-score tally (body.theme-carcassonne); v7: Flip 7 coastal card theme (body.theme-flip7); v6: no tap-zoom + box art for every game; v5: neutral shell + Catan screen matched to the approved rendering (real cropped art in assets/catan). Network-first for HTML so new builds show up immediately; cache is only an offline fallback.
const CACHE_NAME = 'score-tracker-v12-2026-11-26';
const ASSETS = [
  './game_tracker.html',
  './manifest.json',
  './icon-512.jpg',
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
