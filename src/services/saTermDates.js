/**
 * South African national school term-dates service.
 *
 * Reads from the sa_national_term_dates table (single source of truth for
 * SA's unified national calendar from 2026 onwards) and copies the rows
 * onto a specific household_schools row when a ZA user clicks 'Import
 * South African term dates' in the term-date modal.
 *
 * The hardcoded seed in migration-sa-national-term-dates.sql covers 2026.
 * Adding 2027 dates: append the rows to that migration (or a new
 * migration) and re-run. The yearly scraper that auto-updates this from
 * gov.za is a 1.2.1+ follow-up - for now it's manual.
 */

const { supabaseAdmin } = require('../db/client');

/**
 * Get all SA national term dates for the given year.
 * @returns {Promise<object[]>} rows sorted by date
 */
async function getNationalTermDates(year) {
  const { data, error } = await supabaseAdmin
    .from('sa_national_term_dates')
    .select('event_type, date, end_date, label, year')
    .eq('year', year)
    .order('date', { ascending: true });
  if (error) throw error;
  return data || [];
}

/**
 * Import SA national term dates onto a specific household_schools row.
 *
 * Inserts rows into school_term_dates using the same event-type vocabulary
 * (so they render identically to UK-imported term dates on the calendar).
 * Uses the academic_year string format 'YYYY/YYYY+1' that matches what UK
 * LA imports use. Idempotent - duplicates (same school + date + event)
 * are silently skipped via the school's own dedup logic.
 *
 * @param {string} schoolId   household_schools.id
 * @param {number[]} years    e.g. [2026], or [2026, 2027] for a multi-year
 *                            import. Defaults to the current year.
 * @returns {Promise<number>} count of rows inserted
 */
async function importToSchool(schoolId, years = [new Date().getFullYear()]) {
  let totalInserted = 0;

  for (const year of years) {
    const nationalDates = await getNationalTermDates(year);
    if (!nationalDates.length) continue;

    const academicYear = `${year}/${year + 1}`;

    for (const d of nationalDates) {
      // Idempotency: check if a row with same school + event + date already
      // exists. school_term_dates doesn't have a unique constraint we can
      // upsert against, so we check first.
      const { data: existing } = await supabaseAdmin
        .from('school_term_dates')
        .select('id')
        .eq('school_id', schoolId)
        .eq('event_type', d.event_type)
        .eq('date', d.date)
        .limit(1);

      if (existing && existing.length > 0) continue;

      const { error: insertError } = await supabaseAdmin
        .from('school_term_dates')
        .insert({
          school_id: schoolId,
          academic_year: academicYear,
          event_type: d.event_type,
          date: d.date,
          end_date: d.end_date || null,
          label: d.label,
          source: 'sa-national',
        });
      if (!insertError) totalInserted++;
    }
  }

  return totalInserted;
}

module.exports = {
  getNationalTermDates,
  importToSchool,
};
