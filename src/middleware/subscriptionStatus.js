const jwt = require('jsonwebtoken');
const { supabaseAdmin } = require('../db/client');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('Missing JWT_SECRET environment variable — refusing to start with insecure defaults');
}

/**
 * Subscription / trial gate — Phase 2.
 *
 * Mounted in app.js as:
 *   app.use('/api', requireActiveSubscription);
 *
 * Because routes in this codebase apply `requireAuth` per-handler (not via
 * `router.use()` at router level), `req.householdId` is NOT set by the time
 * this middleware runs. We therefore re-verify the JWT here to extract the
 * household id. Cost: one extra jwt.verify() per API request — HS256 over a
 * short token, negligible.
 *
 * Scope — mutations only. Safe (read-only) HTTP methods pass through
 * unconditionally; only mutating requests (POST/PATCH/PUT/DELETE) are
 * gated. This matches the product spec's read-only expired state:
 * households whose trial has ended stay able to LOAD their data (so the
 * UI can remind them of what they'd lose and the "Subscribe" modal can
 * show an accurate snapshot), but CAN'T mutate anything. The spec itself
 * describes the backend this way: "The backend 402 middleware already
 * blocks API writes, so even if someone bypasses the frontend, the API
 * won't process mutations for expired households."
 *
 * Path exclusions are maintained inside this module so the wiring stays a
 * one-liner in app.js. Any route prefix that must stay reachable for
 * expired households (login, subscribe, admin tooling, webhooks) goes in
 * EXCLUDED_PATH_PREFIXES below.
 *
 * Fail-open policy: if the token is missing/invalid, the household row
 * can't be loaded, or the status value is unrecognised, we call next()
 * rather than 402. Rationale: the downstream route's own requireAuth will
 * 401 a bad token, and a paying customer shouldn't be locked out by a
 * transient DB blip. The only paths that 402 are the ones where we are
 * *certain* the household has no valid entitlement AND the request is a
 * mutation.
 */

// Path prefixes (relative to the /api mount — req.path inside this
// middleware strips the /api baseUrl). Any request whose path starts with
// one of these bypasses the gate entirely.
const EXCLUDED_PATH_PREFIXES = [
  '/auth',           // login, register, refresh, verify, logout, account deletion — must work for expired users
  '/subscription',   // /status, and later /checkout + /portal — expired users need these
  '/admin',          // platform staff tools — not gated by customer subscription state
  '/inbound-email',  // Postmark/SendGrid webhook — no user auth at all
  '/webhooks',       // future Stripe webhook — secured by signature, not bearer token
  '/unsubscribe',    // one-click email-footer links — mailgun-style clients POST with no bearer token
];

// HTTP methods that don't mutate state. These bypass the gate even for
// expired households so the frontend can render the read-only view the
// product spec describes (Section 8 — "What the user sees… A summary of
// their household's data, pulled from the database").
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function isExcluded(path) {
  // Match `/auth` exactly and `/auth/anything`, but not `/authorize` etc.
  return EXCLUDED_PATH_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(prefix + '/')
  );
}

async function requireActiveSubscription(req, res, next) {
  // 1. Excluded path — pass through immediately (no token decode, no DB read).
  if (isExcluded(req.path)) return next();

  // 2. Safe (read-only) method — pass through. Expired households keep
  //    read access to their own data; only mutations need entitlement.
  //    Short-circuits before the JWT verify and DB lookup so reads are
  //    essentially free at this layer.
  if (SAFE_METHODS.has(req.method)) return next();

  // 3. No bearer token — let the downstream route's requireAuth 401 it. The
  //    gate only makes decisions for requests that ARE authenticated; it
  //    doesn't take on the 401 role.
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next();

  let payload;
  try {
    payload = jwt.verify(header.slice(7), JWT_SECRET);
  } catch {
    return next(); // bad/expired token — downstream requireAuth will surface the 401
  }

  // 4. Token is valid but has no householdId — user just registered and
  //    hasn't created/joined a household yet. Nothing to gate on; they
  //    need to reach /api/auth/create-household (already excluded) or
  //    /api/auth/join. If they somehow hit a gated route in this state
  //    the route's own requireHousehold middleware will 403 them.
  const householdId = payload.householdId;
  if (!householdId) return next();

  // 5. Load the subscription state. Fail open on errors — we don't want
  //    the gate itself to become a reliability hazard.
  let household;
  try {
    const { data, error } = await supabaseAdmin
      .from('households')
      .select('id, is_internal, subscription_status, trial_ends_at')
      .eq('id', householdId)
      .single();
    if (error || !data) {
      console.warn(
        '[subscriptionStatus] household lookup failed for',
        householdId,
        '—',
        error?.message || 'no row'
      );
      return next();
    }
    household = data;
  } catch (err) {
    console.error('[subscriptionStatus] unexpected error during household lookup:', err);
    return next();
  }

  // 6. Internal / beta / tester accounts bypass all checks.
  if (household.is_internal) return next();

  const status = household.subscription_status;
  const trialEndsAt = household.trial_ends_at ? new Date(household.trial_ends_at) : null;
  const now = new Date();

  // 7. Active paid subscription.
  if (status === 'active') return next();

  // 8. Still within the trial window.
  if (status === 'trialing' && trialEndsAt && now < trialEndsAt) return next();

  // 9. Trial has just crossed its end — transition to 'expired' and 402.
  //
  //    The UPDATE is conditional on `subscription_status = 'trialing'` so
  //    that two simultaneous requests crossing the boundary together don't
  //    both try to flip the row. The first UPDATE matches the row; the
  //    second's WHERE clause filters it out (the status is no longer
  //    'trialing') and affects zero rows. Both requests still return 402
  //    — the response isn't about "did I win the race", it's about "is
  //    the trial over", which is true for both.
  if (status === 'trialing' && trialEndsAt && now >= trialEndsAt) {
    try {
      // On trial expiry we also set inactive_since = trial_ends_at, which
      // starts the 12-month retention clock (see Phase 8 / spec §9). If
      // the user subscribes later, the checkout webhook clears the field.
      await supabaseAdmin
        .from('households')
        .update({
          subscription_status: 'expired',
          inactive_since: household.trial_ends_at,
        })
        .eq('id', householdId)
        .eq('subscription_status', 'trialing');
    } catch (err) {
      // The UPDATE is best-effort — even if it fails the trial IS over, so
      // still 402. A later request (or the daily cron we'll add in a
      // future phase) will sync the row.
      console.error('[subscriptionStatus] trial-expiry UPDATE failed:', err);
    }
    return res.status(402).json({
      status: 'trial_expired',
      trial_ended_at: household.trial_ends_at,
    });
  }

  // 10. Already-expired or cancelled — no entitlement.
  if (status === 'expired' || status === 'cancelled') {
    return res.status(402).json({
      status: 'expired',
      trial_ended_at: household.trial_ends_at,
    });
  }

  // 11. Unknown status value. The DB CHECK constraint should make this
  //     unreachable, but if a new status is added to the schema without
  //     updating this middleware, fail open (log) rather than lock every
  //     household out of the app.
  console.warn(
    `[subscriptionStatus] unrecognised subscription_status "${status}" for household ${householdId} — failing open`
  );
  return next();
}

module.exports = { requireActiveSubscription, EXCLUDED_PATH_PREFIXES };
