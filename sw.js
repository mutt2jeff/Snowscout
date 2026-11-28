// Retirement kill switch (Nov 28 2026). The StashFinder web app has been replaced by a single
// "moved to the phone app" page. Phones and browsers that still have the old app saved
// (including home-screen copies) pick up this file the next time they open the site. It then:
//   1. deletes the old app's saved copies (only caches named "snowscout-web-*", so nothing
//      else on mutt2jeff.github.io, such as StashFinder X, is touched),
//   2. removes itself, so the site is served straight from the network again, and
//   3. reloads any open StashFinder tabs so they show the new page.
// Keep this file for a few months so every old copy gets switched over.

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('snowscout-web')).map((k) => caches.delete(k)));
    await self.registration.unregister();
    const windows = await self.clients.matchAll({ type: 'window' });
    windows.forEach((w) => w.navigate(w.url).catch(() => {}));
  })());
});
