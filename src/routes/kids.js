/**
 * Kids mode endpoints.
 *
 * GET /api/kids/big-days — the "counting down to…" list for the kids'
 * calendar (My Days). Sourced from real household data, per the Kids design
 * spec's production notes:
 *   - school holidays from the imported term dates (term_end = holidays
 *     start, half_term_start, bank_holiday)
 *   - member birthdays (users.birthday → next occurrence)
 *   - events a parent pinned with the kids_countdown toggle
 * Pinned events are flagged `big` (they win the hero slot); otherwise the
 * client uses the nearest future day. Everything is capped to the next
 * ~180 days so September holidays don't crowd out next week's sports day.
 */
const { Router } = require('express');
const db = require('../db/queries');
const { requireAuth, requireHousehold } = require('../middleware/auth');

const router = Router();

const WINDOW_DAYS = 180;
const ymd = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;

// Next occurrence (this year or next) of a birthday, as YYYY-MM-DD.
function nextBirthday(birthday, todayStr) {
  const m = String(birthday || '').match(/^\d{4}-(\d{2})-(\d{2})/);
  if (!m) return null;
  const year = Number(todayStr.slice(0, 4));
  const thisYear = `${year}-${m[1]}-${m[2]}`;
  return thisYear >= todayStr ? thisYear : `${year + 1}-${m[1]}-${m[2]}`;
}

// All school-sourced big days carry the school emoji - a "School Closed"
// day isn't a celebration, and 🎉 is reserved for actual celebrations.
// Every imported term-date type is a day kids count down to: holidays
// starting (term_end / half_term_start), days off (bank_holiday /
// inset_day) AND going back to school (term_start / half_term_end).
const HOLIDAY_TYPES = {
  term_start: { emoji: '🏫', fallback: 'Back to school!' },
  term_end: { emoji: '🏫', fallback: 'School holidays!' },
  half_term_start: { emoji: '🏫', fallback: 'Half term!' },
  half_term_end: { emoji: '🏫', fallback: 'Back to school!' },
  inset_day: { emoji: '🏫', fallback: 'Day off school!' },
  bank_holiday: { emoji: '🏫', fallback: 'Day off school!' },
};

router.get('/big-days', requireAuth, requireHousehold, async (req, res) => {
  try {
    let tz = 'Europe/London';
    try { tz = (await db.getHouseholdById(req.householdId))?.timezone || tz; } catch { /* default */ }
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: tz });
    const horizon = new Date(`${todayStr}T00:00:00`);
    horizon.setDate(horizon.getDate() + WINDOW_DAYS);
    const horizonStr = ymd(horizon);

    const [members, schools, pinned] = await Promise.all([
      db.getHouseholdMembers(req.householdId),
      db.getHouseholdSchools(req.householdId).catch(() => []),
      db.getKidsCountdownEvents(req.householdId, `${todayStr}T00:00:00Z`).catch(() => []),
    ]);
    const termDates = schools.length
      ? await db.getTermDatesBySchoolIds(schools.map((s) => s.id)).catch(() => [])
      : [];

    const days = [];

    // Parent-pinned countdown events — always hero candidates.
    for (const e of pinned) {
      const date = String(e.start_time).slice(0, 10);
      if (date > horizonStr) continue;
      days.push({ date, emoji: e.kids_emoji || null, title: e.title, big: true, source: 'pinned' });
    }

    // School holidays from the term-dates import.
    for (const t of termDates) {
      const kind = HOLIDAY_TYPES[t.event_type];
      if (!kind) continue;
      if (!t.date || t.date < todayStr || t.date > horizonStr) continue;
      days.push({ date: t.date, emoji: kind.emoji, title: t.label || kind.fallback, big: false, source: 'school' });
    }

    // Member birthdays.
    for (const m of members) {
      const date = nextBirthday(m.birthday, todayStr);
      if (!date || date > horizonStr) continue;
      days.push({ date, emoji: '🎂', title: `${m.name}'s birthday`, big: false, source: 'birthday' });
    }

    days.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return res.json({ today: todayStr, bigDays: days.slice(0, 12) });
  } catch (err) {
    console.error('GET /api/kids/big-days error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
