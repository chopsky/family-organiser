/**
 * POST /api/admin/tools/trigger-morning-brief — previewing either brief.
 *
 * The evening brief is about TOMORROW and goes out at 20:00, so before this
 * endpoint took a variant there was no way to read its real copy without
 * waiting for 8pm. The morning default is pinned too: this endpoint is the
 * operator's fix-verification tool and an unqualified call must keep meaning
 * what it always meant.
 */
jest.mock('../db/queries', () => ({
  getUserByIdAdmin: jest.fn(),
  getActiveDeviceTokens: jest.fn(async () => []),
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
// admin.js requires stripe at module scope; the real one wants API keys.
jest.mock('../services/stripe', () => ({}));
jest.mock('../services/push', () => ({}));
jest.mock('../services/whatsapp-templates', () => ({ sendBroadcastToMember: jest.fn() }));
jest.mock('../services/setup-nudge', () => ({
  detectSetupGaps: jest.fn(), buildWhatsAppNudge: jest.fn(), buildPushNudge: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const db = require('../db/queries');
const reminders = require('../jobs/reminders');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/admin', require('./admin'));
  return a;
}

const ADMIN = { id: 'admin1', name: 'Grant', household_id: 'h1', whatsapp_linked: true, whatsapp_phone: '+447700900000' };

beforeEach(() => {
  jest.clearAllMocks();
  db.getUserByIdAdmin.mockResolvedValue(ADMIN);
  db.getActiveDeviceTokens.mockResolvedValue([{ token: 't1' }]);
  reminders.chooseDailyBriefChannel.mockReturnValue('push');
});

const fire = (body) => request(app()).post('/api/admin/tools/trigger-morning-brief').send(body || {});

it('defaults to the morning brief when no variant is given', async () => {
  const res = await fire();

  expect(res.status).toBe(200);
  expect(reminders.sendDailyReminders).toHaveBeenCalledWith(
    'h1', ADMIN, { ignoreOptOut: true, variant: 'morning' },
  );
});

it('sends the evening brief when asked for it', async () => {
  const res = await fire({ variant: 'evening' });

  expect(res.status).toBe(200);
  expect(res.body.variant).toBe('evening');
  expect(res.body.label).toBe('evening heads-up');
  expect(reminders.sendDailyReminders).toHaveBeenCalledWith(
    'h1', ADMIN, { ignoreOptOut: true, variant: 'evening' },
  );
});

it('treats an unrecognised variant as morning rather than erroring', async () => {
  await fire({ variant: 'afternoon' });

  expect(reminders.sendDailyReminders).toHaveBeenCalledWith(
    'h1', ADMIN, { ignoreOptOut: true, variant: 'morning' },
  );
});

it('refuses an evening WhatsApp preview when the template is not configured', async () => {
  // Reporting a successful send that the WhatsApp path then silently skips is
  // worse than refusing: the operator would be waiting for a message that was
  // never going to arrive.
  const saved = process.env.TWILIO_TEMPLATE_EVENING_BRIEF;
  delete process.env.TWILIO_TEMPLATE_EVENING_BRIEF;
  reminders.chooseDailyBriefChannel.mockReturnValue('whatsapp');

  const res = await fire({ variant: 'evening' });

  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/TWILIO_TEMPLATE_EVENING_BRIEF/);
  expect(reminders.sendDailyReminders).not.toHaveBeenCalled();
  if (saved !== undefined) process.env.TWILIO_TEMPLATE_EVENING_BRIEF = saved;
});

it('allows an evening WhatsApp preview once the template IS configured', async () => {
  const saved = process.env.TWILIO_TEMPLATE_EVENING_BRIEF;
  process.env.TWILIO_TEMPLATE_EVENING_BRIEF = `HX${'a'.repeat(32)}`;
  reminders.chooseDailyBriefChannel.mockReturnValue('whatsapp');

  const res = await fire({ variant: 'evening' });

  expect(res.status).toBe(200);
  expect(reminders.sendDailyReminders).toHaveBeenCalled();
  if (saved === undefined) delete process.env.TWILIO_TEMPLATE_EVENING_BRIEF;
  else process.env.TWILIO_TEMPLATE_EVENING_BRIEF = saved;
});

it('never lets the morning preview be blocked by the evening template', async () => {
  const saved = process.env.TWILIO_TEMPLATE_EVENING_BRIEF;
  delete process.env.TWILIO_TEMPLATE_EVENING_BRIEF;
  reminders.chooseDailyBriefChannel.mockReturnValue('whatsapp');

  const res = await fire({ variant: 'morning' });

  expect(res.status).toBe(200);
  if (saved !== undefined) process.env.TWILIO_TEMPLATE_EVENING_BRIEF = saved;
});

describe('channel override', () => {
  // Push wins whenever the app is installed, so an admin with the app on their
  // phone could never see the WhatsApp copy - which is exactly what you need
  // to check after a template is approved.
  it('forces WhatsApp when asked, even though push would win', async () => {
    reminders.chooseDailyBriefChannel.mockReturnValue('push');
    const saved = process.env.TWILIO_TEMPLATE_EVENING_BRIEF;
    process.env.TWILIO_TEMPLATE_EVENING_BRIEF = `HX${'b'.repeat(32)}`;

    const res = await fire({ variant: 'evening', channel: 'whatsapp' });

    expect(res.status).toBe(200);
    expect(res.body.channel).toBe('whatsapp');
    expect(reminders.sendDailyReminders).toHaveBeenCalledWith(
      'h1', ADMIN, { ignoreOptOut: true, variant: 'evening', forceChannel: 'whatsapp' },
    );
    if (saved === undefined) delete process.env.TWILIO_TEMPLATE_EVENING_BRIEF;
    else process.env.TWILIO_TEMPLATE_EVENING_BRIEF = saved;
  });

  it('refuses to force WhatsApp for an admin who has none linked', async () => {
    db.getUserByIdAdmin.mockResolvedValue({ ...ADMIN, whatsapp_linked: false, whatsapp_phone: null });

    const res = await fire({ variant: 'morning', channel: 'whatsapp' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no WhatsApp linked/i);
    expect(reminders.sendDailyReminders).not.toHaveBeenCalled();
  });

  it('refuses to force push for an admin with no registered devices', async () => {
    db.getActiveDeviceTokens.mockResolvedValue([]);

    const res = await fire({ variant: 'morning', channel: 'push' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no registered push devices/i);
  });

  it('ignores a nonsense channel and falls back to the normal choice', async () => {
    reminders.chooseDailyBriefChannel.mockReturnValue('push');

    const res = await fire({ variant: 'morning', channel: 'carrier-pigeon' });

    expect(res.status).toBe(200);
    expect(reminders.sendDailyReminders).toHaveBeenCalledWith(
      'h1', ADMIN, { ignoreOptOut: true, variant: 'morning' },
    );
  });
});
