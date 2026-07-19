/**
 * Capture-opener cron - sends newly linked WhatsApp users their day 1-3
 * activation questions (see services/capture-openers.js for the pool and
 * the why). Runs every 15 minutes; each user's opener goes out in their
 * household's late-morning window (11:00-11:59 local) - deliberately not
 * the 7:00 brief slot: there's no brief content yet, and a question lands
 * better after the school run than during it.
 *
 * Safety:
 *   - scheduler lock per user per day → max one opener/day even if the
 *     cron overlaps or the box restarts.
 *   - respects the whatsapp_daily_reminder opt-out (a user who's switched
 *     proactive messages off gets no openers either).
 *   - if the capture log table isn't migrated yet, sends are SKIPPED (we
 *     can't record them, so we might repeat - worse than waiting).
 */

const db = require('../db/queries');
const { pickNextOpener } = require('../services/capture-openers');
const { sendBroadcastToMember } = require('../services/whatsapp-templates');

const SEND_WINDOW_START = 11; // local hour, inclusive
const SEND_WINDOW_END = 12;   // local hour, exclusive

function localHour(timezone) {
  try {
    return parseInt(new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit', hour12: false, timeZone: timezone || 'Europe/London',
    }).format(new Date()), 10);
  } catch {
    return new Date().getHours();
  }
}

async function runCaptureOpenerCheck() {
  const candidates = await db.findCaptureOpenerCandidates();
  if (!candidates.length) return;

  for (const user of candidates) {
    try {
      const hour = localHour(user.timezone);
      if (hour < SEND_WINDOW_START || hour >= SEND_WINDOW_END) continue;

      const prefs = await db.getNotificationPreferences(user.id).catch(() => null);
      if (prefs && prefs.whatsapp_daily_reminder === false) continue;

      const sentKeys = await db.getCaptureOpenerKeys(user.id);
      if (sentKeys === null) continue; // table not migrated - don't risk repeats

      const [members, schools, activities] = await Promise.all([
        db.getHouseholdMembers(user.household_id).catch(() => []),
        db.getHouseholdSchools(user.household_id).catch(() => []),
        db.getHouseholdActivities(user.household_id).catch(() => []),
      ]);
      const opener = pickNextOpener({ user, members, schools, activities, sentKeys });
      if (!opener) continue;

      // One per user per day, across restarts and overlapping runs.
      const today = new Date().toISOString().slice(0, 10);
      const locked = await db.acquireSchedulerLock(`capture_opener:${user.id}`, today);
      if (!locked) continue;

      await sendBroadcastToMember(
        { ...user, whatsapp_linked: true },
        opener.message,
      );
      await db.recordCaptureOpener(user.id, opener.key);
      if (opener.armsSchoolAnswer) {
        // Lazy require: handlers pulls the whole AI chain; only pay for it
        // when a school opener actually goes out.
        try {
          require('../bot/handlers').armOpenerSchoolAnswer(user.id);
        } catch (err) {
          console.warn('[capture-openers] could not arm school answer:', err.message);
        }
      }
      console.log(`[capture-openers] sent '${opener.key}' to ${user.name} (${user.id})`);
    } catch (err) {
      console.error(`[capture-openers] failed for ${user.id}:`, err.message);
    }
  }
}

module.exports = { runCaptureOpenerCheck, localHour };
