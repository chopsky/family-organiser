/**
 * GET /school-term-dates/ — the SEO index.
 *
 * The page is two views in one URL: the server injects a plain <a> list of
 * every imported council (what crawlers index and what the public JS now
 * keeps), and app.js only swaps in the import dashboard for ?key= holders.
 * These tests pin the server half of that contract: real links, the data-*
 * attributes the client filter needs, and no never-imported councils.
 */
jest.mock('../services/bankHolidays', () => {
  const real = jest.requireActual('../services/bankHolidays');
  return { ...real, fetchBankHolidaysEnglandWales: jest.fn() };
});

jest.mock('../db/laTermDates', () => ({
  listAllAuthorities: jest.fn(),
  listSchoolsForAuthorityName: jest.fn(),
  listAuthoritySchools: jest.fn(),
  getAuthorityBySlug: jest.fn(),
  getEntriesForLA: jest.fn(),
  listAllEntries: jest.fn(),
  getStats: jest.fn(),
}));

const request = require('supertest');
const express = require('express');
const laDb = require('../db/laTermDates');
const router = require('./termDatesSsr');

beforeEach(() => {
  laDb.listAllEntries.mockResolvedValue([]);
  laDb.listSchoolsForAuthorityName.mockResolvedValue([]);
  laDb.getStats.mockResolvedValue({ total: 176, dateCount: 4800, lastRun: { started_at: '2026-08-16T07:43:00Z' } });
});

const app = () => {
  const a = express();
  a.use('/school-term-dates', router);
  return a;
};

// Listability is keyed on HOLDING DATES, not on import health: a council
// whose last refresh 403'd still has a usable calendar and must stay on the
// site (five real councils were 404'ing this way until 2026-08-19).
const AUTHORITIES = [
  { name: 'Hertfordshire', slug: 'hertfordshire', region: 'England', import_status: 'ok', date_count: 40 },
  { name: 'Cardiff', slug: 'cardiff', region: 'Wales', import_status: 'partial', date_count: 20 },
  { name: 'Nevershire', slug: 'nevershire', region: 'England', import_status: 'pending', date_count: 0 },
  // Last import failed, but June's dates are still stored - must STILL list.
  { name: 'Brokenshire', slug: 'brokenshire', region: 'England', import_status: 'failed', date_count: 30 },
];

