/**
 * Public invite-code lookup.
 *
 * Onboarding's "join an existing home" path runs BEFORE an account exists,
 * so this can't sit behind requireAuth. It turns a typed short code into
 * the invite's full token (which the existing ?invite= signup path already
 * understands) plus the household display name for the confirmation card -
 * "You're joining The Shapiro family - invited by Grant".
 *
 * Posture matches /api/inbox/availability: rate-limited, fails SOFT, and
 * answers only yes/no - an invalid, expired, or already-accepted code all
 * return the same { valid: false } so the endpoint can't be used to probe
 * which is which.
 */

const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db/queries');
const { normaliseInviteCode, isValidInviteCodeShape } = require('../utils/invite-code');

const router = Router();

// One debounced check per typing pause plus a confirm re-check; 10/min is
// ample for a human and useless for sweeping a ~594M-code space.
const lookupLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests.' },
  // The limiter is module-level state; without this, a test FILE shares one
  // budget and the later tests 429 for reasons unrelated to what they test.
  skip: () => process.env.NODE_ENV === 'test',
});

/**
 * GET /api/invites/lookup?code=<x>   (typed short code)
 * GET /api/invites/lookup?token=<x>  (the full link token - powers the
 *                                     invite-aware web landing, which knows
 *                                     the token from the URL and needs the
 *                                     household name + code to display)
 * -> { valid: true, householdName, inviterName, token, code, invitee: { name, family_role } }
 * -> { valid: false }   (unknown / expired / accepted / malformed)
 * -> { valid: null }    (server trouble - caller should let the user retry,
 *                        never hard-fail onboarding on our blip)
 */
router.get('/lookup', lookupLimiter, async (req, res) => {
  const token = String(req.query.token || '').trim();
  if (token) {
    if (!/^[0-9a-f]{64}$/.test(token)) return res.json({ valid: false });
    try {
      const invite = await db.getInviteByToken(token);
      if (!invite) return res.json({ valid: false });
      return res.json(await presentInvite(invite));
    } catch (err) {
      console.error('[invites] token lookup failed:', err.message);
      return res.json({ valid: null });
    }
  }
  const code = normaliseInviteCode(req.query.code);
  if (!isValidInviteCodeShape(code)) return res.json({ valid: false });
  try {
    const invite = await db.getInviteByCode(code);
    if (!invite) return res.json({ valid: false });
    return res.json(await presentInvite(invite));
  } catch (err) {
    console.error('[invites] code lookup failed:', err.message);
    return res.json({ valid: null });
  }
});

/** The lookup response, shared by the code and token branches. */
async function presentInvite(invite) {
  let householdName = null;
  let inviterName = null;
  try {
    const household = await db.getHouseholdById(invite.household_id);
    householdName = household?.name || null;
    const members = await db.getHouseholdMembers(invite.household_id);
    inviterName = members?.find((m) => m.id === invite.invited_by)?.name || null;
  } catch { /* names are garnish - the token is the substance */ }
  return {
    valid: true,
    householdName,
    inviterName,
    token: invite.token,
    code: invite.code || null,
    invitee: { name: invite.name || null, family_role: invite.family_role || null },
  };
}

module.exports = router;
