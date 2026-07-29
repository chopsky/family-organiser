/**
 * POST /api/schools/:schoolId/term-dates/confirm — the single save-after-
 * preview endpoint for the stepped import sheet.
 *
 * The whole point of the redesign is that a wrong choice costs one tap rather
 * than a year of wrong holidays, which only holds if nothing writes before
 * this endpoint. So the tests that matter are: it validates what it was handed
 * (the preview screen can edit anything), and it refuses rather than half-
 * saving.
 */
jest.mock('../db/queries', () => ({
  getHouseholdSchools: jest.fn(async () => [{ id: 's1', school_name: 'Wolfson Hillel' }]),
  deleteAllTermDatesBySchool: jest.fn(async () => {}),
  addSchoolTermDates: jest.fn(async () => {}),
  updateHouseholdSchoolMeta: jest.fn(async () => {}),
  updateHouseholdSchool: jest.fn(async () => {}),
}));
jest.mock('../middleware/auth', () => ({
  requireAuth: (req, _res, next) => { req.user = { id: 'u1' }; next(); },
  requireHousehold: (req, _res, next) => { req.householdId = 'h1'; next(); },
  requireAdmin: (_req, _res, next) => next(),
}));
jest.mock('../services/cache', () => ({ invalidate: jest.fn(), get: jest.fn(), set: jest.fn() }));
jest.mock('../db/client', () => ({ supabase: { from: jest.fn() }, supabaseAdmin: { from: jest.fn() }, getUserClient: jest.fn() }));
jest.mock('../services/term-date-extract', () => ({
  extractTermDatesPreview: jest.fn(),
  fetchTermDatesPageText: jest.fn(),
  academicYearsForCountry: jest.fn(() => ['2025-2026']),
  VALID_EVENT_TYPES: new Set(['term_start', 'term_end', 'half_term', 'inset_day', 'holiday']),
  TERM_FETCH_HEADERS: {},
}));

const express = require('express');
const request = require('supertest');
const db = require('../db/queries');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/schools', require('./schools'));
  return a;
}

const ROW = { event_type: 'term_start', date: '2025-09-01', label: 'Autumn term begins', academic_year: '2025-2026' };
const post = (body) => request(app()).post('/api/schools/s1/term-dates/confirm').send(body);

beforeEach(() => jest.clearAllMocks());

it('saves an approved set and records where it came from', async () => {
  const res = await post({ dates: [ROW], source: 'council' });

  expect(res.status).toBe(200);
  expect(db.addSchoolTermDates).toHaveBeenCalledWith('s1', [
    expect.objectContaining({ event_type: 'term_start', source: 'local_authority' }),
  ]);
  expect(db.updateHouseholdSchoolMeta).toHaveBeenCalledWith('s1', expect.objectContaining({
    term_dates_source: 'local_authority',
  }));
});

it('replaces what was there - this is also the wrong-import recovery path', async () => {
  await post({ dates: [ROW], source: 'website' });
  expect(db.deleteAllTermDatesBySchool).toHaveBeenCalledWith('s1');
});

it('only starts an iCal feed syncing once the dates are approved', async () => {
  // The preview deliberately does NOT save the URL: a feed the parent hasn't
  // approved must not sync into their calendar behind the preview screen.
  await post({ dates: [ROW], source: 'ical', source_label: 'https://school.test/cal.ics' });
  expect(db.updateHouseholdSchool).toHaveBeenCalledWith('s1', { ical_url: 'https://school.test/cal.ics' });
});

it('does not save an iCal URL for any other source', async () => {
  await post({ dates: [ROW], source: 'council', source_label: 'Enfield' });
  expect(db.updateHouseholdSchool).not.toHaveBeenCalled();
});

it.each([
  ['an unrecognised type', { ...ROW, event_type: 'wibble' }],
  ['a malformed date', { ...ROW, date: '1st Sept' }],
  ['a malformed end date', { ...ROW, end_date: 'next tuesday' }],
  ['a missing academic year', { ...ROW, academic_year: undefined }],
])('refuses %s rather than saving part of the set', async (_label, row) => {
  const res = await post({ dates: [ROW, row], source: 'council' });

  expect(res.status).toBe(400);
  // Nothing half-written: the existing dates must survive a rejected import.
  expect(db.deleteAllTermDatesBySchool).not.toHaveBeenCalled();
  expect(db.addSchoolTermDates).not.toHaveBeenCalled();
});

it('refuses an unknown source', async () => {
  const res = await post({ dates: [ROW], source: 'telepathy' });
  expect(res.status).toBe(400);
  expect(db.addSchoolTermDates).not.toHaveBeenCalled();
});

it('refuses an empty set', async () => {
  const res = await post({ dates: [], source: 'council' });
  expect(res.status).toBe(400);
});
