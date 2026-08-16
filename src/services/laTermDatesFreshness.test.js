/**
 * Unit tests for the term-dates freshness classifier - the data-shape check
 * that catches what import status can't (a council at status 'ok' whose
 * stored dates are already over, missing, or cut short).
 */
const { classifyFreshness } = require('./laTermDatesFreshness');

// Late season (August): families plan September, so 2026-2027 is in focus.
const AUG = { today: '2026-08-16', currentAY: '2025-2026', nextAY: '2026-2027' };
// Off season (November, after the AY label rolls): current year is in focus.
const NOV = { today: '2026-11-10', currentAY: '2026-2027', nextAY: '2027-2028' };

const row = (academic_year, date, end_date = null) => ({ academic_year, date, end_date });

const healthyNext = [
  row('2026-2027', '2026-09-01'),
  row('2026-2027', '2026-10-26', '2026-10-30'),
  row('2026-2027', '2027-07-21'),
];

describe('classifyFreshness', () => {
  test('no rows at all → all_past', () => {
    expect(classifyFreshness([], AUG)).toMatchObject({ problem: 'all_past' });
  });

  test('the Barnet failure: every date over, despite any import status', () => {
    const rows = [row('2025-2026', '2025-09-01'), row('2025-2026', '2026-07-20')];
    expect(classifyFreshness(rows, AUG)).toMatchObject({ problem: 'all_past' });
  });

  test('a range row keeps a council alive by its END date', () => {
    // Summer holiday range straddling today: date is past, end_date is not.
    const rows = [...healthyNext, row('2025-2026', '2026-07-22', '2026-08-31')];
    expect(classifyFreshness(rows, AUG)).toBeNull();
  });

  test('late season: current-year-only data is missing the year in focus', () => {
    const rows = [row('2025-2026', '2025-09-01'), row('2025-2026', '2026-08-25', '2026-08-31')];
    expect(classifyFreshness(rows, AUG)).toMatchObject({ problem: 'missing_year', detail: expect.stringContaining('2026-2027') });
  });

  test('truncated: the in-focus year stops before its own summer', () => {
    const rows = [row('2026-2027', '2026-09-01'), row('2026-2027', '2027-03-25')];
    expect(classifyFreshness(rows, AUG)).toMatchObject({ problem: 'truncated', detail: expect.stringContaining('2027-03-25') });
  });

  test('healthy in-focus year → null', () => {
    expect(classifyFreshness(healthyNext, AUG)).toBeNull();
  });

  test('off season: current year healthy, next year absent → still null', () => {
    // In November nobody expects 2027-2028 to be published yet.
    expect(classifyFreshness(healthyNext, NOV)).toBeNull();
  });

  test('off season: current year truncated is still flagged', () => {
    const rows = [row('2026-2027', '2026-09-01'), row('2026-2027', '2026-12-18')];
    expect(classifyFreshness(rows, NOV)).toMatchObject({ problem: 'truncated' });
  });
});
