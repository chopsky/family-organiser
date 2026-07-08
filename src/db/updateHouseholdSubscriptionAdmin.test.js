jest.mock('./client', () => ({ supabaseAdmin: {}, supabase: {}, getUserClient: () => ({}), testConnection: () => {} }));
const { updateHouseholdSubscriptionAdmin } = require('./queries');

// Fake Supabase: each .from() yields a fresh builder. A chain that calls
// .update() is a WRITE (captures the payload, echoes it back); a chain that
// only .select()s is a READ (returns the primed current status).
function fakeDb(currentStatus, captured) {
  return {
    from() {
      let isUpdate = false;
      let payload = null;
      const b = {
        select() { return b; },
        eq() { return b; },
        update(p) { isUpdate = true; payload = p; return b; },
        single() {
          if (isUpdate) {
            captured.payload = payload;
            return Promise.resolve({ data: { id: 'h1', ...payload }, error: null });
          }
          return Promise.resolve({ data: { subscription_status: currentStatus }, error: null });
        },
      };
      return b;
    },
  };
}

const future = () => new Date(Date.now() + 30 * 864e5).toISOString();
const past = () => new Date(Date.now() - 5 * 864e5).toISOString();

describe('updateHouseholdSubscriptionAdmin — extend revives an expired trial', () => {
  test('future trial end on an EXPIRED household flips status to trialing + clears the retention clock', async () => {
    const cap = {};
    await updateHouseholdSubscriptionAdmin('h1', { trial_ends_at: future() }, fakeDb('expired', cap));
    expect(cap.payload.subscription_status).toBe('trialing');
    expect(cap.payload.inactive_since).toBeNull();
  });

  test('future trial end on a CANCELLED household also revives it', async () => {
    const cap = {};
    await updateHouseholdSubscriptionAdmin('h1', { trial_ends_at: future() }, fakeDb('cancelled', cap));
    expect(cap.payload.subscription_status).toBe('trialing');
  });

  test('never downgrades a paying (active) household', async () => {
    const cap = {};
    await updateHouseholdSubscriptionAdmin('h1', { trial_ends_at: future() }, fakeDb('active', cap));
    expect(cap.payload.trial_ends_at).toBeDefined();
    expect(cap.payload.subscription_status).toBeUndefined();
    expect(cap.payload.inactive_since).toBeUndefined();
  });

  test('a PAST trial end does not revive (no status change)', async () => {
    const cap = {};
    await updateHouseholdSubscriptionAdmin('h1', { trial_ends_at: past() }, fakeDb('expired', cap));
    expect(cap.payload.subscription_status).toBeUndefined();
  });

  test('is_internal-only update leaves status untouched', async () => {
    const cap = {};
    await updateHouseholdSubscriptionAdmin('h1', { is_internal: true }, fakeDb('expired', cap));
    expect(cap.payload).toEqual({ is_internal: true });
  });
});
