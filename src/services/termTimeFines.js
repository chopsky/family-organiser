/**
 * Term-time holiday fine estimator for the public term-dates site.
 *
 * Given a council's published calendar and a proposed absence, works out how
 * many SCHOOL days the absence actually covers (weekends, bank holidays,
 * council-wide INSET/closure days and published breaks are not absence), then
 * maps that onto the national penalty-notice framework for the council's
 * country. Pure: callers fetch rows + bank holidays and pass them in.
 *
 * Deliberately conservative in what it claims. The framework says when a
 * penalty notice must be CONSIDERED; whether one is issued is the school's
 * and council's call, and only the school can say whether an absence is
 * authorised. The page copy carries those caveats; this module just counts.
 */
const { termIntervals } = require('./bankHolidays');
const { isSchoolScoped } = require('./termDatesSeasonal');

// National frameworks. England: statutory guidance "Working together to
// improve school attendance" (in force from 19 August 2024). Wales: Education
// (Penalty Notices) (Wales) Regulations 2013. Per parent, per child, in both.
const RULES = {
  England: {
    country: 'England',
    firstEarly: 80, // paid within earlyDays of issue
    firstLate: 160, // paid within lateDays of issue
    earlyDays: 21,
    lateDays: 28,
    second: 160, // second notice for the same child inside repeatWindowYears: no reduced rate
    repeatWindowYears: 3,
    thresholdSessions: 10, // unauthorised sessions in a rolling window...
    thresholdWeeks: 10, // ...of this many school weeks. A session is half a day.
  },
  Wales: {
    country: 'Wales',
    firstEarly: 60,
    firstLate: 120,
    earlyDays: 28,
    lateDays: 42,
    second: null, // Wales has no national second-notice uplift; each council's code applies
    repeatWindowYears: null,
    thresholdSessions: null, // no national threshold; each council's code of conduct sets its own trigger
    thresholdWeeks: null,
  },
};