describe('GET /school-term-dates/ (SSR index)', () => {
  beforeEach(() => {
    laDb.listAllAuthorities.mockResolvedValue(AUTHORITIES);
  });

  it('injects a real link per imported council', async () => {
    const res = await request(app()).get('/school-term-dates/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('href="/school-term-dates/hertfordshire"');
    expect(res.text).toContain('href="/school-term-dates/cardiff"'); // partial still shows
    // A failed LAST import does not unpublish a council that still holds dates.
    expect(res.text).toContain('href="/school-term-dates/brokenshire"');
    // Never imported, no dates: nothing to show.
    expect(res.text).not.toContain('href="/school-term-dates/nevershire"');
  });

  it('carries the data attributes the client-side filter reads', async () => {
    const res = await request(app()).get('/school-term-dates/');
    expect(res.text).toContain('data-name="hertfordshire"');
    expect(res.text).toContain('data-region="England"');
    expect(res.text).toContain('data-region="Wales"');
  });

  it('excludes councils holding no dates, but keeps ones whose last import failed', async () => {
    const res = await request(app()).get('/school-term-dates/');
    expect(res.text).not.toContain('nevershire'); // never imported, no dates
    expect(res.text).toContain('brokenshire'); // import failed, dates still held
  });

  it('escapes authority names in the injected markup', async () => {
    laDb.listAllAuthorities.mockResolvedValue([
      { name: 'Evil<script>alert(1)</script>', slug: 'evil', region: 'England', import_status: 'ok', date_count: 10 },
    ]);
    const res = await request(app()).get('/school-term-dates/');
    expect(res.text).not.toContain('<script>alert(1)</script>');
    expect(res.text).toContain('&lt;script&gt;');
  });

  it('still serves the page when the directory query fails', async () => {
    // next() falls through to the plain static file in prod; in this harness
    // there is no static layer, so the contract is simply "no 500 HTML error".
    laDb.listAllAuthorities.mockRejectedValue(new Error('db down'));
    const res = await request(app()).get('/school-term-dates/');
    expect(res.status).toBe(404); // fell through, didn't crash
  });
});

describe('GET /school-term-dates/:slug (council page)', () => {
  beforeEach(() => {
    laDb.getAuthorityBySlug.mockResolvedValue({
      id: 'la1', name: 'Hertfordshire', slug: 'hertfordshire',
      region: 'England', import_status: 'ok', date_count: 40, source_url: 'https://www.hertfordshire.gov.uk/term-dates',
    });
    laDb.getEntriesForLA.mockResolvedValue([
      { academic_year: '2026-2027', event_type: 'term_start', date: '2026-09-01', end_date: null, label: 'Start of term' },
      { academic_year: '2026-2027', event_type: 'half_term_start', date: '2026-10-26', end_date: '2026-10-30', label: 'Half term holiday' },
      { academic_year: '2026-2027', event_type: 'half_term_start', date: '2026-12-21', end_date: '2027-01-01', label: 'Christmas holiday' },
      { academic_year: '2026-2027', event_type: 'half_term_start', date: '2027-02-15', end_date: '2027-02-19', label: 'Half term holiday' },
      { academic_year: '2026-2027', event_type: 'half_term_start', date: '2027-03-26', end_date: '2027-04-09', label: 'Easter holiday' },
      { academic_year: '2026-2027', event_type: 'term_end', date: '2027-07-23', end_date: null, label: 'End of term' },
    ]);
  });

  it('CTA carries the acquisition tag and the council through to signup', async () => {
    const res = await request(app()).get('/school-term-dates/hertfordshire');
    expect(res.status).toBe(200);
    // Main CTA routes to the LANDING page (persuasion first), tags intact so
    // the landing's capture keeps attribution + the council handoff alive.
    expect(res.text).toContain('href="https://housemait.com/gb?src=termdates&amp;la=hertfordshire"');
    // The warm .ics upsell stays direct-to-signup with its own tag.
    expect(res.text).toContain('https://housemait.com/signup?src=termdates-ics');
    // Nothing still points at the old bare-signup CTA.
    expect(res.text).not.toContain('signup?src=termdates"');
  });

  it('cross-links other councils (cyclic mesh), skipping dead pages and itself', async () => {
    laDb.listAllAuthorities.mockResolvedValue([
      { name: 'Barnet', slug: 'barnet', region: 'England', import_status: 'ok', date_count: 40 },
      { name: 'Hertfordshire', slug: 'hertfordshire', region: 'England', import_status: 'ok', date_count: 40 },
      { name: 'Kent', slug: 'kent', region: 'England', import_status: 'ok', date_count: 40 },
      { name: 'Luton', slug: 'luton', region: 'England', import_status: 'ok', date_count: 0 }, // no dates → never linked
      { name: 'Surrey', slug: 'surrey', region: 'England', import_status: 'partial', date_count: 20 },
    ]);
    const res = await request(app()).get('/school-term-dates/hertfordshire');
    expect(res.status).toBe(200);
    expect(res.text).toContain('More UK council term dates');
    // Cyclic window starts after Hertfordshire alphabetically: Kent, Surrey, wraps to Barnet.
    expect(res.text).toContain('href="/school-term-dates/kent"');
    expect(res.text).toContain('href="/school-term-dates/surrey"');
    expect(res.text).toContain('href="/school-term-dates/barnet"');
    expect(res.text).not.toContain('href="/school-term-dates/luton"'); // holds no dates
    expect(res.text).not.toContain('href="/school-term-dates/hertfordshire"'); // not itself
  });

  it('renders the page without a nearby block when the sibling fetch fails', async () => {
    laDb.listAllAuthorities.mockRejectedValue(new Error('db down'));
    const res = await request(app()).get('/school-term-dates/hertfordshire');
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('More UK council term dates');
  });

  it('serves a share image so WhatsApp/Facebook previews render a card', async () => {
    const res = await request(app()).get('/school-term-dates/hertfordshire');
    expect(res.text).toContain('og:image');
    expect(res.text).toContain('https://housemait.com/school-term-dates/og-share.png');
    expect(res.text).toContain('summary_large_image');
  });


  it('renders unique data-driven prose, not just tables', async () => {
    const res = await request(app()).get('/school-term-dates/hertfordshire');
    // The intro derives from the council's own dates and school count
    expect(res.text).toContain('About Hertfordshire school term dates');
    expect(res.text).toContain('pupils return on Tue 1 Sep 2026');
    // FAQ answers are the actual dates, month-classified
    expect(res.text).toContain('When is October half term in Hertfordshire in 2026?');
    expect(res.text).toContain('Mon 26 Oct 2026 – Fri 30 Oct 2026');
    expect(res.text).toContain('When do Hertfordshire schools break up for summer in 2027?');
  });

  it('emits FAQPage structured data matching the visible questions', async () => {
    const res = await request(app()).get('/school-term-dates/hertfordshire');
    const m = res.text.match(/<script type="application\/ld\+json">({"@context":"https:\/\/schema.org","@type":"FAQPage".*?})<\/script>/);
    expect(m).toBeTruthy();
    const ld = JSON.parse(m[1]);
    expect(ld.mainEntity.length).toBeGreaterThanOrEqual(6);
    const names = ld.mainEntity.map((q) => q.name);
    expect(names).toContain('When do Hertfordshire schools go back in September 2026?');
    // every structured question appears as visible page copy too
    for (const q of names) expect(res.text).toContain(q.replace(/&/g, '&amp;'));
  });

  it('degrades to fewer questions when a council has sparse data', async () => {
    laDb.getEntriesForLA.mockResolvedValue([
      { academic_year: '2026-2027', event_type: 'term_start', date: '2026-09-01', end_date: null, label: 'Start of term' },
    ]);
    const res = await request(app()).get('/school-term-dates/hertfordshire');
    expect(res.status).toBe(200);
    expect(res.text).toContain('go back in September 2026');       // fact exists -> question stays
    expect(res.text).not.toContain('half term in Hertfordshire');    // fact missing -> question dropped
  });


  it('links back to housemait.com from every council page (footer)', async () => {
    const res = await request(app()).get('/school-term-dates/hertfordshire');
    expect(res.text).toContain('class="site-footer"');
    expect(res.text).toContain('href="https://housemait.com"');
    expect(res.text).toContain('housemait-logo.svg');
    expect(res.text).toContain('© ');
  });

  it('never-imported councils fall through rather than render empty pages', async () => {
    laDb.getAuthorityBySlug.mockResolvedValue({ id: 'x', name: 'Nevershire', slug: 'nevershire', import_status: 'pending', date_count: 0 });
    const res = await request(app()).get('/school-term-dates/nevershire');
    expect(res.status).toBe(404);
  });

  // The Enfield regression (2026-08-19): five councils whose council page had
  // started 403ing flipped to import_status 'failed' and their pages began
  // returning 404 - despite each still holding a complete, current calendar.
  // A failed refresh must never unpublish data we already hold.
  it('a council whose last import failed still serves its page', async () => {
    laDb.getAuthorityBySlug.mockResolvedValue({
      id: 'la9', name: 'Enfield', slug: 'enfield', region: 'England',
      import_status: 'failed', date_count: 30, source_url: 'https://www.enfield.gov.uk/term-dates',
    });
    const res = await request(app()).get('/school-term-dates/enfield');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Enfield');
  });
});

describe('GET /school-term-dates/:slug/term-dates.ics', () => {
  beforeEach(() => {
    laDb.getAuthorityBySlug.mockResolvedValue({
      id: 'la1', name: 'Hertfordshire', slug: 'hertfordshire', region: 'England', import_status: 'ok', date_count: 40,
    });
    laDb.getEntriesForLA.mockResolvedValue([
      { academic_year: '2026-2027', event_type: 'term_start', date: '2026-09-01', end_date: null, label: 'Start of term' },
      { academic_year: '2026-2027', event_type: 'half_term_start', date: '2026-10-26', end_date: '2026-10-30', label: 'Half term; with, chars' },
      { academic_year: '2026-2027', event_type: 'half_term_start', date: '2026-12-21', end_date: '2026-12-31', label: 'Christmas holiday' },
    ]);
  });

  it('serves a valid all-day calendar with exclusive DTEND', async () => {
    const res = await request(app()).get('/school-term-dates/hertfordshire/term-dates.ics');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/calendar');
    expect(res.headers['content-disposition']).toContain('hertfordshire-term-dates.ics');
    expect(res.text).toMatch(/^BEGIN:VCALENDAR\r\n/);
    expect(res.text.trim().endsWith('END:VCALENDAR')).toBe(true);
    // single day: DTEND is the next day (exclusive per RFC 5545)
    expect(res.text).toContain('DTSTART;VALUE=DATE:20260901');
    expect(res.text).toContain('DTEND;VALUE=DATE:20260902');
    // range ending 30 Oct -> DTEND 31 Oct; range ending 31 Dec -> DTEND 1 Jan (rollover)
    expect(res.text).toContain('DTEND;VALUE=DATE:20261031');
    expect(res.text).toContain('DTEND;VALUE=DATE:20270101');
  });

  it('escapes council text and keeps UIDs stable for re-downloads', async () => {
    const res = await request(app()).get('/school-term-dates/hertfordshire/term-dates.ics');
    expect(res.text).toContain('Half term\\; with\\, chars');
    expect(res.text).toContain('UID:hertfordshire-term_start-2026-09-01@housemait.com');
  });

  it('404s for never-imported councils and bad slugs', async () => {
    laDb.getAuthorityBySlug.mockResolvedValue({ id: 'x', name: 'Nevershire', slug: 'nevershire', import_status: 'pending' });
    expect((await request(app()).get('/school-term-dates/nevershire/term-dates.ics')).status).toBe(404);
    expect((await request(app()).get('/school-term-dates/UPPER!/term-dates.ics')).status).toBe(404);
  });
});

describe('council page action buttons', () => {
  beforeEach(() => {
    laDb.getAuthorityBySlug.mockResolvedValue({
      id: 'la1', name: 'Hertfordshire', slug: 'hertfordshire', region: 'England', import_status: 'ok', date_count: 40,
    });
    laDb.getEntriesForLA.mockResolvedValue([
      { academic_year: '2026-2027', event_type: 'term_start', date: '2026-09-01', end_date: null, label: 'Start of term' },
    ]);
  });

  it('offers the .ics download, the WhatsApp share, and the tagged upsell', async () => {
    const res = await request(app()).get('/school-term-dates/hertfordshire');
    expect(res.text).toContain('href="/school-term-dates/hertfordshire/term-dates.ics"');
    expect(res.text).toContain('https://wa.me/?text=');
    expect(res.text).toContain(encodeURIComponent('https://housemait.com/school-term-dates/hertfordshire'));
    expect(res.text).toContain('https://housemait.com/signup?src=termdates-ics');
  });
});

describe('per-school INSET days (the Barking & Dagenham publishing style)', () => {
  const ENTRIES = [
    { academic_year: '2199-2200', event_type: 'term_start', date: '2199-09-02', end_date: null, label: 'Start of term' },
    // council-wide INSET with a dash - must STAY in the main table and the .ics
    { academic_year: '2199-2200', event_type: 'inset_day', date: '2199-09-03', end_date: null, label: 'INSET Day - designated for all LEA Maintained Schools' },
    // school-scoped rows - subsection only, never ics/countdown
    { academic_year: '2199-2200', event_type: 'inset_day', date: '2199-09-01', end_date: null, label: 'INSET day - all schools except Sydney Russell School and The Warren School' },
    { academic_year: '2199-2200', event_type: 'inset_day', date: '2199-11-20', end_date: null, label: 'INSET day - Godwin Primary, Roding Primary' },
    { academic_year: '2199-2200', event_type: 'half_term_start', date: '2199-10-26', end_date: '2199-10-30', label: 'Half term holiday' },
    { academic_year: '2199-2200', event_type: 'term_end', date: '2200-07-23', end_date: null, label: 'End of term' },
  ];
  beforeEach(() => {
    laDb.getAuthorityBySlug.mockResolvedValue({
      id: 'la-bd', name: 'Barking and Dagenham', slug: 'barking-and-dagenham',
      region: 'England', import_status: 'ok', date_count: 55, school_count: 68,
    });
    laDb.getEntriesForLA.mockResolvedValue(ENTRIES);
  });

  it('moves school-scoped rows into a collapsed section, keeps council-wide ones in the table', async () => {
    const res = await request(app()).get('/school-term-dates/barking-and-dagenham');
    expect(res.text).toContain('Per-school INSET days (2)');
    expect(res.text).toContain('Godwin Primary');
    // the dashed-but-council-wide label stays out of the subsection: it
    // appears before the <details> block, not inside it
    const detailsAt = res.text.indexOf('<details class="perschool"');
    expect(detailsAt).toBeGreaterThan(-1);
    expect(res.text.indexOf('LEA Maintained Schools')).toBeLessThan(detailsAt);
  });

  it('keeps school-scoped rows out of the .ics download', async () => {
    const res = await request(app()).get('/school-term-dates/barking-and-dagenham/term-dates.ics');
    expect(res.text).toContain('LEA Maintained Schools');   // council-wide INSET ships
    expect(res.text).not.toContain('Godwin Primary');        // school-scoped does not
    expect(res.text).not.toContain('Sydney Russell');
  });

  it('countdown card skips school-scoped INSETs and leads with back-to-school', async () => {
    // scoped INSET (1 Sep) precedes term start (2 Sep); without the skip it
    // would be the borough's hero card
    const res = await request(app()).get('/school-term-dates/barking-and-dagenham');
    expect(res.text).toContain('Back to school');
  });

  it('FAQ presents the per-school table as the exception it is', async () => {
    const res = await request(app()).get('/school-term-dates/barking-and-dagenham');
    expect(res.text).toContain('rare exception');
    expect(res.text).toContain('2 school-specific dates');
  });
});


describe('seasonal guide pages', () => {
  // The AY label rolls with the real clock, so fixtures pin the season.
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'setTimeout'] }).setSystemTime(new Date('2026-08-19T12:00:00Z'));
    laDb.listAllAuthorities.mockResolvedValue([
      { id: 'a', name: 'Aleshire', slug: 'aleshire', region: 'England', import_status: 'ok', date_count: 10 },
      { id: 'b', name: 'Beeshire', slug: 'beeshire', region: 'England', import_status: 'ok', date_count: 10 },
      { id: 'z', name: 'Zeroshire', slug: 'zeroshire', region: 'England', import_status: 'pending', date_count: 0 },
    ]);
    laDb.getAuthorityBySlug.mockResolvedValue(null); // fall-through must 404, not hit a stale council mock
    laDb.listAllEntries.mockResolvedValue([
      { la_id: 'a', academic_year: '2026-2027', event_type: 'term_start', date: '2026-09-01', end_date: null, label: null },
      { la_id: 'a', academic_year: '2026-2027', event_type: 'term_end', date: '2026-10-23', end_date: null, label: null },
      { la_id: 'a', academic_year: '2026-2027', event_type: 'term_start', date: '2026-11-02', end_date: null, label: null },
      { la_id: 'b', academic_year: '2026-2027', event_type: 'term_start', date: '2026-09-07', end_date: null, label: null },
      { la_id: 'b', academic_year: '2026-2027', event_type: 'half_term_start', date: '2026-10-26', end_date: '2026-10-30', label: 'Half term' },
      // Zeroshire's rows must never be counted - it is not listable.
      { la_id: 'z', academic_year: '2026-2027', event_type: 'term_start', date: '2026-08-01', end_date: null, label: null },
    ]);
  });
  afterEach(() => jest.useRealTimers());

  it('when-do-schools-go-back groups councils and links each one', async () => {
    const res = await request(app()).get('/school-term-dates/when-do-schools-go-back');
    expect(res.status).toBe(200);
    expect(res.text).toContain('September 2026');
    expect(res.text).toContain('href="/school-term-dates/aleshire"');
    expect(res.text).toContain('href="/school-term-dates/beeshire"');
    expect(res.text).not.toContain('zeroshire'); // unlistable council stays invisible
    expect(res.text).toContain('rel="canonical" href="https://housemait.com/school-term-dates/when-do-schools-go-back"');
  });

  it('october-half-term derives the same week from both council notations', async () => {
    const res = await request(app()).get('/school-term-dates/october-half-term');
    expect(res.status).toBe(200);
    // Aleshire (break-up/return) and Beeshire (holiday-week row) share a group.
    expect(res.text).toContain('2 councils');
    expect(res.text).toContain('Mon 26 Oct 2026');
  });

  it('falls through (404) rather than rendering an empty page when nothing is derivable', async () => {
    laDb.listAllEntries.mockResolvedValue([]);
    const res = await request(app()).get('/school-term-dates/easter-holidays');
    expect(res.status).toBe(404);
  });

  it('db failure falls through, never a 500', async () => {
    laDb.listAllEntries.mockRejectedValue(new Error('db down'));
    const res = await request(app()).get('/school-term-dates/summer-holidays');
    expect(res.status).toBe(404);
  });
});

