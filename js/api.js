// Data access: NRCS SNOTEL (AWDB), NWS forecasts. All three government services send
// "Access-Control-Allow-Origin: *", so the browser calls them directly: no server needed.

import { addDays, score, scoreHourly, stationTimeToMs, todayIso } from './scorer.js';
import { load, save } from './store.js';

const AWDB = 'https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1';
const NWS = 'https://api.weather.gov';
const STATION_CACHE_KEY = 'ss.stations.v2'; // v2: adds each station's time zone
const HOUR = 3600000;
const STATION_CACHE_MS = 7 * 24 * 60 * 60 * 1000;
const HISTORY_DAYS = 14;
const BATCH = 40;

async function getJson(url) {
  let res;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' } });
  } catch {
    throw new Error(navigator.onLine === false ? 'No internet connection' : 'Could not reach the server');
  }
  if (!res.ok) throw new Error(`Server error (${res.status}) – try again shortly`);
  return res.json();
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
 * Latest conditions for each triplet, best score first.
 * With useHourly, the score uses the latest hourly readings (falling back to daily per
 * site when a station has no recent hourly data, or for everything if the hourly
 * request fails). Daily readings are always fetched too, for the chart and table.
 */
export async function conditions(triplets, minBase, useHourly = false) {
  if (!triplets.length) return [];
  const stations = await allStations().catch(() => []);
  const byTriplet = new Map(stations.map((s) => [s.triplet, s]));
  const today = todayIso();
  const begin = addDays(today, -HISTORY_DAYS);

  const dailyReq = Promise.all(chunked(triplets).map((c) =>
    getJson(dataUrl(c, 'SNWD,WTEQ,TOBS,TMAX,TMIN,PREC', 'DAILY', begin, today)),
  )).then((r) => r.flat());
  // 3 days back covers the 72h baseline; "tomorrow" covers phones in time zones ahead of
  // the stations' Pacific Standard Time.
  const hourlyReq = useHourly
    ? Promise.all(chunked(triplets).map((c) =>
      getJson(dataUrl(c, 'SNWD,TOBS,WTEQ', 'HOURLY', addDays(today, -3), addDays(today, 1))),
    )).then((r) => r.flat()).catch(() => null)
    : Promise.resolve(null);

  const [daily, hourly] = await Promise.all([dailyReq, hourlyReq]);
  const dailyBy = new Map(daily.map((r) => [r.stationTriplet, r]));
  const hourlyBy = hourly ? new Map(hourly.map((r) => [r.stationTriplet, r])) : null;
  const now = Date.now();

  const result = triplets.map((t) => {
    const station = byTriplet.get(t) ?? stationFromTriplet(t);
    const days = toDays(dailyBy.get(t));
    const hours = hourlyBy ? toHours(hourlyBy.get(t), station.tz ?? defaultTz(station.state)) : [];
    const s = useHourly ? scoreHourly(hours, days, now, minBase) : score(days, today, minBase);
    const c = { station, days, hours, score: s, minBase, useHourly, hourlyFailed: useHourly && !hourly };
    conditionsCache.set(t, c);
    return c;
  });
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
