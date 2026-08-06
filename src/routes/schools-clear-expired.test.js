/**
 * Bulk clear of finished activities - the start-of-term cleanup. Contract:
 * only activities whose end_date is in the past are deleted, an optional
 * child_id narrows the sweep, future/ongoing activities are never touched,
 * and one stubborn row doesn't abort the rest.
 */
jest.mock('../db/queries');
jest.mock('../db/client', () => ({ supabase: {}, supabaseAdmin: {} }));
jest.mock('../db/laTermDates', () => ({}));
jest.mock('../db/schoolDirectory', () => ({}));
jest.mock('../middleware/auth', () => ({
  requireAuth: (req, _res, next) => { req.user = { id: 'u1' }; next(); },
  requireHousehold: (req, _res, next) => { req.householdId = 'h1'; next(); },
  requireAdmin: (_req, _res, next) => next(),
}));
jest.mock('../services/ai', () => ({ findOfficialTermDatesUrl: jest.fn() }));
jest.mock('../services/ai-client', () => ({ callWithFailover: jest.fn(), LONG_TIMEOUT_MS: 1, REASONING_TIMEOUT_MS: 1 }));
jest.mock('../services/saTermDates', () => ({}));
jest.mock('../services/externalFeed', () => ({}));
jest.mock('../services/termDateValidator', () => ({ validateTermDates: jest.fn((r) => r) }));
jest.mock('../services/cache', () => ({ invalidate: jest.fn(), get: jest.fn(), set: jest.fn() }));
jest.mock('../services/term-date-extract', () => ({
  extractTermDatesPreview: jest.fn(), fetchTermDatesPageText: jest.fn(),
  academicYearsForCountry: jest.fn(() => ({ currentAY: '2025-2026', nextAY: '2026-2027' })),
  VALID_EVENT_TYPES: new Set(['term_start', 'term_end']), TERM_FETCH_HEADERS: {},
}));
jest.mock('../services/schoolDirectory', () => ({
  lookupDirectoryDatesForSchool: jest.fn(), seedOrCrossCheck: jest.fn(), maybeVerifyDirectorySchool: jest.fn(),
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

// Dates pinned relative to "now" so the suite never rots.
const past = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
const future = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

const ACTS = [
  { id: 'a1', child_id: 'kid1', activity: 'Art', end_date: past },
  { id: 'a2', child_id: 'kid1', activity: 'Swimming', end_date: past },
  { id: 'a3', child_id: 'kid2', activity: 'Football', end_date: past },
  { id: 'a4', child_id: 'kid1', activity: 'Tennis', end_date: future },   // next term - keep
  { id: 'a5', child_id: 'kid1', activity: 'Scouts', end_date: null },      // ongoing - keep
];

beforeEach(() => {
  jest.clearAllMocks();
  db.getHouseholdActivities.mockResolvedValue(ACTS);
  db.deleteChildActivity.mockResolvedValue();
});

test('child_id sweep deletes only that child\'s FINISHED activities', async () => {
  const res = await request(app()).post('/api/schools/activities/clear-expired').send({ child_id: 'kid1' });

  expect(res.status).toBe(200);
  expect(res.body).toEqual({ deleted: 2, considered: 2 });
  expect(db.deleteChildActivity).toHaveBeenCalledWith('a1');
  expect(db.deleteChildActivity).toHaveBeenCalledWith('a2');
  expect(db.deleteChildActivity).not.toHaveBeenCalledWith('a3'); // other child
  expect(db.deleteChildActivity).not.toHaveBeenCalledWith('a4'); // future term
  expect(db.deleteChildActivity).not.toHaveBeenCalledWith('a5'); // ongoing
});

test('no child_id sweeps the whole household', async () => {
  const res = await request(app()).post('/api/schools/activities/clear-expired').send({});
  expect(res.body).toEqual({ deleted: 3, considered: 3 });
});

test('one stubborn row does not abort the sweep', async () => {
  db.deleteChildActivity.mockImplementation(async (id) => {
    if (id === 'a1') throw new Error('fk violation');
  });
  const res = await request(app()).post('/api/schools/activities/clear-expired').send({ child_id: 'kid1' });
  expect(res.body).toEqual({ deleted: 1, considered: 2 });
});
