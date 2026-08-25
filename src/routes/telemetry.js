/**
 * Client telemetry that must NEVER break the thing it measures. The
 * paywall screen fire-and-forgets its outcomes here; any failure - table
 * not migrated, DB blip, bad input - answers 200 with ok:false and moves
 * on. A wall that crashes over its own scoreboard would be absurd.
 */

const { Router } = require('express');
const db = require('../db/queries');
const { requireAuth, requireHousehold } = require('../middleware/auth');

const router = Router();

const OUTCOMES = new Set(['shown', 'converted', 'restored', 'skipped', 'fallthrough']);
const CONTEXTS = new Set(['onboarding', 'gate']);

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
