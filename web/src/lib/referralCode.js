/**
 * Referral-code capture (a friend's /gift/<code> landing page → signup).
 *
 * Deliberately a clone of signupPromo.js rather than a third abstraction:
 * same persistence (survives the email-verification round trip and SSO
 * detours), same two leak-prevention rules -
 *
 *   1. EXPIRY - only honoured for MAX_AGE_DAYS after capture.
 *   2. CONSUME-ON-SIGNUP - clearReferralCode() once an account is created,
 *      so one gift link can never attach to every later account on the
 *      device.
 *
 * The server holds the real guards (one reward per email ever, activation
 * gate); this is just plumbing the code from the landing page to signup.
 */

const KEY = 'housemait_referral_code';
const AT_KEY = 'housemait_referral_code_at';
const MAX_AGE_DAYS = 30;
const MAX_AGE_MS = MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

/** Stamp a code from the /gift landing page. */
export function storeReferralCode(code, now = Date.now()) {
  if (!code) return;
  try {
    localStorage.setItem(KEY, String(code).toUpperCase());
    localStorage.setItem(AT_KEY, String(now));
  } catch { /* private mode - the signup will just miss the referral */ }
}

/** Resolve the code for the signup happening now (undefined if none/stale).
 *  A ?gift=<CODE> in the current URL always wins and (re)stamps the store -
 *  the gift page's CTA carries the code through as /signup?gift=<CODE>, so
 *  the URL is the primary channel and storage covers detours (email
 *  verification, SSO popups, coming back later). */
export function resolveReferralCode(now = Date.now()) {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('gift');
    if (fromUrl) {
      storeReferralCode(fromUrl, now);
      return String(fromUrl).toUpperCase();
    }
  } catch { /* no window (tests) - fall through to storage */ }
  try {
    const stored = localStorage.getItem(KEY);
    if (!stored) return undefined;
    const at = Number(localStorage.getItem(AT_KEY) || 0);
    if (!at || now - at > MAX_AGE_MS) {
      clearReferralCode();
      return undefined;
    }
    return stored;
  } catch {
    return undefined;
  }
}

/**
 * The one pre-written share message. "Six weeks free" = the standard
 * 14-day trial plus the 30-day gift, the honest arithmetic of what the
 * link gives a new family (44 days, promised as six) - said ONCE, with
 * the link at the end only.
 * Callers must NOT also pass `url` to share(): share targets (WhatsApp)
 * prepend that param as a second link above the text.
 */
export function referralShareMessage(url) {
  return `Hey, I've been using Housemait to keep our family calendar, lists and school dates in one place. Here's a link to claim six weeks free: ${url}`;
}

/** Consume once an account has been created with it. */
export function clearReferralCode() {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(AT_KEY);
  } catch { /* private mode - nothing to clear */ }
}
