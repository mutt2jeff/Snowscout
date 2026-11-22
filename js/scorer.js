// Sled score: a line-for-line port of the Android app's SnowScorer.kt.
// Keep the two in step: same constants, same rules, same notes.
//
// Base depth is a gate:
//  - Below the rider's minimum base (default 18", Settings 6-48") the site is "No go"
//    and scores 0-19 on depth alone. Cold temps and new snow can't lift bare ground.
//  - At or above it, the score starts at 20 and climbs to 100:
//      55% base depth (minimum -> max(48", minimum + 24"))
//      30% new snow (12"+ in 72h for full marks)
//      15% temperature (25F or colder full marks, none at 40F+)

export const DEFAULT_MIN_BASE_IN = 18;
export const FULL_DEPTH_IN = 48;
export const DEPTH_HEADROOM_IN = 24;
export const FULL_FRESH_IN = 12;
export const MIN_BASE_RANGE = [6, 48];

export const RIDEABLE_FLOOR = 20;
const DEPTH_WEIGHT = 0.55;
const FRESH_WEIGHT = 0.30;
const TEMP_WEIGHT = 0.15;

export const Rating = Object.freeze({
  EPIC: { key: 'epic', label: 'Epic' },
  GOOD: { key: 'good', label: 'Good' },
  FAIR: { key: 'fair', label: 'Fair' },
  MARGINAL: { key: 'marginal', label: 'Marginal' },
  NOT_RIDEABLE: { key: 'nogo', label: 'No go' },
  NO_DATA: { key: 'nodata', label: 'No data' },
});

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Days between two 'YYYY-MM-DD' strings (b - a), ignoring time zones. */
export function daysBetween(a, b) {
  const toUtc = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  return Math.round((toUtc(b) - toUtc(a)) / 86400000);
}

/** 'YYYY-MM-DD' shifted by n days. */
export function addDays(iso, n) {
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + n));
  return d.toISOString().slice(0, 10);
}

/** Today's date in the phone's local time zone, as 'YYYY-MM-DD'. */
export function todayIso() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const shortDate = (iso) =>
  new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/** Base depth that earns full depth marks: at least 48", and always 24" above the minimum. */
export function fullDepthFor(minBaseIn) {
  return Math.max(FULL_DEPTH_IN, minBaseIn + DEPTH_HEADROOM_IN);
}

export function ratingFor(score) {
  if (score >= 80) return Rating.EPIC;
  if (score >= 60) return Rating.GOOD;
  if (score >= 40) return Rating.FAIR;
  if (score >= RIDEABLE_FLOOR) return Rating.MARGINAL;
  return Rating.NOT_RIDEABLE;
}

/**
 * @param days  [{date:'YYYY-MM-DD', depth, swe, tobs, tmax, tmin, prec}] any order; values may be null
 * @param today 'YYYY-MM-DD'
 * @param minBaseIn rider's minimum rideable base, inches
 */
export function score(days, today = todayIso(), minBaseIn = DEFAULT_MIN_BASE_IN) {
  const sorted = [...days].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const lastWith = (key) => [...sorted].reverse().find((d) => d[key] != null);
  const latest = lastWith('depth');
  const latestSwe = lastWith('swe')?.swe ?? null;

  if (!latest) {
    const last = sorted[sorted.length - 1];
    return {
      score: 0, rating: Rating.NO_DATA,
      depthIn: null, new24In: null, new72In: null,
      sweIn: latestSwe, tempF: last ? (last.tobs ?? last.tmax ?? null) : null,
      asOf: last?.date ?? null,
      notes: ['No snow depth reported recently'],
    };
  }

  const depth = latest.depth;
  const byDate = new Map(sorted.map((d) => [d.date, d]));
  const newSince = (daysBack) => {
    const prior = byDate.get(addDays(latest.date, -daysBack))?.depth;
    return prior == null ? null : Math.max(0, depth - prior);
  };
  const new24 = newSince(1);
  const new72 = newSince(3);
  const swe = latest.swe ?? latestSwe;
  const temp = latest.tobs ?? latest.tmax ?? null;
  const minBase = Math.max(1, minBaseIn);

  const notes = [];
  let value;

  if (depth < minBase) {
    value = Math.round(clamp(depth / minBase, 0, 1) * (RIDEABLE_FLOOR - 1));
    const short = Math.max(1, Math.round(minBase - depth));
    notes.push(`Not rideable – needs about ${short}" more base`);
    if ((new72 ?? 0) >= 6) notes.push(`Building – ${Math.round(new72)}" new in 3 days`);
  } else {
    const fullDepth = fullDepthFor(minBase);
    const depthFactor = clamp((depth - minBase) / (fullDepth - minBase), 0, 1);
    const freshFactor = clamp((new72 ?? new24 ?? 0) / FULL_FRESH_IN, 0, 1);
    let tempFactor;
    if (temp == null) tempFactor = 0.5;
    else if (temp <= 25) tempFactor = 1;
    else if (temp >= 40) tempFactor = 0;
    else tempFactor = (40 - temp) / 15;
    const blended = DEPTH_WEIGHT * depthFactor + FRESH_WEIGHT * freshFactor + TEMP_WEIGHT * tempFactor;
    value = Math.round(RIDEABLE_FLOOR + (100 - RIDEABLE_FLOOR) * blended);

    if (depth < minBase + 6) notes.push('Thin base – best to stay on trails');
    if ((new24 ?? 0) >= 6) notes.push('Fresh powder in the last 24 hours');
    else if ((new72 ?? 0) >= 8) notes.push('Good new snow over the last 3 days');
    if (temp != null && temp > 32) notes.push('Above freezing – heavy, wet snow');
  }

  if (daysBetween(latest.date, today) > 2) notes.push(`No report since ${shortDate(latest.date)}`);

  const clamped = clamp(value, 0, 100);
  return {
    score: clamped,
    rating: depth < minBase ? Rating.NOT_RIDEABLE : ratingFor(clamped),
    depthIn: depth,
    new24In: new24,
    new72In: new72,
    sweIn: swe,
    tempF: temp,
    asOf: latest.date,
    notes,
  };
}
