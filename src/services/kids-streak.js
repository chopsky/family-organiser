// Kids-mode streaks - pure, DB-free logic for a child's daily-quest streak.
//
// A "streak" is how many days in a row a kid has done all the quests assigned
// to them. It is NOT stored - it's derived from the same chore_completions
// history the Quests screen already reads, so it can never drift from what the
// kid actually did. This module is kept pure (no database) so the fiddly bits
// - the recurrence rule, the weekly grace, the run maths - are unit-tested.
//
// Design decisions (see docs/kids-engagement-plan.md):
//  - A day is "satisfied" (DONE) when every quest assigned to the kid that was
//    due that day is completed by them. A day with nothing due is NONE - it
//    bridges a streak (a chore-free weekend never punishes) without adding to
//    the count.
//  - Only the kid's OWN assigned quests count. "Anyone" (up-for-grabs) chores
//    are shared, so a sibling grabbing one must never make or break this kid's
//    personal streak.
//  - Free weekly grace: one missed day per ISO week (Mon-Sun) is forgiven - it
//    bridges the run instead of breaking it. A second miss the same week breaks.
//  - Streaks pay out STARS + milestone BADGES, never cosmetics (decoupling).

const { appliesOn } = require('./chores');

// Milestone tiers: reaching this many streak days unlocks the badge + a
// one-off star bonus. Awarded once ever per kid per tier (idempotent via the
// kid_badges unique index + the star ledger's ref_type/ref_id).
const STREAK_MILESTONES = [
  { tier: 7, badge: 'streak_7', bonus: 5 },
  { tier: 30, badge: 'streak_30', bonus: 20 },
  { tier: 100, badge: 'streak_100', bonus: 50 },
  { tier: 365, badge: 'streak_365', bonus: 150 },
];

const DEFAULT_LOOKBACK_DAYS = 400; // enough to see a 365-day streak; bounds cost

// Add `n` days to a 'YYYY-MM-DD' string, returning 'YYYY-MM-DD'. Parsed as a
// local calendar date (never UTC) so it can't drift across a tz boundary - the
// string already encodes the household's day. Mirrors routes/chores.js.
function addDaysStr(dateStr, n) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

