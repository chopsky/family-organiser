/**
 * Unit tests for the LA term-dates importer's outcome classification.
 * The pipeline steps (direct fetch/extract + search fallback) and the DB layer
 * are mocked, so this exercises the two-tier ok / partial / failed decision
 * logic, provenance (direct vs search), and persistence shape in isolation.
 */
jest.mock('./ai');
jest.mock('./term-date-extract');
jest.mock('./termDateValidator');
jest.mock('../db/laTermDates');

const { findOfficialTermDatesUrl, extractTermDatesViaSearch } = require('./ai');
const { fetchTermDatesPageText, extractTermDatesPreview, academicYearsForCountry } = require('./term-date-extract');
const { validateTermDates } = require('./termDateValidator');
const laDb = require('../db/laTermDates');
const { importAuthority, dedupeDates } = require('./laTermDatesImport');

const AYS = { currentAY: '2025-2026', nextAY: '2026-2027' };
const LA = { id: 'la-1', name: 'Barnet', slug: 'barnet' };

function lastStatus() {
  const calls = laDb.updateAuthorityStatus.mock.calls;
  return calls[calls.length - 1][1];
}

beforeEach(() => {
  jest.clearAllMocks();
  academicYearsForCountry.mockReturnValue(AYS);
  laDb.updateAuthorityStatus.mockResolvedValue();
  laDb.replaceEntriesForLA.mockResolvedValue(0);
  validateTermDates.mockImplementation((rows) => rows); // passthrough
  extractTermDatesViaSearch.mockResolvedValue([]); // no fallback dates unless a test sets them
});

describe('importAuthority', () => {
  test('no URL + no search results → failed, nothing persisted', async () => {
    findOfficialTermDatesUrl.mockResolvedValue(null);

    const res = await importAuthority(LA, AYS);

    expect(res.status).toBe('failed');
    expect(fetchTermDatesPageText).not.toHaveBeenCalled();
    expect(extractTermDatesViaSearch).toHaveBeenCalled(); // fallback still attempted
    expect(laDb.replaceEntriesForLA).not.toHaveBeenCalled();
    expect(lastStatus().error).toMatch(/web search/i);
    expect(lastStatus().import_method).toBeNull();
  });

  test('current-year dates from the direct page → ok, method "direct"', async () => {
    findOfficialTermDatesUrl.mockResolvedValue('https://barnet.gov.uk/term-dates');
    fetchTermDatesPageText.mockResolvedValue('lots of page text');
    extractTermDatesPreview.mockResolvedValue({
      ok: true,
      body: {
        dates: [
          { event_type: 'term_start', date: '2025-09-03', academic_year: '2025-2026', label: 'Autumn term' },
          { event_type: 'term_end', date: '2025-12-19', academic_year: '2025-2026', label: 'End of autumn' },
        ],
      },
    });

    const res = await importAuthority(LA, AYS);

    expect(res.status).toBe('ok');
    expect(res.method).toBe('direct');
    expect(extractTermDatesViaSearch).not.toHaveBeenCalled(); // direct succeeded, no fallback
    expect(laDb.replaceEntriesForLA).toHaveBeenCalledWith('la-1', ['2025-2026', '2026-2027'], expect.any(Array));
    expect(lastStatus()).toMatchObject({ status: 'ok', import_method: 'direct', date_count: 2 });
    expect(lastStatus().last_imported_at).toBeDefined();
  });

  test('direct fetch blocked (WAF) but search recovers → ok, method "search"', async () => {
    findOfficialTermDatesUrl.mockResolvedValue('https://barnet.gov.uk/term-dates');
    fetchTermDatesPageText.mockRejectedValue(new Error('That page is protected by bot-detection.'));
    extractTermDatesViaSearch.mockResolvedValue([
      { event_type: 'term_start', date: '2025-09-01', academic_year: '2025-2026', label: 'Autumn term', source_quote: 'Monday 1 September' },
    ]);

    const res = await importAuthority(LA, AYS);

    expect(res.status).toBe('ok');
    expect(res.method).toBe('search');
    expect(validateTermDates).toHaveBeenCalled();
    expect(laDb.replaceEntriesForLA).toHaveBeenCalledWith('la-1', ['2025-2026', '2026-2027'], expect.any(Array));
    expect(lastStatus()).toMatchObject({ status: 'ok', import_method: 'search', source_url: 'https://barnet.gov.uk/term-dates' });
  });

  test('direct zero-extract AND empty search → failed with the direct reason', async () => {
    findOfficialTermDatesUrl.mockResolvedValue('https://barnet.gov.uk/term-dates');
    fetchTermDatesPageText.mockResolvedValue('lots of page text');
    extractTermDatesPreview.mockResolvedValue({ ok: true, body: { dates: [] } });
    extractTermDatesViaSearch.mockResolvedValue([]);

    const res = await importAuthority(LA, AYS);

    expect(res.status).toBe('failed');
    expect(lastStatus().error).toMatch(/no term dates were extractable/i);
    expect(laDb.replaceEntriesForLA).not.toHaveBeenCalled();
  });

  test('only next-year dates → partial with an explanatory note', async () => {
    findOfficialTermDatesUrl.mockResolvedValue('https://barnet.gov.uk/term-dates');
    fetchTermDatesPageText.mockResolvedValue('lots of page text');
    extractTermDatesPreview.mockResolvedValue({
      ok: true,
      body: { dates: [{ event_type: 'term_start', date: '2026-09-02', academic_year: '2026-2027', label: 'Autumn term' }] },
    });

    const res = await importAuthority(LA, AYS);

    expect(res.status).toBe('partial');
    expect(lastStatus().status).toBe('partial');
    expect(lastStatus().error).toMatch(/2025-2026 was not available/);
  });

  test('unexpected error → failed, resolves (never throws)', async () => {
    findOfficialTermDatesUrl.mockRejectedValue(new Error('socket hang up'));

    const res = await importAuthority(LA, AYS);

    expect(res.status).toBe('failed');
    expect(res.error).toMatch(/socket hang up/);
  });
});

describe('dedupeDates', () => {
  test('drops exact duplicates, keeps distinct rows', () => {
    const out = dedupeDates([
      { academic_year: '2025-2026', event_type: 'term_start', date: '2025-09-03' },
      { academic_year: '2025-2026', event_type: 'term_start', date: '2025-09-03' },
      { academic_year: '2025-2026', event_type: 'term_end', date: '2025-12-19' },
    ]);
    expect(out).toHaveLength(2);
  });
});
