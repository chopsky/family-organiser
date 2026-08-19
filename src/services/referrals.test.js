/**
 * Referral scheme unit tests: email normalisation (the anti-recycle key),
 * pilot gating, activation tiers, and the reward-stacking cap.
 * DB-touching paths are covered via injected deps; the supabase client is
 * stubbed so requiring the service never needs env vars.
 */
jest.mock('../db/client', () => ({ supabase: {}, supabaseAdmin: {} }));
jest.mock('../db/queries');

const referrals = require('./referrals');

describe('normalizeReferralEmail (one reward per email, ever)', () => {
  test('lowercases and strips +tags', () => {
    expect(referrals.normalizeReferralEmail('Foo.Bar+promo@Gmail.com')).toBe('foo.bar@gmail.com');
    expect(referrals.normalizeReferralEmail('PLAIN@EXAMPLE.COM')).toBe('plain@example.com');
  });
  test('same person recycled with a +tag maps to the same key', () => {
    const a = referrals.normalizeReferralEmail('friend@example.com');
    const b = referrals.normalizeReferralEmail('friend+again@example.com');
    expect(a).toBe(b);
  });
  test('tolerates junk', () => {
    expect(referrals.normalizeReferralEmail('')).toBe('');
    expect(referrals.normalizeReferralEmail(null)).toBe('');
    expect(referrals.normalizeReferralEmail('@nolocal.com')).toBe('@nolocal.com');
  });
});

describe('referralsEnabled (pilot gate)', () => {
  const OLD = process.env.REFERRAL_PILOT_HOUSEHOLDS;
  afterEach(() => {
    if (OLD === undefined) delete process.env.REFERRAL_PILOT_HOUSEHOLDS;
    else process.env.REFERRAL_PILOT_HOUSEHOLDS = OLD;
  });

  test('unset = disabled for everyone', () => {
    delete process.env.REFERRAL_PILOT_HOUSEHOLDS;
    expect(referrals.referralsEnabled('h1')).toBe(false);
  });
  test('list = only those households', () => {
    process.env.REFERRAL_PILOT_HOUSEHOLDS = 'h1, h2';
    expect(referrals.referralsEnabled('h1')).toBe(true);
    expect(referrals.referralsEnabled('h2')).toBe(true);
    expect(referrals.referralsEnabled('h3')).toBe(false);
  });
  test('star = everyone (GA)', () => {
    process.env.REFERRAL_PILOT_HOUSEHOLDS = '*';
    expect(referrals.referralsEnabled('anything')).toBe(true);
  });
});

describe('isHouseholdActivated (the anti-farm gate)', () => {
  const referredAt = '2026-08-01T10:00:00Z';
  const day = (n, h = 12) => new Date(Date.parse(referredAt) + n * 86_400_000 + h).getTime();

  test('tier 1a: a WhatsApp link ALONE no longer activates (setup, not usage)', async () => {
    const ok = await referrals.isHouseholdActivated('h9', referredAt, {
      fetchMembers: async () => [{ id: 'u1', whatsapp_phone: '+447700900000' }],
      fetchActions: async () => [],
      fetchSetup: async () => [],
    });
    expect(ok).toBe(false);
  });

  test('tier 1a: WhatsApp plus one usage action activates instantly', async () => {
    const ok = await referrals.isHouseholdActivated('h9', referredAt, {
      fetchMembers: async () => [{ id: 'u1', whatsapp_phone: '+447700900000' }],
      fetchActions: async () => [day(0)],
      fetchSetup: async () => [],
    });
    expect(ok).toBe(true);
  });

  test('tier 1a: WhatsApp plus a setup signal (kid or pet added) activates instantly', async () => {
    const ok = await referrals.isHouseholdActivated('h9', referredAt, {
      fetchMembers: async () => [{ id: 'u1', whatsapp_phone: '+447700900000' }],
      fetchActions: async () => [],
      fetchSetup: async () => [day(0)],
    });
    expect(ok).toBe(true);
  });

  test('tier 1b: setup signals alone never satisfy the action requirement', async () => {
    // Two email addresses + a joined member must NOT mint a reward with
    // zero product use - that would be the free farm path.
    const ok = await referrals.isHouseholdActivated('h9', referredAt, {
      fetchMembers: async () => [{ id: 'u1' }, { id: 'u2' }],
      fetchActions: async () => [],
      fetchSetup: async () => [day(0), day(0)],
    });
    expect(ok).toBe(false);
  });

  test('tier 1b: two real members plus any action', async () => {
    const ok = await referrals.isHouseholdActivated('h9', referredAt, {
      fetchMembers: async () => [{ id: 'u1' }, { id: 'u2' }],
      fetchActions: async () => [day(0)],
    });
    expect(ok).toBe(true);
  });

  test('tier 2: five actions across two distinct days', async () => {
    const ok = await referrals.isHouseholdActivated('h9', referredAt, {
      fetchMembers: async () => [{ id: 'u1' }],
      fetchActions: async () => [day(0), day(0), day(0), day(1), day(1)],
    });
    expect(ok).toBe(true);
  });

  test('five actions in ONE sitting do not activate', async () => {
    const ok = await referrals.isHouseholdActivated('h9', referredAt, {
      fetchMembers: async () => [{ id: 'u1' }],
      fetchActions: async () => [day(0), day(0), day(0), day(0), day(0)],
    });
    expect(ok).toBe(false);
  });

  test('four actions across two days do not activate', async () => {
    const ok = await referrals.isHouseholdActivated('h9', referredAt, {
      fetchMembers: async () => [{ id: 'u1' }],
      fetchActions: async () => [day(0), day(0), day(1), day(1)],
    });
    expect(ok).toBe(false);
  });

  test('solo member with zero actions does not activate', async () => {
    const ok = await referrals.isHouseholdActivated('h9', referredAt, {
      fetchMembers: async () => [{ id: 'u1' }],
      fetchActions: async () => [],
    });
    expect(ok).toBe(false);
  });
});

