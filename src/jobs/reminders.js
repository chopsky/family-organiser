const db = require('../db/queries');
const whatsapp = require('../services/whatsapp');
const { pickDigestFooter } = require('../utils/whatsapp-tips');
const { buildDigestWeatherLine } = require('../utils/weather-line');
const { fetchTodayForecastForHousehold } = require('../services/digest-weather');

// ─── Message builders (pure functions — easy to test) ─────────────────────────

/**
 * Format an ISO timestamp as HH:mm in the household's timezone.
 */
function formatEventTime(iso, tz) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString('en-GB', {
      hour: '2-digit', minute: '2-digit', timeZone: tz, hour12: false,
    });
  } catch {
    return String(iso).slice(11, 16);
  }
}

/**
 * Render the assignee bracket for an event. Multi-assignee events
 * (events with an `assignees` array) are comma-joined; legacy single-
 * assignee events fall back to `assigned_to_name`.
 */
function formatEventAssignee(ev) {
  if (Array.isArray(ev.assignees) && ev.assignees.length > 0) {
    return ev.assignees.map(a => a.member_name).filter(Boolean).join(', ');
  }
  return ev.assigned_to_name || '';
}

/**
 * Build the daily reminder text for a single user.
 *
 * Morning digest shape: school activities (if any), today's calendar
 * events, shopping count. Tasks are intentionally NOT included here —
 * a separate later-in-day nudge job surfaces overdue + due-today tasks
 * so the morning message stays focused on what's actually scheduled
 * for the day.
 *
 * @param {object} user                 - User row from DB
 * @param {object[]} todayEvents        - Calendar events for today
 *                                        (already filtered + sorted)
 * @param {number} shoppingCount        - Number of incomplete shopping items
 * @param {object[]} schoolActivities   - School activities for today
 * @param {string} [tz='Europe/London'] - Household timezone for time formatting
 * @returns {string}
 */
function buildDailyReminderMessage(user, todayEvents, shoppingCount, schoolActivities, tz = 'Europe/London', linkedAt = null, weatherLine = null) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const lines = [`${greeting}, ${user.name}! Here's what's on for today:\n`];

  // Weather one-liner — null on quiet days so we don't pad with filler.
  if (weatherLine) {
    lines.push(weatherLine);
    lines.push('');
  }

  // School activities for today
  if (schoolActivities && schoolActivities.length > 0) {
    lines.push('🏫 *SCHOOL:*');
    for (const act of schoolActivities) {
      const timeStr = act.time_end ? ` until ${act.time_end.substring(0, 5)}` : '';
      lines.push(`• ${act.child_name} — ${act.activity}${timeStr}${act.reminder_text ? ` (${act.reminder_text})` : ''}`);
    }
    lines.push('');
  }

  // Today's calendar events
  const hasEvents = Array.isArray(todayEvents) && todayEvents.length > 0;
  if (hasEvents) {
    lines.push("📅 *TODAY'S EVENTS:*");
    for (const ev of todayEvents) {
      const startStr = ev.all_day ? 'All day' : formatEventTime(ev.start_time, tz);
      const who = formatEventAssignee(ev);
      lines.push(`• ${startStr} — ${ev.title}${who ? ` _(${who})_` : ''}`);
    }
    lines.push('');
  }

  const hasSchool = Array.isArray(schoolActivities) && schoolActivities.length > 0;
  if (!hasSchool && !hasEvents) {
    lines.push('✨ Nothing scheduled today.');
    lines.push('');
  }

  // Shopping summary
  if (shoppingCount > 0) {
    lines.push(`🛒 *SHOPPING:* ${shoppingCount} item${shoppingCount !== 1 ? 's' : ''} on the list. Reply /shopping to see it.`);
  } else {
    lines.push('🛒 *SHOPPING:* List is empty — all done!');
  }

  // Discovery footer — rotates through "💡 Did you know…" tips for
  // the first 14 days post-WhatsApp-link, then settles into a quiet
  // "_Reply /help for all commands._" line.
  lines.push('');
  lines.push(pickDigestFooter(linkedAt));

  return lines.join('\n').trim();
}

/**
 * Fetch today's events for a household, filtered the same way the
 * Dashboard / digest endpoint does: drop public_holiday + birthday
 * categories (they're noise in a "what's on today" context), dedupe
 * on (title, start_time) since calendar sync can produce duplicates,
 * and sort by start_time.
 */
