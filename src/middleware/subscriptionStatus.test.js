/**
 * Unit tests for the subscription / trial gate.
 *
 * Tests exercise the middleware directly with mock req/res/next objects —
 * no Express, no HTTP. The Supabase chain is replaced with a handmade stub
 * so we can assert exactly which queries ran and with what filters, which
 * matters for the conditional-UPDATE race-prevention behaviour.
 *
 * Coverage:
 *   • excluded path → pass-through (no DB read)
 *   • safe HTTP method (GET/HEAD/OPTIONS) → pass-through (no DB read, no JWT decode)
 *   • no bearer token → pass-through (downstream requireAuth handles 401)
 *   • invalid JWT → pass-through
 *   • JWT with no householdId (pre-household user) → pass-through
 *   • is_internal account → pass-through
 *   • subscription_status === 'active' → pass-through
 *   • subscription_status === 'trialing' with time remaining → pass-through
 *   • subscription_status === 'trialing' past trial_ends_at on a mutation → conditional UPDATE + 402
 *   • subscription_status === 'expired' on a mutation → 402 without UPDATE
 *   • subscription_status === 'expired' on a GET → pass-through (read-only state)
 *   • subscription_status === 'cancelled' on a mutation → 402 without UPDATE
 *   • race condition: two simultaneous expiring-mutation requests both 402; conditional
 *     WHERE clause is present on every UPDATE call.
 */

// Must be set BEFORE requiring the middleware — the module throws at load
// time if JWT_SECRET is missing (same pattern as middleware/auth.js).
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-subscription-status';

// ── Mock the Supabase client ────────────────────────────────────────
// The middleware uses two chains:
//   SELECT: supabaseAdmin.from('households').select(...).eq(...).single()
//   UPDATE: supabaseAdmin.from('households').update({...}).eq(...).eq(...)
// We expose a shared chainable object so tests can prime .single() for the
// select path and capture .update() payload + .eq() filter args for the
// update path. Because both .eq() calls chain on the same object, the
// terminal UPDATE awaits the chain itself — we make it thenable for that.
const mockChain = {
  select: jest.fn(),
  update: jest.fn(),
  eq: jest.fn(),
  single: jest.fn(),
  // Awaitable terminal for UPDATE (no .single() on the update chain).
  then: undefined,
};

jest.mock('../db/client', () => ({
  supabaseAdmin: { from: jest.fn(() => mockChain) },
}));

const jwt = require('jsonwebtoken');
const { supabaseAdmin } = require('../db/client');
const { requireActiveSubscription } = require('./subscriptionStatus');

// ── Helpers ─────────────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET;
const HOUSEHOLD_ID = 'hh-test-1';

function signToken({ householdId = HOUSEHOLD_ID, userId = 'u-1' } = {}) {
  return jwt.sign({ userId, householdId, name: 'Test', role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });
}

// Default to POST so existing "gate fires" tests exercise the mutation path.
// Tests that need a read-only verb pass `method: 'GET'` explicitly.
function makeReq({ path = '/shopping', token = signToken(), method = 'POST' } = {}) {
  return {
    path,
    method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  };
}

function makeRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

/**
 * Prime the mock chain for one middleware invocation:
 *   - .select().eq().single() resolves to { data: household, error: null }
 *   - .update().eq().eq() resolves via the `then` we attach to the chain
 *     (supabase's update returns a thenable directly since there's no
 *     terminal .single()).
 */
function primeChain({ household, updateResult = { data: null, error: null, count: 1 } }) {
  mockChain.select.mockReturnValue(mockChain);
  mockChain.update.mockReturnValue(mockChain);
  mockChain.eq.mockReturnValue(mockChain);
  mockChain.single.mockResolvedValue({ data: household, error: null });

  // The update path awaits the chain itself. We attach a `then` so
  // `await chain` resolves to updateResult. Select goes through
  // .single() so the then is never hit on that path.
  mockChain.then = (resolve) => resolve(updateResult);
}

function resetChain() {
  mockChain.select.mockReset();
  mockChain.update.mockReset();
  mockChain.eq.mockReset();
  mockChain.single.mockReset();
  mockChain.then = undefined;
  supabaseAdmin.from.mockClear();
}

