/**
 * WhatsApp webhook route tests.
 *
 * Focus: the expired-subscription gate must actually block. An expired or
 * cancelled household must get the 'trial has ended' reply and must NEVER
 * reach handlers.handleTextMessage (the billable AI path). This is the
 * regression test for the numMedia temporal-dead-zone bug, where the gate
 * threw a ReferenceError that the fail-open catch swallowed, letting expired
 * households fall through to a free AI reply.
 *
 * The route imports the DB + whatsapp/broadcast/handlers/document services at
 * load (all need real env/creds), so we mock that whole chain.
 */
const express = require('express');
const request = require('supertest');

jest.mock('../db/queries', () => ({
  getUserByWhatsAppPhone: jest.fn(),
  getHouseholdById: jest.fn(),
  getHouseholdMembers: jest.fn(() => Promise.resolve([])),
  touchWhatsAppInbound: jest.fn(),
  logWhatsAppMessage: jest.fn(),
  findUnusedPairingCode: jest.fn(() => Promise.resolve(null)),
  consumePairingCode: jest.fn(),
  updateUser: jest.fn(),
  getUserById: jest.fn(),
}));
jest.mock('../services/whatsapp', () => ({
  sendMessage: jest.fn(() => Promise.resolve()),
  isConfigured: jest.fn(() => true),
}));
jest.mock('../services/broadcast', () => ({ toHousehold: jest.fn(() => Promise.resolve()) }));
jest.mock('../bot/handlers', () => ({
  handleTextMessage: jest.fn(() => Promise.resolve({ response: 'ok', actions: [] })),
  handlePhoto: jest.fn(() => Promise.resolve({ response: 'ok' })),
  handleVoiceNote: jest.fn(() => Promise.resolve({ response: 'ok' })),
  handleDocument: jest.fn(() => Promise.resolve({ response: 'ok' })),
  buildBroadcastMessage: jest.fn(() => null),
}));
jest.mock('../services/cache', () => ({ invalidate: jest.fn(), invalidatePattern: jest.fn() }));
jest.mock('../services/document-extract', () => ({ isSupportedDocument: jest.fn(() => false) }));

const db = require('../db/queries');
const whatsapp = require('../services/whatsapp');
const handlers = require('../bot/handlers');
const whatsappRouter = require('./whatsapp');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use('/whatsapp', whatsappRouter);
  return app;
}

// The webhook acks Twilio with 200 immediately, then keeps processing async.
// Poll the assertion until the in-flight work settles.
async function waitFor(assertion, { timeout = 1500, interval = 10 } = {}) {
  const start = Date.now();
  for (;;) {
    try { assertion(); return; } catch (e) {
      if (Date.now() - start > timeout) throw e;
      await new Promise((r) => setTimeout(r, interval));
    }
  }
}

const PHONE = '+447700900000';
const LINKED_USER = { id: 'u1', household_id: 'h1', name: 'Grant', whatsapp_linked: true, whatsapp_phone: PHONE };
const TRIAL_ENDED = /trial has ended/i;

function postText(body) {
  return request(makeApp()).post('/whatsapp/webhook').type('form')
    .send({ From: `whatsapp:${PHONE}`, Body: body, NumMedia: '0' })
    .expect(200);
}

beforeEach(() => {
  jest.clearAllMocks();
  // Force the dev-allow path in verifyTwilioSignature (no token => allowed in
  // non-production), so the test doesn't have to sign requests.
  delete process.env.TWILIO_AUTH_TOKEN;
  process.env.NODE_ENV = 'test';
  db.getUserByWhatsAppPhone.mockResolvedValue(LINKED_USER);
  db.getHouseholdMembers.mockResolvedValue([LINKED_USER]);
});

describe('WhatsApp webhook subscription gate', () => {
  test('expired household gets the trial-ended reply and never reaches the AI handler', async () => {
    db.getHouseholdById.mockResolvedValue({ id: 'h1', is_internal: false, subscription_status: 'expired' });

    await postText('what is on my calendar this week?');

    await waitFor(() => expect(whatsapp.sendMessage).toHaveBeenCalledWith(PHONE, expect.stringMatching(TRIAL_ENDED)));
    expect(handlers.handleTextMessage).not.toHaveBeenCalled();
  });

  test('cancelled household is also blocked from the AI handler', async () => {
    db.getHouseholdById.mockResolvedValue({ id: 'h1', is_internal: false, subscription_status: 'cancelled' });

    await postText('add milk to the list');

    await waitFor(() => expect(whatsapp.sendMessage).toHaveBeenCalledWith(PHONE, expect.stringMatching(TRIAL_ENDED)));
    expect(handlers.handleTextMessage).not.toHaveBeenCalled();
  });

  test('active household reaches the AI handler and is not shown the paywall', async () => {
    db.getHouseholdById.mockResolvedValue({ id: 'h1', is_internal: false, subscription_status: 'active', timezone: 'Europe/London' });

    await postText('add milk to the list');

    await waitFor(() => expect(handlers.handleTextMessage).toHaveBeenCalled());
    expect(whatsapp.sendMessage).not.toHaveBeenCalledWith(PHONE, expect.stringMatching(TRIAL_ENDED));
  });

  test('trialing household reaches the AI handler', async () => {
    db.getHouseholdById.mockResolvedValue({ id: 'h1', is_internal: false, subscription_status: 'trialing', timezone: 'Europe/London' });

    await postText('add milk to the list');

    await waitFor(() => expect(handlers.handleTextMessage).toHaveBeenCalled());
    expect(whatsapp.sendMessage).not.toHaveBeenCalledWith(PHONE, expect.stringMatching(TRIAL_ENDED));
  });
});

describe('buildExpiredUpgradeMessage', () => {
  test('states the price and a one-tap /subscribe link, keeping the trial-ended phrase', () => {
    const msg = whatsappRouter.buildExpiredUpgradeMessage('https://housemait.com');
    expect(msg).toMatch(/trial has ended/i);
    expect(msg).toMatch(/£5\.99/);
    expect(msg).toMatch(/£59\.99/);
    expect(msg).toContain('https://housemait.com/subscribe');
  });

  test('falls back to the default domain and strips a trailing slash', () => {
    expect(whatsappRouter.buildExpiredUpgradeMessage()).toContain('https://housemait.com/subscribe');
    expect(whatsappRouter.buildExpiredUpgradeMessage('https://www.housemait.com/')).toContain('https://www.housemait.com/subscribe');
  });
});
