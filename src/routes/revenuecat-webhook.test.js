/**
 * Integration tests for POST /api/webhooks/revenuecat.
 *
 * Approach mirrors stripe-webhook.test.js:
 *   - Mock db/queries so we can observe the subscription updates the
 *     handler issues without touching Supabase.
 *   - Use supertest so we exercise the real Express pipeline (mounting
 *     order, body parsing, idempotency, the Bearer auth flow).
 *
 * What's verified:
 *   - Missing / wrong Bearer token -> 401.
 *   - Malformed payload -> 400.
 *   - Duplicate event_id (idempotency) -> 200 without re-running the handler.
 *   - INITIAL_PURCHASE / RENEWAL / PRODUCT_CHANGE / UNCANCELLATION all
 *     mark the household active with provider='apple' and the right plan.
 *   - EXPIRATION marks cancelled and starts the retention clock.
 *   - CANCELLATION + BILLING_ISSUE + TEST log only (no DB write).
 *   - Handler failures roll back the idempotency row.
 *   - SUBSCRIBER_ALIAS swaps revenuecat_app_user_id without breaking.
 */

const TEST_SECRET = 'test-revenuecat-webhook-secret-very-long-string-1234567890';
process.env.REVENUECAT_WEBHOOK_SECRET = TEST_SECRET;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-revenuecat';

// --- Mocks ---------------------------------------------------------

jest.mock('../db/queries');
jest.mock('../db/client', () => {
  const chain = {
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
  };
  return { supabase: chain, supabaseAdmin: chain };
});

const request = require('supertest');
const app = require('../app');
const db = require('../db/queries');

const HOUSEHOLD_ID = 'hh-revenuecat-1';
const APP_USER_ID = HOUSEHOLD_ID; // canonical case: app_user_id == household.id

// --- Helpers -------------------------------------------------------

function postEvent(event, { auth = `Bearer ${TEST_SECRET}` } = {}) {
  const r = request(app)
    .post('/api/webhooks/revenuecat')
    .set('Content-Type', 'application/json');
  if (auth !== null) r.set('Authorization', auth);
  return r.send({ api_version: '1.0', event });
}

function makeEvent(type, overrides = {}) {
  return {
    id: `evt_${type.toLowerCase()}_${Math.random().toString(36).slice(2)}`,
    type,
    app_user_id: APP_USER_ID,
    product_id: 'housemait_premium_monthly',
    purchased_at_ms: 1_700_000_000_000,
    expiration_at_ms: 1_700_000_000_000 + 30 * 24 * 60 * 60 * 1000,
    environment: 'SANDBOX',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  // Default: idempotency check passes (event is new).
  db.recordRevenuecatEventIfNew.mockResolvedValue(true);
  db.deleteProcessedRevenuecatEvent.mockResolvedValue(undefined);
  // Default: app_user_id resolves directly to a household.
  db.getHouseholdById.mockResolvedValue({ id: HOUSEHOLD_ID });
  db.findHouseholdByRevenuecatAppUserId.mockResolvedValue(null);
  db.updateHouseholdSubscription.mockResolvedValue({ id: HOUSEHOLD_ID });
});

// --- Auth tests ----------------------------------------------------

describe('auth', () => {
  test('rejects missing Authorization header with 401', async () => {
    const res = await postEvent(makeEvent('INITIAL_PURCHASE'), { auth: null });
    expect(res.status).toBe(401);
    expect(db.recordRevenuecatEventIfNew).not.toHaveBeenCalled();
  });

  test('rejects wrong Bearer token with 401', async () => {
    const res = await postEvent(makeEvent('INITIAL_PURCHASE'), {
      auth: 'Bearer wrong-secret-of-the-same-length-12345678901234567890',
    });
    expect(res.status).toBe(401);
    expect(db.recordRevenuecatEventIfNew).not.toHaveBeenCalled();
  });

  test('accepts correct Bearer token', async () => {
    const res = await postEvent(makeEvent('INITIAL_PURCHASE'));
    expect(res.status).toBe(200);
  });
});

// --- Payload tests -------------------------------------------------

describe('payload validation', () => {
  test('rejects malformed payload with 400', async () => {
    const res = await request(app)
      .post('/api/webhooks/revenuecat')
      .set('Authorization', `Bearer ${TEST_SECRET}`)
      .set('Content-Type', 'application/json')
      .send({ api_version: '1.0' }); // no event
    expect(res.status).toBe(400);
  });

  test('rejects event missing id with 400', async () => {
    const res = await postEvent({ type: 'INITIAL_PURCHASE', app_user_id: APP_USER_ID });
    expect(res.status).toBe(400);
  });
});

// --- Idempotency tests ---------------------------------------------

