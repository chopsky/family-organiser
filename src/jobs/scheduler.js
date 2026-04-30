const cron = require('node-cron');
const ical = require('node-ical');
const db = require('../db/queries');
const { sendDailyReminders } = require('./reminders');
const { sendWeeklyDigest, sendWeeklyDigestEmail } = require('./digest');
const { sendOverdueNudges } = require('./overdue-nudge');
const { processEventReminders } = require('./event-reminders');
const { runRetentionCleanup } = require('./retention');
const { runTrialEmailCheck } = require('./trial-emails');
const { checkAiHealth } = require('./ai-health');
const publicHolidays = require('../services/publicHolidays');
const whatsapp = require('../services/whatsapp');
const { callWithFailover, LONG_TIMEOUT_MS } = require('../services/ai-client');
const { isSchoolInSession } = require('../utils/school-terms');

/**
 * Returns the current time as "HH:MM" (zero-padded) in the given IANA timezone.
 * Falls back to 'Europe/London' if the timezone is invalid.
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
      timeZone: 'Europe/London',
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
 * Uses DB lock to prevent duplicate sends during rolling deploys.
 */
async function runDailyReminderCheck() {
  try {
    const households = await db.getAllHouseholds();
    for (const household of households) {
      const tz = household.timezone || 'Europe/London';
      const nowInTZ = currentHHMMInTZ(tz);
      const householdDefault = (household.reminder_time || '08:00:00').substring(0, 5);
      const members = await db.getHouseholdMembers(household.id);
      const todayStr = new Date(new Date().toLocaleString('en-US', { timeZone: tz })).toISOString().split('T')[0];

      for (const member of members) {
        const memberTime = member.reminder_time
          ? (member.reminder_time).substring(0, 5)
          : householdDefault;
        if (memberTime === nowInTZ) {
          const lockKey = `daily_reminder:${member.id}`;
          const acquired = await db.acquireSchedulerLock(lockKey, todayStr);
          if (!acquired) continue;
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
      const tz = household.timezone || 'Europe/London';
      const nowInTZ = currentHHMMInTZ(tz);
      if (nowInTZ === '14:00') {
        const todayStr = new Date(new Date().toLocaleString('en-US', { timeZone: tz })).toISOString().split('T')[0];
        const lockKey = `overdue_nudge:${household.id}`;
        const acquired = await db.acquireSchedulerLock(lockKey, todayStr);
        if (!acquired) continue;
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

      // DB-level dedup to prevent duplicate sends across instances
      const todayStr = now.toISOString().split('T')[0];
      const lockKey = `evening_prep:${household.id}`;
      const acquired = await db.acquireSchedulerLock(lockKey, todayStr);
      if (!acquired) continue;

      const members = await db.getHouseholdMembers(household.id);
      const dependents = members.filter(m => m.member_type === 'dependent' && m.school_id);
      if (dependents.length === 0) continue;

      // Get tomorrow's day of week (0=Mon...4=Fri)
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowDow = (tomorrow.getDay() + 6) % 7;
      if (tomorrowDow > 4) continue; // Skip if tomorrow is weekend

      const tomorrowStr = tomorrow.toISOString().split('T')[0];

      const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
      const lines = [`📚 *Heads up for tomorrow (${DAY_NAMES[tomorrowDow]}):*\n`];
      let hasActivities = false;

      for (const child of dependents) {
        // Skip if the child's school is NOT in session tomorrow (holidays, inset days, half terms)
        const inSession = await isSchoolInSession(child.school_id, tomorrowStr);
        if (!inSession) {
          console.log(`[scheduler] Skipping ${child.name}'s activities — school not in session on ${tomorrowStr}`);
          continue;
        }

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
      console.log(`[scheduler] Evening prep for ${household.name}: sending to ${accountMembers.length} member(s): ${accountMembers.map(m => m.name).join(', ')}`);
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
    const { supabaseAdmin: supabase } = require('../db/client');
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
      // Get current time in household TZ and compare against fire time.
      const nowInTZ = new Date(now.toLocaleString('en-US', { timeZone: tz }));
      const dueLocal = new Date(`${task.due_date}T${task.due_time}`);
      const fireLocal = new Date(dueLocal.getTime() - offsetMinutes * 60000);

      // Check if fire time is within the current minute
      const diffMs = Math.abs(nowInTZ.getTime() - fireLocal.getTime());
      if (diffMs > 60000) continue; // Not yet or already past

      // Atomic claim BEFORE we dispatch. Stamping notification_sent_at now
      // (conditional on it still being null) is a race-free claim — only
      // one parallel cron run wins, the loser skips. Trade-off: a transient
      // send error after this point won't be retried, but that's better
      // than the previous behaviour of double-sending under multiple
      // API replicas / deploy overlaps.
      const claimed = await db.claimTaskNotification(task.id, now.toISOString());
      if (!claimed) continue;

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

      console.log(`[scheduler] Sent task notification for "${task.title}" (${task.id})`);
    }
  } catch (err) {
    console.error('[scheduler] Task notification check failed:', err.message);
  }
}

/**
 * Daily iCal sync — re-fetch and replace all ical_import dates for every
 * school that has an ical_url configured.
 */
async function syncAllIcalFeeds() {
  console.log('[scheduler] Starting daily iCal sync for all schools');
  try {
    const schools = await db.getSchoolsWithIcalUrls();
    if (schools.length === 0) {
      console.log('[scheduler] No schools with iCal URLs configured');
      return;
    }

    for (const school of schools) {
      try {
        console.log(`[scheduler] Syncing iCal for school ${school.id} (${school.school_name})`);

        // Fetch and parse the iCal feed
        const events = await ical.async.fromURL(school.ical_url);
        const eventList = Object.values(events)
          .filter(e => e.type === 'VEVENT')
          .map(e => ({
            title: e.summary || 'Untitled',
            date: e.start ? new Date(e.start).toISOString().split('T')[0] : null,
            end_date: e.end ? new Date(e.end).toISOString().split('T')[0] : null,
            description: e.description || '',
          }))
          .filter(e => e.date);

        if (eventList.length === 0) {
          await db.updateHouseholdSchoolMeta(school.id, {
            ical_last_sync: new Date().toISOString(),
            ical_last_sync_status: 'success_empty',
          });
          console.log(`[scheduler] No events found for school ${school.id}`);
          continue;
        }

        // Use AI to categorise the events
        const categorisePrompt = `You are categorising school calendar events. For each event, determine the category.

Events to categorise:
${eventList.map((e, i) => `${i + 1}. "${e.title}" on ${e.date}${e.end_date && e.end_date !== e.date ? ` to ${e.end_date}` : ''}`).join('\n')}

Return a JSON array where each element has:
- index: the event number (1-based)
- category: one of: term_start, term_end, half_term_start, half_term_end, inset_day, bank_holiday, parents_evening, sports_day, performance, trip, exam, other
- label: a clean display label

Only return valid JSON array, nothing else.`;

        const { text } = await callWithFailover({
          system: 'You categorise school calendar events. Return only valid JSON.',
          messages: [{ role: 'user', content: categorisePrompt }],
          timeoutMs: LONG_TIMEOUT_MS,
          maxTokens: 4096,
          useThinking: false,
          feature: 'school_ical_sync',
          householdId: school.household_id,
        });

        let categorised;
        try {
          const cleaned = text.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
          categorised = JSON.parse(cleaned);
        } catch {
          categorised = eventList.map((e, i) => ({ index: i + 1, category: 'other', label: e.title }));
        }

        const termDateTypes = ['term_start', 'term_end', 'half_term_start', 'half_term_end', 'inset_day', 'bank_holiday'];
        const termDates = [];

        for (const cat of categorised) {
          const event = eventList[cat.index - 1];
          if (!event) continue;

          if (termDateTypes.includes(cat.category)) {
            const eventDate = new Date(event.date);
            const eventMonth = eventDate.getMonth();
            const eventYear = eventDate.getFullYear();
            const academicYear = eventMonth >= 7
              ? `${eventYear}-${eventYear + 1}`
              : `${eventYear - 1}-${eventYear}`;

            termDates.push({
              academic_year: academicYear,
              event_type: cat.category,
              date: event.date,
              end_date: event.end_date !== event.date ? event.end_date : null,
              label: cat.label || event.title,
              source: 'ical_import',
            });
          }
        }

        // Delete all existing ical_import dates for this school, then insert fresh
        const { supabaseAdmin: supabase } = require('../db/client');
        const { error: deleteErr } = await supabase
          .from('school_term_dates')
          .delete()
          .eq('school_id', school.id)
          .eq('source', 'ical_import');
        if (deleteErr) throw deleteErr;

        if (termDates.length > 0) {
          await db.addSchoolTermDates(school.id, termDates);
        }

        await db.updateHouseholdSchoolMeta(school.id, {
          ical_last_sync: new Date().toISOString(),
          ical_last_sync_status: 'success',
          term_dates_last_updated: new Date().toISOString(),
        });

        console.log(`[scheduler] Synced ${termDates.length} term dates for school ${school.id}`);
      } catch (err) {
        console.error(`[scheduler] iCal sync failed for school ${school.id}:`, err.message);
        try {
          await db.updateHouseholdSchoolMeta(school.id, {
            ical_last_sync: new Date().toISOString(),
            ical_last_sync_status: `error: ${err.message}`,
          });
        } catch { /* ignore meta update failure */ }
      }
    }

    console.log('[scheduler] Daily iCal sync complete');
  } catch (err) {
    console.error('[scheduler] Daily iCal sync failed:', err.message);
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

  // ── Event reminders: check every minute ────────────────────────────────────
  cron.schedule('* * * * *', () => processEventReminders());
  console.log('✓ Event reminder scheduler started (checks every minute)');

  // ── Evening school prep reminders: check every minute (fires at 19:00) ─────
  cron.schedule('* * * * *', () => runEveningSchoolPrepCheck());
  console.log('✓ Evening school prep reminder started (19:00 per household timezone)');

  // ── Scheduler lock cleanup: daily at 03:00 UTC ─────────────────────────────
  cron.schedule('0 3 * * *', () => db.cleanupSchedulerLocks());
  console.log('✓ Scheduler lock cleanup scheduled (03:00 UTC daily)');

  // ── Data retention cleanup: daily at 04:00 UTC ─────────────────────────────
  // Implements the retention commitments in /privacy Section 8 — trims
  // operational logs past 90 days and purges expired auth tokens.
  cron.schedule('0 4 * * *', () => runRetentionCleanup());
  console.log('✓ Data retention cleanup scheduled (04:00 UTC daily)');

  // ── Daily iCal feed sync: 06:00 UTC ─────────────────────────────────────────
  cron.schedule('0 6 * * *', () => syncAllIcalFeeds());
  console.log('✓ Daily iCal sync scheduled (06:00 UTC)');

  // ── Yearly public holiday refresh: Dec 1 at midnight ───────────────────────
  cron.schedule('0 0 1 12 *', () => publicHolidays.refreshHolidaysForAllHouseholds());
  console.log('✓ Public holiday refresh scheduled (Dec 1 yearly)');

  // ── Trial lifecycle emails: daily at 09:00 Europe/London ───────────────────
  // Days 20/25/28 (nudges) + day 30 (trial_expired). Welcome email is
  // fired inline from /api/auth/create-household, not here.
  cron.schedule('0 9 * * *', () => runTrialEmailCheck(), { timezone: 'Europe/London' });
  console.log('✓ Trial lifecycle emails scheduled (09:00 Europe/London daily)');

  // ── AI provider health check: every hour at :05 ────────────────────────────
  // Detects "Gemini went dark" failure modes (key unset, quota exhausted,
  // model name change) and emails the operator at most once per day per
  // condition. See src/jobs/ai-health.js for the diagnostic logic.
  // Runs at :05 to avoid clashing with the top-of-hour minute crons.
  cron.schedule('5 * * * *', () => checkAiHealth());
  console.log('✓ AI provider health check scheduled (hourly at :05)');

  // NOTE: the 12-month inactive-household retention cleanup + orphan
  // cleanup are both handled by runRetentionCleanup() above (04:00 UTC).
  // See src/jobs/retention.js. The 11-month pre-deletion warning email
  // is not yet built — when needed, add a new src/jobs/retention-warning.js
  // that runs daily at 09:00 Europe/London, finds households between 11
  // and 12 months of inactive_since, and sends a "your data will be
  // deleted in 30 days" email (dedupe via sent_emails with
  // email_type = 'retention_warning').

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
    triggerTrialEmails:    () => runTrialEmailCheck(),
  };
}

module.exports = { startScheduler, runDailyReminderCheck, runOverdueNudgeCheck, runWeeklyDigest, syncAllIcalFeeds, currentHHMMInTZ, processEventReminders, isSchoolInSession };
