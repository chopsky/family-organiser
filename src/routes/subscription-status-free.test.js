/**
 * GET /subscription/status under FREE_APP_MODE: the client learns the
 * flag and, for metered households, the meter numbers - that's what
 * flips the web UI from "expired read-only" to "Free plan".
 */
jest.mock('../db/queries');
jest.mock('../db/client', () => ({ supabase: {}, supabaseAdmin: {} }));
jest.mock('../middleware/auth', () => ({
  requireAuth: (req, _res, next) => { req.user = { id: 'u1' }; next(); },
  requireHousehold: (req, _res, next) => { req.householdId = 'h1'; next(); },
}));
jest.mock('../services/stripe', () => ({}));
jest.mock('../services/assistant-meter', () => {
  const real = jest.requireActual('../services/assistant-meter');
  return { ...real, meterStatus: jest.fn() };
});

const express = require('express');
const request = require('supertest');
const db = require('../db/queries');
const assistantMeter = require('../services/assistant-meter');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/subscription', require('./subscription'));
  return a;
}

beforeEach(() => jest.clearAllMocks());
afterEach(() => { delete process.env.FREE_APP_MODE; });

test('a lapsed household gets free_app_mode + its meter numbers', async () => {
  process.env.FREE_APP_MODE = '1';
  db.getHouseholdById.mockResolvedValue({
    id: 'h1', subscription_status: 'expired', timezone: 'Europe/London',
  });
  assistantMeter.meterStatus.mockResolvedValue({ used: 3, limit: 10, resetLabel: '1 September' });
  const res = await request(app()).get('/api/subscription/status');
  expect(res.body.free_app_mode).toBe(true);
  expect(res.body.meter).toEqual({ used: 3, limit: 10, reset_label: '1 September' });
});

test('an active household sees the flag but no meter block', async () => {
  process.env.FREE_APP_MODE = '1';
  db.getHouseholdById.mockResolvedValue({
    id: 'h1', subscription_status: 'active', timezone: 'Europe/London',
  });
  const res = await request(app()).get('/api/subscription/status');
  expect(res.body.free_app_mode).toBe(true);
  expect(res.body.meter).toBeUndefined();
  expect(assistantMeter.meterStatus).not.toHaveBeenCalled();
});

test('with the flag off, the field says so and nothing else changes', async () => {
  db.getHouseholdById.mockResolvedValue({
    id: 'h1', subscription_status: 'expired', timezone: 'Europe/London',
  });
  const res = await request(app()).get('/api/subscription/status');
  expect(res.body.free_app_mode).toBe(false);
  expect(res.body.meter).toBeUndefined();
  expect(res.body.status).toBe('expired');
});
