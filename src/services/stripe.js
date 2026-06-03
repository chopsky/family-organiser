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
  // Pin the API version. The SDK (v22) otherwise defaults to a 2025 version
  // where promotionCodes.create no longer accepts a top-level `coupon` param,
  // which broke discount-code creation. Pinning is Stripe best practice
  // anyway - it stops a future SDK bump silently changing behaviour. Checkout,
  // prices and the portal are stable across these versions.
  _stripe = new Stripe(key, { apiVersion: '2024-06-20' });
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

  const byLookupKey = new Map();
  const byPriceId = new Map();

  // Stripe's prices.list caps `lookup_keys` at 10 elements, so request in
  // batches of ≤10 and merge. We currently manage 12 (2 intervals × 6
  // currencies); passing all 12 at once fails with "Array lookup_keys
  // exceeded maximum 10 allowed elements" and breaks every checkout.
  // We expand the linked Product so debugging in logs is friendlier
  // ("Housemait Monthly" instead of an opaque prod_xxx ID).
  for (let i = 0; i < keys.length; i += 10) {
    const batch = keys.slice(i, i + 10);
    const result = await stripe.prices.list({
      lookup_keys: batch,
      expand: ['data.product'],
      limit: 100,
    });
    for (const price of result.data) {
      if (!price.lookup_key) continue;
      byLookupKey.set(price.lookup_key, price.id);
      byPriceId.set(price.id, price.lookup_key);
    }
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

// ────────────────────────────────────────────────────────────────────────
// Discount codes (admin-created marketing codes).
//
// These are real Stripe coupons + promotion codes - the customer enters the
// code on the Stripe-hosted checkout page (which already has the field via
// allow_promotion_codes:true). Percentage-only by product decision. For iOS,
// the operator creates a matching Apple Offer Code in App Store Connect; the
// two systems don't share codes, only the human-facing string.
// ────────────────────────────────────────────────────────────────────────

// Distinct Stripe product ids backing a given interval ('annual'|'monthly'),
// resolved from the managed lookup_keys. Used to restrict a coupon to one
// plan. Returns [] if none resolve (e.g. wrong env) - caller leaves the
// coupon unrestricted. If annual & monthly share ONE product, this returns
// that shared id for both, so a product restriction can't separate them -
// the caller surfaces that as a note.
async function productIdsForInterval(interval) {
  const stripe = getStripe();
  const lookupKeys = SUPPORTED_CURRENCIES.map((c) => `${interval}_${c}`); // <=6, under Stripe's 10 cap
  const res = await stripe.prices.list({ lookup_keys: lookupKeys, expand: ['data.product'], limit: 100 });
  const ids = new Set();
  for (const p of res.data) {
    const pid = typeof p.product === 'object' && p.product ? p.product.id : p.product;
    if (pid) ids.add(pid);
  }
  return [...ids];
}

/**
 * Create a discount code = a Stripe coupon + a customer-facing promotion code.
 * @param {object} opts
 *   code            - the string customers type (e.g. "SAVE25")
 *   percentOff      - 1..100 (use 100 for a free first period)
 *   duration        - 'once' | 'repeating' | 'forever'
 *   durationInMonths- required when duration === 'repeating'
 *   appliesTo       - 'any' | 'annual' | 'monthly'
 *   maxRedemptions  - cap | null
 *   expiresAt       - ISO string | null
 * Returns { code, restrictedToPlan, sharedProductWarning }.
 */
async function createDiscountCode({ code, percentOff, duration = 'once', durationInMonths = null, appliesTo = 'any', maxRedemptions = null, expiresAt = null }) {
  const stripe = getStripe();
  const couponParams = { percent_off: percentOff, duration, name: code };
  if (duration === 'repeating') couponParams.duration_in_months = durationInMonths;

  let sharedProductWarning = false;
  let restrictedToPlan = null;
  if (appliesTo === 'annual' || appliesTo === 'monthly') {
    const wantIds = await productIdsForInterval(appliesTo);
    const otherIds = await productIdsForInterval(appliesTo === 'annual' ? 'monthly' : 'annual');
    const overlap = wantIds.some((id) => otherIds.includes(id));
    if (wantIds.length && !overlap) {
      couponParams.applies_to = { products: wantIds };
      restrictedToPlan = appliesTo;
    } else if (wantIds.length && overlap) {
      // Annual & monthly share a Stripe product - can't restrict by product.
      sharedProductWarning = true;
    }
  }

  const coupon = await stripe.coupons.create(couponParams);
  const promo = await stripe.promotionCodes.create({
    coupon: coupon.id,
    code,
    ...(maxRedemptions ? { max_redemptions: maxRedemptions } : {}),
    ...(expiresAt ? { expires_at: Math.floor(new Date(expiresAt).getTime() / 1000) } : {}),
  });

  return { code: promo.code, id: promo.id, restrictedToPlan, sharedProductWarning };
}

/** List promotion codes (newest first) with their coupon details flattened. */
async function listDiscountCodes({ limit = 50 } = {}) {
  const stripe = getStripe();
  const res = await stripe.promotionCodes.list({ limit, expand: ['data.coupon'] });
  return res.data.map((pc) => ({
    id: pc.id,
    code: pc.code,
    active: pc.active,
    max_redemptions: pc.max_redemptions ?? null,
    times_redeemed: pc.times_redeemed ?? 0,
    expires_at: pc.expires_at ? new Date(pc.expires_at * 1000).toISOString() : null,
    percent_off: pc.coupon?.percent_off ?? null,
    duration: pc.coupon?.duration ?? null,
    duration_in_months: pc.coupon?.duration_in_months ?? null,
    restricted_products: pc.coupon?.applies_to?.products || null,
  }));
}

/** Enable/disable a promotion code (Stripe can't delete an active one). */
async function setDiscountCodeActive(promotionCodeId, active) {
  const stripe = getStripe();
  const pc = await stripe.promotionCodes.update(promotionCodeId, { active: !!active });
  return pc;
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
  createDiscountCode,
  listDiscountCodes,
  setDiscountCodeActive,
  _resetForTests,
};
