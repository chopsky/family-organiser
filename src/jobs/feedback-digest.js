/**
 * Weekly "what users told us" digest - Mondays 07:30 Europe/London.
 *
 * One email to the founder pulling together the week's signal from every
 * channel that already exists, so it gets read without opening admin:
 *   - Something-missing box + day-3 one-tap answers (user_feedback)
 *   - reasons chosen on account deletion (deletion_audit_log.exit_reason)
 *   - the "AI said no" radar (assistant replies that declined something)
 *   - WhatsApp messages the bot handled as plain chat - people saying what
 *     they wanted in their own words, at the moment they wanted it
 *
 * Sends even on a quiet week so its absence means the job broke, not that
 * nobody spoke. Weekly scheduler lock: one instance, once.
 */

const db = require('../db/queries');
const email = require('../services/email');

async function runFeedbackDigest({ days = 7 } = {}) {
  const weekKey = new Date().toISOString().slice(0, 10);
  if (!(await db.acquireSchedulerLock('feedback-digest', weekKey))) return null;
  try {
    const data = await db.getFeedbackDigest({ days });
    await email.sendFeedbackDigestEmail(data);
    const n = data.feedback.length + data.deletions.length + data.misses.length + data.chat.length;
    console.log(`[feedback-digest] sent: feedback=${data.feedback.length} deletions=${data.deletions.length} misses=${data.misses.length} chat=${data.chat.length}`);
    return n;
  } catch (err) {
    console.error('[feedback-digest] failed:', err.message);
    return null;
  }
}

module.exports = { runFeedbackDigest };
