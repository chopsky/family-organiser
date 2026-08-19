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
    // `incoming` (this household's own pending gift) is deliberately
    // outside the pilot gate: the recipient of a pilot household's link
    // is by definition not on the pilot list, but their gift is real.
    let incoming = await referrals.getIncomingReferral(req.householdId);
    if (incoming?.status === 'pending') {
      // Opportunistic settlement: the Dashboard polling its own gift is
      // the one moment we know the recipient is looking, so the card can
      // flip to "landed" on the very load where the household crossed
      // the line. Same conditional-update rules as the nightly job.
      const outcome = await referrals.settleReferralForHousehold(req.householdId);
      if (outcome === 'activated') {
        incoming = await referrals.getIncomingReferral(req.householdId);
      }
    }
    if (!referrals.referralsEnabled(req.householdId)) {
      return res.json({ enabled: false, incoming });
    }
    const state = await referrals.getReferralStateForHousehold(req.householdId);
    return res.json({ enabled: true, ...state, incoming });
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
    // No household name: families name households privately (in-jokes,
    // kids' slang) and gift links get forwarded - the recipient already
    // knows who sent it from the chat it arrived in.
    return res.json({
      valid: true,
      code: household.referral_code,
    });
  } catch (err) {
    console.error('GET /api/referrals/gift error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
