/**
 * Client telemetry that must NEVER break the thing it measures. The
 * paywall screen fire-and-forgets its outcomes here; any failure - table
 * not migrated, DB blip, bad input - answers 200 with ok:false and moves
 * on. A wall that crashes over its own scoreboard would be absurd.
 */

const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db/queries');
const { requireAuth, requireHousehold } = require('../middleware/auth');

const router = Router();

const OUTCOMES = new Set(['shown', 'converted', 'restored', 'skipped', 'fallthrough']);
const CONTEXTS = new Set(['onboarding', 'gate']);

// The v4 flow's step/phase vocabulary. Kept in lockstep with
// web/src/pages/onboarding-v4/flow.js by hand - an unknown step is
// dropped, so a renamed step shows up as a hole in the funnel, not an
// error. 'invitecode' is the join-a-home overlay.
const ONBOARDING_STEPS = new Set([
  'splash', 'pains', 'plan', 'shape', 'you', 'role', 'kids', 'house',
  'cals', 'inbox', 'reminders', 'signup', 'login', 'invitecode',
  'paywall', 'done',
  // 'ask' (pre-auth WhatsApp intent) retired 2026-08-28; kept accepted so
  // stragglers on old builds don't punch a hole in their own funnels.
  'ask',
  // The post-auth pairing phase that replaced it.
  'whatsapp',
]);
const ONBOARDING_ACTIONS = new Set(['enter', 'skip', 'back']);

// Pre-account by nature, so unauthenticated - which makes rate limiting
// the only bouncer. ~2 events per step, 12 steps: 60/min is ample for a
// human and useless for flooding.
const onboardingLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false },
  skip: () => process.env.NODE_ENV === 'test',
});

/**
 * POST /api/telemetry/onboarding  { anonId, step, action, platform? }
 * Anonymous step telemetry for the native onboarding flow. Same contract
 * as the paywall endpoint: this can NEVER break the flow it measures -
 * bad input and missing tables answer 200 with ok:false.
 */
router.post('/onboarding', onboardingLimiter, async (req, res) => {
  const anonId = String(req.body?.anonId || '');
  const step = String(req.body?.step || '');
  const action = String(req.body?.action || '');
  const platform = String(req.body?.platform || '').slice(0, 16) || null;
  if (!/^[0-9a-fA-F-]{16,40}$/.test(anonId)) return res.json({ ok: false });
  if (!ONBOARDING_STEPS.has(step) || !ONBOARDING_ACTIONS.has(action)) return res.json({ ok: false });
  try {
    await db.recordOnboardingEvent({ anonId, step, action, platform });
    return res.json({ ok: true });
  } catch (err) {
    console.warn('[telemetry] onboarding event dropped (migration pending?):', err.message);
    return res.json({ ok: false });
  }
});

router.post('/paywall', requireAuth, requireHousehold, async (req, res) => {
  const outcome = String(req.body?.outcome || '');
  const context = CONTEXTS.has(String(req.body?.context || '')) ? String(req.body.context) : 'onboarding';
  if (!OUTCOMES.has(outcome)) return res.json({ ok: false });
  try {
    await db.recordPaywallEvent({
      householdId: req.householdId,
      userId: req.user.id,
      outcome,
      context,
    });
    return res.json({ ok: true });
  } catch (err) {
    console.warn('[telemetry] paywall event dropped (migration pending?):', err.message);
    return res.json({ ok: false });
  }
});

module.exports = router;