// The Monday (as 'YYYY-MM-DD') of the ISO week containing `dateStr`. Used as the
// per-week grace key so each Mon-Sun week gets exactly one forgiven miss.
function weekKey(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  const dow = dt.getDay(); // 0=Sun..6=Sat
  dt.setDate(dt.getDate() + (dow === 0 ? -6 : 1 - dow));
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

/**
 * The status of one day for one kid: 'DONE' (all due quests completed), 'MISS'
 * (something due left undone), or 'NONE' (nothing was due).
 *
 * `mine` is the kid's assigned, non-"anyone" definitions. `doneSet` holds keys
 * `${def}|${date}|${slot}` for that kid's completions; `skipSet` holds
 * `${def}|${date}` for household skips (hide a chore for one day).
 */
function dayStatus(mine, doneSet, skipSet, dateStr) {
  let due = 0;
  let done = 0;
  for (const d of mine) {
    // A definition can't count before it existed. appliesOn already hides dates
    // before an explicit start_date; for defs without one, fall back to the
    // creation day so newly-added chores don't retroactively break history.
    const effectiveStart = d.start_date || (d.created_at ? String(d.created_at).slice(0, 10) : null);
    if (effectiveStart && dateStr < effectiveStart) continue;
    if (!appliesOn(d, dateStr)) continue;
    if (skipSet.has(`${d.id}|${dateStr}`)) continue;
    // Multi-slot routines are due once per slot (matches buildDayView); chores
    // and slotless routines are a single '' instance.
    const slots = (d.type === 'routine' && (d.whens || []).length) ? d.whens : [''];
    for (const slot of slots) {
      due += 1;
      if (doneSet.has(`${d.id}|${dateStr}|${slot}`)) done += 1;
    }
  }
  if (due === 0) return 'NONE';
  return done >= due ? 'DONE' : 'MISS';
}

/**
 * Compute a kid's streak from raw rows. Pure - the caller supplies the data.
 *
 * @param {Array}  defs        chore_definitions rows
 * @param {Array}  completions chore_completions rows over the lookback window
 *                             (each: { definition_id, member_id, date, slot })
 * @param {Array}  skips       chore_skips rows over the window ({ definition_id, date })
 * @param {Array}  pauses      kid_routine_pauses rows ({ start_date, end_date|null })
 *                             - a paused day protects the streak (a would-be
 *                             miss becomes neutral); a completed day still counts.
 * @param {string} memberId    the kid
 * @param {string} today       'YYYY-MM-DD' (household-local today)
 * @param {number} [lookbackDays]
 * @returns {{current:number, longest:number, satisfiedToday:boolean,
 *            atRisk:boolean, nextMilestone:number|null, todayStatus:string}}
 */
function computeStreak({ defs, completions, skips, pauses = [], memberId, today, lookbackDays = DEFAULT_LOOKBACK_DAYS }) {
  const doneSet = new Set();
  for (const c of completions || []) {
    if (c.member_id !== memberId) continue;
    doneSet.add(`${c.definition_id}|${c.date}|${c.slot || ''}`);
  }
  const skipSet = new Set((skips || []).map((s) => `${s.definition_id}|${s.date}`));
  const mine = (defs || []).filter((d) => !d.anyone && (d.assignee_ids || []).includes(memberId));

  // A date is frozen if it falls in any pause window (an open pause extends to
  // today). Freezing only downgrades a would-be MISS to neutral - a DONE day
  // still counts, so a kid who does their quests on holiday keeps building.
  const frozen = (date) => (pauses || []).some((p) => date >= p.start_date && date <= (p.end_date || today));
  const statusOf = (date) => {
    const st = dayStatus(mine, doneSet, skipSet, date);
    return st === 'MISS' && frozen(date) ? 'NONE' : st;
  };

  // Walk ascending from (today - lookback) THROUGH YESTERDAY, maintaining the
  // run with one graced miss per ISO week. `best` tracks the longest run seen.
  let run = 0;
  let best = 0;
  const graceUsed = new Set(); // ISO-week key -> that week's one grace is spent
  for (let i = lookbackDays; i >= 1; i--) {
    const date = addDaysStr(today, -i);
    const st = statusOf(date);
    if (st === 'DONE') {
      run += 1;
    } else if (st === 'MISS') {
      const wk = weekKey(date);
      if (!graceUsed.has(wk)) graceUsed.add(wk); // forgive: bridge, don't count
      else run = 0;                              // second miss this week: break
    } // NONE bridges: no change
    if (run > best) best = run;
  }
  const runThroughYesterday = run;

  // Today is special: if it's an in-progress MISS the day isn't over, so it
  // doesn't break the streak - it's "at risk". Only a completed today extends.
  const todayStatus = statusOf(today);
  const current = todayStatus === 'DONE' ? runThroughYesterday + 1 : runThroughYesterday;
  const longest = Math.max(best, current);
  const satisfiedToday = todayStatus === 'DONE';
  const atRisk = todayStatus === 'MISS' && current > 0;
  const nextMilestone = STREAK_MILESTONES.map((m) => m.tier).find((t) => t > current) || null;

  return { current, longest, satisfiedToday, atRisk, nextMilestone, todayStatus };
}

// Milestone tiers a `current` streak has reached (tier <= current). The caller
// awards any not already in kid_badges - idempotent, and catches up if several
// were crossed at once.
function milestonesReached(current) {
  return STREAK_MILESTONES.filter((m) => current >= m.tier);
}

module.exports = { STREAK_MILESTONES, DEFAULT_LOOKBACK_DAYS, addDaysStr, weekKey, dayStatus, computeStreak, milestonesReached };
