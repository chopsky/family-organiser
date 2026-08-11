/**
 * Activation & retention - per-household deliberate-activity analysis for
 * the admin dashboard. Answers "are families activating, and do the ones
 * who activate stick?" (founder question 2026-08-10; the ad-hoc analysis
 * this productises found ~60% of signups never perform a single deliberate
 * action, while genuinely-started households retain well).
 *
 * "Deliberate activity" = writes a human chose to make: inbound WhatsApp
 * messages, user chat messages, shopping adds, chore ticks, to-dos, meal
 * plan entries, and MANUAL calendar events. Excluded automation: calendar
 * feed/subscription imports and the ~27 public-holiday events seeded at
 * signup (which made every dead household look active for a fortnight in
 * the first cut of this analysis).
 *
 * Heavy-ish (full pagination over several tables + one indexed query per
 * household), so results are cached in-process for CACHE_TTL_MS; pass
 * refresh=true to bypass. Fine at current scale; revisit the approach
 * around ~1k households.
 */

const { supabaseAdmin } = require('../db/client');

const DAY = 86_400_000;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

// ─── Pure classification (unit-tested) ──────────────────────────────────────

/**
 * Bucket a household by its activity shape.
 *   expired       - paywalled; zero activity is structural, not apathy
 *   never_started - fewer than 5 deliberate actions ever
 *   petered_out   - real first-fortnight usage (10+), silent for 14d, old enough to judge
 *   fading        - strong start, recent activity under a quarter of the early rate
 *   active        - anything in the last 14 days
 *   quiet         - low-volume start that has lapsed
 */
function classifyHousehold({ status, ageDays, total, first14, last14 }) {
  if (status === 'expired') return 'expired';
  if (total < 5) return 'never_started';
  if (ageDays >= 28 && first14 >= 10 && last14 === 0) return 'petered_out';
  if (first14 >= 10 && last14 > 0 && last14 < first14 * 0.25) return 'fading';
  if (last14 > 0) return 'active';
  return 'quiet';
}

/**
 * Weekly retention curve: for week N since signup, the share of households
 * old enough to have completed week N that had any deliberate activity in
 * it. `rows` = [{ signup: ms, events: [ms, ...] }].
 */
function buildWeeklyCurve(rows, now, maxWeeks = 8) {
  const curve = [];
  for (let week = 0; week <= maxWeeks; week++) {
    const eligible = rows.filter((r) => now - r.signup >= (week + 1) * 7 * DAY);
    if (!eligible.length) break;
    const active = eligible.filter((r) =>
      r.events.some((t) => t >= r.signup + week * 7 * DAY && t < r.signup + (week + 1) * 7 * DAY)
    ).length;
    curve.push({ week, active, eligible: eligible.length, pct: Math.round((100 * active) / eligible.length) });
  }
  return curve;
}

// ─── Data gathering ─────────────────────────────────────────────────────────

const WRITE_SOURCES = [
  { table: 'whatsapp_message_log', ts: 'created_at', filter: (q) => q.eq('direction', 'inbound') },
  { table: 'chat_messages', ts: 'created_at', filter: (q) => q.eq('role', 'user') },
  { table: 'shopping_items', ts: 'created_at', filter: (q) => q },
  { table: 'chore_completions', ts: 'completed_at', filter: (q) => q },
  { table: 'tasks', ts: 'created_at', filter: (q) => q },
  { table: 'meal_plan', ts: 'created_at', filter: (q) => q },
];

async function fetchSource({ table, ts, filter }, db) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    // Paginate by primary key - ordering by timestamp columns times out on
    // the bigger tables (no index), learned in the ad-hoc run.
    const { data, error } = await filter(db.from(table).select(`household_id, ${ts}`))
      .order('id', { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return rows
    .map((r) => ({ hh: r.household_id, t: new Date(r[ts]).getTime() }))
    .filter((r) => r.hh && Number.isFinite(r.t));
}

/** Manual, non-seeded calendar events for one household (household_id is
 *  indexed; whole-table scans over calendar_events time out because feed
 *  imports dominate it). */
async function fetchManualCalendar(householdId, db) {
  const { data, error } = await db
    .from('calendar_events')
    .select('created_at')
    .eq('household_id', householdId)
    .is('external_feed_id', null)
    .is('subscription_id', null)
    .or('category.is.null,category.neq.public_holiday')
    .limit(1000);
  if (error) throw new Error(`calendar_events: ${error.message}`);
  return (data || []).map((e) => new Date(e.created_at).getTime()).filter(Number.isFinite);
}

async function gather(db) {
  const { data: hhs, error } = await db
    .from('households')
    .select('id, name, created_at, is_internal, subscription_status');
  if (error) throw error;
  const genuine = (hhs || []).filter((h) => !h.is_internal);

  const events = {};
  for (const src of WRITE_SOURCES) {
    for (const e of await fetchSource(src, db)) (events[e.hh] = events[e.hh] || []).push(e.t);
  }
  // Calendar per household, chunked so we don't fire 80+ queries at once.
  for (let i = 0; i < genuine.length; i += 8) {
    const chunk = genuine.slice(i, i + 8);
    const results = await Promise.all(chunk.map((h) => fetchManualCalendar(h.id, db)));
    chunk.forEach((h, idx) => {
      if (results[idx].length) (events[h.id] = events[h.id] || []).push(...results[idx]);
    });
  }
  return { genuine, events };
}

// ─── Entry point ────────────────────────────────────────────────────────────

let cache = null; // { computedAt: ms, data }

async function computeActivation({ refresh = false, db = supabaseAdmin, now = Date.now() } = {}) {
  if (!refresh && cache && now - cache.computedAt < CACHE_TTL_MS) return cache.data;

  const { genuine, events } = await gather(db);

  const rows = genuine.map((h) => {
    const ev = (events[h.id] || []).sort((a, b) => a - b);
    const signup = new Date(h.created_at).getTime();
    const ageDays = Math.floor((now - signup) / DAY);
    const first14 = ev.filter((t) => t < signup + 14 * DAY).length;
    const last14 = ev.filter((t) => t > now - 14 * DAY).length;
    const stats = { status: h.subscription_status, ageDays, total: ev.length, first14, last14 };
    return {
      id: h.id,
      name: h.name,
      ...stats,
      lastActiveDays: ev.length ? Math.round((now - ev[ev.length - 1]) / DAY) : null,
      bucket: classifyHousehold(stats),
    };
  });

  const buckets = {};
  for (const r of rows) buckets[r.bucket] = (buckets[r.bucket] || 0) + 1;

  // Watchlist: the households worth a founder nudge - real usage that has
  // stopped or collapsed, most recently active first.
  const watchlist = rows
    .filter((r) => ['petered_out', 'fading', 'quiet'].includes(r.bucket))
    .sort((a, b) => (a.lastActiveDays ?? 9999) - (b.lastActiveDays ?? 9999))
    .slice(0, 10)
    .map(({ id, name, ageDays, total, first14, last14, lastActiveDays, bucket }) =>
      ({ id, name, ageDays, total, first14, last14, lastActiveDays, bucket }));

  const data = {
    computedAt: new Date(now).toISOString(),
    totalHouseholds: genuine.length,
    buckets,
    watchlist,
    weekly: buildWeeklyCurve(
      genuine.map((h) => ({ signup: new Date(h.created_at).getTime(), events: events[h.id] || [] })),
      now,
    ),
  };
  cache = { computedAt: now, data };
  return data;
}

function _resetCache() { cache = null; }

module.exports = { computeActivation, classifyHousehold, buildWeeklyCurve, _resetCache };
