/**
 * Admin purge of empty households (0 users).
 *
 * The rows are the residue of abandoned signups and the pre-fix creation
 * race. The contract that matters: deletion re-verifies occupancy per row
 * (deleteEmptyHousehold declines when someone appeared between list and
 * purge), one stubborn row never aborts the sweep, and the response says
 * exactly what happened.
 */
jest.mock('../db/queries', () => ({
  getEmptyHouseholds: jest.fn(),
  deleteEmptyHousehold: jest.fn(),
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

const H = (id) => ({ id, name: 'The Nest', join_code: 'ABC123', created_at: '2026-07-30T00:00:00Z' });

beforeEach(() => jest.clearAllMocks());

it('lists the candidates with a count', async () => {
  db.getEmptyHouseholds.mockResolvedValue([H('h1'), H('h2')]);
  const res = await request(app()).get('/api/admin/empty-households');
  expect(res.status).toBe(200);
  expect(res.body.count).toBe(2);
  expect(res.body.households.map((h) => h.id)).toEqual(['h1', 'h2']);
});

it('purges every candidate and reports the tally', async () => {
  db.getEmptyHouseholds.mockResolvedValue([H('h1'), H('h2'), H('h3')]);
  db.deleteEmptyHousehold.mockResolvedValue(true);

  const res = await request(app()).post('/api/admin/empty-households/purge');

  expect(res.body).toEqual({ deleted: 3, skipped: 0, considered: 3 });
  expect(db.deleteEmptyHousehold).toHaveBeenCalledTimes(3);
});

it('a household that gained a user between list and purge is skipped, not deleted', async () => {
  db.getEmptyHouseholds.mockResolvedValue([H('h1'), H('h2')]);
  // deleteEmptyHousehold's own occupancy re-check declines h2.
  db.deleteEmptyHousehold.mockImplementation(async (id) => id !== 'h2');

  const res = await request(app()).post('/api/admin/empty-households/purge');

  expect(res.body).toEqual({ deleted: 1, skipped: 1, considered: 2 });
});

it('one stubborn row does not abort the sweep', async () => {
  db.getEmptyHouseholds.mockResolvedValue([H('h1'), H('h2'), H('h3')]);
  db.deleteEmptyHousehold.mockImplementation(async (id) => {
    if (id === 'h2') throw new Error('fk violation');
    return true;
  });

  const res = await request(app()).post('/api/admin/empty-households/purge');

  expect(res.body).toEqual({ deleted: 2, skipped: 1, considered: 3 });
});
