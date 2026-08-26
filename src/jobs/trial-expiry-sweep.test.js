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
    expect(out).toEqual({ flipped: 0, failed: 0, announced: 0 });
    expect(sel.eq).toHaveBeenCalledWith('subscription_status', 'trialing');
    expect(sel.eq).toHaveBeenCalledWith('is_internal', false);
    expect(sel.is).toHaveBeenCalledWith('trial_paused_at', null);
    expect(sel.lt).toHaveBeenCalledWith('trial_ends_at', expect.any(String));
  });

  it('skips households holding a live complimentary credit (referral reward)', async () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    const rows = [
      { id: 'hh-credited', trial_ends_at: '2026-08-01T00:00:00Z', complimentary_until: tomorrow },
      { id: 'hh-lapsed-credit', trial_ends_at: '2026-08-01T00:00:00Z', complimentary_until: yesterday },
    ];
    const sel = selectChain({ data: rows, error: null });
    const upd = updateChain({ error: null });
    supabaseAdmin.from
      .mockReturnValueOnce(sel)
      .mockReturnValue(upd);
    const out = await runTrialExpirySweep();
    // Only the household whose credit has lapsed gets flipped.
    expect(out.flipped).toBe(1);
    expect(upd.eq).toHaveBeenCalledWith('id', 'hh-lapsed-credit');
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
    expect(out).toEqual({ flipped: 2, failed: 0, announced: 0 });
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
    expect(out).toEqual({ flipped: 1, failed: 1, announced: 0 });
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

describe('announceLapsedDeals (the proactive lapse template)', () => {
  const { announceLapsedDeals } = require('./trial-expiry-sweep');
  const whatsapp = require('../services/whatsapp');
  jest.mock('../services/whatsapp', () => ({ sendTemplate: jest.fn() }));

  afterEach(() => {
    delete process.env.FREE_APP_MODE;
    delete process.env.TWILIO_TEMPLATE_LAPSE_ANNOUNCEMENT;
  });

  test('no-ops without BOTH the flag and the approved template SID', async () => {
    expect(await announceLapsedDeals()).toEqual({ announced: 0 });
    process.env.FREE_APP_MODE = '1';
    expect(await announceLapsedDeals()).toEqual({ announced: 0 });
    delete process.env.FREE_APP_MODE;
    process.env.TWILIO_TEMPLATE_LAPSE_ANNOUNCEMENT = 'HX' + 'a'.repeat(32);
    expect(await announceLapsedDeals()).toEqual({ announced: 0 });
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });

  test('sends the template to linked members, stamps the household, skips the unlinked', async () => {
    process.env.FREE_APP_MODE = '1';
    process.env.TWILIO_TEMPLATE_LAPSE_ANNOUNCEMENT = 'HX' + 'a'.repeat(32);
    whatsapp.sendTemplate.mockResolvedValue({});

    // households select: .select().in().is().eq().limit()
    const hhChain = { select: jest.fn(), in: jest.fn(), is: jest.fn(), eq: jest.fn(), limit: jest.fn() };
    hhChain.select.mockReturnValue(hhChain);
    hhChain.in.mockReturnValue(hhChain);
    hhChain.is.mockReturnValue(hhChain);
    hhChain.eq.mockReturnValue(hhChain);
    hhChain.limit.mockResolvedValue({
      data: [
        { id: 'h-linked', subscription_status: 'expired' },
        { id: 'h-unlinked', subscription_status: 'expired' },
      ],
      error: null,
    });
    // users select per household: .select().eq().eq()
    const usersFor = (rows) => {
      const c = { select: jest.fn(), eq: jest.fn() };
      c.select.mockReturnValue(c);
      c.eq.mockReturnValueOnce(c).mockResolvedValueOnce({ data: rows, error: null });
      return c;
    };
    const stamp = updateChain({ error: null });
    supabaseAdmin.from
      .mockReturnValueOnce(hhChain)                                              // households list
      .mockReturnValueOnce(usersFor([{ id: 'u1', whatsapp_phone: '+447', whatsapp_linked: true }])) // h-linked members
      .mockReturnValueOnce(stamp)                                                // h-linked stamp
      .mockReturnValueOnce(usersFor([]));                                        // h-unlinked members

    const out = await announceLapsedDeals();
    expect(out.announced).toBe(1);
    expect(whatsapp.sendTemplate).toHaveBeenCalledWith('+447', process.env.TWILIO_TEMPLATE_LAPSE_ANNOUNCEMENT, {});
    expect(stamp.update).toHaveBeenCalledWith(expect.objectContaining({ free_deal_announced_at: expect.any(String) }));
    // The unlinked household is NOT stamped - its in-chat backstop must
    // still fire (only 4 from() calls happened: no second stamp).
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(4);
  });
});