describe('getActivationProgress (the gift-card checklist truth)', () => {
  const referredAt = '2026-08-01T10:00:00Z';

  test('mirrors tier 1a: whatsapp + first thing (usage or setup)', async () => {
    const p = await referrals.getActivationProgress('h9', referredAt, {
      fetchMembers: async () => [{ id: 'u1', whatsapp_phone: '+447700900000' }],
      fetchActions: async () => [],
      fetchSetup: async () => [Date.parse(referredAt) + 1000],
    });
    expect(p).toEqual({ whatsapp_linked: true, has_action: true });
  });

  test('fresh signup shows both steps open', async () => {
    const p = await referrals.getActivationProgress('h9', referredAt, {
      fetchMembers: async () => [{ id: 'u1' }],
      fetchActions: async () => [],
      fetchSetup: async () => [],
    });
    expect(p).toEqual({ whatsapp_linked: false, has_action: false });
  });
});

describe('reward maths (complimentaryBaseMs + cap)', () => {
  const DAY = 86_400_000;
  const now = Date.parse('2026-08-18T12:00:00Z');
  const iso = (ms) => new Date(ms).toISOString();

  test('credit banks after the trial, never alongside it', () => {
    // The founder's own test case: referred household mid-trial. A grant
    // based from `now` would expire the same day the trial does - worth
    // nothing. The base must be the trial end.
    const base = referrals.complimentaryBaseMs({ trial_ends_at: iso(now + 30 * DAY) }, now);
    expect(base).toBe(now + 30 * DAY);
  });

  test('for paying households the credit banks after the paid period', () => {
    const base = referrals.complimentaryBaseMs(
      { trial_ends_at: iso(now - 300 * DAY), subscription_current_period_end: iso(now + 20 * DAY) },
      now,
    );
    expect(base).toBe(now + 20 * DAY);
  });

  test('expired household with no future entitlement starts from now', () => {
    const base = referrals.complimentaryBaseMs({ trial_ends_at: iso(now - 40 * DAY) }, now);
    expect(base).toBe(now);
  });

  test('stacking never exceeds MAX_BANK_DAYS ahead', () => {
    const household = { trial_ends_at: iso(now + 30 * DAY), complimentary_until: null };
    for (let i = 0; i < 20; i++) {
      const base = referrals.complimentaryBaseMs(household, now);
      const cap = now + referrals.MAX_BANK_DAYS * DAY;
      household.complimentary_until = iso(Math.min(base + referrals.REWARD_DAYS * DAY, cap));
    }
    const daysAhead = (Date.parse(household.complimentary_until) - now) / DAY;
    expect(daysAhead).toBeLessThanOrEqual(referrals.MAX_BANK_DAYS);
    expect(daysAhead).toBeGreaterThan(referrals.MAX_BANK_DAYS - 1);
  });
});

describe('getIncomingReferral', () => {
  test('returns null when the table is unavailable (unmigrated tolerance)', async () => {
    // supabaseAdmin is stubbed as {} here, so the query throws internally -
    // the service must swallow it and report "no gift" rather than erroring.
    await expect(referrals.getIncomingReferral('h1')).resolves.toBeNull();
  });
});
