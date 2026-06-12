/**
 * Device calendar sync (EventKit) - app-side service.
 *
 * Talks to the custom read-only EventKitReader native bridge (iOS only) and
 * uploads window snapshots of the user's SELECTED calendars to
 * POST /api/calendar/device-sync. The bridge cannot write to the device
 * calendar - it exposes exactly requestAccess / listCalendars / fetchEvents.
 *
 * Window policy (mirrors the server plan):
 *   - one-off events: -30 days → +36 months (far-future holidays/bookings
 *     are exactly what matters);
 *   - recurring occurrences: capped at +12 months (unbounded weekly series
 *     are where row counts explode).
 *
 * Bandwidth protocol: hashes are remembered per calendar after the server
 * acknowledges them, and routine syncs send ONLY the hash (no events array).
 * The server replies needsEvents for any calendar whose hash it can't match
 * (new link, adopted link, dedupe-coupled calendar), and we retry those with
 * the full payload. So the steady state is a few hundred bytes per sync.
 *
 * All persisted state (selection, acked hashes) is keyed PER USER ID:
 * EventKit permission is app-wide, so without this a second account signing
 * in on the same phone would silently upload the previous user's calendars
 * into a different household.
 */

import { Capacitor, registerPlugin } from '@capacitor/core';
import api from './api';

const EventKitReader = registerPlugin('EventKitReader');

const BACK_DAYS = 30;
const FORWARD_MONTHS = 36;
const RECURRING_FORWARD_MONTHS = 12;
export const MAX_CALENDARS = 10;

// Housemait palette (name → hex) for mapping a device calendar's colour onto
// the nearest palette name - calendar_events.color only accepts named values.
const PALETTE = {
  red: '#E25555', 'burnt-orange': '#E07A3A', amber: '#E8A040', gold: '#C5A833',
  leaf: '#7BAE4E', emerald: '#3A9E6E', teal: '#3AADA0', sky: '#4A9FCC',
  cobalt: '#3A6FD4', indigo: '#6558C7', purple: '#9050B5', magenta: '#C74E95',
  rose: '#E06888', terracotta: '#C47A5E', moss: '#7C8A6E', slate: '#7A8694',
  coral: '#E8724A', plum: '#6B3FA0', sage: '#7DAE82',
};

export function nearestPaletteColor(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return 'sky';
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255; const g = (n >> 8) & 255; const b = n & 255; // eslint-disable-line no-bitwise
  let best = 'sky';
  let bestDist = Infinity;
  for (const [name, ph] of Object.entries(PALETTE)) {
    const pn = parseInt(ph.slice(1), 16);
    const pr = (pn >> 16) & 255; const pg = (pn >> 8) & 255; const pb = pn & 255; // eslint-disable-line no-bitwise
    const dist = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
    if (dist < bestDist) { bestDist = dist; best = name; }
  }
  return best;
}

function currentUserId() {
  try {
    return JSON.parse(localStorage.getItem('user') || 'null')?.id || null;
  } catch {
    return null;
  }
}

const selectedKey = (uid) => `housemait:deviceCalendars:selected:${uid}`;
const ackedKey = (uid) => `housemait:deviceCalendars:acked:${uid}`;
const lastSyncKey = (uid) => `housemait:deviceCalendars:lastSync:${uid}`;

export function getLastSyncAt() {
  const uid = currentUserId();
  if (!uid) return null;
  try {
    return localStorage.getItem(lastSyncKey(uid)) || null;
  } catch {
    return null;
  }
}

export function isDeviceCalendarSupported() {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
  } catch {
    return false;
  }
}

export async function requestCalendarAccess() {
  const { granted } = await EventKitReader.requestAccess();
  return !!granted;
}

// Deep-link to Housemait's page in the OS Settings app so a user who declined
// the calendar permission can re-grant it. Best-effort - returns false if the
// native bridge or the URL is unavailable rather than throwing.
export async function openAppSettings() {
  try {
    if (!isDeviceCalendarSupported()) return false;
    const { opened } = await EventKitReader.openSettings();
    return !!opened;
  } catch {
    return false;
  }
}

