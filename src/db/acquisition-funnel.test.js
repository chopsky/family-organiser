/**
 * getAcquisitionFunnel: recent sign-ups segmented by platform (iOS / Android /
 * web-only), each with the verified→onboarded→whatsapp→subscribed funnel.
 */
jest.mock('../db/client', () => ({ supabase: {}, supabaseAdmin: {} }));

const USERS = [
  { id: 'u1', email: 'a@gmail.com', created_at: '2026-07-19T00:00:00Z', email_verified: true, onboarded_at: '2026-07-19T01:00:00Z', whatsapp_linked: true, household_id: 'h1' },
  { id: 'u2', email: 'b@gmail.com', created_at: '2026-07-19T00:00:00Z', email_verified: true, onboarded_at: null, whatsapp_linked: false, household_id: 'h2' },
  { id: 'u3', email: 'c@gmail.com', created_at: '2026-07-19T00:00:00Z', email_verified: false, onboarded_at: null, whatsapp_linked: false, household_id: 'h3' },
  { id: 'u4', email: 'd@gmail.com', created_at: '2026-07-19T00:00:00Z', email_verified: true, onboarded_at: '2026-07-19T02:00:00Z', whatsapp_linked: true, household_id: 'h4' },
  { id: 'skip', email: 'x@example.com', created_at: '2026-07-19T00:00:00Z', email_verified: true, onboarded_at: null, whatsapp_linked: false, household_id: 'h5' },
];
// u1 = iOS device, u2 = android device, u3/u4 = no device (web-only)
const TOKENS = [
  { user_id: 'u1', platform: 'ios' },
  { user_id: 'u2', platform: 'android' },
];
const HHS = [{ id: 'h1', subscription_status: 'active' }, { id: 'h4', subscription_status: 'trialing' }];

function fakeDb() {
  return {
    from(table) {
      if (table === 'users') {
        const q = { eq: () => q, gte: () => q, limit: () => Promise.resolve({ data: USERS, error: null }) };
        return { select: () => q };
      }
      if (table === 'device_tokens') {
        return { select: () => ({ in: () => ({ eq: () => Promise.resolve({ data: TOKENS }) }) }) };
      }
      if (table === 'households') {
        return { select: () => ({ in: () => Promise.resolve({ data: HHS }) }) };
      }
      throw new Error('unexpected table ' + table);
    },
  };
}

const { getAcquisitionFunnel } = require('./queries');

test('segments by platform and excludes example.com test accounts', async () => {
  const r = await getAcquisitionFunnel({ days: 14 }, fakeDb());
  expect(r.total).toBe(4); // the example.com row is excluded
  expect(r.segments.ios.signups).toBe(1);      // u1
  expect(r.segments.android.signups).toBe(1);  // u2
  expect(r.segments.web_only.signups).toBe(2); // u3, u4 (no device token)
});

test('iOS segment carries the full funnel', async () => {
  const r = await getAcquisitionFunnel({ days: 14 }, fakeDb());
  const ios = r.segments.ios; // u1: verified, onboarded, whatsapp, active sub
  expect(ios).toMatchObject({ signups: 1, verified: 1, onboarded: 1, whatsapp: 1, subscribed: 1 });
});

test('web-only funnel counts onboarding but a trialing household is not "subscribed"', async () => {
  const r = await getAcquisitionFunnel({ days: 14 }, fakeDb());
  const web = r.segments.web_only; // u3 (nothing) + u4 (verified+onboarded+whatsapp, trialing)
  expect(web.signups).toBe(2);
  expect(web.verified).toBe(1);
  expect(web.onboarded).toBe(1);
  expect(web.subscribed).toBe(0); // trialing != active
});
