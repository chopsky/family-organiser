const cron = require('node-cron');
const db = require('../db/queries');
const { sendDailyReminders } = require('./reminders');
const { sendWeeklyDigest, sendWeeklyDigestEmail } = require('./digest');
const { sendOverdueNudges } = require('./overdue-nudge');

/**
 * Returns the current time as "HH:MM" (zero-padded) in the given IANA timezone.
 * Falls back to 'Africa/Johannesburg' if the timezone is invalid.
 */
function currentHHMMInTZ(timezone) {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    return formatter.format(now);
  } catch {
    // Invalid timezone string — fall back
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Johannesburg',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    return formatter.format(now);
  }
}

/**
 * Run daily reminders for every household whose reminder_time matches now.
 * Called every minute by cron.
 */
async function runDailyReminderCheck(bot) {
  try {
    const households = await db.getAllHouseholds();
    for (const household of households) {
      // reminder_time comes back as "HH:MM:SS" from Postgres — compare first 5 chars
      const reminderHHMM = (household.reminder_time || '08:00:00').substring(0, 5);
      const nowInTZ = currentHHMMInTZ(household.timezone || 'Africa/Johannesburg');
      if (reminderHHMM === nowInTZ) {
        console.log(`[scheduler] Sending daily reminders for "${household.name}" (${household.id})`);
        await sendDailyReminders(bot, household.id);
      }
    }
  } catch (err) {
    console.error('[scheduler] Daily reminder check failed:', err.message);
  }
}

/**
 * Run overdue nudge check for every household.
 * Sends at 14:00 in the household's timezone (6 hours after default reminder).
 * Called every minute by cron.
 */
async function runOverdueNudgeCheck(bot) {
  try {
    const households = await db.getAllHouseholds();
    for (const household of households) {
      // Nudge at 14:00 in the household's timezone
      const nowInTZ = currentHHMMInTZ(household.timezone || 'Africa/Johannesburg');
      if (nowInTZ === '14:00') {
        console.log(`[scheduler] Sending overdue nudges for "${household.name}" (${household.id})`);
        await sendOverdueNudges(bot, household.id);
      }
    }
  } catch (err) {
    console.error('[scheduler] Overdue nudge check failed:', err.message);
  }
}

/**
 * Run weekly digest for all households.
 * Called once on Sunday at the configured time (default 20:00).
 * Sends via both Telegram and email.
 */
async function runWeeklyDigest(bot) {
  console.log('[scheduler] Sending weekly digests to all households');
  try {
    const households = await db.getAllHouseholds();
    for (const household of households) {
      await sendWeeklyDigest(bot, household.id);
      await sendWeeklyDigestEmail(household.id);
    }
  } catch (err) {
    console.error('[scheduler] Weekly digest failed:', err.message);
  }
}

/**
 * Start all scheduled jobs.
 *
 * @param {object} bot - Telegraf bot instance (needs bot.telegram.sendMessage)
 */
function startScheduler(bot) {
  // ── Daily reminders: check every minute ─────────────────────────────────────
  cron.schedule('* * * * *', () => runDailyReminderCheck(bot));
  console.log('✓ Daily reminder scheduler started (checks every minute)');

  // ── Overdue nudges: check every minute (fires at 14:00 per household TZ) ───
  cron.schedule('* * * * *', () => runOverdueNudgeCheck(bot));
  console.log('✓ Overdue nudge scheduler started (14:00 per household timezone)');

  // ── Weekly digest: Sunday evenings ──────────────────────────────────────────
  const digestDay  = process.env.WEEKLY_DIGEST_DAY  ?? '0';   // 0 = Sunday
  const digestHour = parseInt((process.env.DAILY_REMINDER_HOUR || '20:00').split(':')[0], 10);
  const digestMin  = parseInt((process.env.DAILY_REMINDER_HOUR || '20:00').split(':')[1] ?? '0', 10);

  // node-cron: minute hour dayOfMonth month dayOfWeek
  const digestCron = `${digestMin} ${digestHour} * * ${digestDay}`;
  cron.schedule(digestCron, () => runWeeklyDigest(bot));
  console.log(`✓ Weekly digest scheduler started (${digestCron})`);

  return {
    // Expose manual triggers for testing / admin use
    triggerDailyReminders: (householdId) => sendDailyReminders(bot, householdId),
    triggerOverdueNudges:  (householdId) => sendOverdueNudges(bot, householdId),
    triggerWeeklyDigest:   (householdId) => sendWeeklyDigest(bot, householdId),
  };
}

module.exports = { startScheduler, runDailyReminderCheck, runOverdueNudgeCheck, runWeeklyDigest, currentHHMMInTZ };
