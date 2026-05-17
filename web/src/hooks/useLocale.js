/**
 * useLocale() — small hook that maps the current pathname to a locale
 * config from /lib/locales.js. Marketing components (LandingPage,
 * Subscribe, etc.) call this instead of reading prices/feature flags
 * from hardcoded literals.
 *
 * Also writes a `housemait-locale` cookie so the checkout flow downstream
 * (which may live on a different route) can pick the right currency
 * without re-parsing the URL.
 */

import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { getLocaleByPath, LOCALE_COOKIE, LOCALES } from '../lib/locales';

export function useLocale() {
  const { pathname } = useLocation();
  const locale = getLocaleByPath(pathname);

  useEffect(() => {
    // Persist for 30 days so a visitor's chosen locale survives across
    // sessions (e.g. they read /us today, come back next week, sign up).
    // SameSite=Lax keeps it out of cross-site contexts; Secure means
    // browsers only set it over HTTPS in production (no-op on localhost).
    if (typeof document !== 'undefined') {
      const maxAge = 60 * 60 * 24 * 30; // 30 days
      const secure = window.location.protocol === 'https:' ? '; Secure' : '';
      document.cookie = `${LOCALE_COOKIE}=${locale.code}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
    }
  }, [locale.code]);

  return locale;
}

/** Read the saved locale code from the cookie, or return null. Useful in
 *  auth'd flows where we want to keep using the locale the visitor
 *  selected during their marketing journey. */
export function readLocaleCookie() {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${LOCALE_COOKIE}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/** Resolve the marketing-homepage path for the visitor's saved locale —
 *  e.g. '/gb' if they came in from the UK marketing page, '/' if no
 *  locale cookie has been set yet. Used by logo links on /login and
 *  /signup so clicking "home" sends the visitor back to the country
 *  marketing page they came from, not the international default.
 *
 *  This is a CLIENT-side equivalent of the edge middleware's
 *  pathForCountry() — needed because React Router's <Link> doesn't go
 *  through Vercel's edge, so the geo redirect never fires for in-app
 *  navigation. */
export function localeHomePath() {
  const code = readLocaleCookie();
  if (code && LOCALES[code]) return LOCALES[code].path;
  return '/';
}
