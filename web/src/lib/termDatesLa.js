/**
 * Council handoff from the public term-dates pages. A visitor on
 * housemait.com/school-term-dates/hertfordshire clicks "Try Housemait free"
 * → /signup?src=termdates&la=hertfordshire. The `src` half is ordinary
 * acquisition tagging (signupSource.js); this half remembers WHICH council
 * they were reading so the app can finish the job they arrived with -
 * steering the end of onboarding to the School screen and framing its
 * add-school prompt with their council's name.
 *
 * Same rules as its twins (signupPromo/signupSource): captured once from the
 * URL, expires after MAX_AGE_DAYS, cleared the moment it's acted on so it
 * never leaks onto another signup from the same device.
 */

const KEY = 'housemait_termdates_la';
const AT_KEY = 'housemait_termdates_la_at';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

// Directory slugs are kebab-case GIAS names ("bath-and-north-east-somerset").
const SLUG_RE = /^[a-z0-9-]{2,64}$/;

export function resolveTermDatesLa(searchParams, now = Date.now()) {
  let fromUrl = null;
  try {
    const raw = searchParams?.get?.('la') || '';
    fromUrl = SLUG_RE.test(raw) ? raw : null;
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
      clearTermDatesLa();
      return undefined;
    }
    return stored;
  } catch {
    return fromUrl || undefined;
  }
}

export function readTermDatesLa(now = Date.now()) {
  return resolveTermDatesLa(null, now);
}

export function clearTermDatesLa() {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(AT_KEY);
  } catch { /* private mode - nothing to clear */ }
}

// "bath-and-north-east-somerset" → "Bath and North East Somerset".
// Display-only - joining words stay lowercase, everything else capitalises.
const LOWER = new Set(['and', 'of', 'with', 'upon', 'the', 'on', 'in']);
export function laDisplayName(slug) {
  if (!slug) return '';
  return slug
    .split('-')
    .map((w, i) => (i > 0 && LOWER.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}
