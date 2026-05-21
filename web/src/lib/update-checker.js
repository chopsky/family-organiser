/**
 * In-app App Store update checker for the iOS Capacitor build.
 *
 * On native iOS only, fetches Apple's public iTunes lookup API to see
 * what version is live on the App Store, then compares against the
 * version bundled in the running app. If the App Store version is
 * newer, returns the metadata the banner needs to prompt the user.
 *
 * Why this approach:
 *   - No backend dependency. Apple's lookup endpoint is free + public.
 *   - Reaches every user who opens the app, regardless of whether they
 *     have auto-update enabled or have engaged with notifications.
 *   - Standard iOS pattern; nothing to App-Review-flag.
 *
 * Returns null on web (no app to update), on lookup failure (network
 * or API blip - we'd rather show nothing than a phantom prompt), or
 * when versions match. The caller treats null as "no banner".
 */

import { Capacitor } from '@capacitor/core';

const BUNDLE_ID = 'com.housemait.app';
// Apple's iTunes Search API. country=gb because the bundle is published
// in the UK store - the wrong country sometimes returns no result.
const LOOKUP_URL = `https://itunes.apple.com/lookup?bundleId=${BUNDLE_ID}&country=gb`;

// Local-storage key the banner reads to suppress dismissed versions.
// Stored value is the latest version the user explicitly dismissed -
// when a NEWER one comes along, the banner re-appears.
const DISMISSED_KEY = 'housemait_update_dismissed_version';

function isNativeIOS() {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
  } catch {
    return false;
  }
}

/**
 * Semver-ish compare. Treats each segment numerically.
 *   compareVersions('1.4.0', '1.3.1') ->  1   (a > b)
 *   compareVersions('1.4.0', '1.4.0') ->  0
 *   compareVersions('1.3.9', '1.4.0') -> -1   (a < b)
 * Missing segments treated as 0 ("1.4" === "1.4.0").
 */
export function compareVersions(a, b) {
  const partsA = String(a || '0').split('.').map(n => parseInt(n, 10) || 0);
  const partsB = String(b || '0').split('.').map(n => parseInt(n, 10) || 0);
  const len = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < len; i++) {
    const x = partsA[i] || 0;
    const y = partsB[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

/**
 * Returns { updateAvailable, currentVersion, latestVersion, storeUrl } on
 * iOS when a newer version exists, or null in every other case.
 */
export async function checkForUpdate() {
  if (!isNativeIOS()) return null;

  let currentVersion = null;
  try {
    const { App } = await import('@capacitor/app');
    const info = await App.getInfo();
    currentVersion = info?.version || null;
  } catch {
    return null;
  }
  if (!currentVersion) return null;

  let storeData;
  try {
    const res = await fetch(LOOKUP_URL);
    if (!res.ok) return null;
    storeData = await res.json();
  } catch {
    // Network failure / offline / DNS - silently no-op. The user will
    // hit the check again on the next launch.
    return null;
  }
  const result = storeData?.results?.[0];
  if (!result) return null;

  const latestVersion = result.version;
  const storeUrl = result.trackViewUrl;
  if (!latestVersion || !storeUrl) return null;

  const updateAvailable = compareVersions(latestVersion, currentVersion) > 0;
  if (!updateAvailable) return null;

  return { updateAvailable, currentVersion, latestVersion, storeUrl };
}

/**
 * Record that the user dismissed a prompt for a specific version, so we
 * don't re-show the banner on the next launch for the same release. If
 * a NEWER version later lands, the banner re-appears because the
 * stored value is older than the new latest.
 */
export function dismissUpdateForVersion(version) {
  try {
    localStorage.setItem(DISMISSED_KEY, String(version));
  } catch { /* Safari private browsing / no-op */ }
}

/**
 * Returns true if the user has already dismissed this exact version (or
 * a newer one - in which case the dismiss is still authoritative).
 */
export function wasUpdateDismissed(version) {
  try {
    const dismissed = localStorage.getItem(DISMISSED_KEY);
    if (!dismissed) return false;
    return compareVersions(dismissed, version) >= 0;
  } catch {
    return false;
  }
}
