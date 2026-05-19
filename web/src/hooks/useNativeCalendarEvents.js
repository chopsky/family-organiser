/**
 * useNativeCalendarEvents — read events from the device's Calendar
 * app for a given date range.
 *
 * Always-safe on every platform: on non-iOS-native the hook returns
 * an empty array + 'denied' status without ever touching the native
 * bridge, so callers can wire it up unconditionally and let the data
 * be empty for web/Android.
 *
 * Auto-refreshes on app foreground so events added in iOS Calendar
 * while the user was away appear next time they switch back.
 *
 * The per-device user preference (which calendars to include) is
 * persisted via localStorage so it survives reloads and isn't
 * leaked to other devices.
 *
 * @param {Date|null} start - lower bound (inclusive). Null disables the fetch.
 * @param {Date|null} end   - upper bound (exclusive-ish).
 * @returns {{
 *   events: Array,
 *   status: 'granted'|'denied'|'not_determined',
 *   selectedCalendarIds: string[],
 *   refresh: () => void
 * }}
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { nativeCalendar } from '../lib/native-calendar';
import { useAppForegroundRefresh } from './useAppForegroundRefresh';

const SELECTED_CALENDARS_KEY = 'housemait-native-calendars';

function readSelected() {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(SELECTED_CALENDARS_KEY) : null;
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function useNativeCalendarEvents(start, end) {
  const [events, setEvents] = useState([]);
  const [status, setStatus] = useState('not_determined');
  const [selectedIds, setSelectedIds] = useState(() => readSelected() ?? []);
  const requestSeq = useRef(0);

  // Re-read status whenever the hook mounts. Cheap.
  useEffect(() => {
    let cancelled = false;
    nativeCalendar.getAuthorizationStatus().then((s) => {
      if (!cancelled) setStatus(s);
    });
    return () => { cancelled = true; };
  }, []);

  const fetchEvents = useCallback(async () => {
    if (!nativeCalendar.isAvailable() || !start || !end) {
      setEvents([]);
      return;
    }
    const current = nativeCalendar.getAuthorizationStatus
      ? await nativeCalendar.getAuthorizationStatus()
      : 'denied';
    setStatus(current);
    if (current !== 'granted') {
      setEvents([]);
      return;
    }
    const seq = ++requestSeq.current;
    const data = await nativeCalendar.getEvents(start, end, selectedIds);
    // Drop stale responses if the window changed mid-flight.
    if (seq !== requestSeq.current) return;
    setEvents(data);
  }, [start, end, selectedIds]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  // Refresh when the app comes back to the foreground — covers the
  // "user added an event in iOS Calendar, then came back to Housemait"
  // case without manual refresh. Throttle short because the underlying
  // EventKit query is local and cheap.
  useAppForegroundRefresh(() => { fetchEvents(); }, { throttleMs: 2000 });

  return { events, status, selectedCalendarIds: selectedIds, setSelectedCalendarIds: writeAndSet(setSelectedIds), refresh: fetchEvents };
}

function writeAndSet(setter) {
  return (ids) => {
    setter(ids);
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(SELECTED_CALENDARS_KEY, JSON.stringify(ids));
      }
    } catch { /* ignore */ }
  };
}
