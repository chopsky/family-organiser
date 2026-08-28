/**
 * Extraction dedupe - stops image/document event extraction from re-creating
 * what the calendar already shows.
 *
 * Two duplicate sources, checked per candidate:
 *
 * 1. School term-date cover. Synced term dates (school_term_dates via the
 *    household's linked schools) are FABRICATED into the calendar at read
 *    time - they are not calendar_events rows - so a photographed school
 *    schedule re-creates every half term and INSET day as a real row and
 *    the calendar shows both. A candidate whose title looks term-structural
 *    (half term / inset / term starts / school closed...) and whose date
 *    falls inside a synced term-date range is a duplicate.
 *
 * 2. An existing calendar_events row with the same normalised title on the
 *    same date. This also makes re-sending the same photo idempotent.
 *
 * Fail-open by design: any lookup error means "no duplicates found" - a
 * dedupe outage must never cost a family their events.
 */

const db = require('../db/queries');

// Titles that describe the term STRUCTURE rather than a one-off happening.
// Deliberately narrow: "Nursery seed event" on an INSET day must survive.
const TERM_STRUCTURE_RE = /\b(half[\s-]?term|inset|term (starts|ends|begins)|(first|last) day of term|school (closed|closes|holiday)|bank holiday)\b/i;

function normTitle(t) {
  return String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * @param {string} householdId
 * @param {Array<{title: string, date: string}>} candidates - extracted events
 *   (date = YYYY-MM-DD local date the extractor produced)
 * @returns {Promise<Array<null | 'term_dates' | 'existing'>>} one verdict per
 *   candidate, null = not a duplicate, create it.
 */
async function findExtractionDuplicates(householdId, candidates) {
  const verdicts = candidates.map(() => null);
  if (!candidates.length) return verdicts;

  // -- Source 1: synced term-date ranges for the household's schools.
  let ranges = [];
  try {
    const schools = await db.getHouseholdSchools(householdId);
    const ids = (schools || []).map((s) => s.id);
    if (ids.length) {
      const dates = await db.getTermDatesBySchoolIds(ids);
      ranges = (dates || []).map((d) => ({ from: d.date, to: d.end_date || d.date }));
    }
  } catch (err) {
    console.warn('[event-dedupe] term-date lookup failed (continuing):', err.message);
  }

  // -- Source 2: existing events across the candidates' date span.
  const existing = new Set();
  try {
    const dates = candidates.map((c) => c.date).filter(Boolean).sort();
    if (dates.length) {
      const events = await db.getCalendarEvents(
        householdId,
        `${dates[0]}T00:00:00Z`,
        `${dates[dates.length - 1]}T23:59:59Z`,
      );
      for (const e of events || []) {
        existing.add(`${(e.start_time || '').slice(0, 10)}|${normTitle(e.title)}`);
      }
    }
  } catch (err) {
    console.warn('[event-dedupe] existing-event lookup failed (continuing):', err.message);
  }

  candidates.forEach((c, i) => {
    if (!c?.date) return;
    if (existing.has(`${c.date}|${normTitle(c.title)}`)) {
      verdicts[i] = 'existing';
      return;
    }
    if (TERM_STRUCTURE_RE.test(c.title || '') &&
        ranges.some((r) => c.date >= r.from && c.date <= r.to)) {
      verdicts[i] = 'term_dates';
    }
  });

  return verdicts;
}

/**
 * One warm sentence describing what was skipped, or null when nothing was.
 * Shared by both channels so the copy can't drift.
 */
function skippedLine(skippedCount, anyTermDates) {
  if (!skippedCount) return null;
  const base = `⏭️ Skipped ${skippedCount} already on your calendar`;
  return anyTermDates
    ? `${base} - your school's term dates cover the half term and INSET days.`
    : `${base}.`;
}

module.exports = { findExtractionDuplicates, skippedLine, TERM_STRUCTURE_RE };
