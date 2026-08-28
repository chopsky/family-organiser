/**
 * Extraction dedupe: synced term dates and existing rows must block
 * re-creation; ordinary events must pass; lookups failing must fail OPEN.
 */

jest.mock('../db/queries', () => ({
  getHouseholdSchools: jest.fn(),
  getTermDatesBySchoolIds: jest.fn(),
  getCalendarEvents: jest.fn(),
}));

const db = require('../db/queries');
const { findExtractionDuplicates, skippedLine } = require('./event-dedupe');

const HH = 'hh-1';

describe('findExtractionDuplicates', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.getHouseholdSchools.mockResolvedValue([{ id: 'school-1' }]);
    db.getTermDatesBySchoolIds.mockResolvedValue([
      { date: '2026-10-26', end_date: '2026-10-30', label: 'Half Term' },
      { date: '2026-09-01', end_date: null, label: 'INSET DAY' },
    ]);
    db.getCalendarEvents.mockResolvedValue([
      { title: 'SCHOOL CLOSED YK', start_time: '2026-09-21T00:00:00Z' },
    ]);
  });

  test('term-structure titles inside synced ranges are duplicates', async () => {
    const verdicts = await findExtractionDuplicates(HH, [
      { title: 'Half Term', date: '2026-10-26' },
      { title: 'Half Term', date: '2026-10-30' },
      { title: 'Inset days', date: '2026-09-01' },
    ]);
    expect(verdicts).toEqual(['term_dates', 'term_dates', 'term_dates']);
  });

  test('an ordinary event ON a term date still creates', async () => {
    const verdicts = await findExtractionDuplicates(HH, [
      { title: 'Nursery seed event', date: '2026-10-26' },
    ]);
    expect(verdicts).toEqual([null]);
  });

  test('term-structure title OUTSIDE synced ranges still creates', async () => {
    const verdicts = await findExtractionDuplicates(HH, [
      { title: 'Half Term', date: '2026-12-21' },
    ]);
    expect(verdicts).toEqual([null]);
  });

  test('same normalised title on the same day is a duplicate (re-sent photo)', async () => {
    db.getCalendarEvents.mockResolvedValue([
      { title: '5M assembly', start_time: '2026-10-21T08:20:00Z' },
    ]);
    const verdicts = await findExtractionDuplicates(HH, [
      { title: '5M Assembly', date: '2026-10-21' },
      { title: '5M assembly', date: '2026-10-22' },
    ]);
    expect(verdicts).toEqual(['existing', null]);
  });

  test('lookup failures fail open - nothing is called a duplicate', async () => {
    db.getHouseholdSchools.mockRejectedValue(new Error('db down'));
    db.getCalendarEvents.mockRejectedValue(new Error('db down'));
    const verdicts = await findExtractionDuplicates(HH, [
      { title: 'Half Term', date: '2026-10-26' },
    ]);
    expect(verdicts).toEqual([null]);
  });
});

describe('skippedLine', () => {
  test('mentions term dates only when they were the reason', () => {
    expect(skippedLine(7, true)).toContain('term dates');
    expect(skippedLine(2, false)).not.toContain('term dates');
    expect(skippedLine(0, true)).toBeNull();
  });
});