/**
 * List device calendars for the picker, pre-classifying which should be
 * default-off (subscribed feeds, Birthdays/Holidays) and hiding Housemait's
 * own outbound feed entirely (echo loop).
 */
export async function listDeviceCalendars() {
  const { calendars } = await EventKitReader.listCalendars();
  return (calendars || [])
    .filter((c) => !/housemait/i.test(c.title || ''))
    .map((c) => ({
      ...c,
      defaultOff: c.type === 'subscription' || c.type === 'birthday' || /holiday/i.test(c.title || ''),
    }));
}

export function getSelectedCalendarIds() {
  const uid = currentUserId();
  if (!uid) return [];
  try {
    const ids = JSON.parse(localStorage.getItem(selectedKey(uid)) || '[]');
    return Array.isArray(ids) ? ids : [];
  } catch {
    return [];
  }
}

export function setSelectedCalendarIds(ids) {
  const uid = currentUserId();
  if (!uid) return;
  try {
    localStorage.setItem(selectedKey(uid), JSON.stringify(ids.slice(0, MAX_CALENDARS)));
    // Selection changed → previous server acks may not cover the new shape.
    localStorage.removeItem(ackedKey(uid));
  } catch {
    // Storage full/blocked - sync still works for this session.
  }
}

function getAckedHashes() {
  const uid = currentUserId();
  if (!uid) return {};
  try {
    return JSON.parse(localStorage.getItem(ackedKey(uid)) || '{}') || {};
  } catch {
    return {};
  }
}

function setAckedHashes(map) {
  const uid = currentUserId();
  if (!uid) return;
  try {
    localStorage.setItem(ackedKey(uid), JSON.stringify(map));
  } catch { /* best effort */ }
}

// djb2 - tiny, stable, good enough to detect "did anything change".
function hashString(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i += 1) {
    h = ((h << 5) + h + str.charCodeAt(i)) >>> 0; // eslint-disable-line no-bitwise
  }
  return h.toString(36);
}

function syncWindow(now = new Date()) {
  const start = new Date(now);
  start.setDate(start.getDate() - BACK_DAYS);
  const end = new Date(now);
  end.setMonth(end.getMonth() + FORWARD_MONTHS);
  const recurringEnd = new Date(now);
  recurringEnd.setMonth(recurringEnd.getMonth() + RECURRING_FORWARD_MONTHS);
  return { start, end, recurringEnd };
}

/**
 * Read the selected calendars and sync. Safe to call often: routine calls
 * send only per-calendar hashes; full payloads go up just for calendars the
 * server asks for (needsEvents). Returns per-calendar results or null when
 * there's nothing to do.
 */
// Remove MY device links for calendars visible on THIS device but no longer
// selected (delete cascades the synced copies). Scoped to this device's
// EventKit ids so links fed by the user's other devices are never touched.
async function cleanupDeselected(allCalendars, selectedIds) {
  const deselectedIds = new Set(allCalendars.filter((c) => !selectedIds.includes(c.id)).map((c) => c.id));
  if (deselectedIds.size === 0) return;
  try {
    const uid = currentUserId();
    const { data: feedData } = await api.get('/calendar/external-feeds');
    const stale = (feedData?.feeds || []).filter((f) => (
      f.source === 'device'
      && f.device_owner_user_id === uid
      && f.sync_enabled !== false // already tombstoned - nothing to do
      && deselectedIds.has(f.device_calendar_id)
    ));
    await Promise.all(stale.map((f) => api.delete(`/calendar/external-feeds/${f.id}`).catch(() => {})));
  } catch { /* cleanup is best-effort; next sync retries */ }
}