describe('about page', () => {
  it('renders with live stats and the methodology essentials', async () => {
    const res = await request(app()).get('/school-term-dates/about-this-data');
    expect(res.status).toBe(200);
    expect(res.text).toContain('176 local education authorities');
    expect(res.text).toContain('4800 dated entries');
    expect(res.text).toContain('hello@housemait.com');
    expect(res.text).toContain('INSET');
  });

  it('still renders when stats are unavailable', async () => {
    laDb.getStats.mockRejectedValue(new Error('db down'));
    const res = await request(app()).get('/school-term-dates/about-this-data');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Where the dates come from');
  });
});

describe('verification date on council pages', () => {
  it('shows the actual date the source was last checked', async () => {
    laDb.getAuthorityBySlug.mockResolvedValue({
      id: 'la1', name: 'Hertfordshire', slug: 'hertfordshire', region: 'England',
      import_status: 'ok', date_count: 40,
      source_url: 'https://www.hertfordshire.gov.uk/term-dates',
      last_imported_at: '2026-08-03T09:18:00Z',
    });
    laDb.getEntriesForLA.mockResolvedValue([
      { academic_year: '2026-2027', event_type: 'term_start', date: '2026-09-01', end_date: null, label: 'Start of term' },
    ]);
    laDb.listAllAuthorities.mockResolvedValue([]);
    const res = await request(app()).get('/school-term-dates/hertfordshire');
    expect(res.status).toBe(200);
    expect(res.text).toContain('checked 3 Aug 2026');
    expect(res.text).toContain('re-checked monthly');
  });
});


