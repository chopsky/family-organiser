/**
 * RevenueCat webhook handler — IAP Phase 1b.
 *
 * Receives subscription state change events from RevenueCat for iOS IAP
 * subscribers and projects them onto households.subscription_status /
 * subscription_provider / subscription_current_period_end.
 *
 * Security model
 * --------------
 *   - Bearer-token auth: RevenueCat sends `Authorization: Bearer <secret>`
 *     using the value we configured in RevenueCat -> Project Settings ->
 *     Integrations -> Webhooks. The secret lives in the env var
 *     REVENUECAT_WEBHOOK_SECRET. Constant-time compare so timing analysis
 *     can't leak it.
 *   - No HMAC body signing (RevenueCat doesn't offer one) - the bearer
 *     token IS the only auth. Treat the secret like a password; rotate it
 *     by updating both Railway and the RevenueCat dashboard.
 *
 * Idempotency
 * -----------
 *   Mirrors the Stripe webhook pattern: every event_id is INSERTed into
 *   processed_revenuecat_events first; conflict (23505) means we've
 *   already handled this delivery and we 200 ack. If the handler throws
 *   AFTER the insert, we delete the idempotency row so RevenueCat's
 *   retry can reprocess. Handler updates are UPSERT-style on households,
 *   so double-processing is harmless.
 *
 * Event types we handle
 * ---------------------
 *   - INITIAL_PURCHASE   - first paid (or trial-converted) purchase
 *   - RENEWAL            - recurring renewal
 *   - PRODUCT_CHANGE     - switched between monthly <-> annual
 *   - CANCELLATION       - user cancelled (still in their paid period)
 *   - EXPIRATION         - paid period ended without renewal
 *   - BILLING_ISSUE      - payment retry failed (still in grace period)
 *   - SUBSCRIBER_ALIAS   - RevenueCat merged two app_user_ids
 *   - UNCANCELLATION     - user reversed a cancellation while still in period
 *   - TEST               - RevenueCat dashboard test fire (acknowledge & log)
 *   - All other types are 200-acked with a log line.
 *
 * Mounted at: POST /api/webhooks/revenuecat
 */

const express = require('express');
const crypto = require('crypto');
const db = require('../db/queries');

const router = express.Router();

// Body is parsed by the global express.json() in app.js (10 MB limit).
// RevenueCat doesn't sign bodies, so unlike the Stripe webhook we don't
// need raw bytes here. Mounting AFTER the global parser is fine.

// --- Auth helper -----------------------------------------------------

/**
 * Constant-time bearer-token check. Returns true if the request carries
 * the configured secret, false otherwise. Logs warn on misconfiguration
 * (no env var) so prod doesn't silently accept everything.
 */
