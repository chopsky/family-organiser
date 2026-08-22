/**
 * Household members can forward without allowlisting themselves.
 *
 * The regression this locks in: a new household starts with an empty
 * allowlist, so before this the most likely first use of email
 * forwarding was a silent rejection.
 */
jest.mock('./client', () => ({ supabase: {}, supabaseAdmin: {} }));

const db = require('./queries');

/** Minimal chainable Supabase stub: users -> members, senders -> rows. */
function stubDb({ members = [], senders = [] }) {
  const build = (rows) => {
    const q = {
      select: () => q,
      eq: () => q,
      ilike: () => q,
      limit: () => Promise.resolve({ data: rows, error: null }),
      then: (res) => Promise.resolve({ data: rows, error: null }).then(res),
    };
    return q;
  };
  return { from: (table) => build(table === 'users' ? members : senders) };
}

describe('isInboundSenderAllowed', () => {
  test('a household member is allowed on their own address, with an EMPTY allowlist', async () => {
    const ok = await db.isInboundSenderAllowed(
      'hh1', 'maxine@example.com', stubDb({ members: [{ id: 'u1' }], senders: [] }),
    );
    expect(ok).toBe(true);
  });

  test('a stranger is still blocked when the allowlist is empty', async () => {
    const ok = await db.isInboundSenderAllowed(
      'hh1', 'stranger@spam.example', stubDb({ members: [], senders: [] }),
    );
    expect(ok).toBe(false);
  });

  test('a non-member on the explicit allowlist is allowed (school office, work address)', async () => {
    const ok = await db.isInboundSenderAllowed(
      'hh1', 'office@school.example', stubDb({ members: [], senders: [{ id: 's1' }] }),
    );
    expect(ok).toBe(true);
  });

  test('an empty sender is never allowed', async () => {
    const ok = await db.isInboundSenderAllowed('hh1', '', stubDb({ members: [{ id: 'u1' }] }));
    expect(ok).toBe(false);
  });
});
