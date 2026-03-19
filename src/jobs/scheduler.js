const cron = require('node-cron');
const db = require('../db/queries');
const { sendDailyReminders } = require('./reminders');
const { sendWeeklyDigest, sendWeeklyDigestEmail } = require('./digest');
const { sendOverdueNudges } = require('./overdue-nudge');
const calendarSync = require('../services/calendarSync');
const publicHolidays = require('../services/publicHolidays');
const whatsapp = require('../services/whatsapp');

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
 * Run daily reminders — checks each member's personal reminder_time,
 * falling back to the household default. Called every minute by cron.
 */
async function runDailyReminderCheck() {
  try {
    const households = await db.getAllHouseholds();
    for (const household of households) {
      const tz = household.timezone || 'Africa/Johannesburg';
      const nowInTZ = currentHHMMInTZ(tz);
      const householdDefault = (household.reminder_time || '08:00:00').substring(0, 5);
      const members = await db.getHouseholdMembers(household.id);

      for (const member of members) {
        const memberTime = member.reminder_time
          ? (member.reminder_time).substring(0, 5)
          : householdDefault;
        if (memberTime === nowInTZ) {
          await sendDailyReminders(household.id, member);
        }
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
async function runOverdueNudgeCheck() {
  try {
    const households = await db.getAllHouseholds();
    for (const household of households) {
      // Nudge at 14:00 in the household's timezone
      const nowInTZ = currentHHMMInTZ(household.timezone || 'Africa/Johannesburg');
      if (nowInTZ === '14:00') {
        console.log(`[scheduler] Sending overdue nudges for "${household.name}" (${household.id})`);
        await sendOverdueNudges(household.id);
      }
    }
  } catch (err) {
    console.error('[scheduler] Overdue nudge check failed:', err.message);
  }
}

/**
 * Run weekly digest for all households.
 * Called once on Sunday at the configured time (default 20:00).
 * Sends via WhatsApp and email.
 */
async function runWeeklyDigest() {
  console.log('[scheduler] Sending weekly digests to all households');
  try {
    const households = await db.getAllHouseholds();
    for (const household of households) {
      await sendWeeklyDigest(household.id);
      await sendWeeklyDigestEmail(household.id);
    }
  } catch (err) {
    console.error('[scheduler] Weekly digest failed:', err.message);
  }
}

/**
 * Evening school prep reminder (19:00 local time).
 * Sends a heads-up for tomorrow's school activities.
 */
async function runEveningSchoolPrepCheck() {
  try {
    const households = await db.getAllHouseholds();
    for (const household of households) {
      const tz = household.timezone || 'Europe/London';
      const now = new Date(new Date().toLocaleString('en-US', { timeZone: tz }));
      const hour = now.getHours();
      const minute = now.getMinutes();

      // Only fire at 19:00
      if (hour !== 19 || minute !== 0) continue;

      const members = await db.getHouseholdMembers(household.id);
      const dependents = members.filter(m => m.member_type === 'dependent' && m.school_id);
      if (dependents.length === 0) continue;

      // Get tomorrow's day of week (0=Mon...4=Fri)
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowDow = (tomorrow.getDay() + 6) % 7;
      if (tomorrowDow > 4) continue; // Skip if tomorrow is weekend

      const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
      const lines = [`📚 *Heads up for tomorrow (${DAY_NAMES[tomorrowDow]}):*\n`];
      let hasActivities = false;

      for (const child of dependents) {
        const activities = await db.getChildActivities(child.id);
        const tomorrowActivities = activities.filter(a => a.day_of_week === tomorrowDow);
        for (const act of tomorrowActivities) {
          hasActivities = true;
          const timeStr = act.time_end ? ` until ${act.time_end.substring(0, 5)}` : '';
          lines.push(`• ${child.name} — ${act.activity}${timeStr}`);
          if (act.reminder_text) lines.push(`  _${act.reminder_text}_`);
        }
      }

      if (!hasActivities) continue;

      const message = lines.join('\n');

      // Send to all WhatsApp-connected account members
      const accountMembers = members.filter(m => m.member_type !== 'dependent' && m.whatsapp_phone);
      for (const member of accountMembers) {
        try {
          await whatsapp.sendTemplate(member.whatsapp_phone, message);
        } catch (err) {
          console.error(`[scheduler] Evening school prep failed for ${member.name}:`, err.message);
        }
      }
    }
  } catch (err) {
    console.error('[scheduler] Evening school prep check failed:', err.message);
  }
}

/**
 * Poll Apple CalDAV connections for changes.
 * Apple doesn't support webhooks, so we poll every 15 minutes.
 */
async function runAppleCalendarPoll() {
  try {
    const households = await db.getAllHouseholds();
    for (const household of households) {
      const connections = await db.getConnectionsByHousehold(household.id);
      const appleConnections = connections.filter((c) => c.provider === 'apple' && c.sync_enabled);
      for (const connection of appleConnections) {
        try {
          await calendarSync.pullChangesFromProvider(connection);
        } catch (err) {
          console.error(`[scheduler] Apple poll failed for connection ${connection.id}:`, err.message);
        }
      }
    }
  } catch (err) {
    console.error('[scheduler] Apple calendar poll failed:', err.message);
  }
}

/**
 * Map notification preference to minutes before due time.
 */
const NOTIFICATION_OFFSETS = {
  at_time: 0,
  '5_min': 5,
  '15_min': 15,
  '30_min': 30,
  '1_hour': 60,
  '2_hours': 120,
  '1_day': 1440,
  '2_days': 2880,
};

/**
 * Check for task notifications that need to be sent.
 * Runs every minute. Finds tasks with a notification preference and due_time set,
 * calculates the fire time (due_date + due_time - offset), and sends if now.
 */
async function runTaskNotificationCheck() {
  try {
    const { supabase } = require('../db/client');
    const { data: tasks, error } = await supabase
      .from('tasks')
      .select('*, households!inner(timezone)')
      .eq('completed', false)
      .not('notification', 'is', null)
      .not('due_time', 'is', null)
      .is('notification_sent_at', null);

    if (error) throw error;
    if (!tasks || tasks.length === 0) return;

    const now = new Date();

    for (const task of tasks) {
      const tz = task.households?.timezone || 'Europe/London';
      const offsetMinutes = NOTIFICATION_OFFSETS[task.notification] ?? 0;

      // Build the due datetime in UTC by parsing due_date + due_time in the household TZ
      const dueStr = `${task.due_date}T${task.due_time}`;
      // Convert to a Date using the household timezone
      const dueInTZ = new Date(new Date(dueStr).toLocaleString('en-US', { timeZone: tz }));
      // Actually, we need the fire time in UTC for comparison
      // Use a simpler approach: get current time in household TZ and compare
      const nowInTZ = new Date(now.toLocaleString('en-US', { timeZone: tz }));
      const dueLocal = new Date(`${task.due_date}T${task.due_time}`);
      const fireLocal = new Date(dueLocal.getTime() - offsetMinutes * 60000);

      // Check if fire time is within the current minute
      const diffMs = Math.abs(nowInTZ.getTime() - fireLocal.getTime());
      if (diffMs > 60000) continue; // Not yet or already past

      // Send notification
      const members = await db.getHouseholdMembers(task.household_id);
      const recipients = task.assigned_to
        ? members.filter((m) => m.id === task.assigned_to && m.whatsapp_linked && m.whatsapp_phone)
        : members.filter((m) => m.whatsapp_linked && m.whatsapp_phone);

      const timeStr = task.due_time.substring(0, 5);
      const message = `🔔 *Task Reminder*\n\n*${task.title}*\nDue: ${task.due_date} at ${timeStr}${task.description ? `\n${task.description}` : ''}`;

      for (const member of recipients) {
        // Send via WhatsApp
        if (member.whatsapp_linked && member.whatsapp_phone && whatsapp.isConfigured()) {
          try {
            await whatsapp.sendTemplate(member.whatsapp_phone, message);
          } catch (err) {
            console.error(`[scheduler] Failed to send task notification to ${member.name} via WhatsApp:`, err.message);
          }
        }
      }

      // Mark as sent
      await supabase
        .from('tasks')
        .update({ notification_sent_at: now.toISOString() })
        .eq('id', task.id);

      console.log(`[scheduler] Sent task notification for "${task.title}" (${task.id})`);
    }
  } catch (err) {
    console.error('[scheduler] Task notification check failed:', err.message);
  }
}

/**
 * Start all scheduled jobs.
 */
function startScheduler() {
  // ── Daily reminders: check every minute ─────────────────────────────────────
  cron.schedule('* * * * *', () => runDailyReminderCheck());
  console.log('✓ Daily reminder scheduler started (checks every minute)');

  // ── Overdue nudges: check every minute (fires at 14:00 per household TZ) ───
  cron.schedule('* * * * *', () => runOverdueNudgeCheck());
  console.log('✓ Overdue nudge scheduler started (14:00 per household timezone)');

  // ── Task notifications: check every minute ──────────────────────────────────
  cron.schedule('* * * * *', () => runTaskNotificationCheck());
  console.log('✓ Task notification scheduler started (checks every minute)');

  // ── Evening school prep reminders: check every minute (fires at 19:00) ─────
  cron.schedule('* * * * *', () => runEveningSchoolPrepCheck());
  console.log('✓ Evening school prep reminder started (19:00 per household timezone)');

  // ── Apple CalDAV polling: every 15 minutes ─────────────────────────────────
  cron.schedule('*/15 * * * *', () => runAppleCalendarPoll());
  console.log('✓ Apple Calendar polling started (every 15 minutes)');

  // ── Yearly public holiday refresh: Dec 1 at midnight ───────────────────────
  cron.schedule('0 0 1 12 *', () => publicHolidays.refreshHolidaysForAllHouseholds());
  console.log('✓ Public holiday refresh scheduled (Dec 1 yearly)');

  // ── Weekly digest: Sunday evenings ──────────────────────────────────────────
  const digestDay  = process.env.WEEKLY_DIGEST_DAY  ?? '0';   // 0 = Sunday
  const digestHour = parseInt((process.env.DAILY_REMINDER_HOUR || '20:00').split(':')[0], 10);
  const digestMin  = parseInt((process.env.DAILY_REMINDER_HOUR || '20:00').split(':')[1] ?? '0', 10);

  // node-cron: minute hour dayOfMonth month dayOfWeek
  const digestCron = `${digestMin} ${digestHour} * * ${digestDay}`;
  cron.schedule(digestCron, () => runWeeklyDigest());
  console.log(`✓ Weekly digest scheduler started (${digestCron})`);

  return {
    // Expose manual triggers for testing / admin use
    triggerDailyReminders: (householdId) => sendDailyReminders(householdId),
    triggerOverdueNudges:  (householdId) => sendOverdueNudges(householdId),
    triggerWeeklyDigest:   (householdId) => sendWeeklyDigest(householdId),
  };
}

module.exports = { startScheduler, runDailyReminderCheck, runOverdueNudgeCheck, runWeeklyDigest, currentHHMMInTZ };
