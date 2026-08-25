/**
 * Paywall telemetry: the one contract that matters is that the scoreboard
 * can never break the wall - bad input and missing tables answer 200.
 */
jest.mock('../db/queries');
jest.mock('../db/client', () => ({ supabase: {}, supabaseAdmin: {} }));
jest.mock('../middleware/auth', () => ({
  requireAuth: (req, _res, next) => { req.user = { id: 'u1' }; next(); },
  requireHousehold: (req, _res, next) => { req.householdId = 'h1'; next(); },
}));

const express = require('express');
const request = require('supertest');
const db = require('../db/queries');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/telemetry', require('./telemetry'));
  return a;
}

beforeEach(() => jest.clearAllMocks());

test('records a wall outcome with household + user + context', async () => {
  db.recordPaywallEvent.mockResolvedValue();
  const res = await request(app()).post('/api/telemetry/paywall').send({ outcome: 'shown', context: 'gate' });
  expect(res.body).toEqual({ ok: true });
  expect(db.recordPaywallEvent).toHaveBeenCalledWith({
    householdId: 'h1', userId: 'u1', outcome: 'shown', context: 'gate',
  });
});

test('unknown outcome never reaches the DB, unknown context defaults', async () => {
  const res = await request(app()).post('/api/telemetry/paywall').send({ outcome: 'exploded' });
  expect(res.body).toEqual({ ok: false });
  expect(db.recordPaywallEvent).not.toHaveBeenCalled();
  db.recordPaywallEvent.mockResolvedValue();
  await request(app()).post('/api/telemetry/paywall').send({ outcome: 'converted', context: 'weird' });
  expect(db.recordPaywallEvent).toHaveBeenCalledWith(expect.objectContaining({ context: 'onboarding' }));
});

test('a missing table (migration pending) answers 200, never 500', async () => {
  db.recordPaywallEvent.mockRejectedValue(new Error('relation "paywall_events" does not exist'));
  const res = await request(app()).post('/api/telemetry/paywall').send({ outcome: 'shown' });
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ ok: false });
});