describe('region hub pages', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'setTimeout'] }).setSystemTime(new Date('2026-08-19T12:00:00Z'));
    laDb.getAuthorityBySlug.mockResolvedValue(null);
    laDb.listAllAuthorities.mockResolvedValue([
      { id: 'm', name: 'Manchester', slug: 'manchester', region: 'England', import_status: 'ok', date_count: 10 },
      { id: 'w', name: 'Wigan', slug: 'wigan', region: 'England', import_status: 'ok', date_count: 10 },
      { id: 'c', name: 'Cardiff', slug: 'cardiff', region: 'Wales', import_status: 'ok', date_count: 10 },
      { id: 'k', name: 'Kent', slug: 'kent', region: 'England', import_status: 'ok', date_count: 10 },
    ]);
    laDb.listAllEntries.mockResolvedValue([
      { la_id: 'm', academic_year: '2026-2027', event_type: 'term_start', date: '2026-09-01', end_date: null, label: null },
      { la_id: 'w', academic_year: '2026-2027', event_type: 'term_start', date: '2026-09-02', end_date: null, label: null },
      { la_id: 'c', academic_year: '2026-2027', event_type: 'term_start', date: '2026-09-01', end_date: null, label: null },
    ]);
  });
  afterEach(() => jest.useRealTimers());

  it('north-west compares only its member councils', async () => {
    const res = await request(app()).get('/school-term-dates/north-west');
    expect(res.status).toBe(200);
    expect(res.text).toContain('href="/school-term-dates/manchester"');
    expect(res.text).toContain('href="/school-term-dates/wigan"');
    expect(res.text).not.toContain('href="/school-term-dates/kent"');   // not a member
    expect(res.text).not.toContain('href="/school-term-dates/cardiff"'); // not a member
    // The divergent start dates are surfaced, not averaged away.
    expect(res.text).toContain('They do not all go back on the same day');
  });

  it('wales membership comes from the region column', async () => {
    const res = await request(app()).get('/school-term-dates/wales');
    expect(res.status).toBe(200);
    expect(res.text).toContain('href="/school-term-dates/cardiff"');
    expect(res.text).not.toContain('href="/school-term-dates/kent"');
  });

  it('falls through when no members are listable', async () => {
    laDb.listAllAuthorities.mockResolvedValue([]);
    const res = await request(app()).get('/school-term-dates/east-midlands');
    expect(res.status).toBe(404);
  });
});


