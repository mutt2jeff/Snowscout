// Builds data/ab-stations.json and data/ab-readings.json from Alberta Rivers' station
// files. Run by the GitHub Action (.github/workflows/publish.yml) about every 30 minutes;
// needs Node 20+ and nothing else.
//
//   node scripts/build-ab-data.mjs
//
// Alberta keeps only 5 days per station, so the files already on the live site are read
// first and their older daily values carried forward. If Alberta's server doesn't answer,
// those files are republished as they are, so an Alberta outage never takes the rest of the
// app down.

import { mkdir, writeFile } from 'node:fs/promises';
import { AB_SOURCES, buildAbData, snowStations } from '../js/ab.js';

const OUT_DIR = new URL('../data/', import.meta.url);
const UA = 'Stashfinder/1.0 (backcountry snow-conditions app; GitHub Pages)';
const PARALLEL = 4; // be polite: a few downloads at a time

const repo = process.env.GITHUB_REPOSITORY;
const LIVE = process.env.SNOWSCOUT_LIVE_URL ||
  (repo ? `https://${repo.split('/')[0].toLowerCase()}.github.io/${repo.split('/')[1]}/` : null);

async function get(url, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    if (i) await new Promise((r) => setTimeout(r, 3000 * i));
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(60000) });
      if (res.ok) return await res.json();
      last = new Error(`${res.status} ${res.statusText}`);
      if (res.status === 404) break; // that station has no file: no point retrying
    } catch (e) { last = e; }
  }
  throw new Error(`${url}: ${last?.message ?? last}`);
}

const live = (file) => (LIVE ? get(new URL(`data/${file}`, LIVE).href, 2).catch(() => null) : Promise.resolve(null));

/** Run fn over items, a few at a time. */
async function pool(items, fn) {
  const queue = [...items];
  await Promise.all(Array.from({ length: PARALLEL }, async () => {
    while (queue.length) await fn(queue.shift());
  }));
}

async function main() {
  const now = Date.now();
  const [manifest, prevStations, prevReadings] = await Promise.all([
    get(AB_SOURCES.manifest).catch((e) => { console.warn('Station manifest:', e.message); return null; }),
    live('ab-stations.json'),
    live('ab-readings.json'),
  ]);
  const previous = prevStations && prevReadings ? { stations: prevStations, readings: prevReadings } : null;

  await mkdir(OUT_DIR, { recursive: true });
  const write = (name, obj) => writeFile(new URL(name, OUT_DIR), JSON.stringify(obj));
  const keepPrevious = async (why) => {
    if (!previous) throw new Error(`${why}, and no previous files to fall back on.`);
    await write('ab-stations.json', prevStations);
    await write('ab-readings.json', prevReadings);
    console.warn(`${why}: republished the previous Alberta files.`);
  };

  // Without the manifest, download the stations we published last time.
  const stations = manifest
    ? snowStations(manifest, now)
    : (prevStations?.stations ?? []).map((s) => ({ id: s.id, rawName: s.name, lat: s.lat, lon: s.lon }));
  if (!stations.length) return keepPrevious('No Alberta station list');

  const tables = new Map();
  let failed = 0;
  await pool(stations, async (s) => {
    try { tables.set(s.id, await get(AB_SOURCES.table(s.id), 2)); } catch { failed++; }
  });
  if (!tables.size) return keepPrevious('No Alberta station files could be downloaded');

  const { stationsFile, readingsFile } = buildAbData(stations, tables, now, previous);
  await write('ab-stations.json', stationsFile);
  await write('ab-readings.json', readingsFile);
  const latest = readingsFile.latestReadingMs ? new Date(readingsFile.latestReadingMs).toISOString() : 'none';
  console.log(`AB: ${stationsFile.stations.length} stations (${tables.size} downloaded` +
    `${failed ? `, ${failed} failed` : ''}${manifest ? '' : ', station list from previous build'}), latest reading ${latest}`);
}

main().catch((e) => {
  // Don't fail the whole publish: the app still works for other sites without these files.
  console.error('Alberta data not built:', e.message);
  process.exitCode = 0;
});
