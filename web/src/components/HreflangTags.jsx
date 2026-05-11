/**
 * Per-page hreflang + canonical injector.
 *
 * Renders nothing visible — purely manipulates the document <head> via
 * an effect so React Router page transitions update the alternate-link
 * set correctly. Tells search engines:
 *
 *   • <link rel="canonical" href="https://housemait.com{locale.path}">
 *   • <link rel="alternate" hreflang="en-GB"   href=".../uk">
 *   • <link rel="alternate" hreflang="en-US"   href=".../us">
 *     …one per locale…
 *   • <link rel="alternate" hreflang="x-default" href="https://housemait.com/">
 *
 * Each tag is namespaced with a data-housemait-hreflang attribute so we
 * can wipe and rewrite the set cleanly between route changes without
 * touching unrelated head tags (e.g. the GA scripts or the font links).
 */

import { useEffect } from 'react';
import { allLocales, SITE_URL } from '../lib/locales';

const MARKER_ATTR = 'data-housemait-hreflang';

export default function HreflangTags({ locale }) {
  useEffect(() => {
    if (typeof document === 'undefined' || !locale) return;

    // Wipe previously-injected tags so we don't accumulate them on
    // route changes (e.g. visitor goes /uk → /us, the old <link>s would
    // otherwise stick around and Google would see conflicting signals).
    document.querySelectorAll(`[${MARKER_ATTR}]`).forEach((node) => node.remove());

    // Self-canonical for this page.
    const canonical = document.createElement('link');
    canonical.rel = 'canonical';
    canonical.href = `${SITE_URL}${locale.path === '/' ? '' : locale.path}`;
    canonical.setAttribute(MARKER_ATTR, 'canonical');
    document.head.appendChild(canonical);

    // Alternates for every locale (including this one — Google requires
    // reciprocal references, where each page in the set names itself).
    for (const alt of allLocales()) {
      const link = document.createElement('link');
      link.rel = 'alternate';
      link.hreflang = alt.hreflang;
      link.href = `${SITE_URL}${alt.path === '/' ? '' : alt.path}`;
      link.setAttribute(MARKER_ATTR, alt.hreflang);
      document.head.appendChild(link);
    }
  }, [locale]);

  return null;
}
