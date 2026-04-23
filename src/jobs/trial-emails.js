/**
 * Trial lifecycle emails — Phase 7.
 *
 * Runs once daily at 09:00 Europe/London (configured in
 * src/jobs/scheduler.js). Finds households at specific trial days and
 * sends the appropriate email via Postmark.
 *
 * Day 20 / 25 / 28 — broadcast stream, respects `trial_emails_enabled`.
 * Day 30 (trial_expired) — transactional stream, always sends.
 *
 * Dedupe is enforced by the `sent_emails` table's UNIQUE
 * (household_id, email_type) constraint: every send is gated by an
 * insert-if-new, so if the cron fires twice in one day (rolling
 * deploy, manual re-trigger) the second attempt no-ops silently.
 *
 * ### Why we don't also fire the welcome email here
 * The welcome email is triggered inline from /api/auth/create-household
 * at the exact moment the trial starts — that's more responsive than
 * waiting up to 24 hours for the cron's next tick, and the user
 * expects to see it within minutes of signup. The cron only handles
 * the day 20+ lifecycle emails.
 */

const db = require('../db/queries');
const email = require('../services/email');

// Tuples describing each lifecycle email the cron can send.
//   dayCount  — integer trial day (1-indexed). Used to find households
//               whose trial_started_at falls within the matching
//               24-hour window.
//   emailType — dedupe key in sent_emails
//   sender    — email.js function to invoke
//   respectOptOut — nudge emails (20/25/28) skip when
//                   trial_emails_enabled=false; transactional (30)
//                   always sends.
const NUDGE_SCHEDULE = [
  { dayCount: 20, emailType: 'trial_day_20', sender: email.sendTrialDay20Email, respectOptOut: true  },
  { dayCount: 25, emailType: 'trial_day_25', sender: email.sendTrialDay25Email, respectOptOut: true  },
  { dayCount: 28, emailType: 'trial_day_28', sender: email.sendTrialDay28Email, respectOptOut: true  },
];

/**
 * Main cron entry point. Called once per day from the scheduler.
 * Exported for tests + manual trigger via the admin console.
 */
async function runTrialEmailCheck() {
  const started = Date.now();
  console.log('[trial-emails] Daily run starting');
  try {
    for (const step of NUDGE_SCHEDULE) {
      await processNudgeDay(step);
    }
    await processExpiredDay();
  } catch (err) {
    // One step's failure shouldn't take down the whole run, but log
    // loudly so monitoring can pick it up.
    console.error('[trial-emails] Daily run failed with:', err);
  }
  console.log(`[trial-emails] Daily run complete in ${Date.now() - started}ms`);
}

async function processNudgeDay({ dayCount, emailType, sender, respectOptOut }) {
  const households = await db.findHouseholdsAtTrialDay(dayCount);
  if (households.length === 0) {
    console.log(`[trial-emails] No households at day ${dayCount}`);
    return;
  }
  console.log(`[trial-emails] ${households.length} household(s) at day ${dayCount} — emailType=${emailType}`);
  for (const household of households) {
    try {
      if (respectOptOut && !household.trial_emails_enabled) {
        // Soft-skip: we still mark the dedupe row so the count in any
        // ops dashboard reflects reality, BUT we won't send again if
        // they re-enable mid-trial (the timestamp is within the
        // one-day window, not the email send itself). Simpler: skip
        // entirely, log, move on.
        console.log(`[trial-emails] household ${household.id} opted out — skipping day ${dayCount}`);
        continue;
      }
      await dispatchEmail({ household, emailType, sender });
    } catch (err) {
      console.error(`[trial-emails] day ${dayCount} failed for household ${household.id}:`, err.message);
      // Continue with the next household rather than aborting the batch.
    }
  }
}

async function processExpiredDay() {
  const households = await db.findHouseholdsWithExpiredTrial();
  if (households.length === 0) {
    console.log('[trial-emails] No newly-expired households');
    return;
  }
  console.log(`[trial-emails] ${households.length} household(s) trial_expired`);
  for (const household of households) {
    try {
      // The trial_expired email is transactional — send regardless of
      // trial_emails_enabled. Users who opted out of nudges still need
      // to know their trial has ended.
      await dispatchEmail({ household, emailType: 'trial_expired', sender: email.sendTrialExpiredEmail });
    } catch (err) {
      console.error(`[trial-emails] trial_expired failed for household ${household.id}:`, err.message);
    }
  }
}

/**
 * Shared send path: dedupe via sent_emails, resolve the recipient,
 * fetch usage counts for personalisation, invoke the sender.
 */
async function dispatchEmail({ household, emailType, sender }) {
  const claimed = await db.markEmailSentIfNew(household.id, emailType);
  if (!claimed) {
    console.log(`[trial-emails] ${emailType} already sent to household ${household.id} — skipping`);
    return;
  }

  const recipient = await db.getHouseholdPrimaryContact(household.id);
  if (!recipient?.email) {
    console.warn(`[trial-emails] household ${household.id} has no contactable admin — skipping ${emailType}`);
    // Don't delete the sent_emails row: the household still doesn't
    // have a reachable admin, so skipping is the correct final state.
    return;
  }

  // Usage stats are nice-to-have. If the fetch blows up, send the
  // email with zeroed counts rather than failing the whole dispatch.
  let usage = null;
  try {
    usage = await db.getHouseholdUsageCounts(household.id);
  } catch (err) {
    console.warn(`[trial-emails] usage-counts failed for household ${household.id}:`, err.message);
  }

  // Extract a first name — the users table stores a single `name`
  // field. Split on whitespace, take the first token, fall back to
  // 'there' inside the email service.
  const firstName = (recipient.name || '').trim().split(/\s+/)[0] || '';

  await sender({
    to: recipient.email,
    firstName,
    trialEndsAt: household.trial_ends_at,
    householdId: household.id,
    usage,
  });
  console.log(`[trial-emails] sent ${emailType} to ${recipient.email} (household ${household.id})`);
}

module.exports = {
  runTrialEmailCheck,
  // Exposed for tests + manual triggers
  _internal: { NUDGE_SCHEDULE, processNudgeDay, processExpiredDay, dispatchEmail },
};
