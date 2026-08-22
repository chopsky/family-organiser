/**
 * House-inbox slug helpers.
 *
 * In their own module, not the step file, because a component module
 * that also exports plain functions breaks Fast Refresh - the same
 * reason flow.js exists.
 */

/** Client slug rules per the handoff: lowercase a-z0-9 only, max 24.
 *  Deliberately a strict SUBSET of the server rule (utils/email-alias
 *  also allows hyphens, up to 32), so everything this produces validates
 *  server-side. Narrowing the server instead would invalidate aliases
 *  households already hold. */
export const slugify = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24);

/** Up to two fallbacks when the wanted slug is gone: the slug plus this
 *  year, then the household's first real word plus "hq". */
export function suggestionsFor(slug, house) {
  const year = new Date().getFullYear();
  const firstWord = (house || '').split(/\s+/).find((w) => slugify(w).length > 2);
  const first = slugify(firstWord || slug);
  return [...new Set([`${slug}${year}`, `${first}hq`])]
    .filter((s) => s && s !== slug)
    .map((s) => s.slice(0, 24))
    .slice(0, 2);
}
