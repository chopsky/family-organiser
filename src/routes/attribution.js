const express = require('express');
const router = express.Router();
const db = require('../db/queries');
const { requireAuth } = require('../middleware/auth');
const { redeemAttributionToken } = require('../services/adservices');

/**
 * POST /api/attribution/adservices  { token }
 *
 * The iOS app sends its AdServices attribution token once, after first
 * sign-in; we redeem it with Apple and stamp the answer on the user. Organic
 * ({ attribution: false }) is stored too - "Apple said no" must be
 * distinguishable from "never asked", or every organic user would re-redeem
 * on every launch.
 *
 * The response's `stored` flag is the client's contract: the device only
 * marks itself done when stored is true, so a missing migration, an Apple
 * outage, or an expired token all mean "try again next launch with a fresh
 * token" rather than a lost answer.
 *
 * Per USER, not household: the install belongs to whoever it converted into.
 */
router.post('/adservices', requireAuth, async (req, res) => {
  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  if (!token) return res.status(400).json({ error: 'Missing token' });

  try {
    const existing = await db.getUserAdAttribution(req.user.id);
    if (existing?.ad_attribution_at) return res.json({ stored: true, already: true });

    const result = await redeemAttributionToken(token);
    if (!result.ok) return res.json({ stored: false });

    await db.setUserAdAttribution(req.user.id, result.payload);
    return res.json({ stored: true, attributed: result.payload?.attribution === true });
  } catch (err) {
    // Most likely the pending migration (missing column). Never an error to
    // the client - the retry-next-launch path is the designed recovery.
    console.warn('[attribution] could not store AdServices result:', err.message);
    return res.json({ stored: false });
  }
});

module.exports = router;
