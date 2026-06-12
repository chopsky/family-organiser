/**
 * Stale device-calendar nudge.
 *
 * Device-synced calendars (EventKit) only refresh when the owning iPhone
 * foregrounds the app. If the owner stops opening Housemait, their
 * calendars freeze silently while the family keeps planning around stale
 * events. The web Settings roster shows a "not syncing" badge to everyone;
 * this service nudges the one person who can fix it - the phone's owner -
 * with a push, because simply opening the app IS the fix (foreground sync).
 *
 * Politeness rules (shouldNudgeLink):
 *   - a link counts as stale after STALE_AFTER_HOURS without a sync;
 *   - one nudge per stale period (a sync after the last nudge re-arms it);
 *   - while still stale, repeat at most every RENUDGE_DAYS;
 *   - links dead longer than GIVE_UP_DAYS are left alone - the owner has
 *     clearly stopped using the app, and weekly pushes forever is nagging,
 *     not helping. The web badge remains as the family-visible signal.
 */

const db = require('../db/queries');
const push = require('./push');

const STALE_AFTER_HOURS = 72;
const RENUDGE_DAYS = 7;
const GIVE_UP_DAYS = 30;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function shouldNudgeLink(link, now = new Date()) {
  if (!link || link.sync_enabled === false || link.source !== 'device') return false;
  if (!link.last_synced_at) return false; // never synced = setup never finished, not a regression
  const lastSync = new Date(link.last_synced_at).getTime();
  if (Number.isNaN(lastSync)) return false;
  const age = now.getTime() - lastSync;
  if (age < STALE_AFTER_HOURS * HOUR) return false;
  if (age > GIVE_UP_DAYS * DAY) return false;
  const nudgedAt = link.stale_nudge_sent_at ? new Date(link.stale_nudge_sent_at).getTime() : null;
  if (!nudgedAt || nudgedAt < lastSync) return true; // never nudged this stale period
  return now.getTime() - nudgedAt >= RENUDGE_DAYS * DAY;
}

function nudgeMessage(links, now = new Date()) {
  const names = links.map((l) => `"${l.display_name}"`);
  const list = names.length === 1
    ? names[0]
    : names.length === 2
      ? `${names[0]} and ${names[1]}`
      : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;
  const oldest = Math.min(...links.map((l) => new Date(l.last_synced_at).getTime()));
  const days = Math.max(1, Math.round((now.getTime() - oldest) / DAY));
  return {
    title: 'Your calendars stopped syncing',
    body: `${list} ${links.length === 1 ? "hasn't" : "haven't"} synced from your iPhone in ${days} day${days === 1 ? '' : 's'}. Just open Housemait and it catches up automatically.`,
    data: { type: 'device_calendar_stale', url: '/settings?section=calendars' },
  };
}

/**
 * Daily cron entry point. Groups stale links per owner so each person gets
 * at most ONE push per run, and marks links nudged BEFORE sending - if the
 * stale_nudge_sent_at column is missing (migration not applied yet) the
 * mark throws and we skip the send rather than risk nudging daily forever.
 */
async function runStaleDeviceNudgeCheck(now = new Date()) {
  let candidates;
  try {
    const cutoff = new Date(now.getTime() - STALE_AFTER_HOURS * HOUR).toISOString();
    candidates = (await db.getStaleDeviceLinks(cutoff)).filter((l) => shouldNudgeLink(l, now));
  } catch (err) {
    console.error('[stale-device-nudge] query failed:', err.message);
    return { nudged: 0 };
  }
  if (candidates.length === 0) return { nudged: 0 };

  const byOwner = new Map();
  for (const link of candidates) {
    if (!link.device_owner_user_id) continue;
    if (!byOwner.has(link.device_owner_user_id)) byOwner.set(link.device_owner_user_id, []);
    byOwner.get(link.device_owner_user_id).push(link);
  }

  let nudged = 0;
  for (const [ownerId, links] of byOwner) {
    try {
      // Mark first: a throw here (e.g. column missing pre-migration) must
      // suppress the push, otherwise an unmarkable link nudges every day.
      for (const link of links) {
        await db.updateDeviceCalendarLink(link.id, { stale_nudge_sent_at: now.toISOString() });
      }
      await push.sendToUser(ownerId, nudgeMessage(links, now));
      nudged += 1;
      console.log(`[stale-device-nudge] nudged user ${ownerId} for ${links.length} calendar(s)`);
    } catch (err) {
      console.error(`[stale-device-nudge] failed for owner ${ownerId}:`, err.message);
    }
  }
  return { nudged };
}

module.exports = {
  shouldNudgeLink,
  nudgeMessage,
  runStaleDeviceNudgeCheck,
  STALE_AFTER_HOURS,
  RENUDGE_DAYS,
  GIVE_UP_DAYS,
};
