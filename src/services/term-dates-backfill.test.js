/**
 * Term-dates backfill: the sweep that fulfils "use my council's dates" for
 * schools where the import never ran. Source order matters (the school's own
 * directory dates beat the council's generic calendar), independents never
 * receive council dates, and one broken school never aborts the sweep.
 */
jest.mock('../db/queries', () => ({
  getSchoolsWithNoTermDates: jest.fn(),
  getLaSourcedSchoolsWithStaleDates: jest.fn(() => Promise.resolve([])),
  deleteAllTermDatesBySchool: jest.fn(() => Promise.resolve()),
  addSchoolTermDates: jest.fn(() => Promise.resolve([])),
  updateHouseholdSchoolMeta: jest.fn(() => Promise.resolve()),
  getCachedLATermDates: jest.fn(() => Promise.resolve(null)),
}));
jest.mock('../db/schoolDirectory', () => ({
  linkHouseholdSchoolToDirectory: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../db/laTermDates', () => ({
  getDirectoryTermDatesByName: jest.fn(() => Promise.resolve([])),
}));
jest.mock('./schoolDirectory', () => ({
  lookupDirectoryDatesForSchool: jest.fn(() => Promise.resolve(null)),
  propagateDirectorySchoolDates: jest.fn(() => Promise.resolve({ updated: 1 })),
}));
jest.mock('./cache', () => ({ invalidate: jest.fn() }));

const db = require('../db/queries');
const dirDb = require('../db/schoolDirectory');
const laDb = require('../db/laTermDates');
const { lookupDirectoryDatesForSchool, propagateDirectorySchoolDates } = require('./schoolDirectory');
const { backfillEmptyTermDates, backfillSchoolTermDates } = require('./term-dates-backfill');

// A live year well past any "finished academic year" filter.
const Y = new Date().getFullYear() + 1;
const AY = `${Y}-${Y + 1}`;
const LA_DATES = [
  { academic_year: AY, event_type: 'term_start', date: `${Y}-09-02`, end_date: null, label: 'Autumn term starts' },
  { academic_year: AY, event_type: 'term_end', date: `${Y}-12-19`, end_date: null, label: 'Autumn term ends' },
];

const SCHOOL = {
  id: 's1', household_id: 'h1', school_name: 'Rosh Pinah Primary School',
  school_urn: '101340', school_type: 'voluntary_aided', local_authority: 'Barnet', uses_la_dates: true,
};

beforeEach(() => {
  jest.clearAllMocks();
  // mockResolvedValue survives clearAllMocks - re-prime the defaults so one
  // test's stub can't bleed into the next.
  lookupDirectoryDatesForSchool.mockResolvedValue(null);
  db.getSchoolsWithNoTermDates.mockResolvedValue([]);
  db.getLaSourcedSchoolsWithStaleDates.mockResolvedValue([]);
  propagateDirectorySchoolDates.mockResolvedValue({ updated: 1 });
  dirDb.linkHouseholdSchoolToDirectory.mockResolvedValue(true);
  laDb.getDirectoryTermDatesByName.mockResolvedValue([]);
  db.getCachedLATermDates.mockResolvedValue(null);
  db.deleteAllTermDatesBySchool.mockResolvedValue();
  db.addSchoolTermDates.mockResolvedValue([]);
  db.updateHouseholdSchoolMeta.mockResolvedValue();
});

test('directory hit wins: links the school and propagates, no LA fallback', async () => {
  lookupDirectoryDatesForSchool.mockResolvedValue({ school: { id: 'dir-1' }, dates: LA_DATES });

  const r = await backfillSchoolTermDates(SCHOOL);

  expect(r).toEqual({ filled: true, source: 'school_directory', count: 2 });
  expect(dirDb.linkHouseholdSchoolToDirectory).toHaveBeenCalledWith('s1', 'dir-1');
  expect(propagateDirectorySchoolDates).toHaveBeenCalledWith('dir-1');
  expect(laDb.getDirectoryTermDatesByName).not.toHaveBeenCalled();
});

test('LA directory fills when the school directory has nothing', async () => {
  laDb.getDirectoryTermDatesByName.mockResolvedValue(LA_DATES);

  const r = await backfillSchoolTermDates(SCHOOL);

  expect(r).toEqual({ filled: true, source: 'la_directory', count: 2 });
  expect(db.addSchoolTermDates).toHaveBeenCalledWith('s1', [
    expect.objectContaining({ date: `${Y}-09-02`, source: 'local_authority' }),
    expect.objectContaining({ date: `${Y}-12-19`, source: 'local_authority' }),
  ]);
  expect(db.updateHouseholdSchoolMeta).toHaveBeenCalledWith('s1', expect.objectContaining({
    term_dates_source: 'local_authority',
  }));
});

