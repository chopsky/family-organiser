/**
 * Unit tests for the weekly calendar_events tombstone purge.
 *
 * The job is a thin RPC loop around the purge_calendar_tombstones() SQL
 * function - the tests pin the loop semantics: batch until a short batch,
 * stop on the safety cap, and degrade gracefully when the migration that
 * creates the function hasn't been applied yet.
 */

// Explicit factory - plain `jest.mock('../db/client')` auto-reads the real
// module first and trips the SUPABASE_* env check.
jest.mock('../db/client', () => ({
  supabaseAdmin: { rpc: jest.fn() },
  supabase:      { from: jest.fn() },
  getUserClient: jest.fn(),
  testConnection: jest.fn(),
}));

const { supabaseAdmin } = require('../db/client');
const { runCalendarTombstonePurge, _constants } = require('./calendar-tombstone-purge');

const { TOMBSTONE_RETENTION_DAYS, PURGE_BATCH_SIZE, MAX_BATCHES_PER_RUN } = _constants;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('runCalendarTombstonePurge', () => {
  test('calls the RPC with the 30-day retention and batch size', async () => {
    supabaseAdmin.rpc.mockResolvedValue({ data: 0, error: null });

    await runCalendarTombstonePurge();

    expect(supabaseAdmin.rpc).toHaveBeenCalledWith('purge_calendar_tombstones', {
      p_retention_days: TOMBSTONE_RETENTION_DAYS,
      p_batch_size: PURGE_BATCH_SIZE,
    });
    expect(TOMBSTONE_RETENTION_DAYS).toBe(30);
  });

  test('loops full batches and stops on the first short batch', async () => {
    supabaseAdmin.rpc
      .mockResolvedValueOnce({ data: PURGE_BATCH_SIZE, error: null })
      .mockResolvedValueOnce({ data: PURGE_BATCH_SIZE, error: null })
      .mockResolvedValueOnce({ data: 42, error: null });

    const total = await runCalendarTombstonePurge();

    expect(total).toBe(PURGE_BATCH_SIZE * 2 + 42);
    expect(supabaseAdmin.rpc).toHaveBeenCalledTimes(3);
  });

  test('an empty first batch is a clean 0', async () => {
    supabaseAdmin.rpc.mockResolvedValue({ data: 0, error: null });

    const total = await runCalendarTombstonePurge();

    expect(total).toBe(0);
    expect(supabaseAdmin.rpc).toHaveBeenCalledTimes(1);
  });

  test('stops at the batch cap so a runaway backlog cannot loop forever', async () => {
    supabaseAdmin.rpc.mockResolvedValue({ data: PURGE_BATCH_SIZE, error: null });

    const total = await runCalendarTombstonePurge();

    expect(supabaseAdmin.rpc).toHaveBeenCalledTimes(MAX_BATCHES_PER_RUN);
    expect(total).toBe(PURGE_BATCH_SIZE * MAX_BATCHES_PER_RUN);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('cap'));
  });

  test('missing SQL function (migration not applied) warns and no-ops', async () => {
    supabaseAdmin.rpc.mockResolvedValue({
      data: null,
      error: { message: 'Could not find the function public.purge_calendar_tombstones', code: 'PGRST202' },
    });

    const total = await runCalendarTombstonePurge();

    expect(total).toBe(0);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('migration-calendar-tombstone-purge.sql')
    );
    expect(console.error).not.toHaveBeenCalled();
  });

  test('other RPC errors log and stop without throwing, keeping earlier batches', async () => {
    supabaseAdmin.rpc
      .mockResolvedValueOnce({ data: PURGE_BATCH_SIZE, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'statement timeout' } });

    const total = await runCalendarTombstonePurge();

    expect(total).toBe(PURGE_BATCH_SIZE);
    expect(console.error).toHaveBeenCalledWith(
      '[tombstone-purge] batch failed:',
      'statement timeout'
    );
  });
});
