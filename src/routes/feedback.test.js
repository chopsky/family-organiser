/**
 * Feedback routes: the Settings box stores + alerts with Reply-To the user,
 * and the day-3 one-tap answer link records a signup reason from a signed
 * token (and rejects a bad one).
 */
process.env.UNSUBSCRIBE_TOKEN_SECRET = process.env.UNSUBSCRIBE_TOKEN_SECRET || 'test-secret-for-feedback-links';

jest.mock('../db/queries');
jest.mock('../db/client', () => {
  const chain = { from: jest.fn().mockReturnThis(), select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }) };
  return { supabase: chain, supabaseAdmin: chain };
});
jest.mock('../services/email', () => ({
  sendUserFeedbackAlert: jest.fn().mockResolvedValue(),
}));

const request = require('supertest');
const app = require('../app');
const db = require('../db/queries');
const email = require('../services/email');
const { signToken } = require('../middleware/auth');
const { signAnswerToken } = require('../services/feedback');

const USER = { id: 'u-1', name: 'Sarah', email: 'sarah@example.com', role: 'admin', household_id: 'hh-1' };
const AUTH = { Authorization: `Bearer ${signToken({ userId: USER.id, householdId: 'hh-1', name: USER.name, role: USER.role })}` };

beforeEach(() => {
  jest.clearAllMocks();
  db.getUserById.mockResolvedValue(USER);
  db.insertUserFeedback.mockResolvedValue(true);
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('POST /api/feedback', () => {
  test('stores the message and alerts the founder with the user as Reply-To', async () => {
    const res = await request(app).post('/api/feedback').set(AUTH).send({ message: 'Please add a packed-lunch planner', context: 'settings' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, stored: true });
    expect(db.insertUserFeedback).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'u-1', household_id: 'hh-1', kind: 'app', message: 'Please add a packed-lunch planner', context: 'settings',
    }));
    expect(email.sendUserFeedbackAlert).toHaveBeenCalledWith(expect.objectContaining({
      user: expect.objectContaining({ email: 'sarah@example.com' }), message: 'Please add a packed-lunch planner',
    }));
  });

  test('still emails when the ledger write fails (migration pending)', async () => {
    db.insertUserFeedback.mockResolvedValue(false);
    const res = await request(app).post('/api/feedback').set(AUTH).send({ message: 'hi' });
    expect(res.status).toBe(200);
    expect(res.body.stored).toBe(false);
    expect(email.sendUserFeedbackAlert).toHaveBeenCalledTimes(1);
  });

  test('rejects an empty message and requires auth', async () => {
    expect((await request(app).post('/api/feedback').set(AUTH).send({ message: '   ' })).status).toBe(400);
    expect((await request(app).post('/api/feedback').send({ message: 'x' })).status).toBe(401);
    expect(email.sendUserFeedbackAlert).not.toHaveBeenCalled();
  });
});

describe('GET /api/feedback/why', () => {
  test('records the tapped reason from a signed token and thanks them', async () => {
    const token = signAnswerToken('u-1', 'hh-1');
    const res = await request(app).get('/api/feedback/why').query({ token, a: 'term_dates' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('School term dates');
    expect(db.insertUserFeedback).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'u-1', household_id: 'hh-1', kind: 'signup_reason', answer: 'term_dates' }));
    expect(email.sendUserFeedbackAlert).toHaveBeenCalledTimes(1);
  });

  test('a bad token or unknown answer records nothing', async () => {
    expect((await request(app).get('/api/feedback/why').query({ token: 'nope', a: 'meals' })).status).toBe(400);
    const token = signAnswerToken('u-1', 'hh-1');
    expect((await request(app).get('/api/feedback/why').query({ token, a: 'bitcoin' })).status).toBe(400);
    expect(db.insertUserFeedback).not.toHaveBeenCalled();
  });
});
