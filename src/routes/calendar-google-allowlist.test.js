/**
 * Staged-rollout allowlist gate. With GOOGLE_CALENDAR_ALLOWLIST set, the Google
 * Calendar routes are visible ONLY to listed emails - so the feature can ship to
 * prod (flag on) while only the founder sees it. Everyone else gets
 * enabled:false (the card stays hidden) and a 404 on the action routes.
 *
 * The allowlist is read at module load, so it's set BEFORE requiring the router.
 */
const crypto = require('crypto');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
process.env.GOOGLE_CALENDAR_ENABLED = 'true';
process.env.GOOGLE_CALENDAR_ALLOWLIST = 'founder@home.com, Extra@Home.com';
process.env.GOOGLE_CALENDAR_CLIENT_ID = 'test-cid';
process.env.GOOGLE_CALENDAR_CLIENT_SECRET = 'test-secret';
process.env.CALENDAR_TOKEN_KEY = crypto.randomBytes(32).toString('base64');
process.env.API_URL = 'https://api.test';

jest.mock('../db/queries');
jest.mock('../db/client', () => ({ supabase: {}, supabaseAdmin: {} }));
jest.mock('../middleware/auth', () => ({
  requireAuth: (req, _res, next) => { req.user = { id: 'u1' }; req.householdId = 'h1'; next(); },
  requireHousehold: (_req, _res, next) => next(),
}));
jest.mock('../services/r2', () => ({}));
jest.mock('../services/push', () => ({}));
jest.mock('../services/broadcast', () => ({}));
jest.mock('../services/externalFeed', () => ({}));
jest.mock('../services/publicHolidays', () => ({}));
jest.mock('../services/deviceCalendarSync', () => ({}));
jest.mock('../services/cache', () => ({ get: jest.fn(), set: jest.fn(), invalidate: jest.fn() }));
jest.mock('../services/googleCalendar');
jest.mock('googleapis', () => ({
  google: { auth: { OAuth2: jest.fn().mockImplementation(() => ({ generateAuthUrl: () => 'https://accounts.google.com/x' })) } },
}));

const express = require('express');
const request = require('supertest');
const db = require('../db/queries');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/calendar', require('./calendar'));
  return a;
}

beforeEach(() => { jest.clearAllMocks(); });

describe('GOOGLE_CALENDAR_ALLOWLIST gate', () => {
  test('an allowlisted user sees the feature enabled', async () => {
    db.getUserById.mockResolvedValue({ id: 'u1', email: 'founder@home.com' });
    db.getCalendarConnectionByUser.mockResolvedValue(null);
    const res = await request(app()).get('/api/calendar/google/status');
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
  });

  test('matching is case-insensitive and trims spaces', async () => {
    db.getUserById.mockResolvedValue({ id: 'u1', email: 'extra@home.com' });
    db.getCalendarConnectionByUser.mockResolvedValue(null);
    const res = await request(app()).get('/api/calendar/google/status');
    expect(res.body.enabled).toBe(true);
  });

  test('a non-allowlisted user sees enabled:false (card stays hidden)', async () => {
    db.getUserById.mockResolvedValue({ id: 'u1', email: 'random@home.com' });
    const res = await request(app()).get('/api/calendar/google/status');
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
  });

  test('a non-allowlisted user is 404d on the connect + action routes', async () => {
    db.getUserById.mockResolvedValue({ id: 'u1', email: 'random@home.com' });
    const connect = await request(app()).get('/api/calendar/connect/google');
    expect(connect.status).toBe(404);
    const calendars = await request(app()).get('/api/calendar/google/calendars');
    expect(calendars.status).toBe(404);
    const select = await request(app()).post('/api/calendar/google/select').send({ calendars: [] });
    expect(select.status).toBe(404);
    const disconnect = await request(app()).delete('/api/calendar/google/disconnect');
    expect(disconnect.status).toBe(404);
  });
});
