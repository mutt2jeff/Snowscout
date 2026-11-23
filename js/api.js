// Data access: NRCS SNOTEL (AWDB), NWS forecasts. All three government services send
// "Access-Control-Allow-Origin: *", so the browser calls them directly: no server needed.

import { addDays, score, scoreHourly, stationTimeToMs, todayIso } from './scorer.js';
import { load, save } from './store.js';
import { mergeHours, saveReadings, savedReadings } from './readings.js';

const AWDB = 'https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1';
const NWS = 'https://api.weather.gov';
const STATION_CACHE_KEY = 'ss.stations.v2'; // v2: adds each station's time zone
const HOUR = 3600000;
const STATION_CACHE_MS = 7 * 24 * 60 * 60 * 1000;
const HISTORY_DAYS = 14;
const BATCH = 40;

// The NRCS server often answers "503 Service Unavailable" when busy, but a retry a moment
// later usually works (measured: ~half of requests 503 at busy times, each failing in
// ~0.2 s). So every request gets two quick retries before we give up.
const RETRY_DELAYS_MS = [700, 1800];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url) {
  let lastError;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt) await sleep(RETRY_DELAYS_MS[attempt - 1]);
    let res;
    try {
      res = await fetch(url, { headers: { Accept: 'application/json' } });
    } catch {
      // Includes a 503 the browser couldn't read. Offline: no point retrying.
      lastError = new Error(navigator.onLine === false ? 'No internet connection' : 'Could not reach the server');
      if (navigator.onLine === false) break;
      continue;
    }
    if (res.ok) return res.json();
    lastError = new Error(`Server error (${res.status}) – try again shortly`);
    if (res.status < 500 && res.status !== 429) break; // a real error, not "busy"
  }
  throw lastError;
}

// ---- Stations ---------------------------------------------------------------------

let stationsPromise = null;

function toStation(s) {
  return {
    triplet: s.stationTriplet,
    id: s.stationId || s.stationTriplet.split(':')[0],
    name: s.name || `Site ${s.stationTriplet.split(':')[0]}`,
    state: s.stateCode || '',
    county: s.countyName || null,
    elev: s.elevation != null ? Math.round(s.elevation) : null,
    lat: s.latitude ?? null,
    lon: s.longitude ?? null,
    // Hours from UTC that the station's readings are stamped in. SNOTEL uses standard
    // time all year: -8 (Pacific) for every lower-48 station, -9 for Alaska.
    tz: s.dataTimeZone ?? defaultTz(s.stateCode),
  };
}

const defaultTz = (state) => (state === 'AK' ? -9 : -8);

/** All active SNOTEL stations (~900). Cached on the phone for a week. */
export function allStations() {
  if (!stationsPromise) {
    stationsPromise = (async () => {
      const cached = load(STATION_CACHE_KEY, null);
      if (cached && Date.now() - cached.savedAt < STATION_CACHE_MS && cached.list?.length) return cached.list;
      try {
        const raw = await getJson(`${AWDB}/stations?stationTriplets=*:*:SNTL&returnStationElements=false&activeOnly=true`);
        const list = raw
          .filter((s) => !s.networkCode || s.networkCode === 'SNTL')
          .map(toStation)
          .sort((a, b) => a.state.localeCompare(b.state) || a.name.localeCompare(b.name));
        save(STATION_CACHE_KEY, { savedAt: Date.now(), list });
        return list;
      } catch (e) {
        if (cached?.list?.length) return cached.list; // offline: use the stale copy
        throw e;
      }
    })();
    stationsPromise.catch(() => { stationsPromise = null; }); // allow retry after a failure
  }
  return stationsPromise;
}

export function stationFromTriplet(triplet) {
  const [id, state] = triplet.split(':');
  return { triplet, id, name: `Site ${id}`, state: state || '', county: null, elev: null, lat: null, lon: null, tz: defaultTz(state) };
}

export function stationSubtitle(st) {
  const parts = [st.state];
  if (st.county) parts.push(`${st.county} Co.`);
  if (st.elev != null) parts.push(`${st.elev.toLocaleString('en-US')} ft`);
  return parts.join(' · ');
}

export const nrcsUrl = (st) => `https://wcc.sc.egov.usda.gov/nwcc/site?sitenum=${encodeURIComponent(st.id)}`;

// ---- Conditions ---------------------------------------------------------------------

const ELEMENT_KEYS = { SNWD: 'depth', WTEQ: 'swe', TOBS: 'tobs', TMAX: 'tmax', TMIN: 'tmin', PREC: 'prec' };
const conditionsCache = new Map(); // triplet -> { station, days, score, minBase }

