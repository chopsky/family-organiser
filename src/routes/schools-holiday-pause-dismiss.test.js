/**
 * Household-wide holiday-pause dismissal. Contract: one adult dismissing
 * the keep-running card records it for the whole household; the activities
 * GET carries the stored value back (null pre-migration, never an error);
 * the dismiss endpoint validates its date and always succeeds from the
 * user's point of view - pre-migration it is a silent no-op.
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

describe('household-wide holiday-pause dismissal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.getHouseholdActivities.mockResolvedValue([{ id: 'a1' }]);
    db.getHolidayPauseDismissedUpto.mockResolvedValue('2026-07-20');
    db.setHolidayPauseDismissedUpto.mockResolvedValue(undefined);
  });

  test('GET /activities carries the stored dismissal', async () => {
    const res = await request(app()).get('/api/schools/activities');
    expect(res.status).toBe(200);
    expect(res.body.holiday_pause_dismissed_upto).toBe('2026-07-20');
    expect(db.getHolidayPauseDismissedUpto).toHaveBeenCalledWith('h1');
  });

  test('GET /activities returns null pre-migration, never an error', async () => {
    db.getHolidayPauseDismissedUpto.mockResolvedValue(null);
    const res = await request(app()).get('/api/schools/activities');
    expect(res.status).toBe(200);
    expect(res.body.holiday_pause_dismissed_upto).toBeNull();
  });

  test('dismiss records the date for the household', async () => {
    const res = await request(app())
      .post('/api/schools/activities/holiday-pause-dismiss')
      .send({ up_to: '2026-07-20' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(db.setHolidayPauseDismissedUpto).toHaveBeenCalledWith('h1', '2026-07-20');
  });

  test('dismiss rejects a malformed date', async () => {
    const res = await request(app())
      .post('/api/schools/activities/holiday-pause-dismiss')
      .send({ up_to: 'yesterday' });
    expect(res.status).toBe(400);
    expect(db.setHolidayPauseDismissedUpto).not.toHaveBeenCalled();
  });
});
