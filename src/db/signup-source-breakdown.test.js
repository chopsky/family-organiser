/**
 * getSignupSourceBreakdown: the "are the ads producing signups?" table.
 * Pins the three rules that make the numbers honest: internal households
 * are excluded, gclid presence is what marks a signup as paid, and
 * untagged signups still appear (as their own row) so the total reconciles.
 */
jest.mock('../db/client', () => ({ supabase: {}, supabaseAdmin: {} }));

const USERS = [
  { id: 'u1', email: 'a@gmail.com', created_at: '2026-08-17T00:00:00Z', signup_source: 'termdates', signup_gclid: 'CjwKCAjw_abc123XYZ', onboarded_at: '2026-08-17T01:00:00Z', household_id: 'h1' },
  { id: 'u2', email: 'b@gmail.com', created_at: '2026-08-17T00:00:00Z', signup_source: 'termdates', signup_gclid: null, onboarded_at: null, household_id: 'h2' },
  { id: 'u3', email: 'c@gmail.com', created_at: '2026-08-17T00:00:00Z', signup_source: 'rsvp', signup_gclid: null, onboarded_at: '2026-08-17T01:00:00Z', household_id: 'h3' },
  { id: 'u4', email: 'd@gmail.com', created_at: '2026-08-17T00:00:00Z', signup_source: null, signup_gclid: null, onboarded_at: null, household_id: 'h4' },
  { id: 'u5', email: 'internal@gmail.com', created_at: '2026-08-17T00:00:00Z', signup_source: 'termdates', signup_gclid: 'CjwKCAjw_internal99', onboarded_at: null, household_id: 'h-int' },
  { id: 'u6', email: 'x@example.com', created_at: '2026-08-17T00:00:00Z', signup_source: 'termdates', signup_gclid: null, onboarded_at: null, household_id: 'h6' },
];
const HHS = [
  { id: 'h1', is_internal: false }, { id: 'h2', is_internal: false },
  { id: 'h3', is_internal: false }, { id: 'h4', is_internal: false },
  { id: 'h-int', is_internal: true }, { id: 'h6', is_internal: false },
];

function fakeDb() {
  return {
    from(table) {
      if (table === 'users') {
        const q = { eq: () => q, gte: () => q, limit: () => Promise.resolve({ data: USERS, error: null }) };
        return { select: () => q };
      }
      if (table === 'households') {
        return { select: () => ({ in: () => Promise.resolve({ data: HHS }) }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

const { getSignupSourceBreakdown } = require('./queries');

describe('getSignupSourceBreakdown', () => {
  it('groups by source, splits paid via gclid, excludes internal + example.com', async () => {
    const out = await getSignupSourceBreakdown({ days: 30 }, fakeDb());
    // u5 (internal) and u6 (@example.com) excluded -> 4 real signups
    expect(out.total).toBe(4);
    const by = Object.fromEntries(out.sources.map((r) => [r.source, r]));
    expect(by.termdates).toEqual({ source: 'termdates', signups: 2, viaAds: 1, onboarded: 1 });
    expect(by.rsvp).toEqual({ source: 'rsvp', signups: 1, viaAds: 0, onboarded: 1 });
    expect(by.untagged).toEqual({ source: 'untagged', signups: 1, viaAds: 0, onboarded: 0 });
    // sorted by volume: termdates first
    expect(out.sources[0].source).toBe('termdates');
  });

  it('returns an empty shell on query error instead of throwing into the route', async () => {
    const db = { from: () => ({ select: () => ({ eq: () => ({ gte: () => ({ limit: () => Promise.resolve({ data: null, error: { message: 'boom' } }) }) }) }) }) };
    const out = await getSignupSourceBreakdown({ days: 30 }, db);
    expect(out).toEqual({ days: 30, total: 0, sources: [] });
  });
});
