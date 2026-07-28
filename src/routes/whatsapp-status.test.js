/**
 * POST /api/whatsapp/status - Twilio delivery-status callback. Verifies the
 * signature guard, the SID→status recording, and the always-ack behaviour.
 */
jest.mock('twilio', () => ({ validateRequest: jest.fn(() => true) }));
jest.mock('../db/queries', () => ({ recordWhatsAppDeliveryStatus: jest.fn(() => Promise.resolve()) }));
// Stub the heavy require chain the whatsapp router pulls at load, so the
// router mounts without real services / Supabase / AI credentials.
jest.mock('../services/whatsapp', () => ({}));
jest.mock('../services/broadcast', () => ({}));
jest.mock('../bot/handlers', () => ({}));
jest.mock('../services/cache', () => ({ get: jest.fn(), set: jest.fn(), invalidate: jest.fn() }));
jest.mock('../services/document-extract', () => ({ isSupportedDocument: jest.fn(() => false) }));

const express = require('express');
const request = require('supertest');
const twilio = require('twilio');
const db = require('../db/queries');
const router = require('./whatsapp');

function app() {
  const a = express();
  a.use(express.urlencoded({ extended: false }));
  a.use('/api/whatsapp', router);
  return a;
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.TWILIO_AUTH_TOKEN = 'tok';
  twilio.validateRequest.mockReturnValue(true);
});

test('records a delivery status update and acks 204', async () => {
  const res = await request(app())
    .post('/api/whatsapp/status')
    .set('x-twilio-signature', 'sig').type('form')
    .send({ MessageSid: 'SM123', To: 'whatsapp:+447700900001', MessageStatus: 'delivered' });
  expect(res.status).toBe(204);
  expect(db.recordWhatsAppDeliveryStatus).toHaveBeenCalledWith(
    expect.objectContaining({ sid: 'SM123', status: 'delivered', toPhone: 'whatsapp:+447700900001' })
  );
});

test('passes the error code through on an undelivered callback', async () => {
  await request(app())
    .post('/api/whatsapp/status')
    .set('x-twilio-signature', 'sig').type('form')
    .send({ MessageSid: 'SM9', To: 'whatsapp:+447700900002', MessageStatus: 'undelivered', ErrorCode: '63024' });
  expect(db.recordWhatsAppDeliveryStatus).toHaveBeenCalledWith(
    expect.objectContaining({ sid: 'SM9', status: 'undelivered', errorCode: '63024' })
  );
});

test('rejects a forged callback (bad signature) and records nothing', async () => {
  twilio.validateRequest.mockReturnValue(false);
  const res = await request(app())
    .post('/api/whatsapp/status')
    .set('x-twilio-signature', 'bad').type('form')
    .send({ MessageSid: 'SM123', MessageStatus: 'delivered' });
  expect(res.status).toBe(403);
  expect(db.recordWhatsAppDeliveryStatus).not.toHaveBeenCalled();
});

describe('signature URL candidates', () => {
  // The live bug: TWILIO_WEBHOOK_URL was a single blanket override for a
  // router that serves TWO signed endpoints. Set to the /webhook URL - the
  // obvious value - it made every /status callback fail the check and get a
  // silent 403, which is why whatsapp_delivery_log never moved off the
  // submit status. Twilio signs the URL it actually POSTed to.
  const WEBHOOK = 'https://api.housemait.com/api/whatsapp/webhook';
  const STATUS = 'https://api.housemait.com/api/whatsapp/status';

  afterEach(() => { delete process.env.TWILIO_WEBHOOK_URL; });

  const fire = () => request(app())
    .post('/api/whatsapp/status')
    .set('x-twilio-signature', 'sig').type('form')
    .send({ MessageSid: 'SM1', To: 'whatsapp:+447700900001', MessageStatus: 'delivered' });

  it('accepts a /status callback while the override names /webhook', async () => {
    process.env.TWILIO_WEBHOOK_URL = WEBHOOK;
    // Twilio only ever signs the real URL, so this is the honest stub.
    twilio.validateRequest.mockImplementation((_t, _s, url) => url === STATUS);

    expect((await fire()).status).toBe(204);
    expect(db.recordWhatsAppDeliveryStatus).toHaveBeenCalled();
    expect(twilio.validateRequest).toHaveBeenCalledWith('tok', 'sig', STATUS, expect.anything());
  });

  it('still accepts a callback signed for the override URL exactly', async () => {
    process.env.TWILIO_WEBHOOK_URL = STATUS;
    twilio.validateRequest.mockImplementation((_t, _s, url) => url === STATUS);

    expect((await fire()).status).toBe(204);
  });

  it('rejects - loudly - when nothing matches', async () => {
    process.env.TWILIO_WEBHOOK_URL = WEBHOOK;
    twilio.validateRequest.mockReturnValue(false);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    expect((await fire()).status).toBe(403);
    expect(db.recordWhatsAppDeliveryStatus).not.toHaveBeenCalled();
    // A silent 403 is indistinguishable from "Twilio never called us" - that
    // ambiguity is what hid this for weeks.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('signature did not match'));
    warn.mockRestore();
  });

  it('falls back to the reconstructed URL when no override is set', async () => {
    twilio.validateRequest.mockImplementation((_t, _s, url) => url.endsWith('/api/whatsapp/status'));
    expect((await fire()).status).toBe(204);
  });
});
