// Builds data/snotel-latest.json: the latest snow numbers for every SNOTEL station, for the
// colored dots on the Sites map. Run by the GitHub Action (.github/workflows/publish.yml),
// which runs about every 30 minutes; this script only downloads from NRCS when the file on
// the live site is about 3 hours old, otherwise it republishes that file as it is.
//
//   node scripts/build-snotel-data.mjs            (FORCE=1 to download regardless)
//
// About 23 requests to NRCS per refresh (40 stations each, one at a time), so roughly 180 a
// day in total however many people use the map. If NRCS doesn't answer, the previous file is
// republished; if there's none, no file is written and the map shows plain dots.

import { mkdir, writeFile } from 'node:fs/promises';
import { buildSnotelSummary } from '../js/snotel.js';

const OUT_DIR = new URL('../data/', import.meta.url);
const UA = 'StashFinder/1.0 (backcountry snow-conditions app; GitHub Pages)';
const AWDB = 'https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1';
const BATCH = 40;
const GAP_MS = 1000;                       // pause between requests: be polite to NRCS
const REFRESH_AFTER_MS = 2.75 * 3600000;   // with 30-minute runs, refreshes every ~3 hours

const repo = process.env.GITHUB_REPOSITORY;
const LIVE = process.env.SNOWSCOUT_LIVE_URL ||
  (repo ? `https://${repo.split('/')[0].toLowerCase()}.github.io/${repo.split('/')[1]}/` : null);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    if (i) await sleep(5000 * i);
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(90000) });
      if (res.ok) return await res.json();
      last = new Error(`${res.status} ${res.statusText}`);
    } catch (e) { last = e; }
  }
  throw new Error(`${url.slice(0, 120)}: ${last?.message ?? last}`);
}

const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

async function main() {
  const now = Date.now();
  await mkdir(OUT_DIR, { recursive: true });
  const write = (obj) => writeFile(new URL('snotel-latest.json', OUT_DIR), JSON.stringify(obj));

  const previous = LIVE ? await get(new URL('data/snotel-latest.json', LIVE).href, 2).catch(() => null) : null;
  const age = previous?.generatedMs ? now - previous.generatedMs : Infinity;
  if (!process.env.FORCE && age < REFRESH_AFTER_MS) {
    await write(previous);
    console.log(`SNOTEL: kept the live file (${Math.round(age / 60000)} min old)`);
    return;
  }

  const keepPrevious = async (why) => {
    if (!previous) throw new Error(`${why}, and no previous file to fall back on`);
    await write(previous);
    console.warn(`${why}: republished the previous SNOTEL file.`);
  };

  let stations;
  try {
    stations = (await get(`${AWDB}/stations?stationTriplets=*:*:SNTL&returnStationElements=false&activeOnly=true`))
      .filter((s) => !s.networkCode || s.networkCode === 'SNTL');
  } catch (e) { return keepPrevious(`Station list: ${e.message}`); }

  const tz = new Map(stations.map((s) => [s.stationTriplet, s.dataTimeZone ?? -8]));
  const triplets = stations.map((s) => s.stationTriplet);
  // 3 days back covers the 72-hour new-snow baseline; "tomorrow" covers stations whose
  // standard time is ahead of the build machine's date.
  const begin = iso(now - 3 * 86400000);
  const end = iso(now + 86400000);

  const responses = [];
  let failed = 0;
  for (let i = 0; i < triplets.length; i += BATCH) {
    const group = triplets.slice(i, i + BATCH).join(',');
    try {
      responses.push(...await get(`${AWDB}/data?stationTriplets=${group}&elements=SNWD,TOBS&duration=HOURLY&beginDate=${begin}&endDate=${end}`));
    } catch { failed++; }
    await sleep(GAP_MS);
  }
  if (!responses.length) return keepPrevious('No SNOTEL readings could be downloaded');

  const file = buildSnotelSummary(responses, (t) => tz.get(t) ?? -8, now);
  // A partial download keeps the previous numbers for the stations that are missing.
  if (failed && previous?.sites) {
    for (const [t, row] of Object.entries(previous.sites)) if (!file.sites[t]) file.sites[t] = row;
  }
  await write(file);
  console.log(`SNOTEL: ${Object.keys(file.sites).length} stations with readings ` +
    `(${responses.length} returned${failed ? `, ${failed} of ${Math.ceil(triplets.length / BATCH)} requests failed` : ''}), ` +
    `latest reading ${file.latestReadingMs ? new Date(file.latestReadingMs).toISOString() : 'none'}`);
}

main().catch((e) => {
  // Don't fail the whole publish: the map just shows plain dots without this file.
  console.error('SNOTEL summary not built:', e.message);
  process.exitCode = 0;
});
