// Builds data/bc-stations.json and data/bc-readings.json from British Columbia's snow
// station downloads. Run by the GitHub Action (.github/workflows/publish.yml) about every
// 30 minutes; needs Node 20+ and nothing else.
//
//   node scripts/build-bc-data.mjs
//
// If BC's servers don't answer, the copies already on the live site are kept, so a BC
// outage never takes the rest of the app down.

import { mkdir, writeFile } from 'node:fs/promises';
import { BC_SOURCES, buildBcData } from '../js/bc.js';

const OUT_DIR = new URL('../data/', import.meta.url);
const UA = 'StashFinder/1.0 (backcountry snow-conditions app; GitHub Pages)';

// The live site, e.g. https://owner.github.io/Repo/ (GitHub sets GITHUB_REPOSITORY).
const repo = process.env.GITHUB_REPOSITORY;
const LIVE = process.env.SNOWSCOUT_LIVE_URL ||
  (repo ? `https://${repo.split('/')[0].toLowerCase()}.github.io/${repo.split('/')[1]}/` : null);

async function get(url, as = 'text', tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    if (i) await new Promise((r) => setTimeout(r, 3000 * i));
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60000) });
      if (res.ok) return as === 'json' ? res.json() : res.text();
      last = new Error(`${res.status} ${res.statusText}`);
    } catch (e) { last = e; }
  }
  throw new Error(`${url}: ${last?.message ?? last}`);
}

const live = (file) => (LIVE ? get(new URL(`data/${file}`, LIVE).href, 'json', 2).catch(() => null) : Promise.resolve(null));

async function main() {
  const now = Date.now();
  const [stationsGeo, depth, swe, temp, liveStations, liveReadings] = await Promise.all([
    get(BC_SOURCES.stations, 'json').catch((e) => { console.warn('Station list:', e.message); return null; }),
    get(BC_SOURCES.depth).catch((e) => { console.warn('Snow depth:', e.message); return null; }),
    get(BC_SOURCES.swe).catch((e) => { console.warn('SWE:', e.message); return null; }),
    get(BC_SOURCES.temp).catch((e) => { console.warn('Temperature:', e.message); return null; }),
    live('bc-stations.json'),
    live('bc-readings.json'),
  ]);

  await mkdir(OUT_DIR, { recursive: true });
  const write = (name, obj) => writeFile(new URL(name, OUT_DIR), JSON.stringify(obj));

  if (!depth) {
    // No snow depth means nothing worth publishing: keep what's live.
    if (liveStations && liveReadings) {
      await write('bc-stations.json', liveStations);
      await write('bc-readings.json', liveReadings);
      console.warn('BC snow depth unavailable: republished the previous BC files.');
      return;
    }
    throw new Error('BC snow depth unavailable and no previous files to fall back on.');
  }

  const { stationsFile, readingsFile } = buildBcData({ depth, swe, temp }, stationsGeo, now, liveStations?.stations ?? []);
  await write('bc-stations.json', stationsFile);
  await write('bc-readings.json', readingsFile);
  const latest = readingsFile.latestReadingMs ? new Date(readingsFile.latestReadingMs).toISOString() : 'none';
  console.log(`BC: ${stationsFile.stations.length} stations, latest reading ${latest}` +
    `${stationsGeo ? '' : ' (station list from previous build)'}${swe && temp ? '' : ' (some readings missing)'}`);
}

main().catch((e) => {
  // Don't fail the whole publish: the app still works for SNOTEL sites without BC files.
  console.error('BC data not built:', e.message);
  process.exitCode = 0;
});
