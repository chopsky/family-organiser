/**
 * dropFinishedAcademicYears — the guard that stops a shared directory record
 * ageing into a liability.
 *
 * A directory entry is seeded once and adopted by families for years
 * afterwards. Without this, a household joining in 2026 inherits 2025's
 * holidays, and every later correction propagates them back.
 */
jest.mock('../db/queries', () => ({ getSchoolTermDates: jest.fn() }));

const { dropFinishedAcademicYears, isSchoolInSession } = require('./school-terms');

const AY25 = '2025-2026';
const AY26 = '2026-2027';
const rows = [
  { event_type: 'term_start', date: '2025-09-03', academic_year: AY25 },
  { event_type: 'half_term_start', date: '2025-10-27', end_date: '2025-10-31', academic_year: AY25 },
  { event_type: 'term_end', date: '2026-07-17', academic_year: AY25 },
  { event_type: 'term_start', date: '2026-09-02', academic_year: AY26 },
  { event_type: 'term_end', date: '2027-07-16', academic_year: AY26 },
];

it('drops a year that is entirely behind us', () => {
  const kept = dropFinishedAcademicYears(rows, '2026-07-29');
  expect(kept.map((r) => r.academic_year)).toEqual([AY26, AY26]);
});

it('keeps a year that is still running, past dates and all', () => {
  // Mid-January: autumn term is over but the year is not, and its term_start
  // is what pairs with the summer term_end.
  const kept = dropFinishedAcademicYears(rows, '2026-01-15');
  expect(kept).toHaveLength(5);
});

it('keeps a year until its last day has passed, not its last start', () => {
  expect(dropFinishedAcademicYears(rows, '2026-07-17')).toHaveLength(5);
  expect(dropFinishedAcademicYears(rows, '2026-07-18')).toHaveLength(2);
});

it('leaves a year alone when its rows carry no usable date', () => {
  const undated = [{ event_type: 'inset_day', academic_year: 'unknown' }];
  expect(dropFinishedAcademicYears(undated, '2030-01-01')).toHaveLength(1);
});

it('returns nothing when every year is over - the caller treats that as no offer', () => {
  expect(dropFinishedAcademicYears(rows, '2030-01-01')).toEqual([]);
});

it('handles an empty or missing set', () => {
  expect(dropFinishedAcademicYears([], '2026-07-29')).toEqual([]);
  expect(dropFinishedAcademicYears(null, '2026-07-29')).toEqual([]);
});

/**
 * The reason this filters whole years and never individual rows: term windows
 * are derived by pairing the Nth start with the Nth end. Drop one past start
 * and every later pair shifts, so a date in the summer holidays starts
 * reporting as term time - and activity reminders fire through the break.
 */
it('leaves term start/end pairing intact', async () => {
  const db = require('../db/queries');
  const kept = dropFinishedAcademicYears(rows, '2026-07-29');
  db.getSchoolTermDates.mockResolvedValue(kept);

  await expect(isSchoolInSession('s1', '2026-10-01')).resolves.toBe(true);   // in term
  await expect(isSchoolInSession('s1', '2027-08-01')).resolves.toBe(false);  // summer holidays
});
