/**
 * Strict regional redirect — Vercel Edge Middleware.
 *
 * Every request to a locale-pathed URL is forced to match the visitor's
 * IP-derived country. UK IP visiting /us → 307 to /uk. ZA IP visiting /
 * → 307 to /za. Unknown country → / (international default).
 *
 * The matcher list at the bottom controls which paths run this
 * middleware. Auth-flow pages (/login, /signup, /support, /privacy,
 * /terms) and authenticated app routes (/dashboard, /settings, …) are
 * NOT in the matcher — they remain universally reachable so a UK
 * customer can still sign in from a US-IP airport WiFi.
 *
 * Search-engine crawlers bypass entirely. Without this exemption,
 * Googlebot crawling from US IPs would always be redirected to /us and
 * never index /uk, /eu, /au, /ca, /za — collapsing the hreflang setup
 * we set up in Tier 1.
 *
 * Choice of 307 (not 301): geo redirects are temporary by their
 * nature — the destination depends on where the visitor is right now,
 * not where they "should" be canonically. Using 301 would teach search
 * engines and browsers to permanently associate / with /uk, which is
 * exactly what we don't want.
 */

// EU + EEA + Switzerland → /eu. Switzerland is included because we
// price in EUR there (the alternative is /us which feels wrong
// culturally). Norway, Iceland, Liechtenstein get the same treatment.
const EU_OR_EEA = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR',
  'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
  'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
  'NO', 'IS', 'LI', 'CH',
]);

// User-agent patterns for crawlers and link-preview fetchers. Includes
// the main search engines, the Facebook/Twitter/LinkedIn card-renderers
// (so shared social cards always render the canonical locale page they
// were linked to), and a generic "bot|crawl|spider" catch-all.
const CRAWLER_UA = /bot|crawl|spider|slurp|ia_archiver|facebookexternalhit|twitterbot|linkedinbot|whatsapp|telegrambot|discordbot|preview/i;

function pathForCountry(country) {
  const cc = (country || '').toUpperCase();
  if (cc === 'GB') return '/uk';
  if (cc === 'US') return '/us';
  if (cc === 'AU') return '/au';
  if (cc === 'CA') return '/ca';
  if (cc === 'ZA') return '/za';
  if (EU_OR_EEA.has(cc)) return '/eu';
  return '/'; // international default — x-default in hreflang
}

export default function middleware(request) {
  // Bot bypass MUST come before the geo check. Googlebot's IP geolocates
  // to the US, but we still want it to be able to crawl /uk so that
  // hreflang annotations resolve correctly when a UK searcher hits
  // Google with a "family organiser uk" query.
  const userAgent = request.headers.get('user-agent') || '';
  if (CRAWLER_UA.test(userAgent)) return;

  // x-vercel-ip-country is set by Vercel's edge from the request's
  // TCP-level source IP geolocation. It's never user-controllable —
  // a tampered cookie or header from the client can't poison this.
  const country = request.headers.get('x-vercel-ip-country') || '';
  const url = new URL(request.url);
  const expected = pathForCountry(country);

  if (url.pathname === expected) return;

  // Preserve query string + hash on the redirect so utm tags, ?invite=…
  // tokens, etc. follow the visitor through to their locale page.
  url.pathname = expected;
  return Response.redirect(url.toString(), 307);
}

export const config = {
  // Only the seven locale-pathed URLs trigger this middleware. Anything
  // else (auth flow, dashboards, static assets) is fall-through — the
  // middleware doesn't even run for those requests, so there's no
  // edge-execution cost on irrelevant traffic.
  matcher: ['/', '/uk', '/us', '/eu', '/au', '/ca', '/za'],
};
