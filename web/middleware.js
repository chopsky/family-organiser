/**
 * Minimal regional redirect - Vercel Edge Middleware.
 *
 * Only the marketing landing roots are geo-aware. A request to `/` (or to a
 * locale root that doesn't match the visitor's country) is redirected to the
 * locale page matching the visitor's IP-derived country. Everything else -
 * app routes, auth pages, typo / 404 URLs - falls through untouched to the
 * SPA, where React Router renders the right page (or a real 404).
 *
 * This is the key behaviour change from the old "strict" model: unknown URLs
 * are NO LONGER force-redirected to a locale landing. They reach the SPA's
 * catch-all route, which renders a proper 404 with a "Housemait home" button.
 *
 * The geo logic therefore guards exactly one surface:
 *   - LOCALE_ROOTS: `/` and the per-country landing pages (`/gb`, `/us`, ...)
 *
 * Plus one piece of non-redirect bookkeeping:
 *   - SKIP_PATHS: transactional pages (the signup/auth flow) get the
 *     housemait-locale cookie stamped from the visitor's IP if it's missing,
 *     so a direct visit to /signup still carries the geo-derived country into
 *     the signup flow (UK households import school term dates; SA ones don't).
 *
 * Search-engine crawlers bypass the geo redirect entirely. Without this,
 * Googlebot crawling from US IPs would always be redirected to /us and never
 * index /gb, /eu, /au, /ca, /za - collapsing the hreflang setup.
 *
 * Choice of 307 (not 301): geo redirects are temporary by their nature - the
 * destination depends on where the visitor is right now, not where they
 * "should" be canonically. 301 would teach engines to permanently associate
 * / with /gb.
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

// The only paths the geo redirect touches. `/` is the international default
// (x-default in hreflang); the rest are the per-country marketing landings.
// A request to any other path falls straight through to the SPA.
const LOCALE_ROOTS = new Set(['/', '/gb', '/us', '/eu', '/au', '/ca', '/za']);

// Transactional pages that get the housemait-locale cookie stamped from the
// visitor's IP (if missing) so the signup flow knows the country without a
// prior marketing-page render. These are NOT geo-redirected - they render the
// same content everywhere; the cookie just carries the country forward.
const SKIP_PATHS = new Set([
  '/login',
  '/signup',
  '/forgot-password',
  '/reset-password',
  '/check-email',
  '/verify',
  '/verified',
  // Campaign smart-link: FairRedirect (in the SPA) routes iPhone -> App Store
  // and everyone else -> /signup?promo=... Stamping the cookie here means a SA
  // visitor who taps /fair lands on the SA signup flow.
  '/fair',
]);

// User-agent patterns for crawlers and link-preview fetchers. Includes
// the main search engines, the Facebook/Twitter/LinkedIn card-renderers
// (so shared social cards always render the canonical locale page they
// were linked to), and a generic "bot|crawl|spider" catch-all.
const CRAWLER_UA = /bot|crawl|spider|slurp|ia_archiver|facebookexternalhit|twitterbot|linkedinbot|whatsapp|telegrambot|discordbot|preview/i;

/** Explicit "continue to the origin" response — the same contract
 *  @vercel/edge's next() emits. Vercel's wrapper also accepts a bare
 *  `return undefined` as continue, but being explicit survives builder/
 *  runtime versions that are stricter about middleware return values
 *  (a production deploy started throwing MIDDLEWARE_INVOCATION_FAILED
 *  on every fall-through path with the implicit form). */
function next() {
  return new Response(null, { headers: { 'x-middleware-next': '1' } });
}

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

  // Transactional pages: stamp the housemait-locale cookie from the visitor's
  // IP if it's missing, so a direct visit to /signup (no prior marketing-page
  // render) still carries the geo-derived country into the signup flow. The
  // browser keeps the cookie on the second hit so the self-redirect resolves
  // after one pass; no loop. Cookieless clients (curl, bots) just get a 307
  // they don't follow, which is harmless on these pages.
  if (SKIP_PATHS.has(path)) {
    const cookieHeader = request.headers.get('cookie') || '';
    if (/(?:^|;\s*)housemait-locale=/.test(cookieHeader)) return next(); // already set
    const country = request.headers.get('x-vercel-ip-country') || '';
    const code = localeCodeForCountry(country);
    if (!code) return next(); // unrecognized country - leave the page alone
    const maxAge = 60 * 60 * 24 * 30; // 30 days, mirrors useLocale.js
    const headers = new Headers();
    headers.set(
      'Set-Cookie',
      `housemait-locale=${code}; Path=/; Max-Age=${maxAge}; SameSite=Lax; Secure`,
    );
    headers.set('Location', request.url);
    return new Response(null, { status: 307, headers });
  }

  // Everything that isn't a locale landing root falls through to the SPA with
  // no redirect: app routes, /privacy, /terms, /support, and unknown / typo
  // URLs (which the SPA renders as a real 404).
  if (!LOCALE_ROOTS.has(path)) return next();

  // Bot bypass MUST come before the geo check. Googlebot's IP geolocates
  // to the US, but we still want it to be able to crawl /gb so that
  // hreflang annotations resolve correctly when a UK searcher hits
  // Google with a "family organiser uk" query.
  const userAgent = request.headers.get('user-agent') || '';
  if (CRAWLER_UA.test(userAgent)) return next();

  // x-vercel-ip-country is set by Vercel's edge from the request's
  // TCP-level source IP geolocation. It's never user-controllable -
  // a tampered cookie or header from the client can't poison this.
  const country = request.headers.get('x-vercel-ip-country') || '';
  const expected = pathForCountry(country);

  if (path === expected) return next();

  // Preserve query string + hash on the redirect so utm tags, ?invite=…
  // tokens, etc. follow the visitor through to their locale page.
  url.pathname = expected;
  return Response.redirect(url.toString(), 307);
}

export const config = {
  // Match almost everything - the function body decides what to act on
  // (only LOCALE_ROOTS get geo-redirected; SKIP_PATHS get a cookie stamp).
  // The matcher only excludes things that should never invoke the edge
  // function at all: static assets, API rewrites, and Vercel internals.
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
