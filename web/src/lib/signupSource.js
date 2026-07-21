/**
 * Acquisition-source capture (e.g. an RSVP page's pitch card →
 * /signup?src=rsvp). Twin of signupPromo.js with the same two rules:
 * a captured tag expires after MAX_AGE_DAYS, and it's consumed once an
 * account is created so it never rolls onto the next signup on the device.
 * Purely an analytics dimension - never changes what the user gets.
 */

const KEY = 'housemait_signup_source';
const AT_KEY = 'housemait_signup_source_at';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function resolveSignupSource(searchParams, now = Date.now()) {
  let fromUrl = null;
  try { fromUrl = searchParams?.get?.('src') || null; } catch { fromUrl = null; }
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
      clearSignupSource();
      return undefined;
    }
    return stored;
  } catch {
    return fromUrl || undefined;
  }
}

export function clearSignupSource() {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(AT_KEY);
  } catch { /* private mode - nothing to clear */ }
}
