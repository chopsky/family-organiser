/**
 * Public house-inbox endpoints.
 *
 * Onboarding claims the household's @inbox.housemait.com address at step
 * 10 - BEFORE an account exists - so the availability check can't sit
 * behind requireAuth like the Settings one does. Same validation and
 * same uniqueness query underneath (utils/email-alias + queries), just
 * an unauthenticated, rate-limited door.
 *
 * Deliberately answers only "is this free?" - never enumerates who holds
 * what. Same posture as the public gift-code lookup.
 */

const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db/queries');
const { validateEmailAlias } = require('../utils/email-alias');

const router = Router();

// Generous enough for debounced typing (one call per ~400ms pause),
// tight enough that the endpoint isn't a comfortable way to sweep the
// namespace.
const availabilityLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests.' },
});

/**
 * GET /api/inbox/availability?alias=<x>
 * -> { available, normalised, reason }
 */
router.get('/availability', availabilityLimiter, async (req, res) => {
  try {
    const v = validateEmailAlias(String(req.query.alias || ''));
    if (!v.ok) return res.json({ available: false, normalised: null, reason: v.reason });
    const available = await db.isEmailAliasAvailable(v.normalised, null);
    return res.json({
      available,
      normalised: v.normalised,
      reason: available ? null : 'Taken - try another',
    });
  } catch (err) {
    console.error('GET /api/inbox/availability error:', err);
    // Fail SOFT: a wobble in this check must never make a free address
    // look taken and send someone hunting for a different name.
    return res.json({ available: null, normalised: null, reason: null });
  }
});

module.exports = router;
