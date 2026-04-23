/**
 * Integration tests for POST /api/webhooks/stripe.
 *
 * Approach:
 *   • Mock stripeService.constructWebhookEvent so we can skip real HMAC
 *     verification and feed the route fully-formed event objects.
 *   • Mock db/queries so we can observe the subscription updates the
 *     handler issues without touching Supabase.
 *   • Use supertest so we exercise the real Express pipeline — that way
 *     the raw-body mounting order in app.js is covered too.
 *
 * What's verified:
 *   • Signature-check failures are rejected with 400.
 *   • Duplicate event_id (idempotency) returns 200 without re-running the handler.
 *   • Each of the five subscribed event types reaches the right handler
 *     and issues the expected db.updateHouseholdSubscription call.
 *   • Handler failures roll back the idempotency row so Stripe's retry
 *     can reprocess.
 *   • Unhandled event types acknowledge but don't mutate state.
 */

// Price IDs must be set before any module that reads them at import
// time. Tests below use these constants to build event fixtures.
const TEST_PRICE_MONTHLY = 'price_test_monthly';
const TEST_PRICE_ANNUAL  = 'price_test_annual';
process.env.STRIPE_PRICE_MONTHLY = TEST_PRICE_MONTHLY;
process.env.STRIPE_PRICE_ANNUAL  = TEST_PRICE_ANNUAL;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-stripe-webhook';

// ── Mocks ──────────────────────────────────────────────────────────
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

jest.mock('../services/stripe', () => {
  // We want real planFromPriceId + idOf semantics but mocked Stripe SDK
  // calls. Only the pieces the route actually invokes need mocking.
  return {
    constructWebhookEvent: jest.fn(),
    planFromPriceId: (priceId) => {
      if (priceId === TEST_PRICE_MONTHLY) return 'monthly';
      if (priceId === TEST_PRICE_ANNUAL) return 'annual';
      return null;
    },
    getStripe: jest.fn(() => ({
      subscriptions: {
        retrieve: jest.fn(),
      },
    })),
  };
});

const request = require('supertest');
const app = require('../app');
const db = require('../db/queries');
const stripeService = require('../services/stripe');

const HOUSEHOLD_ID = 'hh-webhook-1';

// ── Test helpers ───────────────────────────────────────────────────

/** POST an event body to the webhook. The constructWebhookEvent mock
 *  intercepts the raw body and returns the supplied event. */
function postWebhook(event, { signature = 't=1,v1=fake' } = {}) {
  stripeService.constructWebhookEvent.mockImplementation(() => event);
  return request(app)
    .post('/api/webhooks/stripe')
    .set('Content-Type', 'application/json')
    .set('Stripe-Signature', signature)
    .send(Buffer.from(JSON.stringify(event)));
}

// ── Shared beforeEach: reset db mock surface ───────────────────────
beforeEach(() => {
  jest.clearAllMocks();
  db.recordStripeEventIfNew.mockResolvedValue(true);
  db.deleteProcessedStripeEvent.mockResolvedValue();
  db.updateHouseholdSubscription.mockResolvedValue();
  db.findHouseholdByStripeCustomerId.mockResolvedValue(null);
  db.findHouseholdByStripeSubscriptionId.mockResolvedValue(null);
  // Silence expected console noise from handler warnings / the unhandled-type log.
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ── Signature verification ─────────────────────────────────────────

describe('POST /api/webhooks/stripe — signature verification', () => {
  test('400 when Stripe-Signature header is missing', async () => {
    const res = await request(app)
      .post('/api/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .send(Buffer.from('{}'));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/signature/i);
    expect(db.recordStripeEventIfNew).not.toHaveBeenCalled();
  });

  test('400 when constructWebhookEvent throws (bad signature)', async () => {
    stripeService.constructWebhookEvent.mockImplementation(() => {
      throw new Error('No signatures found matching the expected signature');
    });
    const res = await request(app)
      .post('/api/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', 'bad-sig')
      .send(Buffer.from('{}'));
    expect(res.status).toBe(400);
    expect(db.recordStripeEventIfNew).not.toHaveBeenCalled();
  });
});

// ── Idempotency / duplicate delivery ───────────────────────────────

describe('POST /api/webhooks/stripe — idempotency', () => {
  test('first delivery processes; second delivery of same event_id is a no-op', async () => {
    // First call: recordStripeEventIfNew returns true (new event).
    // Second call: returns false (already processed).
    db.recordStripeEventIfNew
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const event = {
      id: 'evt_dup_1',
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: 'sub_abc',
          customer: 'cus_abc',
          metadata: { household_id: HOUSEHOLD_ID },
        },
      },
    };

    const first = await postWebhook(event);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ received: true });
    expect(db.updateHouseholdSubscription).toHaveBeenCalledTimes(1);

    const second = await postWebhook(event);
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ received: true, duplicate: true });
    // Still just the one call from the first delivery — the duplicate
    // delivery did not re-run the handler.
    expect(db.updateHouseholdSubscription).toHaveBeenCalledTimes(1);
  });

  test('handler failure rolls back the idempotency row', async () => {
    db.updateHouseholdSubscription.mockRejectedValueOnce(new Error('DB down'));
    const event = {
      id: 'evt_fail_1',
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: 'sub_fail',
          customer: 'cus_fail',
          metadata: { household_id: HOUSEHOLD_ID },
        },
      },
    };
    const res = await postWebhook(event);
    expect(res.status).toBe(500);
    expect(db.deleteProcessedStripeEvent).toHaveBeenCalledWith('evt_fail_1');
  });
});

