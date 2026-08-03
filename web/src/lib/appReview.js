/**
 * App Store / Play Store review prompts.
 *
 * Two channels, per Apple guideline 5.6.4 (Android's ReviewManager has the
 * same self-throttling shape, so one policy serves both stores):
 *   • maybeRequestReview() - the native review sheet via
 *     @capacitor-community/in-app-review. Apple allows at most 3 shows per
 *     user per 365 days and treats every call as a *request* (the OS decides
 *     whether to display), so we spend attempts carefully: native platforms
 *     only, the app must have been used for 7+ days, and at most one prompt
 *     per app version.
 *   • openWriteReview() - the zero-quota direct link to the App Store
 *     review composer, for the quiet "Rate Housemait" row in Settings.
 *
 * WHEN we ask - the wins engine. The original single trigger (the kids'
 * "all quests done" celebration) sat so deep that in practice the app never
 * asked anyone. recordWin() is now sprinkled on ordinary moments of value -
 * a chore ticked off, the AI doing something real, a meal planned - and the
 * prompt fires once a family has stacked up enough of them after a week of
 * use. Deliberately NOT at the end of onboarding: a day-0 user hasn't
 * experienced value yet, and a shown-but-shrugged prompt burns one of the
 * three yearly display slots.
 *
 * No incentives, no gating, no custom UI mimicking the native prompt.
 */
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { InAppReview } from '@capacitor-community/in-app-review';

export const APP_STORE_ID = '6762131562';

const FIRST_SEEN_KEY = 'housemait_first_seen';
const PROMPTED_KEY = 'housemait_review_prompted_version';
const WINS_KEY = 'housemait_review_wins';
const MIN_DAYS_USED = 7;
const MIN_WINS = 8;

const safeGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const safeSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private browsing */ } };

/** Call once at app boot so the days-used gate has a starting point. */
export function markAppSeen() {
  if (!safeGet(FIRST_SEEN_KEY)) safeSet(FIRST_SEEN_KEY, String(Date.now()));
}

/**
 * Record one moment of value and ask for a review once enough have stacked
 * up. Cheap enough to call from any success path; every guard lives in
 * maybeRequestReview, so callers never need to think about policy.
 */
export function recordWin() {
  try {
    if (!Capacitor.isNativePlatform()) return;
    const wins = Number(safeGet(WINS_KEY) || 0) + 1;
    safeSet(WINS_KEY, String(wins));
    if (wins >= MIN_WINS) maybeRequestReview();
  } catch { /* never surface */ }
}

/**
 * Request the native review sheet if every guard passes. Fire-and-forget:
 * failures (plugin missing, the OS declining to show) are silently ignored -
 * a review prompt must never break the moment it rides on.
 */
export async function maybeRequestReview() {
  try {
    if (!Capacitor.isNativePlatform()) return;

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