describe('bank holidays page', () => {
  const bh = require('../services/bankHolidays');
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'setTimeout'] }).setSystemTime(new Date('2026-08-19T12:00:00Z'));
    laDb.getAuthorityBySlug.mockResolvedValue(null);
    laDb.listAllAuthorities.mockResolvedValue([
      { id: 'a', name: 'Aleshire', slug: 'aleshire', region: 'England', import_status: 'ok', date_count: 10 },
    ]);
    laDb.listAllEntries.mockResolvedValue([
      { la_id: 'a', academic_year: '2026-2027', event_type: 'term_start', date: '2026-09-01', end_date: null, label: null },
      { la_id: 'a', academic_year: '2026-2027', event_type: 'term_end', date: '2026-12-18', end_date: null, label: null },
      { la_id: 'a', academic_year: '2026-2027', event_type: 'term_start', date: '2027-01-04', end_date: null, label: null },
      { la_id: 'a', academic_year: '2026-2027', event_type: 'term_end', date: '2027-03-25', end_date: null, label: null },
      { la_id: 'a', academic_year: '2026-2027', event_type: 'term_start', date: '2027-04-12', end_date: null, label: null },
      { la_id: 'a', academic_year: '2026-2027', event_type: 'term_end', date: '2027-07-21', end_date: null, label: null },
    ]);
    bh.fetchBankHolidaysEnglandWales.mockResolvedValue([
      { date: '2026-12-25', title: 'Christmas Day', notes: '' },
      { date: '2027-05-03', title: 'Early May bank holiday', notes: '' },
    ]);
  });
  afterEach(() => jest.useRealTimers());

  it('annotates term-time bank holidays as extra days off', async () => {
    const res = await request(app()).get('/school-term-dates/bank-holidays');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Early May bank holiday');
    expect(res.text).toContain('Extra day off school');
    expect(res.text).toContain('Christmas Day');
    expect(res.text).toContain('rel="canonical" href="https://housemait.com/school-term-dates/bank-holidays"');
  });

  it('gov.uk failure falls through, never a 500', async () => {
    bh.fetchBankHolidaysEnglandWales.mockRejectedValue(new Error('gov.uk down'));
    const res = await request(app()).get('/school-term-dates/bank-holidays');
    expect(res.status).toBe(404);
  });
});


