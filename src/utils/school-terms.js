const db = require('../db/queries');

/**
 * Check if a given date falls during school term time for a specific school.
 * Returns false (not in session) if:
 *  - The date is an inset day or bank holiday
 *  - The date falls within a half-term period
 *  - The date falls outside all term periods (i.e. during school holidays)
 *
 * @param {string} schoolId
 * @param {string} dateStr - YYYY-MM-DD format
 * @returns {Promise<boolean>}
 */
async function isSchoolInSession(schoolId, dateStr) {
  try {
    const termDates = await db.getSchoolTermDates(schoolId);
    if (!termDates || termDates.length === 0) return true; // No term data — assume in session

    // Check inset days and bank holidays
    const isInsetOrHoliday = termDates.some(td =>
      (td.event_type === 'inset_day' || td.event_type === 'bank_holiday') &&
      td.date <= dateStr && (td.end_date ? td.end_date >= dateStr : td.date >= dateStr)
    );
    if (isInsetOrHoliday) return false;

    // Check half-term periods
    const isHalfTerm = termDates.some(td =>
      (td.event_type === 'half_term_start' || td.event_type === 'half_term_end') &&
      td.end_date && td.date <= dateStr && td.end_date >= dateStr
    );
    if (isHalfTerm) return false;

    // Check if the date falls within any term (between a term_start and its corresponding term_end)
    const termStarts = termDates.filter(td => td.event_type === 'term_start').map(td => td.date).sort();
    const termEnds = termDates.filter(td => td.event_type === 'term_end').map(td => td.date).sort();

    if (termStarts.length > 0 && termEnds.length > 0) {
      let inTerm = false;
      for (let i = 0; i < termStarts.length; i++) {
        const start = termStarts[i];
        const end = termEnds[i] || termEnds[termEnds.length - 1];
        if (dateStr >= start && dateStr <= end) {
          inTerm = true;
          break;
        }
      }
      if (!inTerm) return false; // Date is during school holiday
    }

    return true;
  } catch (err) {
    console.error(`[school-terms] Error checking term dates for school ${schoolId}:`, err.message);
    return true; // On error, assume in session (fail open)
  }
}

module.exports = { isSchoolInSession };
