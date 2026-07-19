/**
 * school-add service tests: governance classification (the never-guess rule)
 * and the outcome branching of addConfirmedSchool with all IO mocked.
 */
jest.mock('../db/queries', () => ({
  searchSchools: jest.fn(),
  getHouseholdSchoolByUrn: jest.fn(() => Promise.resolve(null)),
  createHouseholdSchool: jest.fn((hid, d) => Promise.resolve({ id: 'sc1', household_id: hid, ...d })),
  getCachedLATermDates: jest.fn(() => Promise.resolve(null)),
  cacheLATermDates: jest.fn(() => Promise.resolve()),
  deleteAllTermDatesBySchool: jest.fn(() => Promise.resolve()),
  deleteTermDatesBySchoolAndAcademicYear: jest.fn(() => Promise.resolve()),
  addSchoolTermDates: jest.fn(() => Promise.resolve([])),
  updateHouseholdSchoolMeta: jest.fn(() => Promise.resolve()),
}));
jest.mock('../db/laTermDates', () => ({
  getDirectoryTermDatesByName: jest.fn(() => Promise.resolve([])),
}));
jest.mock('../db/schoolDirectory', () => ({
  linkHouseholdSchoolToDirectory: jest.fn(() => Promise.resolve()),
  updateDirectorySchool: jest.fn(() => Promise.resolve()),
}));
jest.mock('./schoolDirectory', () => ({
  lookupDirectoryDatesForSchool: jest.fn(() => Promise.resolve(null)),
  maybeVerifyDirectorySchool: jest.fn(),
  seedOrCrossCheck: jest.fn(),
}));
jest.mock('./cache', () => ({ invalidate: jest.fn() }));
jest.mock('./ai', () => ({ findOfficialTermDatesUrl: jest.fn() }));
jest.mock('./term-date-extract', () => ({
  extractTermDatesPreview: jest.fn(),
  fetchTermDatesPageText: jest.fn(),
}));

const schoolAdd = require('./school-add');
const db = require('../db/queries');
const laDb = require('../db/laTermDates');
const schoolDirectory = require('./schoolDirectory');

beforeEach(() => {
  jest.clearAllMocks();
  // clearAllMocks keeps mockResolvedValue implementations - re-pin the
  // defaults so per-test overrides never leak into the next test.
  db.getHouseholdSchoolByUrn.mockResolvedValue(null);
  db.getCachedLATermDates.mockResolvedValue(null);
  laDb.getDirectoryTermDatesByName.mockResolvedValue([]);
  schoolDirectory.lookupDirectoryDatesForSchool.mockResolvedValue(null);
});

describe('followsCouncilDates', () => {
  test('LA-maintained types follow council dates', () => {
    expect(schoolAdd.followsCouncilDates('Community school')).toBe(true);
    expect(schoolAdd.followsCouncilDates('Voluntary aided school')).toBe(true);
    expect(schoolAdd.followsCouncilDates('Foundation school')).toBe(true);
  });
  test('academies, free schools, independents and unknowns do NOT (safe direction)', () => {
    expect(schoolAdd.followsCouncilDates('Academy converter')).toBe(false);
    expect(schoolAdd.followsCouncilDates('Academy sponsor led')).toBe(false);
    expect(schoolAdd.followsCouncilDates('Free school')).toBe(false);
    expect(schoolAdd.followsCouncilDates('Other independent school')).toBe(false);
    expect(schoolAdd.followsCouncilDates('')).toBe(false);
    expect(schoolAdd.followsCouncilDates(null)).toBe(false);
    expect(schoolAdd.followsCouncilDates('Something brand new from GIAS')).toBe(false);
  });
});

describe('addConfirmedSchool branches', () => {
  const base = { householdId: 'h1', userId: 'u1' };
  const council = { urn: 1, name: 'Ashfield Primary School', type: 'Community school', local_authority: 'Leeds', postcode: 'LS12' };
  const academy = { urn: 2, name: "St Bede's Academy", type: 'Academy converter', local_authority: 'York', postcode: 'YO1' };

  test('council school with LA-directory dates → la_imported, full clean replace', async () => {
    laDb.getDirectoryTermDatesByName.mockResolvedValue([
      { event_type: 'term_start', date: '2026-09-07', academic_year: '2026-2027' },
      { event_type: 'half_term_start', date: '2026-10-26', academic_year: '2026-2027' },
    ]);
    const out = await schoolAdd.addConfirmedSchool({ ...base, gias: council });
    expect(out.outcome).toBe('la_imported');
    expect(out.imported).toBe(2);
    expect(out.years).toEqual(['2026-2027']);
    expect(db.deleteAllTermDatesBySchool).toHaveBeenCalledWith('sc1');
    expect(db.addSchoolTermDates).toHaveBeenCalledWith('sc1', expect.arrayContaining([
      expect.objectContaining({ source: 'local_authority' }),
    ]));
    // uses_la_dates flows from governance
    expect(db.createHouseholdSchool).toHaveBeenCalledWith('h1', expect.objectContaining({ uses_la_dates: true }));
  });

  test('academy with directory hit → directory_adopted, adoption counted', async () => {
    schoolDirectory.lookupDirectoryDatesForSchool.mockResolvedValue({
      school: { id: 'dir1' },
      dates: [{ event_type: 'term_start', date: '2026-09-02', academic_year: '2026-2027' }],
    });
    const out = await schoolAdd.addConfirmedSchool({ ...base, gias: academy });
    expect(out.outcome).toBe('directory_adopted');
    expect(out.imported).toBe(1);
    expect(db.addSchoolTermDates).toHaveBeenCalledWith('sc1', expect.arrayContaining([
      expect.objectContaining({ source: 'school_directory' }),
    ]));
    expect(schoolDirectory.maybeVerifyDirectorySchool).toHaveBeenCalled();
    // NEVER imports council dates for an own-calendar school
    expect(laDb.getDirectoryTermDatesByName).not.toHaveBeenCalled();
  });

  test('academy with nothing on file → needs_source, no dates written', async () => {
    const out = await schoolAdd.addConfirmedSchool({ ...base, gias: academy });
    expect(out.outcome).toBe('needs_source');
    expect(db.addSchoolTermDates).not.toHaveBeenCalled();
    expect(db.createHouseholdSchool).toHaveBeenCalledWith('h1', expect.objectContaining({ uses_la_dates: false }));
  });

  test('council import failure degrades to needs_source with a friendly reason - school still created', async () => {
    const { findOfficialTermDatesUrl } = require('./ai');
    findOfficialTermDatesUrl.mockResolvedValue(null); // no council page found
    const out = await schoolAdd.addConfirmedSchool({ ...base, gias: council });
    expect(out.outcome).toBe('needs_source');
    expect(out.reason).toMatch(/couldn't find Leeds/);
    expect(db.createHouseholdSchool).toHaveBeenCalled();
  });

  test('existing school by URN is reused, not duplicated', async () => {
    db.getHouseholdSchoolByUrn.mockResolvedValue({ id: 'existing', school_name: 'Ashfield Primary School', local_authority: 'Leeds' });
    laDb.getDirectoryTermDatesByName.mockResolvedValue([
      { event_type: 'term_start', date: '2026-09-07', academic_year: '2026-2027' },
    ]);
    const out = await schoolAdd.addConfirmedSchool({ ...base, gias: council });
    expect(db.createHouseholdSchool).not.toHaveBeenCalled();
    expect(out.school.id).toBe('existing');
  });
});