describe('site navigation', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'setTimeout'] }).setSystemTime(new Date('2026-08-19T12:00:00Z'));
    laDb.getAuthorityBySlug.mockResolvedValue({
      id: 'la1', name: 'Hertfordshire', slug: 'hertfordshire', region: 'England',
      import_status: 'ok', date_count: 40, source_url: 'https://example.gov.uk/terms',
    });
    laDb.getEntriesForLA.mockResolvedValue([
      { academic_year: '2026-2027', event_type: 'term_start', date: '2026-09-01', end_date: null, label: null },
    ]);
    laDb.listAllAuthorities.mockResolvedValue([
      { id: 'la1', name: 'Hertfordshire', slug: 'hertfordshire', region: 'England', import_status: 'ok', date_count: 40 },
    ]);
    laDb.listAllEntries.mockResolvedValue([
      { la_id: 'la1', academic_year: '2026-2027', event_type: 'term_start', date: '2026-09-01', end_date: null, label: null },
    ]);
  });
  afterEach(() => jest.useRealTimers());

  it('council pages carry the nav bar with both dropdowns', async () => {
    const res = await request(app()).get('/school-term-dates/hertfordshire');
    expect(res.text).toContain('class="sitenav"');
    expect(res.text).toContain('<summary>Key dates</summary>');
    expect(res.text).toContain('<summary>Regions</summary>');
    expect(res.text).toContain('href="/school-term-dates/london"');
  });

  it('the active seasonal page is marked in the nav', async () => {
    const res = await request(app()).get('/school-term-dates/when-do-schools-go-back');
    expect(res.status).toBe(200);
    // Its dropdown group is highlighted and its own link carries aria-current.
    expect(res.text).toContain('data-active="1"');
    expect(res.text).toMatch(/href="\/school-term-dates\/when-do-schools-go-back" aria-current="page"/);
  });
});


describe('regional coverage', () => {
  const { HUB_DEFS, REGION_SLUGS } = require('./termDatesSsr').__testables || {};

  it('every English council belongs to exactly one ONS region', () => {
    if (!HUB_DEFS) return; // exported only for tests
    const seen = new Map();
    for (const slug of REGION_SLUGS) {
      for (const c of HUB_DEFS[slug].slugs || []) {
        expect(seen.has(c)).toBe(false); // no council in two regions
        seen.set(c, slug);
      }
    }
    expect(seen.size).toBe(152); // 154 England rows minus 2 offshore buckets
  });

  it('there is exactly one region layer - no overlapping sub-areas', () => {
    if (!HUB_DEFS) return;
    // Every hub is an ONS region; nothing carries a parent, so no council can
    // belong to two areas (the reason the metro layer was retired).
    expect(REGION_SLUGS).toHaveLength(10);
    for (const slug of REGION_SLUGS) expect(HUB_DEFS[slug].parent).toBeUndefined();
  });

  it('the retired metro slugs redirect rather than 404', async () => {
    for (const slug of ['greater-manchester', 'merseyside', 'west-yorkshire', 'south-yorkshire']) {
      const res = await request(app()).get(`/school-term-dates/${slug}`);
      expect(res.status).toBe(301);
      expect(res.headers.location).toMatch(/^\/school-term-dates\/(north-west|yorkshire-and-the-humber)$/);
    }
  });
});


describe('open data', () => {
  beforeEach(() => {
    laDb.listAllAuthorities.mockResolvedValue([
      { id: 'a', name: 'Aleshire', slug: 'aleshire', region: 'England', import_status: 'ok', date_count: 2 },
    ]);
    laDb.listAllEntries.mockResolvedValue([
      { la_id: 'a', academic_year: '2026-2027', event_type: 'term_start', date: '2026-09-01', end_date: null, label: 'Autumn term' },
      { la_id: 'a', academic_year: '2026-2027', event_type: 'half_term_start', date: '2026-10-26', end_date: '2026-10-30', label: 'Half, term' },
    ]);
  });

  it('the data page documents downloads, licence and API', async () => {
    const res = await request(app()).get('/school-term-dates/data');
    expect(res.status).toBe(200);
    expect(res.text).toContain('CC BY 4.0');
    expect(res.text).toContain('/school-term-dates/term-dates.csv');
    expect(res.text).toContain('api.housemait.com/api/la-term-dates/authorities');
    expect(res.text).toContain('"@type":"Dataset"');
  });

  it('CSV exports a header plus one row per date, quoting commas', async () => {
    const res = await request(app()).get('/school-term-dates/term-dates.csv');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    const lines = res.text.trim().split('\n');
    expect(lines[0]).toBe('council,council_slug,country,academic_year,event_type,start_date,end_date,label');
    expect(lines).toHaveLength(3);
    expect(lines[2]).toContain('"Half, term"'); // comma-bearing label is quoted
  });

  it('JSON export carries licence and provenance', async () => {
    const res = await request(app()).get('/school-term-dates/term-dates.json');
    expect(res.status).toBe(200);
    const body = JSON.parse(res.text);
    expect(body.licence).toBe('CC BY 4.0');
    expect(body.rows).toBe(2);
    expect(body.data[0]).toMatchObject({ council: 'Aleshire', council_slug: 'aleshire' });
  });
});

