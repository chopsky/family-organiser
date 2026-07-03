/**
 * App Store review prompts (iOS).
 *
 * Two channels, per Apple guideline 5.6.4:
 *   • maybeRequestReview() - the native SKStoreReviewController sheet via
 *     @capacitor-community/in-app-review. Apple allows at most 3 shows per
 *     user per 365 days and treats every call as a *request* (iOS decides
 *     whether to display), so we spend attempts carefully: native iOS only,
 *     the app must have been used for 14+ days, and at most one prompt per
 *     app version. Fired at a moment of delight - the kids' "all quests
 *     done" celebration.
 *   • openWriteReview() - the zero-quota direct link to the App Store
 *     review composer, for the quiet "Rate Housemait" row in Settings.
 *
 * No incentives, no gating, no custom UI mimicking the native prompt.
 */
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { InAppReview } from '@capacitor-community/in-app-review';
import { isIos } from './platform';

export const APP_STORE_ID = '6762131562';

const FIRST_SEEN_KEY = 'housemait_first_seen';
const PROMPTED_KEY = 'housemait_review_prompted_version';
const MIN_DAYS_USED = 14;

const safeGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const safeSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private browsing */ } };

/** Call once at app boot so the 14-day gate has a starting point. */
export function markAppSeen() {
  if (!safeGet(FIRST_SEEN_KEY)) safeSet(FIRST_SEEN_KEY, String(Date.now()));
}

/**
 * Request the native review sheet if every guard passes. Fire-and-forget:
 * failures (plugin missing, iOS declining to show) are silently ignored -
 * a review prompt must never break the moment it rides on.
 */
export async function maybeRequestReview() {
  try {
    if (!isIos()) return;

    const firstSeen = Number(safeGet(FIRST_SEEN_KEY) || 0);
    if (!firstSeen || Date.now() - firstSeen < MIN_DAYS_USED * 86400000) return;

    const { version } = await App.getInfo();
    if (safeGet(PROMPTED_KEY) === version) return;
    safeSet(PROMPTED_KEY, version); // mark BEFORE requesting - a crash loop must not re-prompt

    await InAppReview.requestReview();
  } catch { /* never surface */ }
}

/** Open the App Store review composer directly (no quota, user-initiated). */
export function openWriteReview() {
  const url = Capacitor.isNativePlatform()
    ? `itms-apps://apps.apple.com/app/id${APP_STORE_ID}?action=write-review`
    : `https://apps.apple.com/app/id${APP_STORE_ID}?action=write-review`;
  if (Capacitor.isNativePlatform()) {
    window.location.href = url; // external scheme handled by the shell
  } else {
    window.open(url, '_blank', 'noopener');
  }
}
