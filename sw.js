// Score Tracker service worker
// v3: network-first for HTML so new builds show up immediately; cache is only an offline fallback.
const CACHE_NAME = 'score-tracker-v3-2026-11-26';
const ASSETS = [
  './game_tracker.html',
  './manifest.json',
  './icon-512.jpg'
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
