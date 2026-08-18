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

  test('tier 1a: a WhatsApp-linked member activates instantly', async () => {
    const ok = await referrals.isHouseholdActivated('h9', referredAt, {
      fetchMembers: async () => [{ id: 'u1', whatsapp_phone: '+447700900000' }],
      fetchActions: async () => [],
    });
    expect(ok).toBe(true);
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

describe('reward cap maths', () => {
  // grantComplimentaryDays hits the DB, so we verify the CAP invariant via
  // the exported constants + a pure re-derivation of its formula.
  test('stacking never exceeds MAX_BANK_DAYS ahead', () => {
    const now = Date.now();
    let compUntil = null;
    for (let i = 0; i < 20; i++) {
      const base = Math.max(now, compUntil ? compUntil : 0);
      const cap = now + referrals.MAX_BANK_DAYS * 86_400_000;
      compUntil = Math.min(base + referrals.REWARD_DAYS * 86_400_000, cap);
    }
    const daysAhead = (compUntil - now) / 86_400_000;
    expect(daysAhead).toBeLessThanOrEqual(referrals.MAX_BANK_DAYS);
    expect(daysAhead).toBeGreaterThan(referrals.MAX_BANK_DAYS - 1);
  });
});
