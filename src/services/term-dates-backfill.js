/**
 * Term-dates backfill: schools whose family chose "use my council's dates"
 * but where no import ever ran.
 *
 * POST /api/schools only STORES uses_la_dates - importing the dates is a
 * separate step, and a family that stops after "add school" leaves the flag
 * as a wish forever (found 2026-08-03: 4 of 16 schools in this state, one
 * since June). This service fulfils the wish from data we already hold:
 *
 *   1. The shared school directory - the same school's verified dates,
 *      adopted from another household (also links directory_school_id so
 *      future corrections propagate here too).
 *   2. The LA term-dates directory - the council's dates, all years held.
 *   3. The LA scrape cache - the current year, if another family scraped it
 *      in the last 90 days.
 *
 * Deliberately NO live council scrape: the sweep runs unattended and free
 * reads are enough for the common case. Council dates are never pushed onto
 * an independent school - they set their own calendar (the same rule as the
 * in-app fork guard).
 */

const db = require('../db/queries');
const dirDb = require('../db/schoolDirectory');
const laDb = require('../db/laTermDates');
const { lookupDirectoryDatesForSchool, propagateDirectorySchoolDates } = require('./schoolDirectory');
const { dropFinishedAcademicYears } = require('../utils/school-terms');
const cache = require('./cache');

function currentAcademicYear(now = new Date()) {
  return now.getMonth() >= 8
    ? `${now.getFullYear()}-${now.getFullYear() + 1}`
    : `${now.getFullYear() - 1}-${now.getFullYear()}`;
}

// A year counts as USABLE only if it still holds a FUTURE term boundary
// (term_start/term_end on or after today). Three real failures this blocks,
// all from the first prod run (2026-08-03): Bexley's only live year held 3
// bank holidays and zero term dates ("3 term dates" that were Christmas
// Day); Essex's year survived the finished-year filter on a trailing August
// bank holiday; and after tightening to structure types, Essex STILL passed
// on "Summer holiday 21 Jul → 31 Aug" - a year whose every term boundary has
// passed can't answer "when does school go back", which is the question an
// August parent is asking. A family is better served by an honestly-empty
// school (the sweep retries weekly once the LA data refreshes) than by a
// card that looks done and expires in four weeks.
function liveTermYears(rows, today = new Date().toISOString().slice(0, 10)) {
  const lastBoundaryOf = new Map();
  for (const d of rows) {
    if (d.event_type !== 'term_start' && d.event_type !== 'term_end') continue;
    const last = d.end_date || d.date || '';
    if (last > (lastBoundaryOf.get(d.academic_year) || '')) lastBoundaryOf.set(d.academic_year, last);
  }
  const liveYears = new Set(
    [...lastBoundaryOf.entries()].filter(([, last]) => last >= today).map(([ay]) => ay),
  );
  return rows.filter((d) => liveYears.has(d.academic_year));
}

/** Full clean replace with LA-sourced rows, mirroring the confirm route. */
async function applyLaDates(school, rawDates) {
  const live = liveTermYears(dropFinishedAcademicYears(
    (rawDates || []).filter((d) => d && /^\d{4}-\d{2}-\d{2}$/.test(d.date || '')),
  ));
  if (live.length === 0) return 0;
  await db.deleteAllTermDatesBySchool(school.id);
  await db.addSchoolTermDates(school.id, live.map((d) => ({
    academic_year: d.academic_year,
    event_type: d.event_type,
    date: d.date,
    end_date: d.end_date || null,
    label: d.label || null,
    source: 'local_authority',
  })));
  await db.updateHouseholdSchoolMeta(school.id, {
    term_dates_source: 'local_authority',
    term_dates_last_updated: new Date().toISOString(),
  });
  cache.invalidate(`schools:${school.household_id}`);
  cache.invalidate(`digest:${school.household_id}`);
  return live.length;
}

/**
 * Try to fill one empty school. Returns { filled, source?, count?, reason? }.
 */
async function backfillSchoolTermDates(school) {
  // 1) The school's OWN dates via the shared directory (safe for every
  //    school type - it's the same school, not the council's calendar).
  try {
    const offer = await lookupDirectoryDatesForSchool(school);
    if (offer) {
      await dirDb.linkHouseholdSchoolToDirectory(school.id, offer.school.id);
      // Propagation fills every linked household school, including the one
      // just linked; re-writing the existing ones with identical data is a
      // deliberate no-op-shaped idempotent write.
      await propagateDirectorySchoolDates(offer.school.id);
      return { filled: true, source: 'school_directory', count: offer.dates.length };
    }
  } catch (err) {
    console.error(`[term-backfill] directory lookup failed for ${school.school_name}:`, err.message);
  }

  if (!school.local_authority) return { filled: false, reason: 'no_local_authority' };
  if (school.school_type === 'independent') return { filled: false, reason: 'independent_school' };

  // 2) The council's dates from the LA directory (every year it holds).
  try {
    const dirDates = await laDb.getDirectoryTermDatesByName(school.local_authority);
    if (dirDates.length) {
      const count = await applyLaDates(school, dirDates);
      if (count > 0) return { filled: true, source: 'la_directory', count };
    }
  } catch (err) {
    console.error(`[term-backfill] LA directory failed for ${school.school_name}:`, err.message);
  }

  // 3) The per-LA scrape cache (current academic year, 90-day freshness).
  try {
    const cached = await db.getCachedLATermDates(school.local_authority, currentAcademicYear());
    if (cached) {
      const count = await applyLaDates(school, cached);
      if (count > 0) return { filled: true, source: 'la_cache', count };
    }
  } catch (err) {
    console.error(`[term-backfill] LA cache failed for ${school.school_name}:`, err.message);
  }

  return { filled: false, reason: 'no_source_available' };
}

/**
 * The sweep, over two candidate sets:
 *   1. Empty schools whose family chose LA dates but no import ever ran.
 *   2. LA-sourced schools whose dates have ALL passed (the Hopwood case:
 *      imported in July, the year ended, and the family sat on 14 expired
 *      rows). Refreshing these is safe - the data came from the LA import,
 *      not the family's own work - and the same liveTermYears gate means a
 *      refresh only happens when the council has genuinely newer data.
 * One school failing never aborts the rest.
 */
async function backfillEmptyTermDates() {
  const [empty, stale] = await Promise.all([
    db.getSchoolsWithNoTermDates(),
    db.getLaSourcedSchoolsWithStaleDates().catch(() => []),
  ]);
  const candidates = [
    ...empty,
    ...stale.map((s) => ({ ...s, __refresh: true })),
  ];
  const filled = [];
  const skipped = [];
  for (const school of candidates) {
    try {
      const result = await backfillSchoolTermDates(school);
      const entry = {
        school: school.school_name,
        household_id: school.household_id,
        ...(school.__refresh ? { refresh: true } : {}),
        ...result,
      };
      (result.filled ? filled : skipped).push(entry);
    } catch (err) {
      console.error(`[term-backfill] failed for ${school.school_name}:`, err.message);
      skipped.push({ school: school.school_name, household_id: school.household_id, filled: false, reason: 'error' });
    }
  }
  return { considered: candidates.length, filled, skipped };
}

module.exports = { backfillEmptyTermDates, backfillSchoolTermDates, currentAcademicYear };
