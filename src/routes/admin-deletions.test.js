/**
 * Admin view of the deletion ledger.
 *
 * deletion_audit_log rows are written by DELETE /auth/account before the
 * destructive part; this endpoint is the founder's window into them. The
 * contract: newest-first passthrough, a sane default limit, and a hard cap
 * so ?limit=999999 can't drag the whole table over the wire.
 */
jest.mock('../db/queries', () => ({
  getDeletionLog: jest.fn(),
  recordAdminAction: jest.fn(async () => ({})),
}));
jest.mock('../middleware/auth', () => ({
  requireAuth: (req, _res, next) => { req.user = { id: 'admin1' }; next(); },
  requirePlatformAdmin: (_req, _res, next) => next(),
}));
// adminAudit is used as `router.use(adminAudit)` - the middleware itself,
// not a factory. Mocking it as a factory swallows next() and every request
// hangs.
jest.mock('../middleware/adminAudit', () => ({ adminAudit: (_req, _res, next) => next() }));
jest.mock('../jobs/reminders', () => ({
  sendDailyReminders: jest.fn(async () => {}),
  chooseDailyBriefChannel: jest.fn(() => 'push'),
}));
jest.mock('../services/digest-weather', () => ({ invalidateHouseholdWeatherCache: jest.fn() }));
jest.mock('../services/stripe', () => ({}));
jest.mock('../services/push', () => ({}));
jest.mock('../services/whatsapp-templates', () => ({ sendBroadcastToMember: jest.fn() }));
jest.mock('../services/setup-nudge', () => ({
  detectSetupGaps: jest.fn(), buildWhatsAppNudge: jest.fn(), buildPushNudge: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const db = require('../db/queries');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/admin', require('./admin'));
  return a;
}

const ROW = (id) => ({
  id,
  deleted_at: '2026-07-30T10:00:00Z',
  user_email: 'gone@example.com',
  household_name: 'The Leavers',
  deletion_mode: 'household_deleted',
});

beforeEach(() => jest.clearAllMocks());

it('returns the ledger with a count', async () => {
  db.getDeletionLog.mockResolvedValue([ROW('d1'), ROW('d2')]);
  const res = await request(app()).get('/api/admin/deletions');
  expect(res.status).toBe(200);
  expect(res.body.count).toBe(2);
  expect(res.body.deletions.map((d) => d.id)).toEqual(['d1', 'd2']);
  expect(db.getDeletionLog).toHaveBeenCalledWith(50);
});

it('caps the requested limit at 200', async () => {
  db.getDeletionLog.mockResolvedValue([]);
  await request(app()).get('/api/admin/deletions?limit=999999');
  expect(db.getDeletionLog).toHaveBeenCalledWith(200);
});

it('a broken ledger read answers 500, not a hang', async () => {
  db.getDeletionLog.mockRejectedValue(new Error('relation does not exist'));
  const res = await request(app()).get('/api/admin/deletions');
  expect(res.status).toBe(500);
});
