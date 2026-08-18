/**
 * Google Ads click ID capture. Every ad click lands with ?gclid=... (account
 * auto-tagging). Stored at the door and written onto the user at signup, it
 * does two jobs the src= tag can't: separates PAID signups from organic ones
 * (both carry src=termdates), and enables offline conversion import back
 * into Google Ads - upload (gclid, signup time) and the Conversions column
 * finally means something, per keyword.
 *
 * Same rules as its twins (signupSource/termDatesLa): captured once from the
 * URL, expires (90 days - Google's outer click-attribution window), cleared
 * the moment an account is created so it never attaches to a second signup.
 */

const KEY = 'housemait_gclid';
const AT_KEY = 'housemait_gclid_at';
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

// gclid is an opaque URL-safe token; bound it rather than trust it.
const GCLID_RE = /^[A-Za-z0-9_-]{10,200}$/;

export function resolveGclid(searchParams, now = Date.now()) {
  let fromUrl = null;
  try {
    const raw = searchParams?.get?.('gclid') || '';
    fromUrl = GCLID_RE.test(raw) ? raw : null;
  } catch { fromUrl = null; }
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
      clearGclid();
      return undefined;
    }
    return stored;
  } catch {
    return fromUrl || undefined;
  }
}

export function clearGclid() {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(AT_KEY);
  } catch { /* private mode - nothing to clear */ }
}