// ── checkout.session.completed ─────────────────────────────────────

describe('POST /api/webhooks/stripe — checkout.session.completed', () => {
  test('sets status=active and stores customer/subscription + plan + period end', async () => {
    const retrieve = jest.fn().mockResolvedValue({
      id: 'sub_1',
      current_period_end: 1_800_000_000,
      items: { data: [{ price: { id: TEST_PRICE_MONTHLY } }] },
    });
    stripeService.getStripe.mockReturnValue({ subscriptions: { retrieve } });

    const res = await postWebhook({
      id: 'evt_co_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_1',
          client_reference_id: HOUSEHOLD_ID,
          customer: 'cus_1',
          subscription: 'sub_1',
          metadata: { household_id: HOUSEHOLD_ID, plan: 'monthly' },
        },
      },
    });

    expect(res.status).toBe(200);
    expect(retrieve).toHaveBeenCalledWith('sub_1');
    expect(db.updateHouseholdSubscription).toHaveBeenCalledWith(HOUSEHOLD_ID, {
      subscription_status: 'active',
      stripe_customer_id: 'cus_1',
      stripe_subscription_id: 'sub_1',
      subscription_plan: 'monthly',
      subscription_current_period_end: new Date(1_800_000_000 * 1000).toISOString(),
      // Phase 8: clear the retention clock on subscribe (covers the
      // trial-expired-then-resubscribed path).
      inactive_since: null,
    });
  });

  test('falls back to client_reference_id when metadata is absent', async () => {
    stripeService.getStripe.mockReturnValue({
      subscriptions: {
        retrieve: jest.fn().mockResolvedValue({
          id: 'sub_2',
          current_period_end: 1_900_000_000,
          items: { data: [{ price: { id: TEST_PRICE_ANNUAL } }] },
        }),
      },
    });

    const res = await postWebhook({
      id: 'evt_co_2',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_2',
          client_reference_id: HOUSEHOLD_ID,
          customer: 'cus_2',
          subscription: 'sub_2',
          metadata: {},
        },
      },
    });

    expect(res.status).toBe(200);
    expect(db.updateHouseholdSubscription).toHaveBeenCalledWith(HOUSEHOLD_ID, expect.objectContaining({
      subscription_status: 'active',
      subscription_plan: 'annual',
    }));
  });
});

// ── invoice.paid ───────────────────────────────────────────────────

describe('POST /api/webhooks/stripe — invoice.paid', () => {
  test('rolls subscription_current_period_end forward and sets status=active', async () => {
    db.findHouseholdByStripeCustomerId.mockResolvedValue({ id: HOUSEHOLD_ID });
    const res = await postWebhook({
      id: 'evt_ip_1',
      type: 'invoice.paid',
      data: {
        object: {
          id: 'in_1',
          customer: 'cus_1',
          subscription: 'sub_1',
          lines: { data: [{ period: { end: 1_850_000_000 } }] },
        },
      },
    });
    expect(res.status).toBe(200);
    expect(db.updateHouseholdSubscription).toHaveBeenCalledWith(HOUSEHOLD_ID, {
      subscription_status: 'active',
      inactive_since: null, // Phase 8 — clear retention clock on renewal
      subscription_current_period_end: new Date(1_850_000_000 * 1000).toISOString(),
    });
  });

  test('logs and acks when no household can be resolved (orphan invoice)', async () => {
    // Neither metadata nor any DB lookup yields a match.
    db.findHouseholdByStripeCustomerId.mockResolvedValue(null);
    db.findHouseholdByStripeSubscriptionId.mockResolvedValue(null);

    const res = await postWebhook({
      id: 'evt_ip_orphan',
      type: 'invoice.paid',
      data: { object: { id: 'in_orphan', customer: 'cus_orphan', subscription: 'sub_orphan', lines: { data: [] } } },
    });
    expect(res.status).toBe(200);
    expect(db.updateHouseholdSubscription).not.toHaveBeenCalled();
  });
});

