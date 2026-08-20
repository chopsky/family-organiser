/**
 * Holiday-pause notifier.
 *
 * When a child's term-windowed weekly activities slip past their end_date,
 * they silently stop appearing anywhere - which is correct for school clubs
 * and wrong for the gym lesson that runs all year (the founder forgot two
 * of his own). The Dashboard card (client-rendered from live data) lets a
 * parent keep individual activities running by clearing their window; this
 * job's only role is the ONE push per household telling them the pause
 * happened.
 *
 * One send per household per gap: the scheduler lock keys on the household
 * plus the gap's newest end_date, so re-runs inside the same holiday are
 * unique-violation no-ops, while the next term ending later mints a fresh
 * key and fires again. First deploy backfills automatically - any household
 * currently in a gap (paused activities whose end_date fell inside the
 * look-back window) gets its one notification straight away.
 */

const db = require('../db/queries');
const { supabaseAdmin } = require('../db/client');
const push = require('../services/push');

// How far back a paused activity still counts as "this gap". Beyond this
// the pause is ancient history - surfacing it would confuse, not help.
const LOOKBACK_DAYS = 60;

/**
 * One short push body from { childName: [activityNames...] }.
 * Single child: name the first two activities; more children: count them.
 */
function buildHolidayPauseBody(byChild) {
  const children = Object.keys(byChild);
  if (children.length === 0) return null;
  if (children.length === 1) {
    const child = children[0];
    const acts = byChild[child];
    const more = acts.length - 2;
    const list = more > 0
      ? `${acts.slice(0, 2).join(', ')} and ${more} more`
      : acts.slice(0, 2).join(' and ');
    return `Term's ended: ${child}'s ${list} ${acts.length === 1 ? 'is' : 'are'} paused. Keep any running through the holidays?`;
  }
  const total = children.reduce((n, c) => n + byChild[c].length, 0);
  const names = children.slice(0, 2).join(' and ');
  return `Term's ended: ${names}'s clubs (${total}) are paused. Keep any running through the holidays?`;
}

async function runHolidayPauseCheck() {
  const today = new Date().toISOString().slice(0, 10);
  const floor = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);

  let rows = [];
  try {
    const { data, error } = await supabaseAdmin
      .from('child_weekly_schedule')
      .select('id, child_id, activity, end_date, users!inner(household_id, name)')
      .not('end_date', 'is', null)
      .lt('end_date', today)
      .gte('end_date', floor);
    if (error) throw error;
    rows = data || [];
  } catch (err) {
    console.error('[holiday-pause] query failed:', err.message);
    return { households: 0, notified: 0 };
  }
  if (rows.length === 0) return { households: 0, notified: 0 };

  // Group by household: { hhId: { gapKey, byChild: { childName: [names] } } }
  const byHousehold = new Map();
  for (const r of rows) {
    const hhId = r.users?.household_id;
    if (!hhId) continue;
    const entry = byHousehold.get(hhId) || { gapKey: '', byChild: {} };
    if (r.end_date > entry.gapKey) entry.gapKey = r.end_date;
    const child = r.users?.name || 'the kids';
    (entry.byChild[child] = entry.byChild[child] || []).push(r.activity);
    byHousehold.set(hhId, entry);
  }

  let notified = 0;
  for (const [householdId, { gapKey, byChild }] of byHousehold) {
    try {
      // One push per household per gap, across restarts and instances.
      // The gap lives in the KEY, and the lock_date is a far-future
      // sentinel on purpose: cleanupSchedulerLocks deletes rows whose
      // lock_date is older than 7 days, and this row is a permanent
      // once-per-gap marker, not a daily lock - a real (old) date here
      // would be swept and the push would re-fire every day after.
      const acquired = await db.acquireSchedulerLock(
        `holiday_pause_${householdId}_${gapKey}`,
        '9999-12-31',
      );
      if (!acquired) continue;

      const body = buildHolidayPauseBody(byChild);
      if (!body) continue;

      const members = (await db.getHouseholdMembers(householdId)) || [];
      const adults = members.filter((m) => m.member_type === 'account');
      let sent = 0;
      for (const adult of adults) {
        try {
          const tokens = (await db.getDeviceTokensForUserAdmin(adult.id)) || [];
          if (tokens.length === 0) continue;
          const result = await push.sendPushNotification(
            tokens.map((t) => t.token),
            { title: 'Paused for the holidays', body, data: { type: 'holiday_pause' } },
          );
          sent += result.sent || 0;
        } catch { /* one adult's dead tokens must not block the rest */ }
      }
      if (sent > 0) notified++;
      console.log(`[holiday-pause] household ${householdId} gap ${gapKey}: pushed to ${sent} device(s)`);
    } catch (err) {
      console.error(`[holiday-pause] household ${householdId} failed:`, err.message);
    }
  }
  return { households: byHousehold.size, notified };
}

module.exports = { runHolidayPauseCheck, buildHolidayPauseBody, LOOKBACK_DAYS };
