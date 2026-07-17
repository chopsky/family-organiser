/**
 * Unit tests for the shared school term-dates directory service: identity
 * normalization, per-AY diffing, seeding/cross-check, arbitration verdict
 * application, system verification, and propagation. The db layer, AI client,
 * and extraction pipeline are mocked (mirrors laTermDatesImport.test.js).
 */
// Factory mocks (not automocks): automocking would require() the real db
// modules, which pull in db/client.js and throw without Supabase env vars.
jest.mock('../db/schoolDirectory', () => ({
  findDirectorySchool: jest.fn(),
  createDirectorySchool: jest.fn(),
  getDirectorySchoolDates: jest.fn(),
  replaceDirectoryDates: jest.fn(),
  updateDirectorySchool: jest.fn(),
  listDirectorySchools: jest.fn(),
  getDirectorySchoolBySlug: jest.fn(),
  getDirectorySchoolById: jest.fn(),
  getSchoolDirectoryStats: jest.fn(),
  listLinkedHouseholdSchools: jest.fn(),
  linkHouseholdSchoolToDirectory: jest.fn(),
  matchGiasByNamePostcode: jest.fn(),
  matchGiasByExactNameUnique: jest.fn(),
}));
jest.mock('../db/queries', () => ({
  updateHouseholdSchool: jest.fn(),
  deleteTermDatesBySchoolAndAcademicYear: jest.fn(),
  addSchoolTermDates: jest.fn(),
  updateHouseholdSchoolMeta: jest.fn(),
}));
jest.mock('./cache', () => ({ invalidate: jest.fn(), get: jest.fn(), set: jest.fn() }));
jest.mock('./ai-client', () => ({ callClaude: jest.fn(), REASONING_TIMEOUT_MS: 90000 }));
jest.mock('./term-date-extract', () => ({
  fetchTermDatesPageText: jest.fn(),
  extractTermDatesPreview: jest.fn(),
  academicYearsForCountry: jest.fn(() => ({ currentAY: '2025-2026', nextAY: '2026-2027' })),
}));

const dirDb = require('../db/schoolDirectory');
const db = require('../db/queries');
const cache = require('./cache');
const { callClaude } = require('./ai-client');
const { fetchTermDatesPageText, extractTermDatesPreview } = require('./term-date-extract');
const svc = require('./schoolDirectory');

const D = (ay, type, date, end = null) => ({ academic_year: ay, event_type: type, date, end_date: end, label: null });
const SCHOOL_ROW = {
  id: 'hs-1', school_name: 'Immanuel College', school_urn: '117659',
  postcode: 'WD23 4EB', local_authority: 'Hertfordshire', directory_school_id: null,
};
const DIR_SCHOOL = {
  id: 'dir-1', urn: '117659', name: 'Immanuel College', name_key: 'immanuel college',
  postcode: 'WD23 4EB', slug: 'immanuel-college-wd23-4eb', status: 'ok',
  source_type: 'website', source_url: 'https://school.example/term-dates',
  source_text: 'Autumn term starts Monday 1 September 2025', verified_count: 1,
  adopted_count: 0, last_imported_at: '2026-06-01T00:00:00Z', last_verified_at: null,
  country: 'GB',
};

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  jest.clearAllMocks();
  dirDb.findDirectorySchool.mockResolvedValue(null);
  dirDb.createDirectorySchool.mockImplementation(async (f) => ({ school: { id: 'dir-new', ...f }, created: true }));
  dirDb.getDirectorySchoolDates.mockResolvedValue([]);
  dirDb.replaceDirectoryDates.mockResolvedValue(0);
  dirDb.updateDirectorySchool.mockResolvedValue();
  dirDb.linkHouseholdSchoolToDirectory.mockResolvedValue(true);
  dirDb.listLinkedHouseholdSchools.mockResolvedValue([]);
  dirDb.matchGiasByNamePostcode.mockResolvedValue(null);
  dirDb.getDirectorySchoolById.mockResolvedValue(DIR_SCHOOL);
  db.updateHouseholdSchool.mockResolvedValue();
  db.deleteTermDatesBySchoolAndAcademicYear.mockResolvedValue();
  db.addSchoolTermDates.mockResolvedValue([]);
  db.updateHouseholdSchoolMeta.mockResolvedValue();
});