async function fetchTodayEvents(householdId, todayStr) {
  const windowStart = `${todayStr}T00:00:00`;
  const windowEnd = `${todayStr}T23:59:59`;
  let events = [];
  try {
    events = await db.getCalendarEvents(householdId, windowStart, windowEnd) || [];
  } catch (e) {
    console.warn('[reminders] events fetch failed:', e.message);
    return [];
  }
  const filtered = events.filter(e => {
    const start = e.start_time?.split('T')[0];
    const end = e.end_time?.split('T')[0];
    const isToday = start === todayStr || (start <= todayStr && (end || todayStr) >= todayStr);
    return isToday && e.category !== 'public_holiday' && e.category !== 'birthday';
  });
  const seen = new Set();
  return filtered
    .filter(e => {
      const key = `${e.title}|${e.start_time}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));
}

/**
 * Send daily reminder to a specific member, or all connected members of a household.
 *
 * @param {string} householdId
 * @param {object} [singleMember] - If provided, only send to this member
 */
async function sendDailyReminders(householdId, singleMember) {
  const today = new Date().toISOString().split('T')[0];

  // Fetch household for timezone (used to render event times in the
  // user's local clock rather than UTC).
  const household = await db.getHouseholdById(householdId).catch(() => null);
  const tz = household?.timezone || 'Europe/London';

  const shoppingItems = await db.getShoppingList(householdId);
  const shoppingCount = shoppingItems.length;

  // Today's calendar events — same scope across all recipients in the
  // household (events are household-wide, not per-member).
  const todayEvents = await fetchTodayEvents(householdId, today);

  // Today's weather one-liner — one fetch per household run, shared
  // across every member's digest. Cached 12h inside the helper so a
  // re-trigger / second cron tick doesn't re-fetch.
  let weatherLine = null;
  try {
    const forecast = await fetchTodayForecastForHousehold(household);
    weatherLine = buildDigestWeatherLine(forecast);
  } catch (e) {
    console.warn('[reminders] weather fetch failed:', e.message);
  }

  const targets = singleMember ? [singleMember] : await db.getHouseholdMembers(householdId);

  for (const member of targets) {
    const hasWhatsApp = member.whatsapp_linked && member.whatsapp_phone;
    if (!hasWhatsApp) {
      console.log(`[reminders] Skipping ${member.name} — whatsapp_linked=${member.whatsapp_linked}, whatsapp_phone=${!!member.whatsapp_phone}`);
      continue;
    }
    // Per-user opt-out (Settings → Notifications → WhatsApp). Default
    // true: a null row, missing column, or any non-false value all
    // mean "send". Only an explicit false skips.
    const prefs = await db.getNotificationPreferences(member.id).catch(() => null);
    if (prefs && prefs.whatsapp_daily_reminder === false) {
      console.log(`[reminders] Skipping ${member.name} — daily reminder disabled by user pref`);
      continue;
    }

    // Get today's school activities for children in this household
    // Only include if today is during term time (not holidays, half term, INSET, or bank holiday)
    const schoolActivities = [];
    try {
      const dayOfWeek = (new Date().getDay() + 6) % 7; // Convert JS day (0=Sun) to our format (0=Mon)
      if (dayOfWeek <= 4) { // Only Mon-Fri
        const todayStr = new Date().toISOString().split('T')[0];
        const allMembers = await db.getHouseholdMembers(householdId);
        const dependents = allMembers.filter(m => m.member_type === 'dependent' && m.school_id);

        for (const child of dependents) {
          // Check if today is during term time for this child's school
          const { isSchoolInSession } = require('../utils/school-terms');
          const inSession = await isSchoolInSession(child.school_id, todayStr);
          if (!inSession) continue; // Skip — school holiday, inset day, half term, etc.

          const activities = await db.getChildActivities(child.id);
          const todayActivities = activities.filter(a => a.day_of_week === dayOfWeek && a.term_only !== false);
          for (const act of todayActivities) {
            schoolActivities.push({ ...act, child_name: child.name });
          }
        }
      }
    } catch { /* silently skip school activities on error */ }

    const message = buildDailyReminderMessage(
      member,
      todayEvents,
      shoppingCount,
      schoolActivities,
      tz,
      member.whatsapp_linked_at || null,
      weatherLine,
    );

    // Send via WhatsApp
    if (whatsapp.isConfigured()) {
      try {
        await whatsapp.sendTemplate(member.whatsapp_phone, message);
        await db.logWhatsAppMessage({
          householdId,
          userId: member.id,
          direction: 'outbound',
          messageType: 'daily_reminder',
          body: message,
        });
      } catch (err) {
        console.error(`Failed to send reminder to ${member.name} via WhatsApp:`, err.message);
        await db.logWhatsAppMessage({
          householdId,
          userId: member.id,
          direction: 'outbound',
          messageType: 'daily_reminder',
          body: message,
          error: err.message,
        });
      }
    } else {
      console.log(`[reminders] Skipping ${member.name} — whatsapp service not configured`);
    }
  }
}

module.exports = { buildDailyReminderMessage, sendDailyReminders };