function countryOf(authority) {
  return (authority && authority.region === 'Wales') ? 'Wales' : 'England';
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
function isIsoDate(s) {
  if (!ISO_RE.test(s || '')) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Longest absence the estimator will look at. Anything longer is not a
// holiday question and the page says so instead of producing a giant number.
const MAX_RANGE_DAYS = 60;

function eachDay(fromIso, toIso) {
  const out = [];
  const cur = new Date(`${fromIso}T00:00:00Z`);
  const end = new Date(`${toIso}T00:00:00Z`);
  for (; cur <= end; cur.setUTCDate(cur.getUTCDate() + 1)) out.push(cur.toISOString().slice(0, 10));
  return out;
}

function daysBetween(aIso, bIso) {
  return Math.round((Date.parse(`${bIso}T00:00:00Z`) - Date.parse(`${aIso}T00:00:00Z`)) / 86400000);
}

function shiftDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Council-wide (not school-scoped) rows that mean "no pupils in today":
 * published break ranges, single-day closures and INSET days.
 */
function closureSets(rows) {
  const ranges = [];
  const singles = new Set();
  for (const r of rows) {
    if (isSchoolScoped(r)) continue;
    if (['half_term_start', 'bank_holiday', 'inset_day'].includes(r.event_type)) {
      if (r.end_date && r.end_date !== r.date) ranges.push([r.date, r.end_date]);
      else singles.add(r.date);
    }
  }
  return { ranges, singles };
}

/**
 * Term intervals across every academic year in the rows, in date order.
 * Returns null if NO year resolves (nothing to count against).
 */
function allIntervals(rows) {
  const years = [...new Set(rows.map((r) => r.academic_year))].sort();
  const out = [];
  let resolvedAny = false;
  for (const ay of years) {
    const iv = termIntervals(rows.filter((r) => r.academic_year === ay));
    if (!iv) continue;
    resolvedAny = true;
    out.push(...iv.map(([s, e]) => [s, e, ay]));
  }
  if (!resolvedAny) return null;
  out.sort((a, b) => a[0].localeCompare(b[0]));
  return out;
}

/**
 * Classify every day of [fromIso, toIso] against one council's calendar.
 *
 * Returns { ok:false, reason } for bad input or an unresolvable calendar, else
 * { ok:true, schoolDays, sessions, byKind: {school, weekend, bankHoliday,
 *   closure, holiday, unknown}, days:[{date, kind}], coveredByCalendar }
 * where `holiday` = published break or outside the school year, `closure` =
 * council-wide INSET/closure day, and `unknown` = a date outside every year
 * the council has published (counted as NOT a school day, but flagged).
 */
function classifyAbsence({ fromIso, toIso, rows, bankHolidayDates = [] }) {
  if (!isIsoDate(fromIso) || !isIsoDate(toIso)) return { ok: false, reason: 'invalid_dates' };
  if (toIso < fromIso) return { ok: false, reason: 'reversed' };
  if (daysBetween(fromIso, toIso) + 1 > MAX_RANGE_DAYS) return { ok: false, reason: 'too_long' };

  const intervals = allIntervals(rows || []);
  if (!intervals) return { ok: false, reason: 'unresolved' };
  const { ranges, singles } = closureSets(rows);
  const bank = new Set(bankHolidayDates);
  const yearSpan = [intervals[0][0], intervals[intervals.length - 1][1]];

  const byKind = { school: 0, weekend: 0, bankHoliday: 0, closure: 0, holiday: 0, unknown: 0 };
  const days = [];
  let coveredByCalendar = true;
  for (const date of eachDay(fromIso, toIso)) {
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    let kind;
    if (dow === 0 || dow === 6) kind = 'weekend';
    else if (bank.has(date)) kind = 'bankHoliday';
    else if (ranges.some(([s, e]) => date >= s && date <= e)) kind = 'holiday';
    else if (singles.has(date)) kind = 'closure';
    else if (date < yearSpan[0] || date > yearSpan[1]) { kind = 'unknown'; coveredByCalendar = false; }
    else if (intervals.some(([s, e]) => date >= s && date <= e)) kind = 'school';
    else kind = 'holiday';
    byKind[kind]++;
    days.push({ date, kind });
  }
  const schoolDays = byKind.school;
  return { ok: true, schoolDays, sessions: schoolDays * 2, byKind, days, coveredByCalendar };
}

/**
 * Money. Per parent per child, so totals scale with both. `second` is what a
 * repeat inside the window costs (England only; null where no national rule).
 */
function estimateFines({ country, parents = 1, children = 1 }) {
  const r = RULES[country] || RULES.England;
  const p = Math.min(2, Math.max(1, parseInt(parents, 10) || 1));
  const c = Math.min(6, Math.max(1, parseInt(children, 10) || 1));
  const n = p * c;
  return {
    rules: r,
    parents: p,
    children: c,
    notices: n,
    firstEarlyTotal: r.firstEarly * n,
    firstLateTotal: r.firstLate * n,
    secondTotal: r.second == null ? null : r.second * n,
  };
}

/**
 * Whether the counted absence meets the national threshold at which a
 * penalty notice must be considered. Null where the country sets none.
 */
function meetsThreshold(country, sessions) {
  const r = RULES[country] || RULES.England;
  if (r.thresholdSessions == null) return null;
  return sessions >= r.thresholdSessions;
}

const BREAK_NAMES = [
  [10, 'October half term'], [11, 'October half term'], [12, 'Christmas holidays'], [1, 'Christmas holidays'],
  [2, 'February half term'], [3, 'Easter holidays'], [4, 'Easter holidays'], [5, 'May half term'], [6, 'May half term'],
  [7, 'Summer holidays'], [8, 'Summer holidays'], [9, 'Summer holidays'],
];
function breakName(firstOffIso) {
  const m = Number(firstOffIso.split('-')[1]);
  const hit = BREAK_NAMES.find(([mm]) => mm === m);
  return hit ? hit[1] : 'School holiday';
}

/**
 * The published break nearest to the chosen dates: the cheapest LEGAL
 * alternative to show alongside the fine. Breaks are the gaps between term
 * intervals (which covers every notation: split terms, and single terms with
 * a half-term range row via `ranges`). Returns null when none can be derived.
 * { name, firstOff, lastOff, weekdays, distanceDays }
 */
function nearestBreak({ fromIso, rows }) {
  if (!isIsoDate(fromIso)) return null;
  const intervals = allIntervals(rows || []);
  if (!intervals) return null;
  const { ranges } = closureSets(rows);
  const candidates = [];
  for (let i = 0; i < intervals.length - 1; i++) {
    const firstOff = shiftDays(intervals[i][1], 1);
    const lastOff = shiftDays(intervals[i + 1][0], -1);
    if (lastOff >= firstOff) candidates.push([firstOff, lastOff]);
  }
  for (const [s, e] of ranges) candidates.push([s, e]);
  const scored = candidates
    .map(([s, e]) => {
      const weekdays = eachDay(s, e).filter((d) => { const w = new Date(`${d}T00:00:00Z`).getUTCDay(); return w >= 1 && w <= 5; }).length;
      // Distance from the chosen start to the break (0 if the start is inside it).
      const distanceDays = fromIso < s ? daysBetween(fromIso, s) : (fromIso > e ? daysBetween(e, fromIso) : 0);
      return { name: breakName(s), firstOff: s, lastOff: e, weekdays, distanceDays };
    })
    .filter((b) => b.weekdays >= 3)
    .sort((a, b) => a.distanceDays - b.distanceDays || b.weekdays - a.weekdays);
  return scored[0] || null;
}

module.exports = {
  RULES,
  MAX_RANGE_DAYS,
  countryOf,
  isIsoDate,
  classifyAbsence,
  estimateFines,
  meetsThreshold,
  nearestBreak,
  breakName,
};