// ── Normalizers + identity ──────────────────────────────────────────────────

describe('normalizeNameKey / normalizePostcode', () => {
  test('punctuation, case and diacritics collapse', () => {
    expect(svc.normalizeNameKey("St. Mary's C of E Primary!")).toBe('st mary s c of e primary');
    expect(svc.normalizeNameKey('ST MARYS C OF E PRIMARY')).not.toBe(svc.normalizeNameKey("St. Mary's C of E Primary"));
    expect(svc.normalizeNameKey('Immanuel  College')).toBe('immanuel college');
  });
  test('postcode uppercases and re-spaces', () => {
    expect(svc.normalizePostcode('wd234eb')).toBe('WD23 4EB');
    expect(svc.normalizePostcode('WD23  4EB')).toBe('WD23 4EB');
    expect(svc.normalizePostcode('')).toBeNull();
  });
});

describe('schoolIdentity', () => {
  test('URN wins when present', () => {
    expect(svc.schoolIdentity(SCHOOL_ROW)).toEqual({ urn: '117659', nameKey: 'immanuel college', postcode: 'WD23 4EB' });
  });
  test('name+postcode fallback when no URN', () => {
    const id = svc.schoolIdentity({ ...SCHOOL_ROW, school_urn: null });
    expect(id.urn).toBeNull();
    expect(id.postcode).toBe('WD23 4EB');
  });
  test('no URN + no postcode → name-only shape (resolveIdentity decides linkability)', () => {
    const id = svc.schoolIdentity({ school_name: 'Highgate School', school_urn: null, postcode: null });
    expect(id).toEqual({ urn: null, nameKey: 'highgate school', postcode: null });
  });
});

describe('resolveIdentity', () => {
  test('name-only school + unique GIAS name match → adopts URN + postcode, heals row', async () => {
    dirDb.matchGiasByExactNameUnique.mockResolvedValue({ urn: '102163', postcode: 'N6 4AY', local_authority: 'Haringey' });
    const id = await svc.resolveIdentity({ id: 'hs-9', school_name: 'Highgate School', school_urn: null, postcode: null }, { heal: true });
    expect(id.urn).toBe('102163');
    expect(id.postcode).toBe('N6 4AY');
    expect(db.updateHouseholdSchool).toHaveBeenCalledWith('hs-9', expect.objectContaining({ school_urn: '102163', postcode: 'N6 4AY', local_authority: 'Haringey' }));
  });

  test('name-only school with NO unique GIAS match → null (never keys on bare name)', async () => {
    dirDb.matchGiasByExactNameUnique.mockResolvedValue(null);
    const id = await svc.resolveIdentity({ id: 'hs-9', school_name: 'St Marys', school_urn: null, postcode: null });
    expect(id).toBeNull();
  });

  test('postcode present → uses name+postcode match, not name-only', async () => {
    dirDb.matchGiasByNamePostcode.mockResolvedValue({ urn: '111', local_authority: null });
    const id = await svc.resolveIdentity({ id: 'hs-9', school_name: 'Some School', school_urn: null, postcode: 'AB1 2CD' });
    expect(id.urn).toBe('111');
    expect(dirDb.matchGiasByExactNameUnique).not.toHaveBeenCalled();
  });
});

describe('diffDateSets', () => {
  const stored = [D('2025-2026', 'term_start', '2025-09-01'), D('2025-2026', 'term_end', '2025-12-19')];
  test('identical after dedupe/ordering', () => {
    const d = svc.diffDateSets(stored, [...stored].reverse());
    expect(d.identical).toBe(true);
  });
  test('per-AY divergence detected', () => {
    const d = svc.diffDateSets(stored, [D('2025-2026', 'term_start', '2025-09-02'), D('2025-2026', 'term_end', '2025-12-19')]);
    expect(d.conflicts).toEqual(['2025-2026']);
  });
  test('stored-only AY is NOT a conflict; new-only AY is an addition', () => {
    const d = svc.diffDateSets(stored, [D('2026-2027', 'term_start', '2026-09-01')]);
    expect(d.conflicts).toEqual([]);
    expect(d.additions).toEqual(['2026-2027']);
    expect(d.identical).toBe(false);
  });
});

