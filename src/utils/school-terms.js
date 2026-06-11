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
    if (!termDates || termDates.length === 0) return true; // No term data - assume in session

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

/** UK season label from a YYYY-MM-DD start date. */
function seasonLabel(dateStr) {
  const month = Number(String(dateStr).slice(5, 7));
  if (month >= 9) return 'Autumn Term';
  if (month <= 4) return 'Spring Term';
  return 'Summer Term';
}

/**
 * Derive discrete terms from raw school_term_dates rows by pairing each
 * term_start with the next term_end within the same academic year. Pure (no
 * DB) so it's easy to test. Returns terms sorted by start, each:
 *   { label, academic_year, start_date, end_date }
 * `label` prefers the source row's own label, else "<Season> Term <year>".
 *
 * @param {Array} termDates - school_term_dates rows
 * @returns {Array<{label,academic_year,start_date,end_date}>}
 */
function deriveTerms(termDates = []) {
  const byYear = new Map();
  for (const td of termDates) {
    if (td.event_type !== 'term_start' && td.event_type !== 'term_end') continue;
    const yr = td.academic_year || '';
    if (!byYear.has(yr)) byYear.set(yr, { starts: [], ends: [] });
    (td.event_type === 'term_start' ? byYear.get(yr).starts : byYear.get(yr).ends).push(td);
  }

  const terms = [];
  for (const [yr, { starts, ends }] of byYear) {
    starts.sort((a, b) => a.date.localeCompare(b.date));
    ends.sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 0; i < starts.length; i++) {
      const s = starts[i];
      const e = ends[i];
      if (!e) continue; // unpaired start - skip rather than guess an end
      // Always derive "<Season> Term <year>" rather than trust the imported
      // row label, which is often boilerplate like "Autumn Term starts" and
      // carries no year - so two academic years would collide into identical,
      // indistinguishable labels. The academic year makes each term unique.
      const label = `${seasonLabel(s.date)}${yr ? ` ${yr}` : ''}`;
      terms.push({ label, academic_year: yr, start_date: s.date, end_date: e.date });
    }
  }
  return terms.sort((a, b) => a.start_date.localeCompare(b.start_date));
}

/** The term whose window contains dateStr, or null. */
function currentTerm(terms = [], dateStr) {
  return terms.find((t) => dateStr >= t.start_date && dateStr <= t.end_date) || null;
}

/**
 * Is a weekly activity active on a given date? An activity with no window
 * (start_date and end_date both null) is "ongoing" and always active;
 * otherwise the date must fall within [start_date, end_date].
 */
function activityActiveOn(activity, dateStr) {
  if (!activity) return false;
  if (activity.start_date && dateStr < activity.start_date) return false;
  if (activity.end_date && dateStr > activity.end_date) return false;
  return true;
}

/**
 * Resolve which school's term calendar applies to a child. A child carries a
 * school_id only as a disambiguator - we only ask "which school?" when a
 * household has 2+ schools. So: prefer the child's explicit school_id; else, if
 * the household has exactly one school, use it; else null (ambiguous / none).
 *
 * @param {object} child - user row (may have school_id)
 * @param {Array} householdSchools - household_schools rows
 * @returns {string|null} schoolId
 */
function resolveTermSchoolForChild(child, householdSchools = []) {
  if (child?.school_id) return child.school_id;
  const schools = Array.isArray(householdSchools) ? householdSchools : [];
  return schools.length === 1 ? schools[0].id : null;
}

/** Fetch + derive the terms for a school. */
async function getSchoolTerms(schoolId) {
  try {
    const rows = await db.getSchoolTermDates(schoolId);
    return deriveTerms(rows || []);
  } catch (err) {
    console.error(`[school-terms] getSchoolTerms failed for ${schoolId}:`, err.message);
    return [];
  }
}

module.exports = {
  isSchoolInSession,
  deriveTerms,
  currentTerm,
  activityActiveOn,
  getSchoolTerms,
  resolveTermSchoolForChild,
  seasonLabel,
};
