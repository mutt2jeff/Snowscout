// Settings and caches, kept in the phone's browser storage.
// Every access is wrapped: storage can be unavailable (private browsing) or full,
// and the app must still work, just without remembering things.

import { DEFAULT_MIN_BASE_IN } from './scorer.js';

export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable or full: keep going without it */
  }
}

const SETTINGS_KEY = 'ss.settings.v1';
const listeners = new Set();

// useHourly: score from the latest hourly SNOTEL readings instead of the midnight daily one.
// showAvalanche: show the avalanche center's forecast on each site's page.
const defaults = () => ({ selected: [], minBase: DEFAULT_MIN_BASE_IN, useHourly: true, showAvalanche: true });

let settings = { ...defaults(), ...load(SETTINGS_KEY, {}) };

export const getSettings = () => settings;

export function updateSettings(patch) {
  settings = { ...settings, ...patch };
  save(SETTINGS_KEY, settings);
  listeners.forEach((fn) => fn(settings));
}

export function onSettingsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function toggleSite(triplet) {
  const set = new Set(settings.selected);
  if (set.has(triplet)) set.delete(triplet);
  else set.add(triplet);
  updateSettings({ selected: [...set] });
}

export const isSelected = (triplet) => settings.selected.includes(triplet);
