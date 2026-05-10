/**
 * Consent-gated Google Analytics loader.
 *
 * GA4 is a non-essential tracker under PECR / UK GDPR — we cannot fire it
 * before the user opts in. This module owns the lifecycle:
 *
 *   • getConsent()     — read the persisted choice ('accepted' | 'declined' | null)
 *   • setConsent()     — persist a new choice and (de)activate GA accordingly
 *   • initAnalytics()  — call once on app boot; if prior consent was 'accepted',
 *                        the GA script is injected and the existing GA cookies
 *                        keep working seamlessly across sessions.
 *
 * If the user later declines (e.g. via a "manage cookies" link in the
 * footer), we don't try to retro-actively unload Google's script — that
 * isn't possible from the page once it's loaded — but we do delete the
 * `_ga*` cookies so Google has nothing to send on the next request, and
 * we set a flag that prevents future page-loads from booting GA again.
 */

const STORAGE_KEY = 'housemait-analytics-consent';
const GA_MEASUREMENT_ID = 'G-RY1QCM5JBG';

let gaLoaded = false;

/** Read the user's saved consent choice, or null if they haven't decided. */
export function getConsent() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === 'accepted' || value === 'declined') return value;
    return null;
  } catch {
    // Private mode / blocked storage. Treat as undecided — the banner will
    // show every visit, which is the conservative-but-still-functional
    // behaviour. We never fire GA without an explicit accepted state.
    return null;
  }
}

/**
 * Persist the user's choice and, if accepted, load GA right away. Returns
 * the saved value so callers can re-render off of it.
 */
export function setConsent(choice) {
  if (choice !== 'accepted' && choice !== 'declined') return null;
  try {
    localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // Falls through to in-memory only — banner won't reappear in this tab.
  }
  if (choice === 'accepted') {
    loadGoogleAnalytics();
  } else {
    clearGoogleAnalyticsCookies();
  }
  return choice;
}

/**
 * Boot-time init. Call from main.jsx once. Safe to call repeatedly — the
 * GA script is only injected once thanks to the gaLoaded guard.
 */
export function initAnalytics() {
  if (getConsent() === 'accepted') {
    loadGoogleAnalytics();
  }
}

function loadGoogleAnalytics() {
  if (gaLoaded || typeof document === 'undefined') return;
  gaLoaded = true;

  // Boilerplate gtag.js loader — verbatim from the GA4 install snippet,
  // injected via DOM rather than served inline so we control timing.
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
  document.head.appendChild(script);

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;
  gtag('js', new Date());
  gtag('config', GA_MEASUREMENT_ID);
}

/**
 * Best-effort cleanup when the user declines (or revokes) consent. We
 * can't unload the GA script from the page — the browser already
 * downloaded and ran it — but we can wipe the `_ga*` cookies it set so
 * subsequent page loads behave as a fresh, identifier-less visit.
 */
function clearGoogleAnalyticsCookies() {
  if (typeof document === 'undefined') return;
  const host = window.location.hostname;
  // Cover both apex and subdomain cookies. _ga and _ga_<measurement-id>
  // are GA4's two main cookies; clear any matching variant.
  document.cookie.split(';').forEach((entry) => {
    const name = entry.split('=')[0]?.trim();
    if (name && name.startsWith('_ga')) {
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=${host}`;
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=.${host.replace(/^www\./, '')}`;
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    }
  });
}
