/**
 * The sweep is bookkeeping, not access control - the middleware already
 * 402s overdue trials at request time. What these tests pin: only genuinely
 * overdue, unpaused, still-trialing rows get flipped; the update carries
 * the retention-clock timestamp; and one bad row doesn't abort the batch.
 */

jest.mock('../db/client', () => ({ supabaseAdmin: { from: jest.fn() } }));

const { supabaseAdmin } = require('../db/client');
const { runTrialExpirySweep } = require('./trial-expiry-sweep');

function selectChain(result) {
  const chain = { select: jest.fn(), eq: jest.fn(), is: jest.fn(), lt: jest.fn() };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.is.mockReturnValue(chain);
  chain.lt.mockResolvedValue(result);
  return chain;
}
function updateChain(result) {
  const chain = { update: jest.fn(), eq: jest.fn() };
  chain.update.mockReturnValue(chain);
  // second .eq() resolves (await triggers .then on the builder)
  chain.eq.mockReturnValueOnce(chain).mockResolvedValueOnce(result);
  return chain;
}

beforeEach(() => jest.clearAllMocks());

describe('runTrialExpirySweep', () => {
  it('queries only unpaused, overdue, trialing rows', async () => {
    const sel = selectChain({ data: [], error: null });
    supabaseAdmin.from.mockReturnValue(sel);
    const out = await runTrialExpirySweep();
    expect(out).toEqual({ flipped: 0, failed: 0 });
    expect(sel.eq).toHaveBeenCalledWith('subscription_status', 'trialing');
    expect(sel.is).toHaveBeenCalledWith('trial_paused_at', null);
    expect(sel.lt).toHaveBeenCalledWith('trial_ends_at', expect.any(String));
  });

  it('flips each overdue row with the conditional status guard and retention timestamp', async () => {
    const rows = [
      { id: 'hh-1', trial_ends_at: '2026-08-01T00:00:00Z' },
      { id: 'hh-2', trial_ends_at: '2026-07-15T00:00:00Z' },
    ];
    const sel = selectChain({ data: rows, error: null });
    const updates = [updateChain({ error: null }), updateChain({ error: null })];
    let call = 0;
    supabaseAdmin.from.mockImplementation(() => (call++ === 0 ? sel : updates[call - 2]));

    const out = await runTrialExpirySweep();
    expect(out).toEqual({ flipped: 2, failed: 0 });
    expect(updates[0].update).toHaveBeenCalledWith({
      subscription_status: 'expired',
      inactive_since: '2026-08-01T00:00:00Z',
    });
    // the race guard: WHERE id = ... AND subscription_status = 'trialing'
    expect(updates[0].eq).toHaveBeenNthCalledWith(1, 'id', 'hh-1');
    expect(updates[0].eq).toHaveBeenNthCalledWith(2, 'subscription_status', 'trialing');
  });

  it('a failing row does not abort the rest of the batch', async () => {
    const rows = [
      { id: 'hh-bad', trial_ends_at: '2026-08-01T00:00:00Z' },
      { id: 'hh-good', trial_ends_at: '2026-08-02T00:00:00Z' },
    ];
    const sel = selectChain({ data: rows, error: null });
    const updates = [updateChain({ error: { message: 'boom' } }), updateChain({ error: null })];
    let call = 0;
    supabaseAdmin.from.mockImplementation(() => (call++ === 0 ? sel : updates[call - 2]));

    const out = await runTrialExpirySweep();
    expect(out).toEqual({ flipped: 1, failed: 1 });
  });

  it('a fetch failure returns cleanly instead of throwing into the cron', async () => {
    const chain = { select: jest.fn(), eq: jest.fn(), is: jest.fn(), lt: jest.fn() };
    chain.select.mockReturnValue(chain);
    chain.eq.mockReturnValue(chain);
    chain.is.mockReturnValue(chain);
    chain.lt.mockResolvedValue({ data: null, error: { message: 'db down' } });
    supabaseAdmin.from.mockReturnValue(chain);
    const out = await runTrialExpirySweep();
    expect(out.flipped).toBe(0);
    expect(out.error).toBe('db down');
  });
});
