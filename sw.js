const CACHE_NAME = 'score-tracker-v2';
const ASSETS = [
  './game_tracker.html',
  './manifest.json',
  './icon-512.jpg',
  './images/flip7.jpg',
  './images/7wonders.jpg',
  './images/ohhell.jpg',
  './images/nertz.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => k !== CACHE_NAME ? caches.delete(k) : null)))
    .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(response => response || fetch(event.request))
  );
});