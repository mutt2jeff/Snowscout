// Service worker: keeps SnowScout opening when there's no signal, while making sure
// updates show up the first time testers open the app after an upload.
//
// App files are "network first": with a connection, the newest version is always loaded
// (and saved). With no connection, or a signal too slow to answer within a few seconds,
// the saved copy is used instead. Snow data, forecasts and map tiles always come
// straight from the network and are not handled here, except the BC and Alberta snow
// files (data/bc-*.json, data/ab-*.json), which live on this site and so are treated like
// app files.
//
// Bump VERSION whenever you publish changed files, so old saved copies get cleaned up.

const VERSION = 'snowscout-web-v9.3'; // v9.3 renamed to Stashfinder (cache name kept), v9.2 phone app beta invitation, v9.1 wording for all backcountry users (snow score), v9 Alberta stations, v8 avalanche forecasts (v8.1 BC region edges, v8.2 wording), v2 hourly, v3 noindex, v4 network-first, v5 saved readings + retries, v6 silent stations, v7 BC stations, v7.3 visit counts, v7.4 readable count names
const NETWORK_TIMEOUT_MS = 4000;
const SHELL = [
  './',
  'index.html',
  'css/app.css',
  'js/app.js',
  'js/api.js',
  'js/scorer.js',
  'js/store.js',
  'js/readings.js',
  'js/bc.js',
  'js/ab.js',
  'js/avalanche.js',
  'vendor/leaflet/leaflet.js',
  'vendor/leaflet/leaflet.css',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'no-cache' }))))
      .then(() => self.skipWaiting()),
  );
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
  event.respondWith(networkFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(VERSION);
  // 'no-cache' makes the browser check with GitHub instead of trusting its own
  // 10-minute HTTP cache, so a fresh upload is picked up right away.
  const network = fetch(req, { cache: 'no-cache' }).then((res) => {
    if (res.ok) cache.put(req, res.clone());
    return res;
  });
  network.catch(() => {}); // a failure is handled below; don't report it as unhandled

  const timedOut = new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT_MS, 'timeout'));
  try {
    const first = await Promise.race([network, timedOut]);
    if (first !== 'timeout') return first;
    // Slow signal: use the saved copy if there is one, otherwise keep waiting.
    return (await cache.match(req, { ignoreSearch: true })) || network;
  } catch {
    // Offline: use the saved copy.
    const saved = await cache.match(req, { ignoreSearch: true });
    return saved || Response.error();
  }
}
