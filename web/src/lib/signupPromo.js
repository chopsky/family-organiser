/**
 * Campaign signup-promo capture (e.g. a school-fair HILLELFEST QR →
 * /fair → /signup?promo=HILLELFEST).
 *
 * The promo is persisted so it survives the user navigating away or the
 * email-verification round trip and is still there if they finish signing
 * up (or use SSO) on a later visit. Two rules keep that persistence from
 * leaking a one-off campaign discount onto unrelated accounts:
 *
 *   1. EXPIRY - a captured code is only honoured for MAX_AGE_DAYS. Campaign
 *      discounts are time-limited; a code scanned months ago must not
 *      silently attach to a brand-new signup.
 *   2. CONSUME-ON-SIGNUP - clearSignupPromo() is called once an account is
 *      created, so the code can never roll onto the NEXT signup made in the
 *      same browser. (The bug this fixes: one QR scan was granting the
 *      discount to every future account on that device.)
 */

const KEY = 'housemait_signup_promo';
const AT_KEY = 'housemait_signup_promo_at';
const MAX_AGE_DAYS = 30;
const MAX_AGE_MS = MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

/**
 * Resolve the promo for the signup happening now. A `promo` in the URL
 * always wins and (re)stamps the store with a fresh timestamp. Otherwise a
 * previously-stored code is returned only if it's still within the window;
 * a stale one is cleared and treated as absent. Pure except for localStorage
 * and the injectable `now` (so the expiry branch is testable).
 */
export function resolveSignupPromo(searchParams, now = Date.now()) {
  let fromUrl = null;
  try { fromUrl = searchParams?.get?.('promo') || null; } catch { fromUrl = null; }
  try {
    if (fromUrl) {
      localStorage.setItem(KEY, fromUrl);
      localStorage.setItem(AT_KEY, String(now));
      return fromUrl;
    }
    const stored = localStorage.getItem(KEY);
    if (!stored) return undefined;
    const at = Number(localStorage.getItem(AT_KEY) || 0);
    if (!at || now - at > MAX_AGE_MS) {
      clearSignupPromo();
      return undefined;
    }
    return stored;
  } catch {
    // Private mode / storage blocked: honour a URL code for this page load
    // only, never a stored one.
    return fromUrl || undefined;
  }
}

/** Clear the stored promo once an account has been created with it. */
export function clearSignupPromo() {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(AT_KEY);
  } catch { /* private mode - nothing to clear */ }
}
