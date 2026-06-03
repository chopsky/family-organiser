/**
 * Device location helper — Phase: iOS location services.
 *
 * The iOS app's GPS is the PRIMARY location source for the weather widget
 * and any AI question that needs "where am I". The household address under
 * Family Setup is the SECONDARY fallback (used when the device location
 * isn't available — permission denied, web build, or lookup failure).
 *
 * Native (iOS): uses @capacitor/geolocation, which bridges to CoreLocation
 * and triggers the system permission prompt the first time. The Web Speech
 * API gotcha (broken in WKWebView) does NOT apply here — CoreLocation works.
 *
 * Web: falls back to the browser Geolocation API where available, so the
 * desktop/PWA build can still use location if the user grants it.
 *
 * We cache a successful fix in-memory for a few minutes so repeated callers
 * (weather widget mount + an AI question moments later) don't each spin up a
 * fresh GPS fix.
 */

import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { isNative } from './platform';

const FIX_TTL_MS = 5 * 60 * 1000; // a GPS fix stays fresh for 5 min
let cachedFix = null; // { coords: { lat, lon }, ts }

/**
 * Current permission state, normalised to one of:
 *   'granted'  — we can read location now
 *   'denied'   — user said no; must re-enable via iOS Settings
 *   'prompt'   — not yet asked (or "ask again")
 *   'unavailable' — no geolocation support on this platform/browser
 *
 * @returns {Promise<'granted'|'denied'|'prompt'|'unavailable'>}
 */
export async function getLocationPermission() {
  try {
    if (isNative()) {
      const status = await Geolocation.checkPermissions();
      // Capacitor returns granted | denied | prompt | prompt-with-rationale
      const s = status.location || status.coarseLocation;
      if (s === 'granted') return 'granted';
      if (s === 'denied') return 'denied';
      return 'prompt';
    }
    // Web: the Permissions API tells us without prompting, when supported.
    if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
      try {
        const res = await navigator.permissions.query({ name: 'geolocation' });
        if (res.state === 'granted') return 'granted';
        if (res.state === 'denied') return 'denied';
        return 'prompt';
      } catch {
        // Some browsers reject geolocation in Permissions API → assume prompt.
      }
    }
    if (typeof navigator !== 'undefined' && navigator.geolocation) return 'prompt';
    return 'unavailable';
  } catch {
    return 'unavailable';
  }
}

/**
 * Explicitly request permission (shows the system prompt on iOS the first
 * time). Returns the resulting permission state. Safe to call when already
 * granted (resolves immediately).
 *
 * @returns {Promise<'granted'|'denied'|'prompt'|'unavailable'>}
 */
export async function requestLocationPermission() {
  try {
    if (isNative()) {
      const status = await Geolocation.requestPermissions();
      const s = status.location || status.coarseLocation;
      if (s === 'granted') return 'granted';
      if (s === 'denied') return 'denied';
      return 'prompt';
    }
    // Web has no separate "request" — the prompt fires on getCurrentPosition.
    // Trigger a one-shot read to surface the browser prompt, then report state.
    const fix = await getDeviceLocation({ force: true });
    return fix ? 'granted' : (await getLocationPermission());
  } catch {
    return 'denied';
  }
}

/**
 * Read the device's current coordinates. Returns { lat, lon } or null when
 * unavailable (no permission, no support, or a timeout). NEVER throws — the
 * caller treats null as "fall back to the household address".
 *
 * @param {object} [opts]
 * @param {boolean} [opts.force] - bypass the in-memory cache
 * @param {boolean} [opts.skipIfDenied] - return null without prompting when
 *   permission isn't already granted (used for silent/background reads)
 * @returns {Promise<{lat:number, lon:number}|null>}
 */
export async function getDeviceLocation({ force = false, skipIfDenied = false } = {}) {
  if (!force && cachedFix && Date.now() - cachedFix.ts < FIX_TTL_MS) {
    return cachedFix.coords;
  }

  try {
    if (skipIfDenied) {
      const perm = await getLocationPermission();
      if (perm !== 'granted') return null;
    }

    if (isNative()) {
      const pos = await Geolocation.getCurrentPosition({
        enableHighAccuracy: false,
        timeout: 10000,
        maximumAge: FIX_TTL_MS,
      });
      const coords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      cachedFix = { coords, ts: Date.now() };
      return coords;
    }

    if (typeof navigator === 'undefined' || !navigator.geolocation) return null;
    const coords = await new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: false, timeout: 10000, maximumAge: FIX_TTL_MS },
      );
    });
    if (coords) cachedFix = { coords, ts: Date.now() };
    return coords;
  } catch {
    return null;
  }
}

/**
 * Open the OS Settings app so the user can re-enable a previously denied
 * location permission. On iOS this deep-links straight to Housemait's
 * settings page. Best-effort — silently no-ops if unavailable.
 */
export async function openLocationSettings() {
  try {
    if (isNative() && Capacitor.getPlatform() === 'ios') {
      // App-specific settings deep link. Handled natively; falls back to the
      // Settings root on older iOS.
      window.open('app-settings:', '_system');
    }
  } catch {
    // no-op
  }
}

/** Clear the cached fix (e.g. after the user toggles location off). */
export function clearLocationCache() {
  cachedFix = null;
}
