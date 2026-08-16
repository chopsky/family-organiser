/**
 * Data-shape freshness audit for the LA term-dates directory.
 *
 * The import pipeline's own health signals (import_status, last_imported_at)
 * measure whether an import RAN, not whether the data it left behind is any
 * good - Barnet sat at status 'ok', freshly imported, while its public page
 * led with an academic year that had already finished (found 2026-08-16, 35
 * more councils like it). This audit looks at the stored dates themselves:
 *
 *   all_past     - every stored date is already over (the Barnet failure)
 *   missing_year - no rows at all for the year families currently care about
 *   truncated    - that year exists but stops before its own summer term
 *
 * "The year families care about" follows the importer's season logic: from
 * May to August parents are planning September, so the NEXT academic year is
 * what must be present; the rest of the year the current one is. (The AY
 * label itself only rolls over in September - academicYearsForCountry.)
 *
 * Pure DB reads - no AI calls, no fetches - so it is safe to run unattended
 * on a schedule. It flags; it never auto-imports.
 */
const { academicYearsForCountry } = require('./term-date-extract');
const laDb = require('../db/laTermDates');

/** Latest calendar day a set of rows reaches (ranges count their end). */
function newestDay(rows) {
  return rows.reduce((max, e) => {
    const d = e.end_date || e.date;
    return d > max ? d : max;
  }, '');
}

/**
 * Classify one authority's stored rows. Returns null when healthy, else
 * { problem, detail } with problem one of 'all_past' | 'missing_year' |
 * 'truncated'. `today` is an ISO date string so tests can pin the season.
 */
function classifyFreshness(rows, { today, currentAY, nextAY }) {
  if (!rows.length) return { problem: 'all_past', detail: 'no dates stored at all' };

  const last = newestDay(rows);
  if (last < today) return { problem: 'all_past', detail: `newest stored date ${last} is already over` };

  const month = new Date(`${today}T00:00:00Z`).getUTCMonth(); // 4..7 = May..Aug
  const lateSeason = month >= 4 && month <= 7;
  const focusAY = lateSeason ? nextAY : currentAY;
  const focus = rows.filter((e) => e.academic_year === focusAY);
  if (!focus.length) return { problem: 'missing_year', detail: `no ${focusAY} dates` };

  // A real academic year runs into its own summer; one that stops short is a
  // partial import (e.g. an autumn-only page) that will go visibly wrong
  // mid-year even though every date in it is still in the future today.
  const summer = `${focusAY.split('-')[1]}-06-01`;
  const focusLast = newestDay(focus);
  if (focusLast < summer) return { problem: 'truncated', detail: `${focusAY} stops at ${focusLast}` };

  return null;
}

/**
 * Audit every authority in the directory. Returns
 * { total, flagged: [{ slug, name, problem, detail }] } - flagged empty when
 * the whole dataset is healthy.
 */
async function auditTermDatesFreshness() {
  const authorities = await laDb.listAllAuthorities();
  const entries = await laDb.listAllEntries();
  const ays = academicYearsForCountry('GB');
  const today = new Date().toISOString().slice(0, 10);

  const byLa = new Map();
  for (const e of entries) {
    if (!byLa.has(e.la_id)) byLa.set(e.la_id, []);
    byLa.get(e.la_id).push(e);
  }

  const flagged = [];
  for (const la of authorities) {
    const verdict = classifyFreshness(byLa.get(la.id) || [], { today, ...ays });
    if (verdict) flagged.push({ slug: la.slug, name: la.name, ...verdict });
  }
  return { total: authorities.length, flagged };
}

module.exports = { classifyFreshness, auditTermDatesFreshness };
