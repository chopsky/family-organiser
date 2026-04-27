/**
 * Stripe webhook handler — Phase 3.
 *
 * Security model:
 *   • NO bearer-token auth. Stripe doesn't send one.
 *   • Authenticity verified via Stripe's HMAC signature (STRIPE_WEBHOOK_SECRET).
 *   • subscriptionStatus gate also excludes /webhooks/* so expired
 *     households' subscribe-to-renew flow works.
 *   • Mounted in app.js BEFORE express.json() — the signature check
 *     needs the exact raw request bytes.
 *
 * Idempotency:
 *   Every successfully-verified event_id is recorded in
 *   processed_stripe_events (primary key = event_id). If the insert
 *   conflicts, the event is a re-delivery and we 200 without re-running
 *   the handler. If the handler throws AFTER the insert, we delete the
 *   idempotency row so Stripe's retry can reprocess. All handlers are
 *   idempotent on the database side (UPSERT-style updates) so double-
 *   processing is harmless.
 *
 * NOT a true ACID transaction — Supabase's client doesn't expose
 * cross-call transactions. The spec's "wrap in a transaction" line is
 * approximated by: (a) atomic insert via unique PK race, (b) rollback
 * of the insert on handler failure, (c) idempotent handlers so replay
 * is safe. Flag: if you later need hard transactionality, move this
 * block into a plpgsql function and call via supabase.rpc().
 */

const express = require('express');
const db = require('../db/queries');
const stripeService = require('../services/stripe');

const router = express.Router();

// ─── Body parser: raw bytes for signature verification ──────────────
// Scoped to THIS router only so the global express.json() in app.js can
// keep handling every other route normally.
router.use(express.raw({ type: 'application/json', limit: '2mb' }));

router.post('/stripe', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  if (!sig) {
    return res.status(400).json({ error: 'Missing Stripe-Signature header' });
  }

  let event;
  try {
    event = stripeService.constructWebhookEvent(req.body, sig);
  } catch (err) {
    // Don't leak details — bad signatures usually mean hostile or
    // misconfigured sender. Log for ops, return 400.
    console.error('[stripe webhook] signature verification failed:', err.message);
    return res.status(400).json({ error: 'Signature verification failed' });
  }

  // ── Idempotency gate ────────────────────────────────────────────
  let isNew;
  try {
    isNew = await db.recordStripeEventIfNew(event.id, event.type);
  } catch (err) {
    console.error('[stripe webhook] idempotency write failed:', err);
    // Can't reason about whether this is a dup — fail loud so Stripe retries.
    return res.status(500).json({ error: 'Idempotency check failed' });
  }

  if (!isNew) {
    // Already processed — ack so Stripe stops retrying.
    return res.status(200).json({ received: true, duplicate: true });
  }

  // ── Process the event ───────────────────────────────────────────
  // Return 200 quickly on success; roll back the dedupe row on failure
  // so Stripe's next retry re-runs the handler.
  //
  // Info log on every accepted event. Low-volume traffic (a few events
  // per subscription transition per household per month) so the noise
  // cost is tiny, and having a clear "yes, this landed and succeeded"
  // line makes post-hoc debugging much easier than silent 200s.
  try {
    await handleEvent(event);
    console.log(`[stripe webhook] processed ${event.type} (${event.id})`);
    return res.status(200).json({ received: true });
  } catch (err) {
    console.error(`[stripe webhook] handler for ${event.type} (${event.id}) failed:`, err);
    try {
      await db.deleteProcessedStripeEvent(event.id);
    } catch (delErr) {
      // If rollback fails, the event is stuck until a human intervenes
      // (Stripe will retry, but our dedupe will reject it). Log loudly.
      console.error(
        `[stripe webhook] CRITICAL: rollback of idempotency row ${event.id} failed — ` +
        `manual intervention may be needed to reprocess:`,
        delErr
      );
    }
    return res.status(500).json({ error: 'Event processing failed' });
  }
});

// ─── Event handlers ─────────────────────────────────────────────────