test('scrape cache is the last resort', async () => {
  db.getCachedLATermDates.mockResolvedValue(LA_DATES);

  const r = await backfillSchoolTermDates(SCHOOL);

  expect(r).toEqual({ filled: true, source: 'la_cache', count: 2 });
});

test('an independent school NEVER receives council dates', async () => {
  laDb.getDirectoryTermDatesByName.mockResolvedValue(LA_DATES);
  db.getCachedLATermDates.mockResolvedValue(LA_DATES);

  const r = await backfillSchoolTermDates({ ...SCHOOL, school_type: 'independent' });

  expect(r).toEqual({ filled: false, reason: 'independent_school' });
  expect(db.addSchoolTermDates).not.toHaveBeenCalled();
});

test('a school with no LA (a nursery) skips the council paths cleanly', async () => {
  const r = await backfillSchoolTermDates({ ...SCHOOL, local_authority: null });
  expect(r).toEqual({ filled: false, reason: 'no_local_authority' });
});

test('an LA-sourced school with only PAST dates is refreshed by the sweep (the Hopwood case)', async () => {
  db.getSchoolsWithNoTermDates.mockResolvedValue([]);
  db.getLaSourcedSchoolsWithStaleDates.mockResolvedValue([
    { ...SCHOOL, id: 's-stale', school_name: 'Hopwood Community Primary', term_dates_source: 'local_authority' },
  ]);
  laDb.getDirectoryTermDatesByName.mockResolvedValue(LA_DATES);

  const result = await backfillEmptyTermDates();

  expect(result.filled).toHaveLength(1);
  expect(result.filled[0]).toMatchObject({ school: 'Hopwood Community Primary', refresh: true, source: 'la_directory' });
  // Full clean replace: the expired rows go, the live year lands.
  expect(db.deleteAllTermDatesBySchool).toHaveBeenCalledWith('s-stale');
});

test('the sweep survives one broken school and reports the tally', async () => {
  db.getSchoolsWithNoTermDates.mockResolvedValue([
    SCHOOL,
    { ...SCHOOL, id: 's2', school_name: 'Broken School' },
  ]);
  lookupDirectoryDatesForSchool
    .mockResolvedValueOnce({ school: { id: 'dir-1' }, dates: LA_DATES })
    .mockRejectedValueOnce(new Error('boom'));

  const result = await backfillEmptyTermDates();

  expect(result.considered).toBe(2);
  expect(result.filled).toHaveLength(1);
  expect(result.skipped).toHaveLength(1);
  expect(result.skipped[0].school).toBe('Broken School');
});

test('a year holding only bank holidays is NOT applied (the Bexley case)', async () => {
  laDb.getDirectoryTermDatesByName.mockResolvedValue([
    { academic_year: AY, event_type: 'bank_holiday', date: `${Y}-12-25`, end_date: null, label: 'Christmas Day' },
    { academic_year: AY, event_type: 'bank_holiday', date: `${Y}-12-28`, end_date: null, label: 'Boxing Day (sub)' },
  ]);

  const r = await backfillSchoolTermDates(SCHOOL);

  expect(db.addSchoolTermDates).not.toHaveBeenCalled();
  expect(r.filled).toBe(false);
});

test('a year with no FUTURE term boundary is NOT applied, even mid-summer-holiday (the Essex case)', async () => {
  const past = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const future = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
  laDb.getDirectoryTermDatesByName.mockResolvedValue([
    { academic_year: 'X', event_type: 'term_start', date: past, end_date: null, label: 'started long ago' },
    { academic_year: 'X', event_type: 'term_end', date: past, end_date: null, label: 'ended long ago' },
    // Both of these are genuinely still running/upcoming, but neither can
    // answer "when does school go back" - the year is dead for a new family.
    { academic_year: 'X', event_type: 'half_term_start', date: past, end_date: future, label: 'Summer holiday' },
    { academic_year: 'X', event_type: 'bank_holiday', date: future, end_date: null, label: 'August bank holiday' },
  ]);

  const r = await backfillSchoolTermDates(SCHOOL);

  expect(db.addSchoolTermDates).not.toHaveBeenCalled();
  expect(r.filled).toBe(false);
});

test('finished academic years are not resurrected onto the school', async () => {
  const finished = [
    { academic_year: '2024-2025', event_type: 'term_start', date: '2024-09-02', end_date: null, label: 'old' },
    { academic_year: '2024-2025', event_type: 'term_end', date: '2025-07-18', end_date: null, label: 'old end' },
  ];
  laDb.getDirectoryTermDatesByName.mockResolvedValue(finished);

  const r = await backfillSchoolTermDates(SCHOOL);

  // Everything the LA directory held is dead history → nothing applied,
  // and the cache fallback gets its chance instead.
  expect(db.addSchoolTermDates).not.toHaveBeenCalled();
  expect(r.filled).toBe(false);
});
