# SnowScout web

The iPhone-friendly version of SnowScout. It runs in Safari (or any browser) and can be added
to the home screen like an app. No Mac, no App Store, no fees.

It is plain HTML/CSS/JavaScript with no build step: whatever is in this folder is the app.
The US snow data (NRCS SNOTEL), forecasts (NWS, Environment Canada) and map (USGS) are
fetched straight from the government services, which all allow it, so there's no server to
run or pay for.

## British Columbia stations

BC's snow stations (the Automated Snow Weather Station network, ~160 sites) publish their
readings as files that web pages aren't allowed to read directly. So a free **GitHub Action**
(`.github/workflows/publish.yml`) downloads them about every 30 minutes, trims them to what
the app needs (`scripts/build-bc-data.mjs`, using `js/bc.js`), and publishes
`data/bc-stations.json` and `data/bc-readings.json` together with the app. Readings are
converted to inches and °F, and scored exactly like SNOTEL.

**One-time setup (needed for BC data):**

1. Get the files into the repository, including `.github/workflows/publish.yml`, the
   `scripts` folder, `package.json` and `js/bc.js`. Don't add a `data` folder: the Action
   makes it. (Pushing with Git does this in one go. With the web uploader, drag-and-drop may
   skip the hidden `.github` folder: create that file with **Add file → Create new file**,
   typing the name `.github/workflows/publish.yml`.)
2. **Settings → Pages → Build and deployment → Source:** choose **GitHub Actions**
   (instead of "Deploy from a branch").
3. Open the **Actions** tab: "Publish SnowScout" should run within a minute (green tick).
   After that, every change publishes through it, and BC data refreshes on its own.

GitHub pauses scheduled runs if a repository has no activity for 60 days. If BC sites show
"BC data delayed", open **Actions → Publish SnowScout** and click **Enable workflow** (or
**Run workflow**). The app then says so instead of blaming the stations.

To undo: set Pages back to **Deploy from a branch** (main, /root). The app keeps working
for US sites; BC sites show "Couldn't load BC snow data".

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

## Trying it on this PC

```powershell
powershell -ExecutionPolicy Bypass -File serve.ps1
```

Then open http://localhost:8765 in a browser. Scoring tests: http://localhost:8765/tests/

To try BC stations locally, start it with `-Dev` and open
http://localhost:8765/tests/build-bc.html once: it builds `data/bc-*.json` from BC's live
files (what the Action does online). Delete the `data` folder afterwards; it isn't uploaded.

## Files

```
index.html              page shell, iPhone home-screen settings
css/app.css             styles (light and dark mode)
js/app.js               screens: dashboard, site picker (map + list), detail, settings
js/api.js               NRCS / NWS / BC / Environment Canada data, station cache
js/bc.js                BC snow station files: building (Action) and reading (app)
js/readings.js          readings saved on the phone for server outages
js/scorer.js            sled score (keep in step with SnowScorer.kt)
js/store.js             saved sites and settings (browser storage)
sw.js                   offline support / app caching
manifest.webmanifest    home-screen app name and icons
icons/                  app icons
vendor/leaflet/         Leaflet 1.9.4 map library (BSD-2-Clause)
tests/index.html        scorer tests (open in a browser)
tests/build-bc.html     builds the BC files locally (serve.ps1 -Dev only)
scripts/build-bc-data.mjs   run by the GitHub Action to build data/bc-*.json
package.json            tells Node the js files are modules (for the Action)
.github/workflows/publish.yml   the GitHub Action: publish the site + refresh BC data
serve.ps1               local test server (not needed online)
```
