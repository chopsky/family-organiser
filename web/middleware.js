/**
 * Strict regional redirect - Vercel Edge Middleware.
 *
 * Every "marketing-ish" request is forced to the locale page matching
 * the visitor's IP-derived country. This explicitly includes typo /
 * 404-style paths (`/asdfkjaskdj`, `/old-link-from-2022`, etc.) - those
 * would otherwise fall through to the SPA rewrite and render the
 * default-locale landing, which makes the geo enforcement leaky.
 *
 * The set of paths that bypass the redirect is enumerated below:
 *   - SKIP_PATHS: exact-match public pages (auth flow, support, legal)
 *   - SKIP_PREFIXES: authenticated app routes + well-known endpoints
 *   - Matcher exclusions: static assets, API rewrites
 *
 * Search-engine crawlers also bypass entirely. Without this, Googlebot
 * crawling from US IPs would always be redirected to /us and never
 * index /gb, /eu, /au, /ca, /za - collapsing the hreflang setup.
 *
 * Choice of 307 (not 301): geo redirects are temporary by their
 * nature - the destination depends on where the visitor is right now,
 * not where they "should" be canonically. Using 301 would teach search
 * engines and browsers to permanently associate / with /gb.
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

// Exact-match paths the middleware MUST NOT redirect. These render the
// same content for every visitor regardless of country.
const SKIP_PATHS = new Set([
  '/login',
  '/signup',
  '/forgot-password',
  '/reset-password',
  '/check-email',
  '/verify',
  '/verified',
  '/privacy',
  '/terms',
  '/support',
  // Campaign smart-link: must reach the SPA (FairRedirect) which routes
  // iPhone -> App Store and everyone else -> /signup?promo=... Without this
  // the geo redirect bounces /fair to the locale landing page instead.
  '/fair',
]);

// Of the SKIP_PATHS, these country-agnostic legal / support pages must pass
// straight through with NO cookie-stamp self-redirect. They render identically
// everywhere, so the locale cookie buys nothing - and the 307-to-self below
// loops forever for any client that doesn't echo the cookie back on the second
// hit (Googlebot, the Google OAuth verification privacy-policy fetcher, curl).
// That loop made /privacy unreachable to Google, which would fail OAuth
// verification. Humans in a browser never noticed (the cookie resolves it in
// one hop), so the bug only bit headless fetchers.
const NO_STAMP_PATHS = new Set(['/privacy', '/terms', '/support']);

// Prefix-match paths - anything starting with one of these is bypassed.
// Mostly authenticated app routes that already require a JWT to render
// anything useful, and a few well-known infra endpoints.
const SKIP_PREFIXES = [
  '/dashboard',
  '/shopping',
  '/tasks',
  '/calendar',
  '/meals',
  '/receipt',
  '/documents',
  '/family',
  '/settings',
  '/subscribe',
  '/subscription',
  '/setup',
  '/onboarding',
  '/admin',
  '/.well-known',
  '/v3',          // static v3 redesign preview in public/v3 — never geo-redirect
];

// User-agent patterns for crawlers and link-preview fetchers. Includes
// the main search engines, the Facebook/Twitter/LinkedIn card-renderers
// (so shared social cards always render the canonical locale page they
// were linked to), and a generic "bot|crawl|spider" catch-all.
const CRAWLER_UA = /bot|crawl|spider|slurp|ia_archiver|facebookexternalhit|twitterbot|linkedinbot|whatsapp|telegrambot|discordbot|preview/i;

function pathForCountry(country) {
  const cc = (country || '').toUpperCase();
  if (cc === 'GB') return '/gb';
  if (cc === 'US') return '/us';
  if (cc === 'AU') return '/au';
  if (cc === 'CA') return '/ca';
  if (cc === 'ZA') return '/za';
  if (EU_OR_EEA.has(cc)) return '/eu';
  return '/'; // international default - x-default in hreflang
}

/** Returns the bare locale code ('gb'/'us'/'eu'/...) for a country, or
 *  null when the country isn't one we have a locale for. Used to stamp
 *  the housemait-locale cookie on transactional routes. */
