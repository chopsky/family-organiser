/**
 * Thin JS shim around the in-tree iOS plugin `HousemaitCalendarPlugin`
 * (web/ios/App/App/HousemaitCalendarPlugin.swift). On non-iOS-native
 * platforms every method resolves to a sensible no-op so callers
 * don't have to branch.
 *
 * Why a shim and not call registerPlugin() inline at every call site:
 * having one module own the platform check + JSON shape keeps the
 * rest of the codebase free of `Capacitor.isNativePlatform()` calls.
 */

import { Capacitor, registerPlugin } from '@capacitor/core';

const HousemaitCalendar = registerPlugin('HousemaitCalendar');

function isAvailable() {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
  } catch {
    return false;
  }
}

/**
 * Current permission state.
 * @returns {Promise<'granted'|'denied'|'not_determined'>}
 */
export async function getAuthorizationStatus() {
  if (!isAvailable()) return 'denied';
  try {
    const { status } = await HousemaitCalendar.getAuthorizationStatus();
    return status || 'not_determined';
  } catch {
    return 'denied';
  }
}

/**
 * Prompt the user for full calendar access if they haven't been asked
 * yet. If they already denied, this still fires but iOS won't re-prompt
 * — the call resolves immediately with 'denied' and the user must go
 * to iOS Settings → Privacy → Calendars → Housemait to flip it.
 *
 * @returns {Promise<'granted'|'denied'>}
 */
export async function requestAccess() {
  if (!isAvailable()) return 'denied';
  try {
    const { status } = await HousemaitCalendar.requestAccess();
    return status === 'granted' ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}

/**
 * List every calendar the user has on their device.
 * @returns {Promise<Array<{id, name, type, color, allowsContentModifications}>>}
 */
export async function listCalendars() {
  if (!isAvailable()) return [];
  try {
    const { calendars } = await HousemaitCalendar.listCalendars();
    return Array.isArray(calendars) ? calendars : [];
  } catch (err) {
    console.warn('[native-calendar] listCalendars failed:', err?.message || err);
    return [];
  }
}

/**
 * Fetch events between two dates from the user's chosen calendars.
 *
 * @param {Date|string} start - lower bound (inclusive)
 * @param {Date|string} end   - upper bound (exclusive-ish; EventKit
 *                              follows Apple's overlap rules)
 * @param {string[]}    [calendarIds] - omit to pull from all calendars
 * @returns {Promise<Array<{id, title, startISO, endISO, allDay,
 *                          calendarId, calendarName, calendarColor,
 *                          location?, notes?}>>}
 */
export async function getEvents(start, end, calendarIds) {
  if (!isAvailable()) return [];
  const startISO = start instanceof Date ? start.toISOString() : String(start);
  const endISO = end instanceof Date ? end.toISOString() : String(end);
  try {
    const { events } = await HousemaitCalendar.getEvents({
      start: startISO,
      end: endISO,
      calendarIds: Array.isArray(calendarIds) ? calendarIds : [],
    });
    return Array.isArray(events) ? events : [];
  } catch (err) {
    console.warn('[native-calendar] getEvents failed:', err?.message || err);
    return [];
  }
}

export const nativeCalendar = {
  isAvailable,
  getAuthorizationStatus,
  requestAccess,
  listCalendars,
  getEvents,
};
