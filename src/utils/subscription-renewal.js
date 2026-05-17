/**
 * Pure helpers for computing subscription renewal dates.
 *
 * Both helpers operate on YYYY-MM-DD strings (the column type is `date`,
 * not `timestamptz`) and avoid Date arithmetic across DST boundaries
 * by working in calendar arithmetic only.
 */

function pad(n) { return String(n).padStart(2, '0'); }

function ymd(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function clampDay(year, month0, day) {
  // month0 is 0-indexed (JS convention). Last day of month is
  // new Date(year, month0 + 1, 0).getDate().
  const lastDay = new Date(year, month0 + 1, 0).getDate();
  return Math.min(day, lastDay);
}

/**
 * Compute the first renewal date for a new subscription given its
 * cadence. Returns the NEXT occurrence on or after "today".
 *
 * @param {string} todayYmd - YYYY-MM-DD baseline
 * @param {object} spec - { recurrence, renewal_day_of_month, renewal_month }
 * @returns {string} YYYY-MM-DD
 */
function computeNextRenewal(todayYmd, spec) {
  const [ty, tm, td] = todayYmd.split('-').map(Number);
  if (spec.recurrence === 'monthly') {
    const day = spec.renewal_day_of_month || 1;
    let year = ty;
    let month = tm; // 1-12
    // Try this month. If the resolved date is before today, roll forward one.
    const thisMonthDay = clampDay(year, month - 1, day);
    if (thisMonthDay >= td) return `${year}-${pad(month)}-${pad(thisMonthDay)}`;
    month += 1;
    if (month > 12) { month = 1; year += 1; }
    const nextMonthDay = clampDay(year, month - 1, day);
    return `${year}-${pad(month)}-${pad(nextMonthDay)}`;
  }
  // yearly
  const targetMonth = spec.renewal_month || 1;
  const targetDay = spec.renewal_day_of_month || 1;
  let year = ty;
  const thisYearDay = clampDay(year, targetMonth - 1, targetDay);
  const thisYearStr = `${year}-${pad(targetMonth)}-${pad(thisYearDay)}`;
  if (thisYearStr >= todayYmd) return thisYearStr;
  year += 1;
  const nextYearDay = clampDay(year, targetMonth - 1, targetDay);
  return `${year}-${pad(targetMonth)}-${pad(nextYearDay)}`;
}

/**
 * Advance an existing next_renewal_at by one period. Used by the cron
 * after a renewal date passes (so we don't keep nudging for the same
 * date forever).
 */
function advanceRenewal(currentYmd, recurrence) {
  const [y, m, d] = currentYmd.split('-').map(Number);
  if (recurrence === 'monthly') {
    let nm = m + 1;
    let ny = y;
    if (nm > 12) { nm = 1; ny += 1; }
    return `${ny}-${pad(nm)}-${pad(clampDay(ny, nm - 1, d))}`;
  }
  // yearly
  return `${y + 1}-${pad(m)}-${pad(clampDay(y + 1, m - 1, d))}`;
}

module.exports = { computeNextRenewal, advanceRenewal, ymd };