describe('idempotency', () => {
  test('duplicate event returns 200 and skips handler', async () => {
    db.recordRevenuecatEventIfNew.mockResolvedValueOnce(false); // already processed
    const res = await postEvent(makeEvent('RENEWAL'));
    expect(res.status).toBe(200);
    expect(res.body.duplicate).toBe(true);
    expect(db.updateHouseholdSubscription).not.toHaveBeenCalled();
  });

  test('handler failure rolls back idempotency row', async () => {
    db.updateHouseholdSubscription.mockRejectedValueOnce(new Error('DB exploded'));
    const res = await postEvent(makeEvent('INITIAL_PURCHASE'));
    expect(res.status).toBe(500);
    expect(db.deleteProcessedRevenuecatEvent).toHaveBeenCalledTimes(1);
  });
});

// --- Active-subscription handlers ----------------------------------

describe('active-subscription handlers', () => {
  test.each([
    ['INITIAL_PURCHASE', 'housemait_premium_monthly', 'monthly'],
    ['RENEWAL', 'housemait_premium_annual', 'annual'],
    ['PRODUCT_CHANGE', 'housemait_premium_annual', 'annual'],
    ['UNCANCELLATION', 'housemait_premium_monthly', 'monthly'],
  ])('%s marks household active with provider=apple and plan=%s', async (type, productId, expectedPlan) => {
    const res = await postEvent(makeEvent(type, { product_id: productId }));
    expect(res.status).toBe(200);
    expect(db.updateHouseholdSubscription).toHaveBeenCalledWith(
      HOUSEHOLD_ID,
      expect.objectContaining({
        subscription_status: 'active',
        subscription_provider: 'apple',
        subscription_plan: expectedPlan,
        revenuecat_app_user_id: APP_USER_ID,
        inactive_since: null,
      })
    );
  });

  test('passes expiration_at_ms through as ISO string', async () => {
    const expMs = 1_800_000_000_000;
    await postEvent(makeEvent('INITIAL_PURCHASE', { expiration_at_ms: expMs }));
    const call = db.updateHouseholdSubscription.mock.calls[0][1];
    expect(call.subscription_current_period_end).toBe(new Date(expMs).toISOString());
  });

  test('unresolvable app_user_id logs but 200s (no retry forever)', async () => {
    db.getHouseholdById.mockResolvedValue(null);
    db.findHouseholdByRevenuecatAppUserId.mockResolvedValue(null);
    const res = await postEvent(makeEvent('INITIAL_PURCHASE'));
    expect(res.status).toBe(200);
    expect(db.updateHouseholdSubscription).not.toHaveBeenCalled();
  });
});

// --- Expiration handler --------------------------------------------

describe('EXPIRATION', () => {
  test('marks cancelled and starts retention clock from expiration_at_ms', async () => {
    const expMs = 1_800_000_000_000;
    await postEvent(makeEvent('EXPIRATION', { expiration_at_ms: expMs }));
    expect(db.updateHouseholdSubscription).toHaveBeenCalledWith(
      HOUSEHOLD_ID,
      expect.objectContaining({
        subscription_status: 'cancelled',
        inactive_since: new Date(expMs).toISOString(),
      })
    );
  });
});

// --- Log-only handlers ---------------------------------------------

describe('log-only event types', () => {
  test.each(['CANCELLATION', 'BILLING_ISSUE', 'TEST'])(
    '%s 200s without writing to households',
    async (type) => {
      const res = await postEvent(makeEvent(type));
      expect(res.status).toBe(200);
      expect(db.updateHouseholdSubscription).not.toHaveBeenCalled();
    }
  );

  test('unknown event types are 200-acked', async () => {
    const res = await postEvent(makeEvent('SOME_FUTURE_EVENT_TYPE'));
    expect(res.status).toBe(200);
    expect(db.updateHouseholdSubscription).not.toHaveBeenCalled();
  });
});

// --- Subscriber alias -----------------------------------------------

describe('SUBSCRIBER_ALIAS', () => {
  test('updates revenuecat_app_user_id to the new id', async () => {
    const ORIGINAL = 'rcanon-original-1';
    const NEXT = HOUSEHOLD_ID;
    db.getHouseholdById.mockImplementation(async (id) =>
      id === NEXT ? { id: NEXT } : null
    );
    db.findHouseholdByRevenuecatAppUserId.mockResolvedValue(null);

    const event = makeEvent('SUBSCRIBER_ALIAS', {
      app_user_id: NEXT,
      original_app_user_id: ORIGINAL,
    });
    const res = await postEvent(event);
    expect(res.status).toBe(200);
    expect(db.updateHouseholdSubscription).toHaveBeenCalledWith(
      NEXT,
      expect.objectContaining({
        revenuecat_app_user_id: NEXT,
        subscription_provider: 'apple',
      })
    );
  });
});
