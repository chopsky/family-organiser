/**
 * Public availability endpoint. Onboarding claims the house-inbox
 * address before an account exists, so this door is unauthenticated -
 * which makes "never lies, never enumerates, never fails hard" the
 * whole contract.
 */
jest.mock('../db/client', () => ({ supabase: {}, supabaseAdmin: {} }));
jest.mock('../db/queries');

const request = require('supertest');
const express = require('express');
const db = require('../db/queries');

function app() {
  const a = express();
  a.use('/api/inbox', require('./inbox'));
  return a;
}

describe('GET /api/inbox/availability', () => {
  beforeEach(() => jest.resetAllMocks());

  test('a free, valid alias is available', async () => {
    db.isEmailAliasAvailable.mockResolvedValue(true);
    const res = await request(app()).get('/api/inbox/availability?alias=thecarters');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ available: true, normalised: 'thecarters' });
  });

  test('a taken alias reports taken, without naming who holds it', async () => {
    db.isEmailAliasAvailable.mockResolvedValue(false);
    const res = await request(app()).get('/api/inbox/availability?alias=thecarters');
    expect(res.body.available).toBe(false);
    expect(res.body.reason).toMatch(/taken/i);
    expect(JSON.stringify(res.body)).not.toMatch(/household|id/i);
  });

  test('invalid input is rejected by the shared validator, not the DB', async () => {
    const res = await request(app()).get('/api/inbox/availability?alias=ab');
    expect(res.body.available).toBe(false);
    expect(db.isEmailAliasAvailable).not.toHaveBeenCalled();
  });

  test('a reserved word is never available', async () => {
    const res = await request(app()).get('/api/inbox/availability?alias=support');
    expect(res.body.available).toBe(false);
    expect(db.isEmailAliasAvailable).not.toHaveBeenCalled();
  });

  test('a DB wobble fails SOFT - never tells someone a free address is taken', async () => {
    db.isEmailAliasAvailable.mockRejectedValue(new Error('boom'));
    const res = await request(app()).get('/api/inbox/availability?alias=thecarters');
    expect(res.status).toBe(200);
    expect(res.body.available).toBeNull();
  });
});
