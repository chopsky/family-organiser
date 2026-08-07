/**
 * T+24h "finish your setup" email nudges. Sibling of
 * scheduler.runWhatsAppFollowupCheck - same 24h-7d warmth window, same
 * every-15-minutes cadence, same one-shot stamp-after-send semantics.
 *
 * Two cohorts, mutually exclusive by construction:
 *   • Setup nudge  - verified users with NO household (abandoned the wizard
 *     before the household step). CTA → /signup, which resumes the
 *     onboarding at the first unfinished step (entryIndex).
 *   • Verify nudge - users who never verified their email. We mint a FRESH
 *     verification token + code (identical to POST /api/auth/resend-
 *     verification - the signup token expired after 24h) so the link in
 *     the email actually verifies.
 *
 * The WhatsApp follow-up query requires household_id IS NOT NULL, so a
 * householdless user gets exactly one of these, never both.
 *
 * Stamps (users.setup_nudge_sent_at / users.verify_nudge_sent_at) are
 * written AFTER a successful send - a failed send retries on the next tick,
 * bounded by the 7-day window. Pre-migration the finders return [] (missing
 * column self-heal in db/queries), so the cron no-ops safely.
 */

const crypto = require('crypto');
const db = require('../db/queries');
const email = require('../services/email');

// Token + code generation mirrors src/routes/auth.js (generateToken /
// generateVerifyCode) - the /verify page and verify-email-code endpoint
// accept exactly this shape.
const VERIFY_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function generateVerifyCode(len = 6) {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += VERIFY_ALPHABET[bytes[i] % VERIFY_ALPHABET.length];
  return out;
}

async function processSetupNudges() {
  const eligible = await db.findUsersAwaitingSetupNudge();
  if (!eligible || eligible.length === 0) return;
  console.log(`[setup-nudge] Sending ${eligible.length} setup nudge(s)`);
  for (const user of eligible) {
    try {
      await email.sendSetupNudgeEmail(user.email, user.name);
      await db.markSetupNudgeSent(user.id);
      console.log(`[setup-nudge] sent to ${user.email}`);
    } catch (err) {
      // Don't stamp on failure - next tick retries. A permanently broken
      // address ages out of the 7-day window on its own.
      console.error(`[setup-nudge] failed for user ${user.id}:`, err.message);
    }
  }
}

async function processVerifyNudges() {
  const eligible = await db.findUsersAwaitingVerifyNudge();
  if (!eligible || eligible.length === 0) return;
  console.log(`[verify-nudge] Sending ${eligible.length} verify nudge(s)`);
  for (const user of eligible) {
    try {
      // Fresh token + code, exactly like the resend-verification endpoint.
      // createEmailVerificationToken tolerates the code column being
      // unmigrated (falls back to token-only), hence row?.code below.
      const token = generateToken();
      const code = generateVerifyCode();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const row = await db.createEmailVerificationToken(user.id, token, expiresAt, code);
      await email.sendVerifyNudgeEmail(user.email, user.name, token, row?.code || null);
      await db.markVerifyNudgeSent(user.id);
      console.log(`[verify-nudge] sent to ${user.email}`);
    } catch (err) {
      console.error(`[verify-nudge] failed for user ${user.id}:`, err.message);
    }
  }
}

/**
 * Cron entry point - every 15 minutes from scheduler.startScheduler.
 * Each cohort is isolated so one query failing can't starve the other.
 */
async function runSetupNudgeCheck() {
  try {
    await processSetupNudges();
  } catch (err) {
    console.error('[setup-nudge] outer check failed:', err.message);
  }
  try {
    await processVerifyNudges();
  } catch (err) {
    console.error('[verify-nudge] outer check failed:', err.message);
  }
}

module.exports = { runSetupNudgeCheck };
