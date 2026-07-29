/**
 * The alerting policy only executes during an outage - the exact moment it
 * must not be wrong. These tests pin the behaviour that matters: don't cry
 * wolf on a blip, do alert on a real outage, don't spam, and always send the
 * all-clear if you sent an alarm.
 */

// Factories, not automocks: automocking would require() the real modules to
// read their shape, and db-health pulls in the Supabase client, which throws
// without SUPABASE_* env vars present.
jest.mock('../utils/db-health', () => ({
  checkDatabase: jest.fn(),
  PROBE_TIMEOUT_MS: 5000,
}));
jest.mock('../services/email', () => ({ sendAdminAlert: jest.fn() }));

const { checkDatabase } = require('../utils/db-health');
const email = require('../services/email');
const monitor = require('./db-health-monitor');

const { runDbHealthCheck, _resetState, _internal } = monitor;

const OK = { ok: true, latencyMs: 40, code: null, message: null };
const DOWN = {
  ok: false,
  latencyMs: 1700,
  code: 'PGRST002',
  message: 'Could not query the database for the schema cache. Retrying.',
};

// Subjects distinguish the three email kinds the monitor can send.
const subjectsSent = () => email.sendAdminAlert.mock.calls.map((c) => c[0]);

beforeEach(() => {
  jest.clearAllMocks();
  email.sendAdminAlert.mockResolvedValue(undefined);
  _resetState();
});

describe('db health monitor alerting', () => {
  test('a single failed probe does NOT alert (transient blip)', async () => {
    checkDatabase.mockResolvedValue(DOWN);
    await runDbHealthCheck();
    expect(email.sendAdminAlert).not.toHaveBeenCalled();
  });

  test('alerts once the consecutive-failure threshold is crossed', async () => {
    checkDatabase.mockResolvedValue(DOWN);
    for (let i = 0; i < _internal.FAILURES_BEFORE_ALERT; i++) await runDbHealthCheck();

    expect(email.sendAdminAlert).toHaveBeenCalledTimes(1);
    expect(subjectsSent()[0]).toMatch(/unreachable/i);
    // The operator needs the actual PostgREST code in the mail, not just "down".
    expect(email.sendAdminAlert.mock.calls[0][1]).toContain('PGRST002');
  });

  test('does not re-alert on continued failure inside the quiet window', async () => {
    checkDatabase.mockResolvedValue(DOWN);
    for (let i = 0; i < 10; i++) await runDbHealthCheck();

    // 10 failing probes, still exactly one email.
    expect(email.sendAdminAlert).toHaveBeenCalledTimes(1);
  });

  test('re-alerts once the quiet window has elapsed', async () => {
    checkDatabase.mockResolvedValue(DOWN);
    for (let i = 0; i < _internal.FAILURES_BEFORE_ALERT; i++) await runDbHealthCheck();
    expect(email.sendAdminAlert).toHaveBeenCalledTimes(1);

    // Jump past the reminder interval.
    const realNow = Date.now;
    Date.now = () => realNow() + _internal.REMINDER_INTERVAL_MS + 1000;
    try {
      await runDbHealthCheck();
    } finally {
      Date.now = realNow;
    }

    expect(email.sendAdminAlert).toHaveBeenCalledTimes(2);
    expect(subjectsSent()[1]).toMatch(/STILL unreachable/i);
  });

  test('sends exactly one recovery email after an alerted outage', async () => {
    checkDatabase.mockResolvedValue(DOWN);
    for (let i = 0; i < _internal.FAILURES_BEFORE_ALERT; i++) await runDbHealthCheck();

    checkDatabase.mockResolvedValue(OK);
    await runDbHealthCheck();
    await runDbHealthCheck(); // still healthy - must not send a second all-clear

    expect(email.sendAdminAlert).toHaveBeenCalledTimes(2); // 1 outage + 1 recovery
    expect(subjectsSent()[1]).toMatch(/recovered/i);
  });

  test('a blip that recovers below the threshold sends NO email at all', async () => {
    checkDatabase.mockResolvedValue(DOWN);
    await runDbHealthCheck(); // 1 failure - under threshold

    checkDatabase.mockResolvedValue(OK);
    await runDbHealthCheck();

    expect(email.sendAdminAlert).not.toHaveBeenCalled();
  });

  test('a failed send is retried on the next tick rather than lost', async () => {
    checkDatabase.mockResolvedValue(DOWN);
    email.sendAdminAlert.mockRejectedValueOnce(new Error('Postmark unreachable'));

    for (let i = 0; i < _internal.FAILURES_BEFORE_ALERT; i++) await runDbHealthCheck();
    expect(email.sendAdminAlert).toHaveBeenCalledTimes(1); // attempted, threw

    await runDbHealthCheck(); // next tick retries because alertedAt never got set
    expect(email.sendAdminAlert).toHaveBeenCalledTimes(2);
  });

  test('a probe that throws is contained, not propagated', async () => {
    // cron calls this with no .catch(), so a rejection would become an
    // unhandled rejection and can take the process down. The monitor must
    // never be able to kill the server it is monitoring.
    checkDatabase.mockRejectedValue(new Error('unexpected'));
    const result = await runDbHealthCheck();
    expect(result.ok).toBe(false);
    expect(result.code).toBe('MONITOR_ERROR');
  });
});
