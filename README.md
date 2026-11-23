# SnowScout web

The iPhone-friendly version of SnowScout. It runs in Safari (or any browser) and can be added
to the home screen like an app. No Mac, no App Store, no fees.

It is plain HTML/CSS/JavaScript with no build step: whatever is in this folder is the app.
The snow data (NRCS SNOTEL), forecasts (NWS) and map (USGS) are fetched straight from the
government services, which all allow it, so there's no server to run or pay for.

## Differences from the Android app

- No background fresh-snow alerts (a web page can't check while it's closed). Open it to check.
- Everything else matches: same sled score (`js/scorer.js` is a line-for-line port of
  `SnowScorer.kt`, with the same tests), map picker, site details, NWS forecast, settings.

## Instructions for iPhone testers

1. Open the link in **Safari**.
2. Tap **Share** (square with an arrow pointing up) → **Add to Home Screen** → **Add**.
3. Open SnowScout from the new home-screen icon and choose your sites there
   (the home-screen app keeps its own saved sites, separate from Safari).

Android testers can use it too (Chrome menu → **Add to Home screen** / **Install app**),
but the Android app is better because it has snow alerts.


## Files

```
index.html              page shell, iPhone home-screen settings
css/app.css             styles (light and dark mode)
js/app.js               screens: dashboard, site picker (map + list), detail, settings
js/api.js               NRCS / NWS data, station cache
js/scorer.js            sled score (keep in step with SnowScorer.kt)
js/store.js             saved sites and settings (browser storage)
sw.js                   offline support / app caching
manifest.webmanifest    home-screen app name and icons
icons/                  app icons
vendor/leaflet/         Leaflet 1.9.4 map library (BSD-2-Clause)
tests/index.html        scorer tests (open in a browser)
serve.ps1               local test server (not needed online)
```
