/**
 * GET /school-term-dates/ — the SEO index.
 *
 * The page is two views in one URL: the server injects a plain <a> list of
 * every imported council (what crawlers index and what the public JS now
 * keeps), and app.js only swaps in the import dashboard for ?key= holders.
 * These tests pin the server half of that contract: real links, the data-*
 * attributes the client filter needs, and no never-imported councils.
 */
jest.mock('../db/laTermDates', () => ({
  listAllAuthorities: jest.fn(),
  listAuthoritySchools: jest.fn(),
  getAuthorityBySlug: jest.fn(),
  getEntriesForLA: jest.fn(),
}));

const request = require('supertest');
const express = require('express');
const laDb = require('../db/laTermDates');
const router = require('./termDatesSsr');

const app = () => {
  const a = express();
  a.use('/school-term-dates', router);
  return a;
};

const AUTHORITIES = [
  { name: 'Hertfordshire', slug: 'hertfordshire', region: 'England', import_status: 'ok' },
  { name: 'Cardiff', slug: 'cardiff', region: 'Wales', import_status: 'partial' },
  { name: 'Nevershire', slug: 'nevershire', region: 'England', import_status: 'pending' },
  { name: 'Brokenshire', slug: 'brokenshire', region: 'England', import_status: 'failed' },
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
  });

  it('carries the data attributes the client-side filter reads', async () => {
    const res = await request(app()).get('/school-term-dates/');
    expect(res.text).toContain('data-name="hertfordshire"');
    expect(res.text).toContain('data-region="England"');
    expect(res.text).toContain('data-region="Wales"');
  });

  it('excludes councils that never imported', async () => {
    const res = await request(app()).get('/school-term-dates/');
    expect(res.text).not.toContain('nevershire');
    expect(res.text).not.toContain('brokenshire');
  });

  it('escapes authority names in the injected markup', async () => {
    laDb.listAllAuthorities.mockResolvedValue([
      { name: 'Evil<script>alert(1)</script>', slug: 'evil', region: 'England', import_status: 'ok' },
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
      region: 'England', import_status: 'ok', source_url: 'https://www.hertfordshire.gov.uk/term-dates',
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
      { name: 'Barnet', slug: 'barnet', region: 'England', import_status: 'ok' },
      { name: 'Hertfordshire', slug: 'hertfordshire', region: 'England', import_status: 'ok' },
      { name: 'Kent', slug: 'kent', region: 'England', import_status: 'ok' },
      { name: 'Luton', slug: 'luton', region: 'England', import_status: 'failed' }, // dead → never linked
      { name: 'Surrey', slug: 'surrey', region: 'England', import_status: 'partial' },
    ]);
    const res = await request(app()).get('/school-term-dates/hertfordshire');
    expect(res.status).toBe(200);
    expect(res.text).toContain('More UK council term dates');
    // Cyclic window starts after Hertfordshire alphabetically: Kent, Surrey, wraps to Barnet.
    expect(res.text).toContain('href="/school-term-dates/kent"');
    expect(res.text).toContain('href="/school-term-dates/surrey"');
    expect(res.text).toContain('href="/school-term-dates/barnet"');
    expect(res.text).not.toContain('href="/school-term-dates/luton"'); // failed import
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
    expect(res.text).not.toContain('October half term');            // fact missing -> question dropped
  });


  it('links back to housemait.com from every council page (footer)', async () => {
    const res = await request(app()).get('/school-term-dates/hertfordshire');
    expect(res.text).toContain('class="site-footer"');
    expect(res.text).toContain('href="https://housemait.com"');
    expect(res.text).toContain('housemait-logo.svg');
    expect(res.text).toContain('© ');
  });

  it('never-imported councils fall through rather than render empty pages', async () => {
    laDb.getAuthorityBySlug.mockResolvedValue({ id: 'x', name: 'Nevershire', slug: 'nevershire', import_status: 'pending' });
    const res = await request(app()).get('/school-term-dates/nevershire');
    expect(res.status).toBe(404);
  });
});

describe('GET /school-term-dates/:slug/term-dates.ics', () => {
  beforeEach(() => {
    laDb.getAuthorityBySlug.mockResolvedValue({
      id: 'la1', name: 'Hertfordshire', slug: 'hertfordshire', region: 'England', import_status: 'ok',
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
      id: 'la1', name: 'Hertfordshire', slug: 'hertfordshire', region: 'England', import_status: 'ok',
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
