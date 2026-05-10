/**
 * Google Consent Mode v2 controller.
 *
 * The gtag script is loaded from index.html on every page so Google's
 * verifier can find it and so anonymous traffic-shape data flows from
 * the first paint. The script boots with every consent signal set to
 * `denied`, which means GA only fires cookieless pings (no _ga cookies,
 * no client ID, no personal data) until the visitor accepts the banner.
 *
 * This module exposes three helpers:
 *
 *   • getConsent()      — read the persisted choice ('accepted' | 'declined' | null)
 *   • setConsent()      — persist a new choice and call gtag('consent', 'update', …)
 *   • initAnalytics()   — call once on boot to restore a prior "accepted"
 *                         choice before the first GA event fires. The
 *                         wait_for_update=500ms in index.html gives this
 *                         module a window to upgrade consent before the
 *                         initial page-view ping goes out.
 *
 * "Accepted" upgrades analytics_storage to `granted`, which lets GA set
 * its _ga* cookies and send fully-attributed events. "Declined" keeps
 * everything `denied` (the default) and clears any _ga cookies that
 * lingered from a previous session.
 */

const STORAGE_KEY = 'housemait-analytics-consent';

/** Read the user's saved consent choice, or null if they haven't decided. */
export function getConsent() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === 'accepted' || value === 'declined') return value;
    return null;
  } catch {
    // Private mode / blocked storage. Treat as undecided — the banner will
    // show every visit, which is the conservative-but-still-functional
    // behaviour. Consent stays at the safe "denied" default.
    return null;
  }
}

/**
 * Persist the user's choice and update Google's consent flags accordingly.
 * Returns the saved value so callers can re-render off of it.
 */
export function setConsent(choice) {
  if (choice !== 'accepted' && choice !== 'declined') return null;
  try {
    localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // Falls through to in-memory only — banner won't reappear in this tab.
  }
  applyConsentToGtag(choice);
  if (choice === 'declined') {
    clearGoogleAnalyticsCookies();
  }
  return choice;
}

/**
 * Boot-time init. Call from main.jsx once. Restores a prior "accepted"
 * choice so returning visitors get full tracking from the first event,
 * not just cookieless pings.
 */
export function initAnalytics() {
  const choice = getConsent();
  if (choice) {
    applyConsentToGtag(choice);
  }
}

function applyConsentToGtag(choice) {
  if (typeof window === 'undefined' || typeof window.gtag !== 'function') return;
  // Only analytics_storage is in scope — we don't run ads. The other three
  // signals stay denied per the defaults in index.html, regardless of choice,
  // which keeps us out of any "Marketing storage" / ad-personalisation
  // collection paths inside GA4.
  window.gtag('consent', 'update', {
    analytics_storage: choice === 'accepted' ? 'granted' : 'denied',
  });
}

/**
 * Best-effort cleanup when the user declines (or revokes) consent.
 * Consent Mode v2 means GA already isn't writing cookies after a decline,
 * but if cookies linger from a previous "accepted" session we clear them
 * here so the next page-load behaves as a fresh, identifier-less visit.
 */
function clearGoogleAnalyticsCookies() {
  if (typeof document === 'undefined') return;
  const host = window.location.hostname;
  document.cookie.split(';').forEach((entry) => {
    const name = entry.split('=')[0]?.trim();
    if (name && name.startsWith('_ga')) {
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=${host}`;
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=.${host.replace(/^www\./, '')}`;
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    }
  });
}