function toDays(stationData) {
  const byDate = new Map();
  for (const el of stationData?.data ?? []) {
    const key = ELEMENT_KEYS[el.stationElement?.elementCode];
    if (!key) continue;
    for (const v of el.values ?? []) {
      const date = String(v.date).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const day = byDate.get(date) ?? { date, depth: null, swe: null, tobs: null, tmax: null, tmin: null, prec: null };
      day[key] = v.value ?? null;
      byDate.set(date, day);
    }
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

const HOURLY_KEYS = { SNWD: 'depth', TOBS: 'tobs', WTEQ: 'swe' };

/** Hourly readings -> [{t (ms since epoch), depth, tobs, swe}], oldest first. */
function toHours(stationData, tz) {
  const byT = new Map();
  for (const el of stationData?.data ?? []) {
    const key = HOURLY_KEYS[el.stationElement?.elementCode];
    if (!key) continue;
    for (const v of el.values ?? []) {
      // Stamped in station standard time (tz hours from UTC): convert to a real instant.
      const t = stationTimeToMs(v.date, tz);
      if (t == null) continue;
      const h = byT.get(t) ?? { t, depth: null, tobs: null, swe: null };
      h[key] = v.value ?? null;
      byT.set(t, h);
    }
  }
  return [...byT.values()].sort((a, b) => a.t - b.t);
}

function chunked(list) {
  const chunks = [];
  for (let i = 0; i < list.length; i += BATCH) chunks.push(list.slice(i, i + BATCH));
  return chunks;
}

// Triplets are only digits, capitals and colons, which are safe in a query string as-is.
const dataUrl = (triplets, elements, duration, begin, end) =>
  `${AWDB}/data?stationTriplets=${triplets.join(',')}&elements=${elements}` +
  `&duration=${duration}&beginDate=${begin}&endDate=${end}`;

/**
 * Run one request per group of up to 40 sites. Returns the data by triplet, plus the
 * triplets whose request failed even after retries, and the last error.
 */
async function fetchGroups(triplets, urlFor) {
  const groups = chunked(triplets);
  const results = await Promise.allSettled(groups.map((g) => getJson(urlFor(g))));
  const data = new Map();
  const failed = new Set();
  let error = null;
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') for (const s of r.value ?? []) data.set(s.stationTriplet, s);
    else { groups[i].forEach((t) => failed.add(t)); error = r.reason; }
  });
  return { data, failed, error };
}

/**
 * Latest conditions for each triplet, best score first.
 *
 * Daily readings are always fetched (chart, table, fallback). With useHourly, hourly
 * readings are fetched too, and the score uses whichever is newer.
 *
 * Every good download is saved on the phone. When NRCS doesn't answer (even after
 * retries), the saved readings are used instead, up to the last hour they cover, and the
 * site is marked so the screen can say "saved". Once the phone has the earlier hours, only
 * the latest day of hourly readings is requested, which keeps requests small.
 */
export async function conditions(triplets, minBase, useHourly = false) {
  if (!triplets.length) return [];
  const stations = await allStations().catch(() => []);
  const byTriplet = new Map(stations.map((s) => [s.triplet, s]));
  const today = todayIso();
  const now = Date.now();
  const saved = new Map(triplets.map((t) => [t, savedReadings(t)]));

  // Do we already have the older hours (back past 72h) and something from the last day?
  const hasRecentHours = (t) => {
    const h = saved.get(t)?.hours;
    return !!h?.length && h[0].t <= now - 70 * HOUR && h[h.length - 1].t >= now - 20 * HOUR;
  };

  const [daily, hourly] = await Promise.all([
    fetchGroups(triplets, (g) => dataUrl(g, 'SNWD,WTEQ,TOBS,TMAX,TMIN,PREC', 'DAILY', addDays(today, -HISTORY_DAYS), today)),
    useHourly
      // 3 days back covers the 72h baseline (1 day if saved hours cover the rest);
      // "tomorrow" covers phones in time zones ahead of the stations' Pacific Standard Time.
      ? fetchGroups(triplets, (g) => dataUrl(g, 'SNWD,TOBS,WTEQ', 'HOURLY',
        addDays(today, g.every(hasRecentHours) ? -1 : -3), addDays(today, 1)))
      : Promise.resolve(null),
  ]);

  const updates = {};
  let anyData = false;
  const result = triplets.map((t) => {
    const station = byTriplet.get(t) ?? stationFromTriplet(t);
    const tz = station.tz ?? defaultTz(station.state);
    const prev = saved.get(t);

    const dailyFailed = daily.failed.has(t);
    const days = dailyFailed ? (prev?.days ?? []) : toDays(daily.data.get(t));

    let hours = prev?.hours ?? [];
    const hourlyFailed = !!hourly && hourly.failed.has(t);
    if (hourly && !hourlyFailed) hours = mergeHours(hours, toHours(hourly.data.get(t), tz), now);

    updates[t] = { days, hours };
    if (days.length || hours.length) anyData = true;

    let s = useHourly ? scoreHourly(hours, days, now, minBase, tz) : score(days, today, minBase);
    const couldntLoad = (dailyFailed || hourlyFailed) && !days.length && !hours.length;
    if (couldntLoad) s = { ...s, notes: ["Couldn't reach NRCS – try refreshing"] };

    const c = {
      station, days, hours, score: s, minBase, useHourly,
      // Which parts of the shown numbers came from readings saved earlier on this phone.
      dailyFromSave: dailyFailed && days.length > 0,
      hourlyFromSave: hourlyFailed && s.source === 'hourly',
    };
    conditionsCache.set(t, c);
    return c;
  });

  saveReadings(updates, now);
  // Nothing downloaded and nothing saved to fall back on: report the error.
  if (!anyData && (daily.error || hourly?.error)) throw daily.error ?? hourly.error;
  return result.sort((a, b) => b.score.score - a.score.score);
}

/** Cached conditions, only if scored with the same settings. */
export function cachedConditions(triplet, minBase, useHourly = false) {
  const c = conditionsCache.get(triplet);
  return c && c.minBase === minBase && c.useHourly === useHourly ? c : null;
}

// ---- Forecast -----------------------------------------------------------------------

export async function forecast(lat, lon) {
  const point = await getJson(`${NWS}/points/${lat.toFixed(4)},${lon.toFixed(4)}`);
  const url = point?.properties?.forecast;
  if (!url) return [];
  const fc = await getJson(url);
  return (fc?.properties?.periods ?? []).map((p) => ({
    name: p.name,
    isDaytime: p.isDaytime,
    temperature: p.temperature,
    unit: p.temperatureUnit || 'F',
    wind: [p.windDirection, p.windSpeed].filter(Boolean).join(' ') || null,
    short: p.shortForecast || '',
    precip: p.probabilityOfPrecipitation?.value ?? null,
  }));
}
