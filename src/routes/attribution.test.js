/**
 * Apple Ads attribution - the contract that matters is `stored`: the device
 * only marks itself done when we say so, which makes every failure mode
 * (pending migration, Apple outage, expired token) recoverable on the next
 * launch instead of silently lost.
 */
jest.mock('../db/queries', () => ({
  getUserAdAttribution: jest.fn(async () => ({ ad_attribution: null, ad_attribution_at: null })),
  setUserAdAttribution: jest.fn(async () => {}),
}));
jest.mock('../middleware/auth', () => ({
  requireAuth: (req, _res, next) => { req.user = { id: 'u1' }; next(); },
}));
jest.mock('../services/adservices', () => ({ redeemAttributionToken: jest.fn() }));

const express = require('express');
const request = require('supertest');
const db = require('../db/queries');
const { redeemAttributionToken } = require('../services/adservices');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/attribution', require('./attribution'));
  return a;
}

const post = (body) => request(app()).post('/api/attribution/adservices').send(body);

beforeEach(() => {
  jest.clearAllMocks();
  // clearAllMocks keeps implementations, so re-prime the default here or the
  // idempotency test's "already stamped" answer leaks into its neighbours.
  db.getUserAdAttribution.mockResolvedValue({ ad_attribution: null, ad_attribution_at: null });
});

it('stores an attributed install verbatim', async () => {
  const payload = { attribution: true, campaignId: 2144259176, adGroupId: 1, conversionType: 'Download' };
  redeemAttributionToken.mockResolvedValue({ ok: true, payload });

  const res = await post({ token: 'tok' });

  expect(res.body).toEqual({ stored: true, attributed: true });
  expect(db.setUserAdAttribution).toHaveBeenCalledWith('u1', payload);
});

it('stores organic as {attribution:false} so it is never re-asked', async () => {
  redeemAttributionToken.mockResolvedValue({ ok: true, payload: { attribution: false } });
  const res = await post({ token: 'tok' });
  expect(res.body).toEqual({ stored: true, attributed: false });
  expect(db.setUserAdAttribution).toHaveBeenCalledWith('u1', { attribution: false });
});

it('is idempotent: an existing stamp is final, Apple is not called again', async () => {
  db.getUserAdAttribution.mockResolvedValue({ ad_attribution: { attribution: false }, ad_attribution_at: '2026-07-30T00:00:00Z' });
  const res = await post({ token: 'tok' });
  expect(res.body).toEqual({ stored: true, already: true });
  expect(redeemAttributionToken).not.toHaveBeenCalled();
});

it('answers stored:false when Apple gave no answer - nothing persisted', async () => {
  redeemAttributionToken.mockResolvedValue({ ok: false });
  const res = await post({ token: 'tok' });
  expect(res.body).toEqual({ stored: false });
  expect(db.setUserAdAttribution).not.toHaveBeenCalled();
});

it('answers stored:false (not 500) while the migration is pending', async () => {
  db.getUserAdAttribution.mockRejectedValue(new Error('column users.ad_attribution does not exist'));
  const res = await post({ token: 'tok' });
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ stored: false });
});

it('rejects a missing token', async () => {
  const res = await post({});
  expect(res.status).toBe(400);
});