function isAuthorised(req) {
  const expected = process.env.REVENUECAT_WEBHOOK_SECRET;
  if (!expected) {
    console.error('[revenuecat webhook] REVENUECAT_WEBHOOK_SECRET not set - rejecting all requests');
    return false;
  }
  const header = req.headers['authorization'] || '';
  const match = /^Bearer\s+(.+)$/.exec(header);
  if (!match) return false;
  const provided = match[1];
  // Length-mismatched buffers cause timingSafeEqual to throw - short-circuit.
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

// --- Plan / status helpers -------------------------------------------

/**
 * Map RevenueCat product_id -> our subscription_plan enum ('monthly'|'annual').
 * Substring-based so we don't have to hard-code the exact App Store
 * Connect product IDs (typically `housemait_premium_monthly` etc).
 * Returns null if the product can't be classified - caller leaves
 * subscription_plan untouched.
 */
function planFromProductId(productId) {
  if (!productId) return null;
  if (/annual|year/i.test(productId)) return 'annual';
  if (/month/i.test(productId)) return 'monthly';
  return null;
}

/**
 * Resolve a RevenueCat event payload to one of our household rows.
 *
 * In the happy path (the iOS app called Purchases.logIn(household.id)
 * before any purchase), app_user_id is the household UUID directly.
 * Fallback to the revenuecat_app_user_id column for anonymous /
 * aliased cases.
 */
async function resolveHousehold(appUserId) {
  if (!appUserId) return null;
  // Path 1: app_user_id IS the household id (the canonical case).
  const direct = await db.getHouseholdById(appUserId).catch(() => null);
  if (direct) return direct;
  // Path 2: alias / anon id -> look up via the column.
  return db.findHouseholdByRevenuecatAppUserId(appUserId);
}

// --- Route -----------------------------------------------------------

router.post('/', async (req, res) => {
  if (!isAuthorised(req)) {
    return res.status(401).json({ error: 'Unauthorised' });
  }

  // RevenueCat wraps the event under `event` plus a top-level `api_version`.
  const event = req.body && req.body.event;
  if (!event || !event.id || !event.type) {
    console.warn('[revenuecat webhook] malformed payload - missing event.id / event.type');
    return res.status(400).json({ error: 'Malformed payload' });
  }

  // Idempotency gate - exact mirror of the Stripe pattern.
  let isNew;
  try {
    isNew = await db.recordRevenuecatEventIfNew(event.id, event.type, event.app_user_id);
  } catch (err) {
    console.error('[revenuecat webhook] idempotency write failed:', err);
    return res.status(500).json({ error: 'Idempotency check failed' });
  }
  if (!isNew) {
    return res.status(200).json({ received: true, duplicate: true });
  }

  try {
    await handleEvent(event);
    console.log(
      `[revenuecat webhook] processed ${event.type} (${event.id}) ` +
      `app_user_id=${event.app_user_id} env=${event.environment || '?'}`
    );
    return res.status(200).json({ received: true });
  } catch (err) {
    console.error(`[revenuecat webhook] handler for ${event.type} (${event.id}) failed:`, err);
    try {
      await db.deleteProcessedRevenuecatEvent(event.id);
    } catch (delErr) {
      console.error(
        `[revenuecat webhook] CRITICAL: rollback of idempotency row ${event.id} failed - ` +
        `manual intervention may be needed:`,
        delErr
      );
    }
    return res.status(500).json({ error: 'Event processing failed' });
  }
});

// --- Event handlers --------------------------------------------------

async function handleEvent(event) {
  switch (event.type) {
    case 'INITIAL_PURCHASE':
    case 'RENEWAL':
    case 'PRODUCT_CHANGE':
    case 'UNCANCELLATION':
      return applyActiveSubscription(event);
    case 'CANCELLATION':
      // Cancellation here means "user has hit cancel, but is still in
      // their paid period". The subscription stays active until the
      // period ends - at which point we get an EXPIRATION event.
      // Match Stripe semantics: log only; flip status on EXPIRATION.
      return logOnly(event, 'cancelled but still in paid period');
    case 'EXPIRATION':
      return applyExpiredSubscription(event);
    case 'BILLING_ISSUE':
      return logOnly(event, 'billing issue - RevenueCat will retry; staying active during grace period');
    case 'SUBSCRIBER_ALIAS':
      return handleSubscriberAlias(event);
    case 'TEST':
      return logOnly(event, 'test event from RevenueCat dashboard - acknowledged');
    default:
      console.log(`[revenuecat webhook] ignoring unhandled event type: ${event.type}`);
  }
}

/**
 * Active states (initial purchase, renewal, plan-change, un-cancel) all
 * write the same household state: status=active, provider=apple,
 * plan from product_id, current period end from expiration_at_ms.
 */
async function applyActiveSubscription(event) {
  const household = await resolveHousehold(event.app_user_id);
  if (!household) {
    console.warn(
      `[revenuecat webhook] ${event.type} (${event.id}) has no resolvable household ` +
      `(app_user_id=${event.app_user_id})`
    );
    return;
  }

  const update = {
    subscription_status: 'active',
    subscription_provider: 'apple',
    revenuecat_app_user_id: event.app_user_id,
    inactive_since: null, // clear retention clock if it was ticking
  };

  const plan = planFromProductId(event.product_id);
  if (plan) update.subscription_plan = plan;

  if (event.expiration_at_ms) {
    update.subscription_current_period_end = new Date(event.expiration_at_ms).toISOString();
  }

  await db.updateHouseholdSubscription(household.id, update);
}

/**
 * EXPIRATION = paid period over without renewal. Mirrors the Stripe
 * customer.subscription.deleted handler: status -> cancelled, start the
 * 12-month retention clock (inactive_since).
 */
async function applyExpiredSubscription(event) {
  const household = await resolveHousehold(event.app_user_id);
  if (!household) {
    console.warn(
      `[revenuecat webhook] EXPIRATION (${event.id}) has no resolvable household ` +
      `(app_user_id=${event.app_user_id})`
    );
    return;
  }

  // expiration_at_ms is when the period ended - that's when the household
  // became inactive for retention-cleanup purposes.
  const inactiveSince = event.expiration_at_ms
    ? new Date(event.expiration_at_ms).toISOString()
    : new Date().toISOString();

  await db.updateHouseholdSubscription(household.id, {
    subscription_status: 'cancelled',
    inactive_since: inactiveSince,
  });
}

/**
 * SUBSCRIBER_ALIAS: RevenueCat tells us that two app_user_ids should
 * point at the same subscriber. Most commonly: an anonymous purchase
 * was later linked to a real user via Purchases.logIn(). We update the
 * household whose revenuecat_app_user_id was the original_app_user_id
 * to use the new app_user_id going forward.
 *
 * We don't ALWAYS receive these - only when the SDK explicitly aliases.
 * This handler is defensive; in our flow logIn() runs early so aliases
 * should be rare.
 */
async function handleSubscriberAlias(event) {
  const original = event.original_app_user_id;
  const next = event.app_user_id;
  if (!original || !next || original === next) return;

  // Try to find a household via either id. Whichever exists wins.
  const byOriginal = await resolveHousehold(original);
  const byNext = await resolveHousehold(next);
  const household = byOriginal || byNext;
  if (!household) {
    console.warn(
      `[revenuecat webhook] SUBSCRIBER_ALIAS (${event.id}) - neither ${original} nor ${next} ` +
      `resolves to a household; ignoring`
    );
    return;
  }

  await db.updateHouseholdSubscription(household.id, {
    revenuecat_app_user_id: next,
    subscription_provider: 'apple',
  });
}

function logOnly(event, reason) {
  console.log(
    `[revenuecat webhook] ${event.type} (${event.id}) - ${reason}; no DB change`
  );
}

module.exports = router;
