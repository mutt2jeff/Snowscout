// Readings saved on the phone, so SnowScout can keep showing the last good numbers when
// the NRCS server is overloaded (it often answers "503 Service Unavailable").
//
// Per site: the last ~3 days of hourly readings and the last good 14-day daily download.
// About 5 KB per site, kept in browser storage.

import { load, save } from './store.js';

const KEY = 'ss.readings.v1';
const HOUR = 3600000;
export const KEEP_HOURS = 80;     // covers the 72-hour new-snow baseline
const FORGET_AFTER_DAYS = 14;     // drop sites nobody has looked at in two weeks

/** Merge saved and freshly downloaded hourly readings; fresh values win, old ones are dropped. */
export function mergeHours(saved = [], fresh = [], nowMs = Date.now(), keepHours = KEEP_HOURS) {
  const byT = new Map(saved.map((h) => [h.t, h]));
  for (const h of fresh) byT.set(h.t, h);
  return [...byT.values()]
    .filter((h) => h.t >= nowMs - keepHours * HOUR)
    .sort((a, b) => a.t - b.t);
}

let memo = null;
const all = () => (memo ??= load(KEY, {}));

/** { hours, days, savedAt } for a site, or null. */
export const savedReadings = (triplet) => all()[triplet] ?? null;

/** Save readings for several sites at once: { triplet: { hours, days } }. */
export function saveReadings(updates, nowMs = Date.now()) {
  const store = all();
  for (const [t, r] of Object.entries(updates)) store[t] = { ...r, savedAt: nowMs };
  for (const [t, r] of Object.entries(store)) {
    if (nowMs - (r.savedAt ?? 0) > FORGET_AFTER_DAYS * 24 * HOUR) delete store[t];
  }
  save(KEY, store);
}