// ── invoice.payment_failed ─────────────────────────────────────────

describe('POST /api/webhooks/stripe — invoice.payment_failed', () => {
  test('logs but does NOT mutate subscription state (Stripe dunning handles retries)', async () => {
    const res = await postWebhook({
      id: 'evt_if_1',
      type: 'invoice.payment_failed',
      data: {
        object: {
          id: 'in_fail',
          customer: 'cus_1',
          subscription: 'sub_1',
        },
      },
    });
    expect(res.status).toBe(200);
    expect(db.updateHouseholdSubscription).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('invoice.payment_failed')
    );
  });
});

// ── customer.subscription.updated ──────────────────────────────────

describe('POST /api/webhooks/stripe — customer.subscription.updated', () => {
  test('syncs plan + period end + status when Stripe reports active', async () => {
    db.findHouseholdByStripeSubscriptionId.mockResolvedValue({ id: HOUSEHOLD_ID });
    const res = await postWebhook({
      id: 'evt_su_1',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_1',
          customer: 'cus_1',
          status: 'active',
          current_period_end: 1_950_000_000,
          items: { data: [{ price: { id: TEST_PRICE_ANNUAL } }] },
          metadata: { household_id: HOUSEHOLD_ID },
        },
      },
    });
    expect(res.status).toBe(200);
    expect(db.updateHouseholdSubscription).toHaveBeenCalledWith(HOUSEHOLD_ID, {
      stripe_subscription_id: 'sub_1',
      subscription_status: 'active',
      subscription_plan: 'annual',
      subscription_current_period_end: new Date(1_950_000_000 * 1000).toISOString(),
    });
  });

  test('leaves status untouched for transient states (past_due / incomplete)', async () => {
    const res = await postWebhook({
      id: 'evt_su_2',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_2',
          customer: 'cus_2',
          status: 'past_due',
          current_period_end: 1_960_000_000,
          items: { data: [{ price: { id: TEST_PRICE_MONTHLY } }] },
          metadata: { household_id: HOUSEHOLD_ID },
        },
      },
    });
    expect(res.status).toBe(200);
    const call = db.updateHouseholdSubscription.mock.calls[0];
    expect(call[0]).toBe(HOUSEHOLD_ID);
    expect(call[1]).not.toHaveProperty('subscription_status');
    expect(call[1]).toMatchObject({ subscription_plan: 'monthly' });
  });
});

// ── customer.subscription.deleted ──────────────────────────────────

describe('POST /api/webhooks/stripe — customer.subscription.deleted', () => {
  test('sets subscription_status=cancelled and starts the retention clock', async () => {
    const endUnix = 1_750_000_000;
    const res = await postWebhook({
      id: 'evt_sd_1',
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: 'sub_del',
          customer: 'cus_del',
          current_period_end: endUnix,
          metadata: { household_id: HOUSEHOLD_ID },
        },
      },
    });
    expect(res.status).toBe(200);
    expect(db.updateHouseholdSubscription).toHaveBeenCalledWith(HOUSEHOLD_ID, {
      subscription_status: 'cancelled',
      // Phase 8: inactive_since starts the 12-month retention clock.
      // Uses ended_at if present, else current_period_end, else "now".
      inactive_since: new Date(endUnix * 1000).toISOString(),
    });
  });

  test('falls back to now() when Stripe sends no period end', async () => {
    const beforeMs = Date.now();
    const res = await postWebhook({
      id: 'evt_sd_2',
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: 'sub_del_2',
          customer: 'cus_del_2',
          metadata: { household_id: HOUSEHOLD_ID },
        },
      },
    });
    expect(res.status).toBe(200);
    const call = db.updateHouseholdSubscription.mock.calls[0][1];
    expect(call.subscription_status).toBe('cancelled');
    expect(typeof call.inactive_since).toBe('string');
    expect(new Date(call.inactive_since).getTime()).toBeGreaterThanOrEqual(beforeMs);
  });
});

// ── Unhandled event types ──────────────────────────────────────────

describe('POST /api/webhooks/stripe — unhandled event types', () => {
  test('acks with 200 and leaves state untouched', async () => {
    const res = await postWebhook({
      id: 'evt_unhandled',
      type: 'payment_intent.succeeded',
      data: { object: {} },
    });
    expect(res.status).toBe(200);
    expect(db.updateHouseholdSubscription).not.toHaveBeenCalled();
    // Idempotency row IS written so Stripe doesn't waste retries.
    expect(db.recordStripeEventIfNew).toHaveBeenCalledWith('evt_unhandled', 'payment_intent.succeeded');
  });
});
