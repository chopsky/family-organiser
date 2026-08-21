/**
 * Trial lifecycle emails - Phase 7.
 *
 * Runs once daily at 09:00 Europe/London (configured in
 * src/jobs/scheduler.js). Finds households at specific trial days and
 * sends the appropriate email via Postmark.
 *
 * Day 20 / 25 / 28 - broadcast stream, respects `trial_emails_enabled`.
 * Day 30 (trial_expired) - transactional stream, always sends.
 *
 * Dedupe is enforced by the `sent_emails` table's UNIQUE
 * (household_id, email_type) constraint: every send is gated by an
 * insert-if-new, so if the cron fires twice in one day (rolling
 * deploy, manual re-trigger) the second attempt no-ops silently.
 *
 * ### Why we don't also fire the welcome email here
 * The welcome email is triggered inline from /api/auth/create-household
 * at the exact moment the trial starts - that's more responsive than
 * waiting up to 24 hours for the cron's next tick, and the user
 * expects to see it within minutes of signup. The cron only handles
 * the day 20+ lifecycle emails.
 */

const db = require('../db/queries');
const email = require('../services/email');

// Tuples describing each lifecycle email the cron can send.
//   daysLeft  - days until trial_ends_at. Selection is keyed on the
//               REAL end date, not days since signup: the old
//               signup-age windows told extended-trial households
//               their trial was ending months early (The Schneiders,
//               2026-08-08 — "5 days left" with 334 days to go).
//               On the 14-day trial these land on days 7, 9 and 12 -
//               a halfway nudge, then two closing reminders. (The
//               emailType keys still read day_20/25/28: they are frozen
//               dedupe keys from the 30-day era, not day numbers.)
//   emailType - dedupe key in sent_emails (names kept from the old
//               day-count scheme so historical dedupe rows still hold)
//   sender    - email.js function to invoke
//   respectOptOut - nudge emails skip when trial_emails_enabled=false;
//                   transactional (trial_expired) always sends.
const NUDGE_SCHEDULE = [
  { daysLeft: 7,  emailType: 'trial_day_20', sender: email.sendTrialDay20Email, respectOptOut: true  },
  { daysLeft: 5,  emailType: 'trial_day_25', sender: email.sendTrialDay25Email, respectOptOut: true  },
  { daysLeft: 2,  emailType: 'trial_day_28', sender: email.sendTrialDay28Email, respectOptOut: true  },
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
    await processAdminExpiryAlerts();
  } catch (err) {
    // One step's failure shouldn't take down the whole run, but log
    // loudly so monitoring can pick it up.
    console.error('[trial-emails] Daily run failed with:', err);
  }
  console.log(`[trial-emails] Daily run complete in ${Date.now() - started}ms`);
}

/**
 * Operator alert: email the admin (ADMIN_ALERT_EMAIL / SUPPORT_EMAIL) for
 * each household whose trial expires roughly tomorrow (trial_ends_at
 * 24-48h after this 09:00 run) — the last comfortable window to reach
 * out before the paywall drops.
 *
 * Reuses the sent_emails (household_id, email_type) dedupe so a re-run
 * (deploy, manual trigger) can't double-alert on the same household.
 * Separate email per household - volume is low and per-household subjects
 * ("Trial expires tomorrow: Bennett Family") beat a digest for actioning.
 */
async function processAdminExpiryAlerts() {
  const households = await db.findHouseholdsWithTrialEndingInDays(1);
  if (households.length === 0) {
    console.log('[trial-emails] No households with 1 day left - no admin expiry alerts');
    return;
  }
  const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  for (const household of households) {
    try {
      const claimed = await db.markEmailSentIfNew(household.id, 'admin_trial_expiry_alert');
      if (!claimed) continue;
      const expires = household.trial_ends_at
        ? new Date(household.trial_ends_at).toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'short' })
        : 'unknown';
      const adminUrl = `${process.env.WEB_URL || 'https://www.housemait.com'}/admin/households/${household.id}`;
      await email.sendAdminAlert(
        `Trial expires tomorrow: ${household.name}`,
        `<strong>${esc(household.name)}</strong>'s free trial expires ${esc(expires)}.<br/>` +
        `They have not subscribed yet.<br/><br/>` +
        `<a href="${adminUrl}">View in admin dashboard</a>`
      );
      console.log(`[trial-emails] admin expiry alert sent for household ${household.id}`);
    } catch (err) {
      console.error(`[trial-emails] admin expiry alert failed for household ${household.id}:`, err.message);
    }
  }
}

async function processNudgeDay({ daysLeft, emailType, sender, respectOptOut }) {
  const households = await db.findHouseholdsWithTrialEndingInDays(daysLeft);
  if (households.length === 0) {
    console.log(`[trial-emails] No households with ${daysLeft} days of trial left`);
    return;
  }
  console.log(`[trial-emails] ${households.length} household(s) with ${daysLeft} days left - emailType=${emailType}`);
  for (const household of households) {
    try {
      // A live complimentary credit (referral reward) means the trial
      // countdown isn't their reality - "3 days left" would be wrong and
      // alarming. Skip; the nudges resume if the credit lapses mid-trial.
      if (household.complimentary_until && new Date(household.complimentary_until) > new Date()) {
        console.log(`[trial-emails] household ${household.id} has complimentary credit - skipping ${emailType}`);
        continue;
      }
      if (respectOptOut && !household.trial_emails_enabled) {
        // Soft-skip: we still mark the dedupe row so the count in any
        // ops dashboard reflects reality, BUT we won't send again if
        // they re-enable mid-trial (the timestamp is within the
        // one-day window, not the email send itself). Simpler: skip
        // entirely, log, move on.
        console.log(`[trial-emails] household ${household.id} opted out - skipping ${emailType}`);
        continue;
      }
      await dispatchEmail({ household, emailType, sender });
    } catch (err) {
      console.error(`[trial-emails] ${emailType} failed for household ${household.id}:`, err.message);
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
      // The trial_expired email is transactional - send regardless of
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
    console.log(`[trial-emails] ${emailType} already sent to household ${household.id} - skipping`);
    return;
  }

  const recipient = await db.getHouseholdPrimaryContact(household.id);
  if (!recipient?.email) {
    console.warn(`[trial-emails] household ${household.id} has no contactable admin - skipping ${emailType}`);
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

  // Extract a first name - the users table stores a single `name`
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
  _internal: { NUDGE_SCHEDULE, processNudgeDay, processExpiredDay, processAdminExpiryAlerts, dispatchEmail },
};
