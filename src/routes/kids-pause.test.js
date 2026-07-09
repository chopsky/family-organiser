/**
 * Route tests for the kids' routine PAUSE (holiday / off-sick). DB + auth
 * mocked; asserts the pause state read + start/resume writes and the graceful
 * pre-migration behaviour.
 */
jest.mock('../db/queries');
jest.mock('../db/client', () => ({ supabase: {}, supabaseAdmin: {} }));
jest.mock('../middleware/auth', () => ({
  requireAuth: (req, _res, next) => { req.user = { id: 'me' }; next(); },
  requireHousehold: (req, _res, next) => { req.householdId = 'h1'; next(); },
}));
jest.mock('../services/r2', () => ({}));
jest.mock('../services/push', () => ({}));

const express = require('express');
const request = require('supertest');
const db = require('../db/queries');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/kids', require('./kids'));
  return a;
}

beforeEach(() => {
  jest.clearAllMocks();
  db.getHouseholdById.mockResolvedValue({ timezone: 'Europe/London' });
  db.getKidPauses.mockResolvedValue([]); // table exists, not paused
  db.startKidPause.mockResolvedValue({ paused: true, since: '2026-07-15' });
  db.endKidPause.mockResolvedValue({ paused: false });
});

describe('GET /api/kids/pause', () => {
  test('reports not paused when there is no open window', async () => {
    const res = await request(app()).get('/api/kids/pause?member_id=m');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ available: true, paused: false, since: null });
  });

  test('reports the open pause when one exists', async () => {
    db.getKidPauses.mockResolvedValue([{ start_date: '2026-07-10', end_date: null }]);
    const res = await request(app()).get('/api/kids/pause?member_id=m');
    expect(res.body).toMatchObject({ available: true, paused: true, since: '2026-07-10' });
  });

  test('available:false when the table is missing (pre-migration)', async () => {
    db.getKidPauses.mockResolvedValue(null);
    const res = await request(app()).get('/api/kids/pause?member_id=m');
    expect(res.body).toMatchObject({ available: false, paused: false });
  });
});

describe('POST /api/kids/pause (start) and /resume', () => {
  test('starts a pause and returns the since date', async () => {
    const res = await request(app()).post('/api/kids/pause').send({ member_id: 'm' });
    expect(res.status).toBe(200);
    expect(res.body.paused).toBe(true);
    expect(db.startKidPause).toHaveBeenCalledWith('h1', 'm', expect.any(String));
  });

  test('resume ends the pause', async () => {
    const res = await request(app()).post('/api/kids/pause/resume').send({ member_id: 'm' });
    expect(res.status).toBe(200);
    expect(res.body.paused).toBe(false);
    expect(db.endKidPause).toHaveBeenCalledWith('h1', 'm', expect.any(String));
  });

  test('start is 503 pre-migration (never silently no-ops)', async () => {
    db.startKidPause.mockResolvedValue({ unavailable: true });
    const res = await request(app()).post('/api/kids/pause').send({ member_id: 'm' });
    expect(res.status).toBe(503);
  });

  test('member_id is required', async () => {
    const res = await request(app()).post('/api/kids/pause').send({});
    expect(res.status).toBe(400);
    expect(db.startKidPause).not.toHaveBeenCalled();
  });
});