describe('schools listing on council pages', () => {
  beforeEach(() => {
    laDb.getAuthorityBySlug.mockResolvedValue({
      id: 'la1', name: 'Barnet', slug: 'barnet', region: 'England',
      import_status: 'ok', date_count: 40, source_url: 'https://barnet.gov.uk/terms',
    });
    laDb.getEntriesForLA.mockResolvedValue([
      { academic_year: '2026-2027', event_type: 'term_start', date: '2026-09-01', end_date: null, label: null },
    ]);
    laDb.listAllAuthorities.mockResolvedValue([]);
  });

  it('lists school NAMES grouped by phase, with the academy caveat', async () => {
    laDb.listSchoolsForAuthorityName.mockResolvedValue([
      { name: 'Ashmole Academy', phase: 'Secondary' },
      { name: 'Akiva School', phase: 'Primary' },
      { name: 'Pavilion Study Centre', phase: 'Not applicable' },
    ]);
    const res = await request(app()).get('/school-term-dates/barnet');
    expect(res.text).toContain('Ashmole Academy');
    expect(res.text).toContain('Primary schools');
    expect(res.text).toContain('Special schools and other settings'); // 'Not applicable' relabelled
    expect(res.text).toContain("We don't publish individual schools' calendars");
  });

  it('renders nothing when the area has no schools, and survives a lookup failure', async () => {
    laDb.listSchoolsForAuthorityName.mockResolvedValue([]);
    let res = await request(app()).get('/school-term-dates/barnet');
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('class="schools"');

    laDb.listSchoolsForAuthorityName.mockRejectedValue(new Error('db down'));
    res = await request(app()).get('/school-term-dates/barnet');
    expect(res.status).toBe(200); // fail-open: dates still render
  });
});

