/**
 * Single source of truth for "which device calendars has the user
 * chosen to overlay onto Housemait's Calendar view".
 *
 * Two consumers:
 *   • NativeCalendarPicker (Settings → Calendar Sync) — writes
 *   • useNativeCalendarEvents (Calendar.jsx) — reads + reacts to changes
 *
 * Previously each component had its own useState seeded from
 * localStorage. Writes from the picker updated storage but did NOT
 * trigger a re-fetch in the Calendar page — so toggling a calendar
 * off in Settings still showed its events. This module fixes that
 * via a tiny pub-sub: writes go through setSelectedCalendarIds(),
 * subscribers fire on every change in the same tab.
 *
 * Storage event handlers only fire cross-tab; within the same tab a
 * write to localStorage is silent, so we need our own listeners.
 */

const STORAGE_KEY = 'housemait-native-calendars';

function readFromStorage() {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

let selectedIds = readFromStorage();
const listeners = new Set();

export function getSelectedCalendarIds() {
  return selectedIds;
}

export function setSelectedCalendarIds(ids) {
  const next = Array.isArray(ids) ? [...ids] : [];
  selectedIds = next;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    }
  } catch { /* ignore quota errors etc. */ }
  listeners.forEach((fn) => {
    try { fn(next); } catch { /* listener threw; don't block others */ }
  });
}

/**
 * Subscribe to changes. Returns an unsubscribe function. Useful from
 * React via useEffect.
 */
export function subscribeToSelection(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
