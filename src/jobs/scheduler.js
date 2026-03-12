const cron = require('node-cron');
const db = require('../db/queries');
const { sendDailyReminders } = require('./reminders');
const { sendWeeklyDigest } = require('./digest');

/**
 * Returns the current local time as "HH:MM" (zero-padded).
 */
function currentHHMM() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

/**
 * Run daily reminders for every household whose reminder_time matches now.
 * Called every minute by cron.
 */
async function runDailyReminderCheck(bot) {
  const now = currentHHMM();
  try {
    const households = await db.getAllHouseholds();
    for (const household of households) {
      // reminder_time comes back as "HH:MM:SS" from Postgres — compare first 5 chars
      const reminderHHMM = (household.reminder_time || '08:00:00').substring(0, 5);
      if (reminderHHMM === now) {
        console.log(`[scheduler] Sending daily reminders for "${household.name}" (${household.id})`);
        await sendDailyReminders(bot, household.id);
      }
    }
  } catch (err) {
    console.error('[scheduler] Daily reminder check failed:', err.message);
  }
}

/**
 * Run weekly digest for all households.
 * Called once on Sunday at the configured time (default 20:00).
 */
async function runWeeklyDigest(bot) {
  console.log('[scheduler] Sending weekly digests to all households');
  try {
    const households = await db.getAllHouseholds();
    for (const household of households) {
      await sendWeeklyDigest(bot, household.id);
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
    triggerWeeklyDigest:   (householdId) => sendWeeklyDigest(bot, householdId),
  };
}

module.exports = { startScheduler, runDailyReminderCheck, runWeeklyDigest, currentHHMM };
