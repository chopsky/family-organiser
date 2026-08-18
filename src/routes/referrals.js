/**
 * Referral endpoints.
 *
 * GET /api/referrals/mine       - auth'd; the household's code + counts.
 *                                 Answers { enabled: false } outside the
 *                                 pilot (REFERRAL_PILOT_HOUSEHOLDS) so the
 *                                 web surfaces know to render nothing.
 * GET /api/referrals/gift/:code - public (like /subscription/promo/:code);
 *                                 powers the /gift/<code> landing page.
 *                                 Rate-limited: it enumerates nothing
 *                                 sensitive (family display name only) but
 *                                 there's no reason to allow scraping.
 */

const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth, requireHousehold } = require('../middleware/auth');
const referrals = require('../services/referrals');

const router = Router();

const giftLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

router.get('/mine', requireAuth, requireHousehold, async (req, res) => {
  try {
    if (!referrals.referralsEnabled(req.householdId)) {
      return res.json({ enabled: false });
    }
    const state = await referrals.getReferralStateForHousehold(req.householdId);
    return res.json({ enabled: true, ...state });
  } catch (err) {
    console.error('GET /api/referrals/mine error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/gift/:code', giftLimiter, async (req, res) => {
  try {
    const household = await referrals.findHouseholdByReferralCode(req.params.code);
    if (!household) {
      return res.status(404).json({ error: 'This gift link is not valid.' });
    }
    // Display name only - never expose members, emails, or ids.
    return res.json({
      valid: true,
      code: household.referral_code,
      family_name: household.name || null,
    });
  } catch (err) {
    console.error('GET /api/referrals/gift error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