// ── Seeding / cross-check ───────────────────────────────────────────────────

describe('seedOrCrossCheck', () => {
  const dates = [D('2025-2026', 'term_start', '2025-09-01')];
  const args = { householdSchool: SCHOOL_ROW, dates, sourceUrl: 'https://school.example/term-dates', sourceText: 'text', sourceType: 'website', householdId: 'h1' };

  test('miss → creates record (verified_count 1) + dates + link', async () => {
    const res = await svc.seedOrCrossCheck(args);
    expect(res.action).toBe('seeded');
    expect(dirDb.createDirectorySchool).toHaveBeenCalledWith(expect.objectContaining({ urn: '117659', verified_count: 1, status: 'ok' }));
    expect(dirDb.replaceDirectoryDates).toHaveBeenCalledWith('dir-new', ['2025-2026'], expect.any(Array));
    expect(dirDb.linkHouseholdSchoolToDirectory).toHaveBeenCalledWith('hs-1', 'dir-new');
  });

  test('identical to stored → confirmed, verified_count bumped only when newly linked', async () => {
    dirDb.findDirectorySchool.mockResolvedValue(DIR_SCHOOL);
    dirDb.getDirectorySchoolDates.mockResolvedValue(dates);
    const res = await svc.seedOrCrossCheck(args);
    expect(res.action).toBe('confirmed');
    expect(dirDb.updateDirectorySchool).toHaveBeenCalledWith('dir-1', expect.objectContaining({ verified_count_increment: true }));

    jest.clearAllMocks();
    dirDb.findDirectorySchool.mockResolvedValue(DIR_SCHOOL);
    dirDb.getDirectorySchoolDates.mockResolvedValue(dates);
    dirDb.updateDirectorySchool.mockResolvedValue();
    dirDb.linkHouseholdSchoolToDirectory.mockResolvedValue(true);
    const res2 = await svc.seedOrCrossCheck({ ...args, householdSchool: { ...SCHOOL_ROW, directory_school_id: 'dir-1' } });
    expect(res2.action).toBe('confirmed');
    const update = dirDb.updateDirectorySchool.mock.calls[0][1];
    expect(update.verified_count_increment).toBeUndefined();
  });

  test('conflicting import → arbitrating; household import untouched', async () => {
    dirDb.findDirectorySchool.mockResolvedValue(DIR_SCHOOL);
    dirDb.getDirectorySchoolDates.mockResolvedValue([D('2025-2026', 'term_start', '2025-09-02')]);
    callClaude.mockResolvedValue({ text: '{"years":[]}' }); // background arbitration resolves harmlessly
    fetchTermDatesPageText.mockResolvedValue('page text');
    const res = await svc.seedOrCrossCheck(args);
    expect(res.action).toBe('arbitrating');
    expect(res.conflicts).toEqual(['2025-2026']);
    await flush();
  });

  test('GIAS backfill heals a manual school and its household row', async () => {
    dirDb.matchGiasByNamePostcode.mockResolvedValue({ urn: '999999', local_authority: 'Barnet' });
    const res = await svc.seedOrCrossCheck({ ...args, householdSchool: { ...SCHOOL_ROW, school_urn: null, local_authority: null } });
    expect(res.action).toBe('seeded');
    expect(db.updateHouseholdSchool).toHaveBeenCalledWith('hs-1', expect.objectContaining({ school_urn: '999999', local_authority: 'Barnet' }));
    expect(dirDb.createDirectorySchool).toHaveBeenCalledWith(expect.objectContaining({ urn: '999999' }));
  });

  test('db explosion → resolves { action: skipped }, never throws', async () => {
    dirDb.findDirectorySchool.mockRejectedValue(new Error('boom'));
    const res = await svc.seedOrCrossCheck(args);
    expect(res.action).toBe('skipped');
  });
});

// ── Arbitration verdict application ─────────────────────────────────────────

