const { Router } = require('express');
const db = require('../db/queries');
const { requireAuth, requireHousehold } = require('../middleware/auth');
const stripeService = require('../services/stripe');

const router = Router();

function resolveWebUrl() {
  return process.env.WEB_URL || process.env.FRONTEND_URL || 'https://www.housemait.com';
}

/**
 * GET /api/subscription/status
 *
 * Returns the current trial/subscription state for the authenticated
 * user's household. This endpoint is deliberately NOT gated by the
 * requireActiveSubscription middleware — expired users must be able to
 * read their own state so the frontend can render the subscribe prompt
 * with accurate trial_ends_at / days_remaining values.
 *
 * Response shape:
 *   {
 *     "status": "trialing" | "active" | "expired" | "cancelled",
 *     "trial_ends_at": "2026-05-21T00:00:00Z" | null,
 *     "days_remaining": 27 | null,          // null unless status === 'trialing'
 *     "subscription_plan": "monthly" | "annual" | null,
 *     "subscription_provider": "stripe" | "apple",  // which billing platform
 *     "is_internal": false                  // tester/beta accounts — frontend treats as unlimited
 *   }
 */
router.get('/status', requireAuth, requireHousehold, async (req, res) => {
  try {
    const household = await db.getHouseholdById(req.householdId);
    if (!household) {
      return res.status(404).json({ error: 'Household not found' });
    }

    const status = household.subscription_status;
    const trialEndsAt = household.trial_ends_at || null;

    // days_remaining is only meaningful during an active trial. Ceil so a
    // trial with a fraction of a day left still reports "1 day left" — the
    // frontend copy reads "X days left" and we don't want to round down to
    // zero prematurely. Clamp at 0 so we never report negative days for a
    // trial that's technically past but hasn't been flipped to 'expired'
    // yet (the gate middleware flips it on the next gated request).
    let daysRemaining = null;
    if (status === 'trialing' && trialEndsAt) {
      const diffMs = new Date(trialEndsAt).getTime() - Date.now();
      daysRemaining = Math.max(0, Math.ceil(diffMs / 86_400_000));
    }

    return res.json({
      status,
      trial_ends_at: trialEndsAt,
      days_remaining: daysRemaining,
      subscription_plan: household.subscription_plan || null,
      // Default to 'stripe' if the column is somehow null (legacy rows
      // pre-Phase-1a were backfilled, but defensive fallback).
      subscription_provider: household.subscription_provider || 'stripe',
      is_internal: household.is_internal === true,
    });
  } catch (err) {
    console.error('GET /api/subscription/status error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/subscription/checkout
 *
 * Body: { plan: 'monthly' | 'annual' }
 * Returns: { url: <Stripe Checkout URL>, session_id: <cs_...> }
 *
 * Creates a Stripe Checkout Session and hands the URL back to the
 * frontend, which redirects the browser. The session's metadata +
 * client_reference_id carry the household_id so the webhook can
 * correlate back without relying on customer lookup.
 *
 * Mid-trial: we do NOT pass a Stripe trial_period_days. Users
 * subscribing mid-trial start billing immediately and forfeit remaining
 * days — spec trade-off (§3). Their `active` status takes precedence
 * over any trial_ends_at still in the future, so the gate still lets
 * them in.
 */
router.post('/checkout', requireAuth, requireHousehold, async (req, res) => {
  const plan = req.body?.plan;
  if (plan !== 'monthly' && plan !== 'annual') {
    return res.status(400).json({ error: 'plan must be "monthly" or "annual"' });
  }

  try {
    const user = await db.getUserById(req.user.id);
    if (!user?.email) {
      // Pre-email-verified accounts or dependents — they shouldn't be
      // able to checkout without a real email to send the receipt to.
      return res.status(400).json({ error: 'Account has no email on file' });
    }

    const webUrl = resolveWebUrl();
    const session = await stripeService.createCheckoutSession({
      plan,
      householdId: req.householdId,
      customerEmail: user.email,
      successUrl: `${webUrl}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${webUrl}/subscription/cancel`,
    });

    return res.json({ url: session.url, session_id: session.id });
  } catch (err) {
    console.error('POST /api/subscription/checkout error:', err);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

/**
 * POST /api/subscription/portal
 *
 * Returns: { url: <Stripe Customer Portal URL> }
 *
 * Creates a Stripe Customer Portal session so the user can manage their
 * subscription (switch plan, update card, cancel). Requires the
 * household to have a stripe_customer_id — i.e. they've completed at
 * least one checkout. Returns 400 otherwise rather than silently
 * creating a new customer.
 */
router.post('/portal', requireAuth, requireHousehold, async (req, res) => {
  try {
    const household = await db.getHouseholdById(req.householdId);
    if (!household?.stripe_customer_id) {
      return res.status(400).json({
        error: 'No Stripe customer on this household — subscribe first to access the portal',
      });
    }

    const webUrl = resolveWebUrl();
    const session = await stripeService.createPortalSession({
      customerId: household.stripe_customer_id,
      returnUrl: `${webUrl}/settings`,
    });

    return res.json({ url: session.url });
  } catch (err) {
    console.error('POST /api/subscription/portal error:', err);
    return res.status(500).json({ error: 'Failed to create portal session' });
  }
});

module.exports = router;
