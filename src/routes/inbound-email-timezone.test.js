/**
 * Email-forward events must store UTC instants converted from the
 * household's timezone. The route used to write the AI's local
 * wall-clock time as a naive string, which Postgres reads as UTC -
 * during BST every emailed appointment landed an hour late (Maxine's
 * 6:45pm blood test showing as 7:45pm, reported 2026-08-13).
 */

const request = require('supertest');
const express = require('express');

jest.mock('../db/queries', () => ({
  getHouseholdByEmailAlias: jest.fn(),
  getHouseholdByInboundToken: jest.fn(),
  getHouseholdMembers: jest.fn(async () => []),
  getHouseholdSchools: jest.fn(async () => []),
  getShoppingList: jest.fn(async () => []),
  getRecentlyPurchasedNames: jest.fn(async () => []),
  getRecurringTaskTitles: jest.fn(async () => []),
  isInboundSenderAllowed: jest.fn(async () => true),
  checkDuplicateEmail: jest.fn(async () => false),
  createInboundEmailLog: jest.fn(async () => ({ id: 'log-1' })),
  updateInboundEmailLog: jest.fn(async () => ({})),
  touchInboundSender: jest.fn(async () => {}),
  resolveAssignees: jest.fn(() => ({ ids: [], names: [] })),
  createCalendarEvent: jest.fn(async (hh, ev) => ({ id: 'ev-1', ...ev })),
  saveEventAssignees: jest.fn(async () => {}),
  addTasks: jest.fn(async () => []),
}));
jest.mock('../services/ai', () => ({
  scanReceipt: jest.fn(),
  matchReceiptToList: jest.fn(),
  extractFromEmail: jest.fn(),
}));
jest.mock('../services/email-parser', () => ({
  extractEmailContent: jest.fn(() => ({ text: 'Your appointment is at 6:45pm', images: [], subject: 'Fwd: Appointment', from: 'maxine@example.com' })),
  extractAttachmentText: jest.fn(async () => ''),
}));
jest.mock('../services/email', () => ({
  sendInboundEmailConfirmation: jest.fn(async () => {}),
  sendInboundEmailNoResults: jest.fn(async () => {}),
}));

const db = require('../db/queries');
const { extractFromEmail } = require('../services/ai');
const inboundEmailRouter = require('./inbound-email');

const app = express();
app.use(express.json());
app.use('/api/inbound-email', inboundEmailRouter);

// The webhook 200s immediately and processes in a detached async block -
// flush the microtask queue until the mocked pipeline has run.
async function postAndSettle(body) {
  await request(app).post('/api/inbound-email/webhook').send(body).expect(200);
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
}

const WEBHOOK_BODY = { ToFull: [{ Email: 'parry-house@in.housemait.com' }], From: 'maxine@example.com' };

function mockHousehold(timezone) {
  db.getHouseholdByEmailAlias.mockResolvedValue({ id: 'hh-1', name: 'Parry House', country: 'GB', timezone });
}

beforeEach(() => {
  jest.clearAllMocks();
  db.isInboundSenderAllowed.mockResolvedValue(true);
  db.checkDuplicateEmail.mockResolvedValue(false);
  db.createInboundEmailLog.mockResolvedValue({ id: 'log-1' });
  db.createCalendarEvent.mockImplementation(async (hh, ev) => ({ id: 'ev-1', ...ev }));
});

describe('inbound email event timezone conversion', () => {
  test('BST wall-clock time is stored as the UTC instant', async () => {
    mockHousehold('Europe/London');
    extractFromEmail.mockResolvedValue({
      email_type: 'appointment',
      events: [{ title: 'Blood Test', date: '2026-08-14', start_time: '18:45', end_time: '19:45', all_day: false }],
    });
    await postAndSettle(WEBHOOK_BODY);
    expect(db.createCalendarEvent).toHaveBeenCalledTimes(1);
    const stored = db.createCalendarEvent.mock.calls[0][1];
    // 6:45pm London in August (BST, UTC+1) = 17:45 UTC
    expect(stored.start_time).toBe('2026-08-14T17:45:00Z');
    expect(stored.end_time).toBe('2026-08-14T18:45:00Z');
  });

  test('winter (GMT) times store unshifted', async () => {
    mockHousehold('Europe/London');
    extractFromEmail.mockResolvedValue({
      email_type: 'appointment',
      events: [{ title: 'Dentist', date: '2026-12-10', start_time: '09:30', end_time: null, all_day: false }],
    });
    await postAndSettle(WEBHOOK_BODY);
    const stored = db.createCalendarEvent.mock.calls[0][1];
    expect(stored.start_time).toBe('2026-12-10T09:30:00Z');
  });

  test('South African household converts from SAST (UTC+2)', async () => {
    mockHousehold('Africa/Johannesburg');
    extractFromEmail.mockResolvedValue({
      email_type: 'appointment',
      events: [{ title: 'Vet', date: '2026-08-14', start_time: '10:00', end_time: null, all_day: false }],
    });
    await postAndSettle(WEBHOOK_BODY);
    const stored = db.createCalendarEvent.mock.calls[0][1];
    expect(stored.start_time).toBe('2026-08-14T08:00:00Z');
  });

  test('all-day events keep the naive date-only convention', async () => {
    mockHousehold('Europe/London');
    extractFromEmail.mockResolvedValue({
      email_type: 'school',
      events: [{ title: 'INSET day', date: '2026-09-01', start_time: null, end_time: null, all_day: true }],
    });
    await postAndSettle(WEBHOOK_BODY);
    const stored = db.createCalendarEvent.mock.calls[0][1];
    expect(stored.start_time).toBe('2026-09-01T00:00:00');
    expect(stored.end_time).toBe('2026-09-01T23:59:59');
  });
});