describe('arbitrate', () => {
  const stored = [D('2025-2026', 'term_start', '2025-09-02')];
  const fresh = [D('2025-2026', 'term_start', '2025-09-01')];
  const base = {
    directorySchool: DIR_SCHOOL, storedDates: stored, newDates: fresh,
    newSource: { url: 'https://new.example/dates', text: 'new text', type: 'website' },
    conflictYears: ['2025-2026'], additions: [],
  };
  beforeEach(() => {
    fetchTermDatesPageText.mockResolvedValue('fetched stored page');
    // The record holds dates, so propagation (which re-reads them) proceeds.
    dirDb.getDirectorySchoolDates.mockResolvedValue(stored);
  });

  test('new wins → replace won AYs, reset verified_count, propagate', async () => {
    callClaude.mockResolvedValue({ text: '{"years":[{"academic_year":"2025-2026","winner":"new","reason":"newer","evidence_quote":"1 September"}]}' });
    const res = await svc.arbitrate(base);
    expect(res.outcome).toBe('resolved');
    expect(dirDb.replaceDirectoryDates).toHaveBeenCalledWith('dir-1', ['2025-2026'], expect.any(Array));
    expect(dirDb.updateDirectorySchool).toHaveBeenCalledWith('dir-1', expect.objectContaining({ verified_count: 1, status: 'ok' }));
    expect(dirDb.listLinkedHouseholdSchools).toHaveBeenCalled(); // propagation ran
  });

  test('stored wins → record kept, propagation still runs (pulls importer back)', async () => {
    callClaude.mockResolvedValue({ text: '{"years":[{"academic_year":"2025-2026","winner":"stored","reason":"matches page","evidence_quote":"2 September"}]}' });
    const res = await svc.arbitrate(base);
    expect(res.outcome).toBe('resolved');
    expect(dirDb.replaceDirectoryDates).not.toHaveBeenCalled();
    expect(dirDb.listLinkedHouseholdSchools).toHaveBeenCalled();
  });

  test('undecidable → needs_attention, record untouched, NO propagation', async () => {
    callClaude.mockResolvedValue({ text: '{"years":[{"academic_year":"2025-2026","winner":"undecidable","reason":"not in texts","evidence_quote":null}]}' });
    const res = await svc.arbitrate(base);
    expect(res.outcome).toBe('undecidable');
    expect(dirDb.replaceDirectoryDates).not.toHaveBeenCalled();
    expect(dirDb.updateDirectorySchool).toHaveBeenCalledWith('dir-1', expect.objectContaining({ status: 'needs_attention' }));
    expect(dirDb.listLinkedHouseholdSchools).not.toHaveBeenCalled();
  });

  test('unparseable AI output → needs_attention, nothing destroyed', async () => {
    callClaude.mockResolvedValue({ text: 'I could not decide, sorry!' });
    const res = await svc.arbitrate(base);
    expect(res.outcome).toBe('undecidable');
    expect(dirDb.replaceDirectoryDates).not.toHaveBeenCalled();
    expect(dirDb.updateDirectorySchool).toHaveBeenCalledWith('dir-1', expect.objectContaining({ status: 'needs_attention' }));
  });
});

// ── Propagation ─────────────────────────────────────────────────────────────

describe('propagateDirectorySchoolDates', () => {
  test('per-AY replace with school_directory source + meta + cache per household', async () => {
    dirDb.getDirectorySchoolDates.mockResolvedValue([D('2025-2026', 'term_start', '2025-09-01'), D('2026-2027', 'term_start', '2026-09-01')]);
    dirDb.listLinkedHouseholdSchools.mockResolvedValue([{ id: 'hs-1', household_id: 'h1' }, { id: 'hs-2', household_id: 'h2' }]);
    const res = await svc.propagateDirectorySchoolDates('dir-1');
    expect(res.updated).toBe(2);
    expect(db.deleteTermDatesBySchoolAndAcademicYear).toHaveBeenCalledWith('hs-1', '2025-2026');
    expect(db.deleteTermDatesBySchoolAndAcademicYear).toHaveBeenCalledWith('hs-2', '2026-2027');
    const saved = db.addSchoolTermDates.mock.calls[0][1];
    expect(saved.every((r) => r.source === 'school_directory')).toBe(true);
    expect(db.updateHouseholdSchoolMeta).toHaveBeenCalledWith('hs-1', expect.objectContaining({ term_dates_source: 'school_directory' }));
    expect(cache.invalidate).toHaveBeenCalledWith('schools:h1');
    expect(cache.invalidate).toHaveBeenCalledWith('digest:h2');
  });

  test('one broken household does not block the rest', async () => {
    dirDb.getDirectorySchoolDates.mockResolvedValue([D('2025-2026', 'term_start', '2025-09-01')]);
    dirDb.listLinkedHouseholdSchools.mockResolvedValue([{ id: 'hs-bad', household_id: 'h1' }, { id: 'hs-ok', household_id: 'h2' }]);
    db.deleteTermDatesBySchoolAndAcademicYear.mockImplementation(async (id) => { if (id === 'hs-bad') throw new Error('boom'); });
    const res = await svc.propagateDirectorySchoolDates('dir-1');
    expect(res.updated).toBe(1);
  });
});

