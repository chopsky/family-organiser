/**
 * Activity reminder sweep - the 30-minutes-before ping for weekly
 * extracurriculars (child_weekly_schedule).
 *
 * Calendar events have had a reminder processor for months; activities had
 * NOTHING time-proximate - a family's only signals for tonight's 18:30
 * swimming were the previous evening's 19:00 prep ping and one line in the
 * 07:00 brief (real near-miss, founder, 2026-09-01). This job closes that:
 * every minute it takes ONE flat estate query of activities, narrows in
 * memory to occurrences whose fire-minute (start - 30) is now, and pings.
 *
 * Rules (shared with the prep ping + calendar expansion):
 * - Per-date skips and time overrides apply; the override's time wins.
 * - Term-WINDOWED activities are suppressed when school is out of session;
 *   an activity with no window is ongoing (gym, private lessons) and runs
 *   through the holidays (holiday-pause doctrine).
 * - Targeting: the activity's pickup person when set, else every adult.
 * - Delivery via deliverPing under 'calendar_reminders', so the existing
 *   Settings toggle governs it per person and it lands in the centre.
 * - A 5-minute late-fire window + a per-occurrence scheduler lock: a slow
 *   tick delivers late rather than never, and replicas can't double-send.
 */

const db = require('../db/queries');
const { deliverPing } = require('../services/ping-router');
const { isSchoolInSession, activityActiveOn, resolveTermSchoolForChild } = require('../utils/school-terms');

const LEAD_MINUTES = 30;
const TOLERANCE_MINUTES = 5;

/** Local calendar parts for an instant in a tz: ymd, minutes-since-midnight, Monday=0 dow. */
function localParts(nowUtc, tz) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz || 'Europe/London',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(nowUtc).map((p) => [p.type, p.value]));
  const DOW = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  return {
    ymd: `${parts.year}-${parts.month}-${parts.day}`,
    nowMin: (Number(parts.hour) % 24) * 60 + Number(parts.minute),
    dow: DOW[parts.weekday] ?? 0,
  };
}

async function runActivityReminderCheck(nowUtc = new Date()) {
  try {
    const activities = await db.getAllActivitiesWithChild();
    if (!activities || activities.length === 0) return;

    // One households fetch per tick (prep-job precedent) - tz lookup only.
    const households = await db.getAllHouseholds();
    const tzById = new Map((households || []).map((h) => [h.id, h.timezone || 'Europe/London']));
    // Local-part computation cached per tz (most of the estate shares one).
    const partsByTz = new Map();

    for (const act of activities) {
      const householdId = act.child?.household_id;
      if (!householdId || !act.time_start) continue;

      const tz = tzById.get(householdId) || 'Europe/London';
      if (!partsByTz.has(tz)) partsByTz.set(tz, localParts(nowUtc, tz));
      const { ymd, nowMin, dow } = partsByTz.get(tz);

      if (act.day_of_week !== dow) continue;
      if (!activityActiveOn(act, ymd)) continue;
      if ((act.skips || []).includes(ymd)) continue;

      const ov = act.overrides ? act.overrides[ymd] : null;
      const effStart = (ov ? ov.time_start : act.time_start) || null;
      if (!effStart) continue;
      const [hh, mm] = String(effStart).split(':').map(Number);
      if (Number.isNaN(hh) || Number.isNaN(mm)) continue;
      const fireMin = hh * 60 + mm - LEAD_MINUTES;
      if (fireMin < 0) continue; // small-hours starts have no same-day slot
      if (nowMin < fireMin || nowMin >= fireMin + TOLERANCE_MINUTES) continue;

      // ── Candidate: claim first, then the heavier gates ──
      const locked = await db.acquireSchedulerLock(`act_rem:${act.id}`, ymd);
      if (!locked) continue;

      try {
        const members = await db.getHouseholdMembers(householdId);
        const child = members.find((m) => m.id === act.child_id) || act.child || {};

        // Term-windowed activities pause with the school calendar; ongoing
        // (window-less) ones run all year - per-activity, never per-child.
        if (act.start_date || act.end_date) {
          const householdSchools = await db.getHouseholdSchools(householdId).catch(() => []);
          const termSchoolId = resolveTermSchoolForChild(child, householdSchools);
          if (termSchoolId && !(await isSchoolInSession(termSchoolId, ymd))) continue;
        }

        const adults = members.filter((m) => m.member_type !== 'dependent');
        const recipients = act.pickup_member_id
          ? adults.filter((m) => m.id === act.pickup_member_id)
          : adults;
        if (recipients.length === 0) continue;

        const startLabel = String(effStart).slice(0, 5);
        const note = act.reminder_text ? ` - ${act.reminder_text}` : '';
        for (const recipient of recipients) {
          try {
            await deliverPing(recipient, {
              title: `Reminder: ${child.name ? `${child.name} - ` : ''}${act.activity}`,
              body: `Starts in ${LEAD_MINUTES} minutes (${startLabel})${note}`,
              category: 'calendar_reminders',
              householdId,
              data: { type: 'activity_reminder', activityId: act.id, date: ymd },
            });
          } catch (err) {
            console.error(`[activity-reminders] send to ${recipient.name} failed:`, err.message);
          }
        }
        console.log(`[activity-reminders] Reminded ${recipients.length} for "${act.activity}" (${ymd} ${startLabel})`);
      } catch (err) {
        // Lock already claimed - this occurrence won't retry, matching the
        // event-reminder processor's claim-first trade-off.
        console.error('[activity-reminders] occurrence failed:', err.message);
      }
    }
  } catch (err) {
    console.error('[activity-reminders] sweep failed:', err.message);
  }
}

module.exports = { runActivityReminderCheck, LEAD_MINUTES, TOLERANCE_MINUTES };