/**
 * Resolve a Stripe object back to our household_id.
 *
 * Lookup order (cheapest first):
 *   1. Event-object metadata (set by createCheckoutSession on both the
 *      session and its subscription.metadata).
 *   2. client_reference_id (Checkout session field).
 *   3. Local DB lookup by stripe_customer_id.
 *   4. Local DB lookup by stripe_subscription_id.
 *   5. Remote fetch: retrieve the subscription from Stripe and read its
 *      metadata.household_id.
 *
 * Step 5 matters because Stripe sends webhooks in an order that isn't
 * intuitive: the FIRST invoice.paid often arrives BEFORE
 * checkout.session.completed on a fresh subscription. When it does, the
 * household's stripe_customer_id / stripe_subscription_id columns
 * aren't yet populated, so steps 3 and 4 both miss. Step 5 fetches the
 * subscription directly from Stripe (which carries the household_id we
 * set in subscription_data.metadata at checkout) and resolves cleanly.
 *
 * Returns null only when ALL five paths fail — genuinely orphan events
 * (e.g. test fires with fake IDs) log + 200 ack (returning 500 would
 * cause Stripe to retry forever).
 */
async function resolveHouseholdId({ metadata, clientReferenceId, customerId, subscriptionId }) {
  if (metadata?.household_id) return metadata.household_id;
  if (clientReferenceId) return clientReferenceId;
  if (customerId) {
    const row = await db.findHouseholdByStripeCustomerId(customerId);
    if (row) return row.id;
  }
  if (subscriptionId) {
    const row = await db.findHouseholdByStripeSubscriptionId(subscriptionId);
    if (row) return row.id;

    // Last-ditch: fetch the subscription from Stripe. Covers the
    // first-invoice-before-checkout-completion race. Swallow fetch
    // errors — this is a best-effort resolution, not a hard dependency.
    try {
      const stripe = stripeService.getStripe();
      const sub = await stripe.subscriptions.retrieve(subscriptionId);
      if (sub?.metadata?.household_id) return sub.metadata.household_id;
    } catch (err) {
      console.warn(
        `[stripe webhook] subscription-fetch resolution failed for ${subscriptionId}:`,
        err.message || err
      );
    }
  }
  return null;
}

// Narrow helper — Stripe sometimes returns an ID string, sometimes a
// full expanded object. Normalise to the ID.
function idOf(val) {
  if (!val) return null;
  if (typeof val === 'string') return val;
  return val.id || null;
}

async function handleEvent(event) {
  switch (event.type) {
    case 'checkout.session.completed':
      return handleCheckoutCompleted(event.data.object);
    case 'invoice.paid':
      return handleInvoicePaid(event.data.object);
    case 'invoice.payment_failed':
      return handleInvoicePaymentFailed(event.data.object);
    case 'customer.subscription.updated':
      return handleSubscriptionUpdated(event.data.object);
    case 'customer.subscription.deleted':
      return handleSubscriptionDeleted(event.data.object);
    default:
      // Acknowledged but ignored. Stripe sends many event types we don't
      // subscribe to — logging at info level is enough.
      console.log(`[stripe webhook] ignoring unhandled event type: ${event.type}`);
  }
}

async function handleCheckoutCompleted(session) {
  const customerId = idOf(session.customer);
  const subscriptionId = idOf(session.subscription);

  const householdId = await resolveHouseholdId({
    metadata: session.metadata,
    clientReferenceId: session.client_reference_id,
    customerId,
    subscriptionId,
  });
  if (!householdId) {
    console.warn(
      `[stripe webhook] checkout.session.completed (${session.id}) has no resolvable household`
    );
    return;
  }

  // The session only carries the subscription ID — fetch the full
  // subscription to get the price + current_period_end for our DB.
  let plan = null;
  let periodEnd = null;
  if (subscriptionId) {
    const stripe = stripeService.getStripe();
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    plan = stripeService.planFromPriceId(sub.items?.data?.[0]?.price?.id);
    if (sub.current_period_end) {
      periodEnd = new Date(sub.current_period_end * 1000).toISOString();
    }
  }

  // Active status overrides any remaining trial time (spec §3). We don't
  // touch trial_started_at / trial_ends_at — the gate middleware
  // short-circuits on subscription_status='active' before looking at them.
  //
  // inactive_since is cleared on every successful checkout — covers the
  // "resubscribed after trial expiry" case where the 12-month retention
  // clock was already ticking. The household is active again, so reset.
  await db.updateHouseholdSubscription(householdId, {
    subscription_status: 'active',
    stripe_customer_id: customerId,
    stripe_subscription_id: subscriptionId,
    subscription_plan: plan,
    subscription_current_period_end: periodEnd,
    inactive_since: null,
  });
}