describe('term-time holiday fines page', () => {
  const bh = require('../services/bankHolidays');
  const FINES = '/school-term-dates/term-time-holiday-fines';
  const yr = (event_type, date, extra = {}) => ({ la_id: 'x', academic_year: '2026-2027', event_type, date, end_date: null, label: null, ...extra });
  const ROWS = [
    yr('term_start', '2026-09-02'), yr('term_end', '2026-10-23'),
    yr('term_start', '2026-11-02'), yr('term_end', '2026-12-18'),
    yr('term_start', '2027-01-05'), yr('term_end', '2027-02-12'),
    yr('term_start', '2027-02-22'), yr('term_end', '2027-03-26'),
    yr('term_start', '2027-04-12'), yr('term_end', '2027-05-28'),
    yr('term_start', '2027-06-07'), yr('term_end', '2027-07-21'),
    yr('inset_day', '2026-11-27', { label: 'INSET day' }),
  ];
  const ALESHIRE = { id: 'a', name: 'Aleshire', slug: 'aleshire', region: 'England', import_status: 'ok', date_count: 10, last_imported_at: '2026-08-20T05:00:00Z' };
  const CARDIFF = { id: 'w', name: 'Cardiff', slug: 'cardiff', region: 'Wales', import_status: 'ok', date_count: 10 };

  beforeEach(() => {
    laDb.listAllAuthorities.mockResolvedValue([
      ALESHIRE, CARDIFF,
      { id: 'z', name: 'Nevershire', slug: 'nevershire', region: 'England', import_status: 'pending', date_count: 0 },
    ]);
    laDb.getAuthorityBySlug.mockImplementation(async (slug) => ({ aleshire: ALESHIRE, cardiff: CARDIFF }[slug] || null));
    laDb.getEntriesForLA.mockResolvedValue(ROWS);
    bh.fetchBankHolidaysEnglandWales.mockResolvedValue([{ date: '2027-05-03', title: 'Early May bank holiday', notes: '' }]);
  });

  it('renders the checker with every listable council, indexable, with the rules', async () => {
    const res = await request(app()).get(FINES);
    expect(res.status).toBe(200);
    expect(res.text).toContain('rel="canonical" href="https://housemait.com/school-term-dates/term-time-holiday-fines"');
    expect(res.text).not.toContain('noindex');
    expect(res.text).toContain('<option value="aleshire"');
    expect(res.text).toContain('<optgroup label="Wales"><option value="cardiff"');
    expect(res.text).not.toContain('nevershire');
    expect(res.text).toContain('action="/school-term-dates/term-time-holiday-fines#result"');
    expect(res.text).toContain('href="/school-term-dates/term-time-holiday-fines" aria-current="page">Term-time fines</a>');
    expect(res.text).toContain('10 sessions</strong>');
    expect(res.text).toContain('"@type":"FAQPage"');
    // Bare page: no result block, no stray error.
    expect(res.text).not.toContain('id="result"');
  });

  it('counts school days and prices the notices per parent per child', async () => {
    const res = await request(app()).get(`${FINES}?council=aleshire&from=2026-11-09&to=2026-11-13&children=2&parents=2`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('5 school days (10 sessions) in Aleshire');
    expect(res.text).toContain('Meets the national threshold');
    expect(res.text).toContain('4 notices');
    expect(res.text).toContain('<div class="amt">£320</div>');
    expect(res.text).toContain('<div class="amt">£640</div>');
    expect(res.text).toContain('October half term');
    expect(res.text).toContain('checked Thu 20 Aug 2026');
    // Result pages never compete with the bare URL in the index.
    expect(res.text).toContain('<meta name="robots" content="noindex,follow" />');
    expect(res.text).toContain('rel="canonical" href="https://housemait.com/school-term-dates/term-time-holiday-fines"');
    // Form keeps the visitor's choices.
    expect(res.text).toContain('<option value="aleshire" selected>');
    expect(res.text).toContain('value="2026-11-09"');
  });

  it('removes half term, INSET and bank holidays before counting', async () => {
    const res = await request(app()).get(`${FINES}?council=aleshire&from=2026-10-23&to=2026-11-02`);
    expect(res.text).toContain('2 school days (4 sessions)');
    expect(res.text).toContain('5 school holiday');
    expect(res.text).toContain('Below the national threshold');
    const inset = await request(app()).get(`${FINES}?council=aleshire&from=2026-11-23&to=2026-11-27`);
    expect(inset.text).toContain('4 school days');
    expect(inset.text).toContain('1 INSET/closure');
    const may = await request(app()).get(`${FINES}?council=aleshire&from=2027-05-03&to=2027-05-07`);
    expect(may.text).toContain('4 school days');
    expect(may.text).toContain('1 bank holiday');
  });

  it('says so when the dates are all holiday', async () => {
    const res = await request(app()).get(`${FINES}?council=aleshire&from=2026-10-26&to=2026-10-30`);
    expect(res.text).toContain('0 school days');
    expect(res.text).toContain('nothing to fine');
    expect(res.text).toContain('class="result clear"');
  });

  it('uses the Welsh framework for Welsh councils', async () => {
    const res = await request(app()).get(`${FINES}?council=cardiff&from=2026-11-09&to=2026-11-13&children=1&parents=1`);
    expect(res.text).toContain('<div class="amt">£60</div>');
    expect(res.text).toContain('<div class="amt">£120</div>');
    expect(res.text).toContain('no single national trigger');
    expect(res.text).not.toContain('Meets the national threshold');
  });

  it('explains bad input instead of failing', async () => {
    const rev = await request(app()).get(`${FINES}?council=aleshire&from=2026-11-13&to=2026-11-09`);
    expect(rev.status).toBe(200);
    expect(rev.text).toContain('before the first day');
    const unknown = await request(app()).get(`${FINES}?council=atlantis&from=2026-11-09&to=2026-11-13`);
    expect(unknown.text).toContain('term dates for that council yet');
    const hidden = await request(app()).get(`${FINES}?council=nevershire&from=2026-11-09&to=2026-11-13`);
    expect(hidden.text).toContain('term dates for that council yet');
    const partial = await request(app()).get(`${FINES}?council=aleshire&from=2026-11-09`);
    expect(partial.text).toContain('Choose a council and both dates');
    const long = await request(app()).get(`${FINES}?council=aleshire&from=2026-09-07&to=2026-12-11`);
    expect(long.text).toContain('more than 60 days');
    laDb.getEntriesForLA.mockResolvedValue([]);
    const unresolved = await request(app()).get(`${FINES}?council=aleshire&from=2026-11-09&to=2026-11-13`);
    expect(unresolved.status).toBe(200);
    expect(unresolved.text).toContain('term structure');
    expect(unresolved.text).toContain('href="/school-term-dates/aleshire"');
  });

  it('escapes hostile query values', async () => {
    const res = await request(app()).get(`${FINES}?council=%3Cscript%3E&from=2026-11-09&to=2026-11-13`);
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('<script>alert');
    expect(res.text).not.toContain('value="<script>');
  });

  it('still answers when gov.uk bank holidays are unavailable', async () => {
    bh.fetchBankHolidaysEnglandWales.mockRejectedValue(new Error('gov.uk down'));
    const res = await request(app()).get(`${FINES}?council=aleshire&from=2027-05-03&to=2027-05-07`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('5 school days');
    expect(res.text).toContain('Bank holidays could not be checked');
  });

  it('is linked from the sitemap, the Key dates menu and the footer, and the footer lists live regions only', async () => {
    const sm = await request(app()).get('/school-term-dates/sitemap.xml');
    expect(sm.text).toContain('<loc>https://housemait.com/school-term-dates/term-time-holiday-fines</loc>');
    const page = await request(app()).get('/school-term-dates/bank-holidays');
    expect(page.text).toContain('href="/school-term-dates/term-time-holiday-fines">Term-time fines</a>');
    expect(page.text).not.toContain('/school-term-dates/greater-manchester"');
    expect(page.text).toContain('href="/school-term-dates/yorkshire-and-the-humber">Yorkshire and the Humber</a>');
  });
});
