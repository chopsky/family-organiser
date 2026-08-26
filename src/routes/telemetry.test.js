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

// --- Onboarding step telemetry (unauthenticated, same never-break contract) ---

const ANON = 'a41f0c8e-9d21-4b1a-8a3e-1f2d3c4b5a69';

test('records an anonymous onboarding step', async () => {
  db.recordOnboardingEvent.mockResolvedValue();
  const res = await request(app()).post('/api/telemetry/onboarding')
    .send({ anonId: ANON, step: 'house', action: 'enter', platform: 'ios' });
  expect(res.body).toEqual({ ok: true });
  expect(db.recordOnboardingEvent).toHaveBeenCalledWith({
    anonId: ANON, step: 'house', action: 'enter', platform: 'ios',
  });
});

test('garbage anonId, unknown step, and unknown action never reach the DB', async () => {
  for (const body of [
    { anonId: 'x', step: 'house', action: 'enter' },
    { anonId: `${ANON}'; DROP TABLE--`, step: 'house', action: 'enter' },
    { anonId: ANON, step: 'renamed-step', action: 'enter' },
    { anonId: ANON, step: 'house', action: 'exploded' },
  ]) {
    const res = await request(app()).post('/api/telemetry/onboarding').send(body);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: false });
  }
  expect(db.recordOnboardingEvent).not.toHaveBeenCalled();
});

test('onboarding events survive a missing table with 200, never 500', async () => {
  db.recordOnboardingEvent.mockRejectedValue(new Error('relation "onboarding_events" does not exist'));
  const res = await request(app()).post('/api/telemetry/onboarding')
    .send({ anonId: ANON, step: 'pains', action: 'enter' });
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ ok: false });
});
