jest.mock('../db/queries');
jest.mock('../services/email');
jest.mock('../db/client', () => ({ supabase: { from: jest.fn() }, supabaseAdmin: { from: jest.fn() } }));

const db = require('../db/queries');
const email = require('../services/email');
const { runFeedbackDigest } = require('./feedback-digest');

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test('sends the digest once per week (lock) with every section, even when empty', async () => {
  db.acquireSchedulerLock.mockResolvedValue(true);
  db.getFeedbackDigest.mockResolvedValue({ since: '2026-08-28T00:00:00Z', days: 7, feedback: [], deletions: [{ exit_reason: 'forgot' }], misses: [], chat: [] });
  expect(await runFeedbackDigest()).toBe(1);
  expect(db.getFeedbackDigest).toHaveBeenCalledWith({ days: 7 });
  expect(email.sendFeedbackDigestEmail).toHaveBeenCalledTimes(1);
});

test('a second instance that loses the lock does nothing', async () => {
  db.acquireSchedulerLock.mockResolvedValue(false);
  expect(await runFeedbackDigest()).toBeNull();
  expect(email.sendFeedbackDigestEmail).not.toHaveBeenCalled();
});