// ── System verification ─────────────────────────────────────────────────────

describe('verifyDirectorySchool', () => {
  test('PDF-seeded record → no-op (no fetch, no AI)', async () => {
    dirDb.getDirectorySchoolById.mockResolvedValue({ ...DIR_SCHOOL, source_type: 'pdf', source_url: 'termdates.pdf' });
    const res = await svc.verifyDirectorySchool('dir-1');
    expect(res.action).toBe('skipped');
    expect(fetchTermDatesPageText).not.toHaveBeenCalled();
  });

  test('fresh extraction matches → verified_count+1 + last_verified_at stamped', async () => {
    fetchTermDatesPageText.mockResolvedValue('page');
    extractTermDatesPreview.mockResolvedValue({ ok: true, body: { dates: [D('2025-2026', 'term_start', '2025-09-01')] } });
    dirDb.getDirectorySchoolDates.mockResolvedValue([D('2025-2026', 'term_start', '2025-09-01')]);
    const res = await svc.verifyDirectorySchool('dir-1');
    expect(res.action).toBe('verified');
    expect(dirDb.updateDirectorySchool).toHaveBeenCalledWith('dir-1', expect.objectContaining({ verified_count_increment: true, last_verified_at: expect.any(String) }));
  });

  test('fresh extraction diverges → arbitration path runs', async () => {
    fetchTermDatesPageText.mockResolvedValue('page');
    extractTermDatesPreview.mockResolvedValue({ ok: true, body: { dates: [D('2025-2026', 'term_start', '2025-09-08')] } });
    dirDb.getDirectorySchoolDates.mockResolvedValue([D('2025-2026', 'term_start', '2025-09-01')]);
    callClaude.mockResolvedValue({ text: '{"years":[{"academic_year":"2025-2026","winner":"stored","reason":"page says 1 Sep","evidence_quote":"1 September"}]}' });
    const res = await svc.verifyDirectorySchool('dir-1');
    expect(res.action).toBe('arbitrated');
    expect(callClaude).toHaveBeenCalledTimes(1);
  });

  test('fetch failure → stamped + noted, nothing destroyed', async () => {
    fetchTermDatesPageText.mockRejectedValue(new Error('HTTP 500'));
    const res = await svc.verifyDirectorySchool('dir-1');
    expect(res.action).toBe('failed');
    expect(dirDb.updateDirectorySchool).toHaveBeenCalledWith('dir-1', expect.objectContaining({ last_verified_at: expect.any(String) }));
    expect(dirDb.replaceDirectoryDates).not.toHaveBeenCalled();
  });
});

describe('maybeVerifyDirectorySchool gating', () => {
  test('never-verified → fires; freshly-verified → does not', () => {
    expect(svc.maybeVerifyDirectorySchool({ ...DIR_SCHOOL, last_verified_at: null })).toBe(true);
    expect(svc.maybeVerifyDirectorySchool({ ...DIR_SCHOOL, last_verified_at: new Date().toISOString() })).toBe(false);
  });
  test('stale (>90d) → fires', () => {
    const old = new Date(Date.now() - 120 * 86400000).toISOString();
    expect(svc.maybeVerifyDirectorySchool({ ...DIR_SCHOOL, last_verified_at: old })).toBe(true);
  });
});
