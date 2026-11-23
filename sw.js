// Service worker: lets SnowScout open instantly and offline once it has been visited.
// App files: served from the cache, refreshed in the background (new versions show up on
// the next launch). Snow data, forecasts and map tiles always come from the network.
//
// Bump VERSION whenever you publish changed files, so old caches get cleaned up.

const VERSION = 'snowscout-web-v2'; // v2: hourly readings
const SHELL = [
  './',
  'index.html',
  'css/app.css',
  'js/app.js',
  'js/api.js',
  'js/scorer.js',
  'js/store.js',
  'vendor/leaflet/leaflet.js',
  'vendor/leaflet/leaflet.css',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // data, forecasts, tiles: network

  event.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: true });
      const network = fetch(req)
        .then((res) => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