async function handleInvoicePaid(invoice) {
  // Fires on initial charge AND on every renewal. Re-affirms active
  // status and rolls subscription_current_period_end forward.
  const customerId = idOf(invoice.customer);
  const subscriptionId = idOf(invoice.subscription);
  const householdId = await resolveHouseholdId({
    metadata: invoice.metadata,
    customerId,
    subscriptionId,
  });
  if (!householdId) {
    console.warn(`[stripe webhook] invoice.paid (${invoice.id}) has no resolvable household`);
    return;
  }

  // Clear inactive_since on every successful payment — if a household
  // was cancelled-but-still-in-period and the user resubscribed, the
  // retention clock must stop. Idempotent for households that were
  // never inactive (UPDATE to null-from-null is a no-op).
  const update = { subscription_status: 'active', inactive_since: null };
  // The renewed period lives on the invoice line item.
  const periodEnd = invoice.lines?.data?.[0]?.period?.end;
  if (periodEnd) {
    update.subscription_current_period_end = new Date(periodEnd * 1000).toISOString();
  }
  await db.updateHouseholdSubscription(householdId, update);
}

async function handleInvoicePaymentFailed(invoice) {
  // Intentionally non-destructive: Stripe has its own dunning window
  // (retries the card for a few days) and will fire
  // customer.subscription.deleted when it gives up. Flipping status to
  // something like 'past_due' on the first failure would disable paying
  // customers over a transient bank blip. If we add a 'past_due' enum
  // value later, hook it in here. For now: log for ops visibility.
  const subscriptionId = idOf(invoice.subscription);
  const customerId = idOf(invoice.customer);
  console.warn(
    `[stripe webhook] invoice.payment_failed (${invoice.id}) subscription=${subscriptionId} ` +
    `customer=${customerId} — no DB change; Stripe will retry and eventually cancel if unrecoverable`
  );
}

async function handleSubscriptionUpdated(subscription) {
  const customerId = idOf(subscription.customer);
  const householdId = await resolveHouseholdId({
    metadata: subscription.metadata,
    customerId,
    subscriptionId: subscription.id,
  });
  if (!householdId) {
    console.warn(
      `[stripe webhook] customer.subscription.updated (${subscription.id}) has no resolvable household`
    );
    return;
  }

  const update = { stripe_subscription_id: subscription.id };

  // Map Stripe's subscription statuses onto our enum. Stripe values:
  //   active, trialing, canceled, incomplete, incomplete_expired,
  //   past_due, unpaid, paused.
  // We bucket conservatively — incomplete / past_due / unpaid leave our
  // status untouched (the invoice events carry the authoritative signal).
  if (subscription.status === 'active' || subscription.status === 'trialing') {
    update.subscription_status = 'active';
  } else if (subscription.status === 'canceled') {
    update.subscription_status = 'cancelled';
  }

  const plan = stripeService.planFromPriceId(subscription.items?.data?.[0]?.price?.id);
  if (plan) update.subscription_plan = plan;
  if (subscription.current_period_end) {
    update.subscription_current_period_end =
      new Date(subscription.current_period_end * 1000).toISOString();
  }

  await db.updateHouseholdSubscription(householdId, update);
}

async function handleSubscriptionDeleted(subscription) {
  const customerId = idOf(subscription.customer);
  const householdId = await resolveHouseholdId({
    metadata: subscription.metadata,
    customerId,
    subscriptionId: subscription.id,
  });
  if (!householdId) {
    console.warn(
      `[stripe webhook] customer.subscription.deleted (${subscription.id}) has no resolvable household`
    );
    return;
  }

  // Start the 12-month retention clock (spec §9 / Phase 8). Stripe's
  // cancelled subscription carries its period end — we use whichever
  // field is populated. `ended_at` is set on immediate cancellation;
  // `current_period_end` is the end of the paid-up window for
  // cancel-at-period-end. Either way, that's when the household
  // becomes inactive for our purposes.
  //
  // Fall back to "now" if neither timestamp is present — better to
  // start the clock today than leave it null and never retain-clean.
  const endUnix = subscription.ended_at || subscription.current_period_end;
  const inactiveSince = endUnix
    ? new Date(endUnix * 1000).toISOString()
    : new Date().toISOString();

  await db.updateHouseholdSubscription(householdId, {
    subscription_status: 'cancelled',
    inactive_since: inactiveSince,
  });
}

module.exports = router;
