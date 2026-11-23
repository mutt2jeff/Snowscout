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

## Put it online (one time, free)

Testers need a web address. Two free options; pick one.

### Option 1: GitHub Pages (recommended: free, permanent, and sets up Git for later)

1. Create a free account at https://github.com (you choose the username; it appears in the
   web address).
2. Click **+ → New repository**. Name it `snowscout`, choose **Public**, tick
   **Add a README file**, and click **Create repository**.
3. Click **Add file → Upload files**. Drag in **everything inside this `web` folder**
   (the files and the `css`, `js`, `icons`, `vendor`, `tests` folders), not the `web` folder
   itself. Click **Commit changes**.
4. Go to **Settings → Pages**. Under *Branch*, pick **main** and **/(root)**, click **Save**.
5. After a minute the page shows your address, like `https://YOURNAME.github.io/snowscout/`.
   That's the link for your testers.

### Option 2: Netlify Drop (fastest)

1. Go to https://app.netlify.com/drop and sign up for a free account.
2. Drag the whole `web` folder onto the page. You get an address like
   `https://something-random.netlify.app` (you can rename it in Site settings).

## Keeping it out of search engines (beta)

`index.html` and `tests/index.html` carry `<meta name="robots" content="noindex, nofollow">`,
which tells Google and other search engines not to list the site. Delete that line when you
want SnowScout to be findable. (A `robots.txt` file wouldn't help here: for a GitHub project
site, search engines only read it from the top of `YOURNAME.github.io`.) The GitHub
repository page itself is public and can't be hidden on the free plan.

## Instructions for iPhone testers

1. Open the link in **Safari**.
2. Tap **Share** (square with an arrow pointing up) → **Add to Home Screen** → **Add**.
3. Open SnowScout from the new home-screen icon and choose your sites there
   (the home-screen app keeps its own saved sites, separate from Safari).

Android testers can use it too (Chrome menu → **Add to Home screen** / **Install app**),
but the Android app is better because it has snow alerts.

## Updating it

1. Change the files.
2. In `sw.js`, bump `VERSION` (for example `snowscout-web-v1` → `snowscout-web-v2`) so phones
   drop the old cached copy.
3. Upload the changed files again (GitHub: **Add file → Upload files**, same names replace the
   old ones; Netlify: drag the folder onto your site's **Deploys** page).
   Testers get the new version the next time they open the app (sometimes the second time).

## Trying it on this PC

```powershell
powershell -ExecutionPolicy Bypass -File serve.ps1
```

Then open http://localhost:8765 in a browser. Scoring tests: http://localhost:8765/tests/

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
