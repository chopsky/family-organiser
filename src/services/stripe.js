/**
 * Stripe service wrapper - Phase 3.
 *
 * Thin wrapper around the `stripe` SDK. Keeps all Stripe-specific wiring
 * (secret key loading, price-ID resolution, webhook signature verify) in
 * one place so route handlers stay terse and testable.
 *
 * Lazy client init - tests mock this whole module, so we don't want the
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
      'STRIPE_SECRET_KEY is not set - cannot create Stripe client. ' +
      'Set it in .env (test key) or Railway (live key).'
    );
  }
  _stripe = new Stripe(key);
  return _stripe;
}

// ────────────────────────────────────────────────────────────────────────
// Price resolution via Stripe lookup_keys.
//
// Instead of storing one Price ID per (plan, currency) pair in env vars
// (would be 12 vars: STRIPE_PRICE_MONTHLY_GBP, … _USD, … _EUR …), every
// Price object in Stripe carries a stable `lookup_key` string we set at
// creation time. Our convention is `${interval}_${currency}` - e.g.
// `monthly_gbp`, `annual_usd`. At runtime we fetch all matching Prices
// once, cache the ID↔lookup_key map in memory, and resolve from there.
//
// Why a cache: Stripe doesn't expose a single-Price-by-lookup-key
// endpoint; you have to list-by-lookup-keys. Doing this on every
// checkout request would add ~300ms of API latency per call. The cache
// is process-local and refreshes on dyno restart, which is fine - Price
// IDs never change once created.
// ────────────────────────────────────────────────────────────────────────

const SUPPORTED_INTERVALS = ['monthly', 'annual'];
const SUPPORTED_CURRENCIES = ['gbp', 'usd', 'eur', 'aud', 'cad', 'zar'];

function allManagedLookupKeys() {
  const keys = [];
  for (const interval of SUPPORTED_INTERVALS) {
    for (const cur of SUPPORTED_CURRENCIES) {
      keys.push(`${interval}_${cur}`);
    }
  }
  return keys;
}

let _priceCache = null; // { byLookupKey: Map, byPriceId: Map }

async function getPriceCache() {
  if (_priceCache) return _priceCache;
  const stripe = getStripe();
  const keys = allManagedLookupKeys();

  // Stripe's list endpoint accepts a `lookup_keys[]` array. We expand
  // the linked Product so debugging in logs is friendlier ("Housemait
  // Monthly" instead of an opaque prod_xxx ID).
  const result = await stripe.prices.list({
    lookup_keys: keys,
    expand: ['data.product'],
    limit: 100,
  });

  const byLookupKey = new Map();
  const byPriceId = new Map();
  for (const price of result.data) {
    if (!price.lookup_key) continue;
    byLookupKey.set(price.lookup_key, price.id);
    byPriceId.set(price.id, price.lookup_key);
  }

  _priceCache = { byLookupKey, byPriceId };
  return _priceCache;
}

/**
 * Resolve the Stripe Price ID for a (plan, currency) pair.
 * `currency` is one of the SUPPORTED_CURRENCIES strings (lowercase).
 * Throws if the matching Price hasn't been created in Stripe yet.
 */
async function priceIdForPlan(plan, currency = 'gbp') {
  if (!SUPPORTED_INTERVALS.includes(plan)) {
    throw new Error(`Unknown plan "${plan}" - expected monthly or annual`);
  }
  const lc = (currency || 'gbp').toLowerCase();
  if (!SUPPORTED_CURRENCIES.includes(lc)) {
    throw new Error(`Unsupported currency "${currency}" - supported: ${SUPPORTED_CURRENCIES.join(', ')}`);
  }
  const lookupKey = `${plan}_${lc}`;
  const { byLookupKey } = await getPriceCache();
  const id = byLookupKey.get(lookupKey);
  if (!id) {
    throw new Error(
      `No Stripe Price found with lookup_key="${lookupKey}". ` +
      `Create the Price in the Stripe Dashboard (set the lookup_key field on the Price) ` +
      `or check that the plan/currency you passed is one we manage.`
    );
  }
  return id;
}

/**
 * Map a Stripe Price ID back to our internal { plan, currency } pair.
 * Used by the webhook handler when Stripe sends subscription / invoice
 * events that carry only the price. Returns null for unknown prices.
 */
async function planFromPriceId(priceId) {
  if (!priceId) return null;
  const { byPriceId } = await getPriceCache();
  const key = byPriceId.get(priceId);
  if (!key) return null;
  const [plan, currency] = key.split('_');
  return { plan, currency };
}

/**
 * Create a Checkout Session for a household to subscribe.
 *
 * Mid-trial semantics: we deliberately do NOT pass
 * `subscription_data.trial_period_days`. A user subscribing on, say, day
 * 12 of their trial starts billing immediately and forfeits the remaining
 * 18 days. This is the spec's chosen trade-off (simpler billing logic, no
 * credit/proration handling) - documented in Phase 3 of the instructions.
 *
 * Setting `household_id` into both session.metadata AND
 * subscription.metadata means downstream events (invoice.paid,
 * customer.subscription.updated) can resolve back to the household
 * without a round-trip through the customers table.
 */
async function createCheckoutSession({ plan, currency, householdId, customerEmail, successUrl, cancelUrl }) {
  const stripe = getStripe();
  const cur = (currency || 'gbp').toLowerCase();
  const priceId = await priceIdForPlan(plan, cur);

  return stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    client_reference_id: householdId,
    customer_email: customerEmail,
    allow_promotion_codes: true,
    success_url: successUrl,
    cancel_url: cancelUrl,
    // Metadata is repeated on both the session and the subscription so
    // both webhook event types (checkout.session.completed and
    // customer.subscription.*) can resolve back to our household + plan
    // + currency without re-fetching the other object.
    metadata: { household_id: householdId, plan, currency: cur },
    subscription_data: {
      metadata: { household_id: householdId, plan, currency: cur },
    },
  });
}

/**
 * Create a Customer Portal session so the user can update their card,
 * switch plans, or cancel. Returns the session object (contains `.url`).
 *
 * Requires that the household has a stripe_customer_id - caller should
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
      'STRIPE_WEBHOOK_SECRET is not set - cannot verify webhook signature. ' +
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
