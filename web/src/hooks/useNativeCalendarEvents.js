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
 * Selected calendars come from native-calendar-selection.js — a
 * shared single-source-of-truth that the NativeCalendarPicker also
 * writes to. Subscribing to its changes means flipping a calendar
 * off in Settings immediately removes its events from this hook
 * (previously each consumer had its own useState seeded from
 * localStorage and writes didn't propagate within the same tab).
 *
 * @param {Date|null} start - lower bound (inclusive). Null disables the fetch.
 * @param {Date|null} end   - upper bound (exclusive-ish).
 * @returns {{
 *   events: Array,
 *   status: 'granted'|'denied'|'not_determined',
 *   refresh: () => void
 * }}
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { nativeCalendar } from '../lib/native-calendar';
import { getSelectedCalendarIds, subscribeToSelection } from '../lib/native-calendar-selection';
import { useAppForegroundRefresh } from './useAppForegroundRefresh';

export function useNativeCalendarEvents(start, end) {
  const [events, setEvents] = useState([]);
  const [status, setStatus] = useState('not_determined');
  const [selectedIds, setSelectedIds] = useState(() => getSelectedCalendarIds());
  const requestSeq = useRef(0);

  // Re-read status whenever the hook mounts. Cheap.
  useEffect(() => {
    let cancelled = false;
    nativeCalendar.getAuthorizationStatus().then((s) => {
      if (!cancelled) setStatus(s);
    });
    return () => { cancelled = true; };
  }, []);

  // Stay in sync with the picker — flipping a calendar off there
  // should immediately empty the events list here.
  useEffect(() => {
    const unsub = subscribeToSelection((ids) => setSelectedIds(ids));
    return unsub;
  }, []);

  const fetchEvents = useCallback(async () => {
    if (!nativeCalendar.isAvailable() || !start || !end) {
      setEvents([]);
      return;
    }
    const current = await nativeCalendar.getAuthorizationStatus();
    setStatus(current);
    if (current !== 'granted') {
      setEvents([]);
      return;
    }
    // No calendars chosen → no events (intentional; user has to opt in).
    if (!selectedIds || selectedIds.length === 0) {
      setEvents([]);
      return;
    }
    const seq = ++requestSeq.current;
    const data = await nativeCalendar.getEvents(start, end, selectedIds);
    if (seq !== requestSeq.current) return; // window changed mid-flight
    setEvents(data);
  }, [start, end, selectedIds]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  // Refresh when the app comes back to the foreground.
  useAppForegroundRefresh(() => { fetchEvents(); }, { throttleMs: 2000 });

  return { events, status, refresh: fetchEvents };
}
