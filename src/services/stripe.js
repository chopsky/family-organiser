/**
 * Stripe service wrapper — Phase 3.
 *
 * Thin wrapper around the `stripe` SDK. Keeps all Stripe-specific wiring
 * (secret key loading, price-ID resolution, webhook signature verify) in
 * one place so route handlers stay terse and testable.
 *
 * Lazy client init — tests mock this whole module, so we don't want the
 * `new Stripe(undefined)` constructor to throw at require-time when
 * STRIPE_SECRET_KEY is absent.
 */

const Stripe = require('stripe');

let _stripe = null;
function getStripe() {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      'STRIPE_SECRET_KEY is not set — cannot create Stripe client. ' +
      'Set it in .env (test key) or Railway (live key).'
    );
  }
  _stripe = new Stripe(key);
  return _stripe;
}

function priceIdForPlan(plan) {
  const ids = {
    monthly: process.env.STRIPE_PRICE_MONTHLY,
    annual: process.env.STRIPE_PRICE_ANNUAL,
  };
  const id = ids[plan];
  if (!id) {
    throw new Error(
      `No Stripe price configured for plan "${plan}" — ` +
      `check STRIPE_PRICE_${(plan || '').toUpperCase()} env var`
    );
  }
  return id;
}

/**
 * Map a Stripe Price ID back to our internal plan label. Used by the
 * webhook handler when Stripe sends subscription / invoice events that
 * carry only the price.
 */
function planFromPriceId(priceId) {
  if (!priceId) return null;
  if (priceId === process.env.STRIPE_PRICE_MONTHLY) return 'monthly';
  if (priceId === process.env.STRIPE_PRICE_ANNUAL) return 'annual';
  return null;
}

/**
 * Create a Checkout Session for a household to subscribe.
 *
 * Mid-trial semantics: we deliberately do NOT pass
 * `subscription_data.trial_period_days`. A user subscribing on, say, day
 * 12 of their trial starts billing immediately and forfeits the remaining
 * 18 days. This is the spec's chosen trade-off (simpler billing logic, no
 * credit/proration handling) — documented in Phase 3 of the instructions.
 *
 * Setting `household_id` into both session.metadata AND
 * subscription.metadata means downstream events (invoice.paid,
 * customer.subscription.updated) can resolve back to the household
 * without a round-trip through the customers table.
 */
async function createCheckoutSession({ plan, householdId, customerEmail, successUrl, cancelUrl }) {
  const stripe = getStripe();
  const priceId = priceIdForPlan(plan);

  return stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    client_reference_id: householdId,
    customer_email: customerEmail,
    allow_promotion_codes: true,
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { household_id: householdId, plan },
    subscription_data: {
      metadata: { household_id: householdId, plan },
    },
  });
}

/**
 * Create a Customer Portal session so the user can update their card,
 * switch plans, or cancel. Returns the session object (contains `.url`).
 *
 * Requires that the household has a stripe_customer_id — caller should
 * check before calling.
 */
async function createPortalSession({ customerId, returnUrl }) {
  const stripe = getStripe();
  return stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });
}

/**
 * Verify the `Stripe-Signature` header against STRIPE_WEBHOOK_SECRET and
 * return the parsed event. Throws on missing secret OR bad signature.
 *
 * `rawBody` MUST be the untouched request body as a Buffer. If
 * express.json() has already parsed it, re-serialising won't match the
 * bytes Stripe signed and verification will fail.
 */
function constructWebhookEvent(rawBody, signatureHeader) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error(
      'STRIPE_WEBHOOK_SECRET is not set — cannot verify webhook signature. ' +
      'For local dev: run `stripe listen --forward-to localhost:3000/api/webhooks/stripe` ' +
      'and paste the whsec_... it prints into .env.'
    );
  }
  const stripe = getStripe();
  return stripe.webhooks.constructEvent(rawBody, signatureHeader, secret);
}

// Test hook: let tests reset the memoised client between runs so a
// re-mocked env var actually takes effect. Not used in production.
function _resetForTests() {
  _stripe = null;
}

module.exports = {
  getStripe,
  priceIdForPlan,
  planFromPriceId,
  createCheckoutSession,
  createPortalSession,
  constructWebhookEvent,
  _resetForTests,
};