function localeCodeForCountry(country) {
  const path = pathForCountry(country);
  if (path === '/') return null; // no useful locale for this country
  return path.slice(1); // strip leading slash → 'gb'/'us'/'za'/...
}

export default function middleware(request) {
  const url = new URL(request.url);
  const path = url.pathname;

  // Skip non-locale pages. Split into two buckets:
  //
  //   1. SKIP_PREFIXES - machine endpoints like /.well-known/ and /api/.
  //      Returned as-is, with NO redirects and NO cookie stamping. Apple's
  //      apps_swcd daemon fetching /.well-known/apple-app-site-association
  //      is cookie-less; if we 307-self-redirected to install a cookie it
  //      would never set the cookie and we'd loop forever (which is what
  //      was breaking iOS Password AutoFill on the iOS app login form).
  //
  //   2. SKIP_PATHS - transactional human-facing pages like /signup.
  //      Stamp the housemait-locale cookie if it's missing so a direct
  //      visit to /signup (no prior marketing-page render) still carries
  //      the visitor's geo-derived country into the signup flow. Browser
  //      keeps the cookie on the second hit so the self-redirect resolves
  //      after one pass; no loop.
  if (SKIP_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) {
    return;
  }
  if (SKIP_PATHS.has(path)) {
    // Country-agnostic legal/support pages: return immediately, never stamp a
    // cookie via a self-redirect (it loops for cookieless clients - see
    // NO_STAMP_PATHS). This keeps /privacy reachable for Google's verifier.
    if (NO_STAMP_PATHS.has(path)) return;
    const cookieHeader = request.headers.get('cookie') || '';
    if (/(?:^|;\s*)housemait-locale=/.test(cookieHeader)) return; // already set
    const country = request.headers.get('x-vercel-ip-country') || '';
    const code = localeCodeForCountry(country);
    if (!code) return; // unrecognized country - leave the page alone
    const maxAge = 60 * 60 * 24 * 30; // 30 days, mirrors useLocale.js
    const headers = new Headers();
    headers.set(
      'Set-Cookie',
      `housemait-locale=${code}; Path=/; Max-Age=${maxAge}; SameSite=Lax; Secure`,
    );
    headers.set('Location', request.url);
    return new Response(null, { status: 307, headers });
  }

  // Bot bypass MUST come before the geo check. Googlebot's IP geolocates
  // to the US, but we still want it to be able to crawl /gb so that
  // hreflang annotations resolve correctly when a UK searcher hits
  // Google with a "family organiser uk" query.
  const userAgent = request.headers.get('user-agent') || '';
  if (CRAWLER_UA.test(userAgent)) return;

  // x-vercel-ip-country is set by Vercel's edge from the request's
  // TCP-level source IP geolocation. It's never user-controllable -
  // a tampered cookie or header from the client can't poison this.
  const country = request.headers.get('x-vercel-ip-country') || '';
  const expected = pathForCountry(country);

  if (path === expected) return;

  // Preserve query string + hash on the redirect so utm tags, ?invite=…
  // tokens, etc. follow the visitor through to their locale page.
  url.pathname = expected;
  return Response.redirect(url.toString(), 307);
}

export const config = {
  // Match almost everything - the SKIP_PATHS / SKIP_PREFIXES lists
  // above do the heavy lifting inside the function. The matcher itself
  // only excludes things that should never invoke the middleware at
  // all: static assets, API rewrites, and Vercel internals.
  //
  // The negative-lookahead pattern means "any path that doesn't start
  // with one of these prefixes and isn't a file with one of these
  // extensions". File-extension exclusion is required because the SPA
  // also serves /housemait-favicon.png, /manifest.json, etc., and we
  // don't want to fire the edge function for those.
  matcher: [
    '/((?!api/|assets/|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|xml|txt|json|webmanifest|js|css|map|woff|woff2|ttf|otf|html)).*)',
  ],
};
