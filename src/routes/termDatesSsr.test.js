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
    ]);
  });

  it('CTA carries the acquisition tag and the council through to signup', async () => {
    const res = await request(app()).get('/school-term-dates/hertfordshire');
    expect(res.status).toBe(200);
    expect(res.text).toContain('href="https://housemait.com/signup?src=termdates&amp;la=hertfordshire"');
  });

  it('serves a share image so WhatsApp/Facebook previews render a card', async () => {
    const res = await request(app()).get('/school-term-dates/hertfordshire');
    expect(res.text).toContain('og:image');
    expect(res.text).toContain('https://housemait.com/school-term-dates/og-share.png');
    expect(res.text).toContain('summary_large_image');
  });

  it('never-imported councils fall through rather than render empty pages', async () => {
    laDb.getAuthorityBySlug.mockResolvedValue({ id: 'x', name: 'Nevershire', slug: 'nevershire', import_status: 'pending' });
    const res = await request(app()).get('/school-term-dates/nevershire');
    expect(res.status).toBe(404);
  });
});