// ── Tests ───────────────────────────────────────────────────────────

describe('requireActiveSubscription', () => {
  beforeEach(() => {
    resetChain();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── 1. Excluded paths ──────────────────────────────────────────────

  describe('excluded paths', () => {
    const excluded = [
      '/auth/login',
      '/auth/register',
      '/auth',
      '/subscription/status',
      '/subscription/checkout',
      '/admin/households',
      '/inbound-email/postmark',
      '/webhooks/stripe',
    ];

    test.each(excluded)('%s bypasses the gate entirely', async (path) => {
      const req = makeReq({ path });
      const res = makeRes();
      const next = jest.fn();

      await requireActiveSubscription(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
      expect(supabaseAdmin.from).not.toHaveBeenCalled();
    });

    // Guard against over-eager prefix match — /authorize shouldn't hit /auth's exclusion.
    test('prefix-only match: /authorize is NOT treated as excluded', async () => {
      primeChain({ household: { id: HOUSEHOLD_ID, is_internal: false, subscription_status: 'active', trial_ends_at: null } });
      const req = makeReq({ path: '/authorize' });
      const res = makeRes();
      const next = jest.fn();

      await requireActiveSubscription(req, res, next);

      // DB WAS consulted (not excluded) — and because status is active, next() runs.
      expect(supabaseAdmin.from).toHaveBeenCalledWith('households');
      expect(next).toHaveBeenCalled();
    });
  });

  // ── 2. Safe HTTP methods (read-only state) ─────────────────────────

  describe('safe HTTP methods', () => {
    // Reads are never gated — expired households retain read access to
    // their own data. Only mutations require an active entitlement.
    test.each(['GET', 'HEAD', 'OPTIONS'])(
      '%s on a gated path passes through regardless of subscription state',
      async (method) => {
        // Prime the chain to return an EXPIRED household — proof that the
        // method check short-circuits before status is even examined.
        primeChain({
          household: {
            id: HOUSEHOLD_ID,
            is_internal: false,
            subscription_status: 'expired',
            trial_ends_at: '2020-01-01T00:00:00Z',
          },
        });
        const req = makeReq({ method });
        const res = makeRes();
        const next = jest.fn();

        await requireActiveSubscription(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
        // DB was never hit — safe methods short-circuit before the lookup.
        expect(supabaseAdmin.from).not.toHaveBeenCalled();
      }
    );

    test.each(['POST', 'PATCH', 'PUT', 'DELETE'])(
      '%s on an expired household returns 402 (mutations ARE gated)',
      async (method) => {
        const past = new Date(Date.now() - 86_400_000).toISOString();
        primeChain({
          household: {
            id: HOUSEHOLD_ID,
            is_internal: false,
            subscription_status: 'expired',
            trial_ends_at: past,
          },
        });
        const req = makeReq({ method });
        const res = makeRes();
        const next = jest.fn();

        await requireActiveSubscription(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(402);
        expect(res.json).toHaveBeenCalledWith({
          status: 'expired',
          trial_ended_at: past,
        });
      }
    );
  });

  // ── 3. Auth handling (fail-open pass-through) ──────────────────────

  describe('auth pre-checks', () => {
    test('no bearer token → pass through (downstream requireAuth will 401)', async () => {
      const req = makeReq({ token: null });
      const res = makeRes();
      const next = jest.fn();

      await requireActiveSubscription(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
      expect(supabaseAdmin.from).not.toHaveBeenCalled();
    });

    test('invalid JWT → pass through', async () => {
      const req = { path: '/shopping', headers: { authorization: 'Bearer not-a-real-token' } };
      const res = makeRes();
      const next = jest.fn();

      await requireActiveSubscription(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(supabaseAdmin.from).not.toHaveBeenCalled();
    });

    test('JWT with no householdId (pre-household user) → pass through', async () => {
      const token = jwt.sign({ userId: 'u-new', householdId: null }, JWT_SECRET, { expiresIn: '1h' });
      const req = { path: '/shopping', headers: { authorization: `Bearer ${token}` } };
      const res = makeRes();
      const next = jest.fn();

      await requireActiveSubscription(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(supabaseAdmin.from).not.toHaveBeenCalled();
    });
  });

  // ── 4. Five primary subscription states ────────────────────────────

  describe('subscription states', () => {
    test('internal-bypass: is_internal=true → pass through even if status is expired', async () => {
      primeChain({
        household: {
          id: HOUSEHOLD_ID,
          is_internal: true,
          // Deliberately 'expired' to prove is_internal short-circuits the check.
          subscription_status: 'expired',
          trial_ends_at: '2020-01-01T00:00:00Z',
        },
      });
      const req = makeReq();
      const res = makeRes();
      const next = jest.fn();

      await requireActiveSubscription(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
      // No UPDATE should have been attempted.
      expect(mockChain.update).not.toHaveBeenCalled();
    });

    test('active: pass through', async () => {
      primeChain({
        household: {
          id: HOUSEHOLD_ID,
          is_internal: false,
          subscription_status: 'active',
          trial_ends_at: null,
        },
      });
      const req = makeReq();
      const res = makeRes();
      const next = jest.fn();

      await requireActiveSubscription(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
      expect(mockChain.update).not.toHaveBeenCalled();
    });

    test('trialing-active: time remaining → pass through', async () => {
      const fiveDaysFromNow = new Date(Date.now() + 5 * 86_400_000).toISOString();
      primeChain({
        household: {
          id: HOUSEHOLD_ID,
          is_internal: false,
          subscription_status: 'trialing',
          trial_ends_at: fiveDaysFromNow,
        },
      });
      const req = makeReq();
      const res = makeRes();
      const next = jest.fn();

      await requireActiveSubscription(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
      expect(mockChain.update).not.toHaveBeenCalled();
    });

    test('trialing-expired-just-now: conditional UPDATE + 402 trial_expired', async () => {
      const oneSecondAgo = new Date(Date.now() - 1000).toISOString();
      primeChain({
        household: {
          id: HOUSEHOLD_ID,
          is_internal: false,
          subscription_status: 'trialing',
          trial_ends_at: oneSecondAgo,
        },
      });
      const req = makeReq();
      const res = makeRes();
      const next = jest.fn();

      await requireActiveSubscription(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(402);
      expect(res.json).toHaveBeenCalledWith({
        status: 'trial_expired',
        trial_ended_at: oneSecondAgo,
      });

      // Conditional UPDATE: flipped to 'expired' with a WHERE-still-trialing guard.
      // Also sets inactive_since to start the 12-month retention clock (Phase 8).
      expect(mockChain.update).toHaveBeenCalledWith({
        subscription_status: 'expired',
        inactive_since: oneSecondAgo,
      });
      // .eq was called for both select (id) and update (id + status). The
      // update's status-guard .eq is the key one for race prevention.
      expect(mockChain.eq).toHaveBeenCalledWith('subscription_status', 'trialing');
      expect(mockChain.eq).toHaveBeenCalledWith('id', HOUSEHOLD_ID);
    });

    test('expired: 402 without attempting an UPDATE', async () => {
      const oneDayAgo = new Date(Date.now() - 86_400_000).toISOString();
      primeChain({
        household: {
          id: HOUSEHOLD_ID,
          is_internal: false,
          subscription_status: 'expired',
          trial_ends_at: oneDayAgo,
        },
      });
      const req = makeReq();
      const res = makeRes();
      const next = jest.fn();

      await requireActiveSubscription(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(402);
      expect(res.json).toHaveBeenCalledWith({
        status: 'expired',
        trial_ended_at: oneDayAgo,
      });
      // No UPDATE — the row is already in the correct state.
      expect(mockChain.update).not.toHaveBeenCalled();
    });

    test('cancelled: 402 with same expired shape', async () => {
      const oneDayAgo = new Date(Date.now() - 86_400_000).toISOString();
      primeChain({
        household: {
          id: HOUSEHOLD_ID,
          is_internal: false,
          subscription_status: 'cancelled',
          trial_ends_at: oneDayAgo,
        },
      });
      const req = makeReq();
      const res = makeRes();
      const next = jest.fn();

      await requireActiveSubscription(req, res, next);

      expect(res.status).toHaveBeenCalledWith(402);
      expect(res.json).toHaveBeenCalledWith({
        status: 'expired',
        trial_ended_at: oneDayAgo,
      });
      expect(mockChain.update).not.toHaveBeenCalled();
    });
  });

  // ── 5. Fail-open on infrastructure errors ──────────────────────────

  describe('fail-open behaviour', () => {
    test('household row missing → pass through (don\'t lock out on DB blip)', async () => {
      mockChain.select.mockReturnValue(mockChain);
      mockChain.eq.mockReturnValue(mockChain);
      mockChain.single.mockResolvedValue({ data: null, error: { message: 'not found' } });

      const req = makeReq();
      const res = makeRes();
      const next = jest.fn();

      await requireActiveSubscription(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    test('unknown status value → pass through with a warning', async () => {
      primeChain({
        household: {
          id: HOUSEHOLD_ID,
          is_internal: false,
          subscription_status: 'future-status-not-yet-implemented',
          trial_ends_at: null,
        },
      });
      const req = makeReq();
      const res = makeRes();
      const next = jest.fn();

      await requireActiveSubscription(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('unrecognised subscription_status')
      );
    });
  });

  // ── 6. Race-condition / concurrent expiry ──────────────────────────

  describe('race condition — simultaneous trial expiry', () => {
    // When two requests cross the trial-end boundary at the same instant,
    // both read `subscription_status = 'trialing'` and both attempt the
    // UPDATE. The DB enforces atomicity: the first UPDATE matches 1 row,
    // the second matches 0 (because the WHERE-still-trialing filter fails
    // the moment the first has flipped the row). Both requests must still
    // return 402 — the response doesn't depend on which request "won".
    test('both requests return 402 trial_expired; both UPDATE calls carry the status guard', async () => {
      const oneSecondAgo = new Date(Date.now() - 1000).toISOString();

      // Track each update's resolved count so we can assert the simulation
      // matches reality (first update matches a row, second matches none).
      const updateCounts = [];

      // Custom chain setup: .select().eq().single() returns the trialing
      // row, .update().eq().eq() awaits via our `then` which resolves to
      // count=1 on the first call and count=0 on subsequent calls.
      let updateCallIdx = 0;
      mockChain.select.mockReturnValue(mockChain);
      mockChain.eq.mockReturnValue(mockChain);
      mockChain.single.mockResolvedValue({
        data: {
          id: HOUSEHOLD_ID,
          is_internal: false,
          subscription_status: 'trialing',
          trial_ends_at: oneSecondAgo,
        },
        error: null,
      });
      mockChain.update.mockImplementation(() => {
        const idx = updateCallIdx++;
        // Return a fresh thenable that terminates the UPDATE chain so the
        // two in-flight awaits don't share state.
        return {
          eq: () => ({
            eq: () => {
              const result = idx === 0
                ? { data: null, error: null, count: 1 }
                : { data: null, error: null, count: 0 };
              updateCounts.push(result.count);
              return Promise.resolve(result);
            },
          }),
        };
      });

      const req1 = makeReq();
      const req2 = makeReq();
      const res1 = makeRes();
      const res2 = makeRes();
      const next1 = jest.fn();
      const next2 = jest.fn();

      // Fire both in flight simultaneously.
      await Promise.all([
        requireActiveSubscription(req1, res1, next1),
        requireActiveSubscription(req2, res2, next2),
      ]);

      // Both attempted the UPDATE (now also carrying inactive_since — Phase 8).
      expect(mockChain.update).toHaveBeenCalledTimes(2);
      expect(mockChain.update).toHaveBeenCalledWith(expect.objectContaining({
        subscription_status: 'expired',
      }));

      // Exactly one UPDATE actually matched a row (race-prevention works
      // because the second UPDATE's WHERE-still-trialing clause fails).
      expect(updateCounts).toEqual([1, 0]);

      // Neither request passed through — both got 402 with identical body.
      expect(next1).not.toHaveBeenCalled();
      expect(next2).not.toHaveBeenCalled();
      expect(res1.status).toHaveBeenCalledWith(402);
      expect(res2.status).toHaveBeenCalledWith(402);
      expect(res1.json).toHaveBeenCalledWith({
        status: 'trial_expired',
        trial_ended_at: oneSecondAgo,
      });
      expect(res2.json).toHaveBeenCalledWith({
        status: 'trial_expired',
        trial_ended_at: oneSecondAgo,
      });
    });
  });
});
