/**
 * getHouseholdInvitesAdmin: the admin answer to "did this household invite
 * someone who never joined?"
 *
 * Two shapes share the invites table and must not be conflated: NAMED
 * invites (a specific email was asked) and OPEN share-links (email = '',
 * the welcome screen's one-tap partner link, which names nobody).
 */
jest.mock('./client', () => ({ supabase: {}, supabaseAdmin: {} }));

const FUTURE = new Date(Date.now() + 7 * 86400000).toISOString();
const PAST = new Date(Date.now() - 7 * 86400000).toISOString();

const INVITES = [
  { id: 'i1', email: 'partner@gmail.com', name: 'Sasha', family_role: 'Mum', invited_by: 'u1', accepted_at: null, expires_at: FUTURE, created_at: '2026-09-01T00:00:00Z' },
  { id: 'i2', email: 'lapsed@gmail.com', name: null, family_role: null, invited_by: 'u1', accepted_at: null, expires_at: PAST, created_at: '2026-08-01T00:00:00Z' },
  { id: 'i3', email: 'joined@gmail.com', name: 'Matt', family_role: null, invited_by: 'u1', accepted_at: '2026-08-10T00:00:00Z', expires_at: PAST, created_at: '2026-08-05T00:00:00Z' },
  { id: 'i4', email: '', name: null, family_role: null, invited_by: 'u1', accepted_at: null, expires_at: FUTURE, created_at: '2026-09-02T00:00:00Z' },
];

function fakeDb(invites = INVITES) {
  return {
    from(table) {
      if (table === 'invites') {
        return { select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: invites, error: null }) }) }) };
      }
      if (table === 'users') {
        return { select: () => ({ in: () => Promise.resolve({ data: [{ id: 'u1', name: 'Mike' }], error: null }) }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

const { getHouseholdInvitesAdmin } = require('./queries');

describe('getHouseholdInvitesAdmin', () => {
  it('classifies pending, expired and accepted from accepted_at + expires_at', async () => {
    const out = await getHouseholdInvitesAdmin('hh1', fakeDb());
    const byId = Object.fromEntries(out.map((i) => [i.id, i]));
    expect(byId.i1.status).toBe('pending');
    expect(byId.i2.status).toBe('expired');
    expect(byId.i3.status).toBe('accepted');
  });

  it('separates open share-links from named invites and hides their empty email', async () => {
    const out = await getHouseholdInvitesAdmin('hh1', fakeDb());
    const link = out.find((i) => i.id === 'i4');
    expect(link.kind).toBe('share_link');
    expect(link.email).toBeNull();          // '' must never render as a person
    expect(out.filter((i) => i.kind === 'named')).toHaveLength(3);
  });

  it('resolves the inviter name for display', async () => {
    const out = await getHouseholdInvitesAdmin('hh1', fakeDb());
    expect(out[0].invited_by_name).toBe('Mike');
  });

  it('returns an empty array when nothing was ever sent', async () => {
    const out = await getHouseholdInvitesAdmin('hh1', fakeDb([]));
    expect(out).toEqual([]);
  });
});