export async function syncDeviceCalendars({ reenableIds = [] } = {}) {
  if (!isDeviceCalendarSupported()) return null;
  if (!currentUserId()) return null;
  const selected = getSelectedCalendarIds();

  const { start, end, recurringEnd } = syncWindow();
  const all = await listDeviceCalendars();
  const chosen = all.filter((c) => selected.includes(c.id)).slice(0, MAX_CALENDARS);
  if (chosen.length === 0) {
    // Deselect-all is a real action: removing the last calendar must still
    // clean up its link (and synced events) rather than silently no-op.
    await cleanupDeselected(all, selected);
    return [];
  }

  const { events } = await EventKitReader.fetchEvents({
    calendarIds: chosen.map((c) => c.id),
    start: start.getTime(),
    end: end.getTime(),
  });

  const byCalendar = new Map(chosen.map((c) => [c.id, []]));
  for (const e of events || []) {
    if (!byCalendar.has(e.calendarId)) continue;
    // Tiered expansion: recurring occurrences beyond +12 months are dropped
    // (they reappear as the window rolls forward); one-offs keep the full
    // 36-month horizon.
    if (e.isRecurring && new Date(e.start) > recurringEnd) continue;
    byCalendar.get(e.calendarId).push({
      uid: e.uid,
      title: e.title,
      start: e.start,
      end: e.end,
      allDay: !!e.allDay,
      location: e.location || null,
    });
  }

  const full = new Map(); // calendarId → full payload (for needsEvents retries)
  const acked = getAckedHashes();
  const payloads = chosen.map((c) => {
    const list = byCalendar.get(c.id) || [];
    // Stable order so the hash doesn't churn with EventKit's return order.
    list.sort((a, b) => (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0));
    const base = {
      deviceCalendarId: c.id,
      name: c.title,
      color: nearestPaletteColor(c.color),
      hash: hashString(JSON.stringify(list)),
      windowStart: start.toISOString(),
      windowEnd: end.toISOString(),
      // Only a calendar the user EXPLICITLY ticked in this picker session
      // may resurrect a web-tombstoned link. A blanket flag would also ride
      // on calendars that are merely still-selected (stale localStorage, or
      // pre-ticked on a first run/new phone) and silently undo a removal
      // another household member made on the web.
      ...(reenableIds.includes(c.id) ? { reenable: true } : {}),
    };
    full.set(c.id, { ...base, events: list });
    // Hash already acknowledged → hash-only ping; otherwise send everything.
    return acked[c.id] === base.hash ? base : full.get(c.id);
  });

  await cleanupDeselected(all, selected);

  const { data } = await api.post('/calendar/device-sync', { calendars: payloads });
  let results = data?.results || [];

  // Server couldn't match a hash-only ping (new/adopted/dedupe-coupled
  // link) → retry just those calendars with full payloads.
  const retryIds = payloads
    .filter((p, i) => results[i]?.needsEvents)
    .map((p) => p.deviceCalendarId);
  if (retryIds.length > 0) {
    const retry = await api.post('/calendar/device-sync', {
      calendars: retryIds.map((id) => full.get(id)),
    });
    const retryResults = retry.data?.results || [];
    let r = 0;
    results = results.map((res) => (res?.needsEvents ? retryResults[r++] || res : res));
  }

  // Server says a link was tombstoned from the web ("stop syncing this") -
  // honour it by dropping the calendar from this device's selection, so the
  // removal sticks instead of resurrecting on the next sync.
  const disabledIds = payloads
    .filter((p, i) => results[i]?.disabled)
    .map((p) => p.deviceCalendarId);
  if (disabledIds.length > 0) {
    const uid = currentUserId();
    if (uid) {
      try {
        const kept = getSelectedCalendarIds().filter((id) => !disabledIds.includes(id));
        localStorage.setItem(selectedKey(uid), JSON.stringify(kept));
      } catch { /* selection prune is best-effort */ }
    }
  }

  // Ack hashes the server accepted - EXCEPT dedupe-coupled calendars (the
  // server deliberately doesn't store their hash, so we must keep sending
  // full payloads for them).
  const nextAcked = {};
  payloads.forEach((p, i) => {
    const res = results[i];
    if (res?.ok && !(res.dedupedInHousehold > 0)) nextAcked[p.deviceCalendarId] = p.hash;
  });
  setAckedHashes(nextAcked);
  try {
    const uid = currentUserId();
    if (uid) localStorage.setItem(lastSyncKey(uid), new Date().toISOString());
  } catch { /* cosmetic only */ }

  return results;
}

/** Fire-and-forget variant for app-foreground hooks. */
export function syncDeviceCalendarsQuietly() {
  syncDeviceCalendars().catch(() => {});
}
