import { SITE_URL } from './locales';

/**
 * Set a single, self-referencing <link rel="canonical"> for the current
 * page, replacing any canonical already in the <head>.
 *
 * Why "replace, not append": the app ships a static homepage canonical
 * in index.html. Non-landing pages (Support / Privacy / Terms) are
 * rendered by the SPA over that same shell, so without this they'd
 * inherit the homepage canonical and wrongly consolidate into "/".
 * Removing every existing canonical first guarantees exactly one tag,
 * pointing at this page.
 *
 * `path` is the route path with a leading slash ('' or '/' = homepage).
 * The host is always SITE_URL (apex, non-www) to match the sitemap and
 * hreflang annotations.
 */
export function setCanonical(path = '') {
  if (typeof document === 'undefined') return;
  document
    .querySelectorAll('link[rel="canonical"]')
    .forEach((node) => node.remove());
  const link = document.createElement('link');
  link.rel = 'canonical';
  const clean = path === '/' ? '' : path;
  link.href = `${SITE_URL}${clean}`;
  document.head.appendChild(link);
}
