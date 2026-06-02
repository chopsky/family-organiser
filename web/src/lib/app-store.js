/**
 * App Store metadata + helpers — single source of truth for any
 * landing-page surface that needs to deep-link to the iOS app.
 *
 * Replace APP_STORE_ID with the numeric ID from the live App Store
 * listing (the digits after `/id` in the App Store URL). Also update
 * the matching Smart App Banner meta tag in web/index.html so Safari
 * on iOS surfaces a native install banner at the top of the page.
 *
 * Once the live listing exists, the only edit needed across the whole
 * codebase is `APP_STORE_ID` below.
 */

export const APP_STORE_ID = 'REPLACE_WITH_APP_STORE_ID';

/** Direct link to the App Store product page. */
export const APP_STORE_URL = `https://apps.apple.com/app/housemait/id${APP_STORE_ID}`;

/** True when the App Store ID has been configured for production. The
 *  landing page uses this to hide the App Store badge until the live
 *  ID is in place — we'd rather show no badge than a broken link. */
export const APP_STORE_CONFIGURED = APP_STORE_ID !== 'REPLACE_WITH_APP_STORE_ID';

/**
 * Detect whether the visitor is on a phone/tablet running iOS or iPadOS.
 * Used to swap the hero CTA order: iOS visitors see the App Store badge
 * as the primary action, web signup as secondary. Non-iOS visitors get
 * the current trial-first treatment.
 *
 * iPadOS reports as Mac in modern Safari — we use the touch + Mac
 * platform combination as the giveaway. (No equivalent for Android
 * here because we don't ship an Android app yet.)
 */
export function isIos() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) && !window.MSStream) return true;
  // iPadOS 13+ masquerades as Mac in user-agent — look for touch.
  if (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) return true;
  return false;
}
