/**
 * Unit tests for the extended retention job.
 *
 * Focus on the three new paths added alongside the existing log/token
 * sweeps: audit-log IP scrub, 12-month household retention, orphan
 * cleanup. The existing 90-day log sweeps already run through the same
 * `sweep()` helper and are well-exercised by other tests via the
 * chainable mock.
 */

jest.mock('../db/queries');
// Explicit factory — plain `jest.mock('../db/client')` auto-reads the real
// module first and trips the SUPABASE_* env check.
jest.mock('../db/client', () => ({
  supabaseAdmin: { from: jest.fn() },
  supabase:      { from: jest.fn() },
  getUserClient: jest.fn(),
  testConnection: jest.fn(),
}));

const { supabaseAdmin } = require('../db/client');
const db = require('../db/queries');
const {
  runHouseholdRetentionCleanup,
  runOrphanHouseholdCleanup,
  nullifyOldAuditLogIPs,
} = require('./retention');

// Helper: build a fresh mock chain per-table so each test can set up the
// exact query + error/count shape. The retention code uses distinct
// chains for SELECT (inside queries), UPDATE (IP scrub), and INSERT
// (audit log row), so a single chainable stub isn't enough.
function makeChain(overrides = {}) {
  const chain = {
    select: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    insert: jest.fn().mockResolvedValue({ data: null, error: null }),
    delete: jest.fn().mockReturnThis(),
    eq:     jest.fn().mockReturnThis(),
    lt:     jest.fn().mockReturnThis(),
    or:     jest.fn().mockReturnThis(),
    is:     jest.fn().mockReturnThis(),
    not:    jest.fn().mockReturnThis(),
    // Terminal thenable — most queries await the chain directly.
    then: (resolve) => resolve({ data: overrides.data ?? [], error: overrides.error ?? null, count: overrides.count ?? 0 }),
  };
  return chain;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

// ── nullifyOldAuditLogIPs ──────────────────────────────────────────────

describe('nullifyOldAuditLogIPs', () => {
  test('nulls IP + user-agent on rows older than the cutoff', async () => {
    const chain = makeChain({ count: 7 });
    supabaseAdmin.from.mockReturnValue(chain);

    const result = await nullifyOldAuditLogIPs('2026-01-22T00:00:00Z');

    expect(result).toBe(7);
    expect(supabaseAdmin.from).toHaveBeenCalledWith('deletion_audit_log');
    expect(chain.update).toHaveBeenCalledWith(
      { ip_address: null, user_agent: null },
      { count: 'exact' }
    );
    // Cutoff filter + "only rows that still have an IP" guard.
    expect(chain.lt).toHaveBeenCalledWith('deleted_at', '2026-01-22T00:00:00Z');
    expect(chain.not).toHaveBeenCalledWith('ip_address', 'is', null);
  });

  test('returns 0 on DB error without throwing', async () => {
    const chain = makeChain({ error: { message: 'boom' } });
    supabaseAdmin.from.mockReturnValue(chain);

    const result = await nullifyOldAuditLogIPs('2026-01-22T00:00:00Z');

    expect(result).toBe(0);
    expect(console.error).toHaveBeenCalled();
  });
});

// ── runHouseholdRetentionCleanup ──────────────────────────────────────

describe('runHouseholdRetentionCleanup', () => {
  test('finds inactive households older than 12 months and cascade-deletes each', async () => {
    const selectChain = makeChain({
      data: [
        { id: 'hh-old-1', name: 'The Smiths' },
        { id: 'hh-old-2', name: 'The Joneses' },
      ],
    });
    supabaseAdmin.from.mockReturnValue(selectChain);
    db.deleteHouseholdCascade.mockResolvedValue();

    const deleted = await runHouseholdRetentionCleanup();

    expect(deleted).toBe(2);
    expect(db.deleteHouseholdCascade).toHaveBeenCalledTimes(2);
    expect(db.deleteHouseholdCascade).toHaveBeenCalledWith('hh-old-1');
    expect(db.deleteHouseholdCascade).toHaveBeenCalledWith('hh-old-2');
    // Query used inactive_since + correct cutoff direction.
    expect(selectChain.not).toHaveBeenCalledWith('inactive_since', 'is', null);
    expect(selectChain.lt).toHaveBeenCalledWith('inactive_since', expect.any(String));
  });

  test('writes an audit row per deletion with null user fields', async () => {
    supabaseAdmin.from.mockReturnValue(makeChain({
      data: [{ id: 'hh-1', name: 'Household 1' }],
    }));
    db.deleteHouseholdCascade.mockResolvedValue();

    await runHouseholdRetentionCleanup();

    // Find the insert call on deletion_audit_log.
    const auditInsert = supabaseAdmin.from.mock.results
      .map((r) => r.value)
      .flatMap((chain) => chain.insert.mock.calls);
    expect(auditInsert.length).toBeGreaterThanOrEqual(1);
    const row = auditInsert[0][0];
    expect(row).toMatchObject({
      user_id: null,
      user_email: null,
      household_id: 'hh-1',
      household_name: 'Household 1',
      deletion_mode: 'household_deleted',
    });
  });

  test('one failing household does not block the rest', async () => {
    supabaseAdmin.from.mockReturnValue(makeChain({
      data: [{ id: 'hh-fail', name: 'Failing' }, { id: 'hh-ok', name: 'Ok' }],
    }));
    db.deleteHouseholdCascade
      .mockRejectedValueOnce(new Error('FK violation'))
      .mockResolvedValueOnce();

    const deleted = await runHouseholdRetentionCleanup();

    expect(deleted).toBe(1);
    expect(db.deleteHouseholdCascade).toHaveBeenCalledTimes(2);
  });

  test('no matching households is a clean 0 with no deletes', async () => {
    supabaseAdmin.from.mockReturnValue(makeChain({ data: [] }));

    const deleted = await runHouseholdRetentionCleanup();

    expect(deleted).toBe(0);
    expect(db.deleteHouseholdCascade).not.toHaveBeenCalled();
  });

  test('query failure returns 0 without throwing', async () => {
    supabaseAdmin.from.mockReturnValue(makeChain({ error: { message: 'boom' } }));

    const deleted = await runHouseholdRetentionCleanup();

    expect(deleted).toBe(0);
    expect(db.deleteHouseholdCascade).not.toHaveBeenCalled();
  });
});

// ── runOrphanHouseholdCleanup ─────────────────────────────────────────

describe('runOrphanHouseholdCleanup', () => {
  test('deletes households with zero account-type members, keeps ones with members', async () => {
    // First call: SELECT from households — returns 2 candidates.
    // Subsequent calls: SELECT count from users for each candidate.
    const candidatesChain = makeChain({
      data: [
        { id: 'hh-orphan', name: 'Abandoned', created_at: '2025-01-01' },
        { id: 'hh-alive',  name: 'Has Member', created_at: '2025-01-01' },
      ],
    });
    const orphanCountChain = makeChain({ count: 0 });
    const aliveCountChain  = makeChain({ count: 1 });

    supabaseAdmin.from
      .mockReturnValueOnce(candidatesChain)   // initial households SELECT
      .mockReturnValueOnce(orphanCountChain)  // user count for hh-orphan
      .mockReturnValueOnce(makeChain())       // insert deletion_audit_log for orphan
      .mockReturnValueOnce(aliveCountChain);  // user count for hh-alive

    db.deleteHouseholdCascade.mockResolvedValue();

    const deleted = await runOrphanHouseholdCleanup();

    expect(deleted).toBe(1);
    expect(db.deleteHouseholdCascade).toHaveBeenCalledTimes(1);
    expect(db.deleteHouseholdCascade).toHaveBeenCalledWith('hh-orphan');
  });

  test('respects the min-age guardrail (created_at > 30d ago)', async () => {
    const chain = makeChain({ data: [] });
    supabaseAdmin.from.mockReturnValue(chain);

    await runOrphanHouseholdCleanup();

    // Query must filter on created_at older than the cutoff.
    expect(chain.lt).toHaveBeenCalledWith('created_at', expect.any(String));
    // And exclude internal households.
    expect(chain.or).toHaveBeenCalledWith('is_internal.is.null,is_internal.eq.false');
  });

  test('query failure returns 0 without throwing', async () => {
    supabaseAdmin.from.mockReturnValue(makeChain({ error: { message: 'oops' } }));

    const deleted = await runOrphanHouseholdCleanup();

    expect(deleted).toBe(0);
    expect(db.deleteHouseholdCascade).not.toHaveBeenCalled();
  });

  test('count error on one candidate does not block the others', async () => {
    const candidatesChain = makeChain({
      data: [
        { id: 'hh-err', name: 'Count Errors', created_at: '2025-01-01' },
        { id: 'hh-ok',  name: 'Ok', created_at: '2025-01-01' },
      ],
    });
    const errorCountChain = makeChain({ error: { message: 'count failed' } });
    const okCountChain    = makeChain({ count: 0 });

    supabaseAdmin.from
      .mockReturnValueOnce(candidatesChain)
      .mockReturnValueOnce(errorCountChain)
      .mockReturnValueOnce(okCountChain)
      .mockReturnValueOnce(makeChain()); // audit insert for hh-ok

    db.deleteHouseholdCascade.mockResolvedValue();

    const deleted = await runOrphanHouseholdCleanup();

    expect(deleted).toBe(1);
    expect(db.deleteHouseholdCascade).toHaveBeenCalledWith('hh-ok');
  });
});
