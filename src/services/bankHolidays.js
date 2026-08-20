/**
 * Bank holidays for the public term-dates site, cross-referenced with the
 * school calendar - the page answers the question parents actually have:
 * "does this bank holiday get us an extra day off school, or does it fall in
 * the holidays anyway?"
 *
 * Dates come from GOV.UK's own JSON (england-and-wales division) - official,
 * includes substitute days, no scraping. Fetched with a long in-memory cache
 * and a last-good fallback, so a gov.uk blip can't take the page down.
 *
 * The classification is pure and mirrors termDatesSeasonal's hard-won rules:
 * a council's published TERM STRUCTURE decides, school-scoped rows are
 * ignored, and a council whose structure can't be paired is counted as
 * unresolved - never guessed.
 */
const axios = require('axios');
const { isSchoolScoped } = require('./termDatesSeasonal');

const GOV_UK_URL = 'https://www.gov.uk/bank-holidays.json';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

let cached = null; // { at: epoch-ms, events: [{ date, title, notes }] }

/** England & Wales bank holidays from GOV.UK, cached ~24h with last-good fallback. */
async function fetchBankHolidaysEnglandWales() {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.events;
  try {
    const { data } = await axios.get(GOV_UK_URL, { timeout: 10000 });
    const events = (data['england-and-wales'] && data['england-and-wales'].events) || [];
    if (!events.length) throw new Error('gov.uk returned no england-and-wales events');
    cached = { at: Date.now(), events: events.map((e) => ({ date: e.date, title: e.title, notes: e.notes || '' })) };
    return cached.events;
  } catch (err) {
    if (cached) return cached.events; // stale beats down
    throw err;
  }
}

/**
 * Pair one academic year's term_start/term_end rows into [start, end]
 * intervals. Returns null when the structure can't be paired cleanly -
 * that council is then counted as unresolved for this exercise.
 */
// The longest genuine term interval is autumn in single-interval notation
// (1 Sep - mid Dec, ~108 days). Anything longer is a council publishing only
// "start of year / end of year" (Neath Port Talbot: one 322-day pair) - that
// pairs cleanly but classifies Christmas Day as term time. Not a term.
const MAX_TERM_DAYS = 130;

function termIntervals(rows) {
  const starts = rows.filter((r) => r.event_type === 'term_start' && !isSchoolScoped(r)).map((r) => r.date).sort();
  const ends = rows.filter((r) => r.event_type === 'term_end' && !isSchoolScoped(r)).map((r) => r.date).sort();
  if (!starts.length || starts.length !== ends.length) return null;
  const intervals = [];
  for (let i = 0; i < starts.length; i++) {
    if (ends[i] < starts[i]) return null; // interleaving broken
    if (i > 0 && starts[i] <= ends[i - 1]) return null;
    if ((Date.parse(ends[i]) - Date.parse(starts[i])) / 86400000 > MAX_TERM_DAYS) return null;
    intervals.push([starts[i], ends[i]]);
  }
  return intervals;
}

/**
 * Classify one date against every authority's calendar.
 * Returns { termTime: [{name,slug}], off: [{name,slug}], unresolved: [{name,slug}] }
 * where `off` means the date falls in a school break or outside the school
 * year - either way, children were not due in school.
 */
function classifyDate(dateIso, authorities, entries) {
  const byLa = new Map();
  for (const e of entries) {
    if (!byLa.has(e.la_id)) byLa.set(e.la_id, []);
    byLa.get(e.la_id).push(e);
  }
  const termTime = []; const off = []; const unresolved = [];
  for (const la of authorities) {
    const rows = byLa.get(la.id) || [];
    // Published break ranges (half terms, holiday spans). Councils write the
    // calendar in two notations: some split each term around half term
    // (term_end 28 May / term_start 7 Jun), others publish ONE term interval
    // plus a half-term range row. A date inside a break range is off school
    // whichever notation the council used - without this, the spring bank
    // holiday looked like term time for every single-interval council.
    const breakRanges = rows.filter((r) => ['half_term_start', 'bank_holiday'].includes(r.event_type)
      && r.end_date && r.end_date !== r.date && !isSchoolScoped(r));
    const inBreak = breakRanges.some((r) => dateIso >= r.date && dateIso <= r.end_date);

    // Pair intervals per academic year, then test against their union - a
    // bank holiday near year boundaries must not straddle two years' rows.
    const years = [...new Set(rows.map((r) => r.academic_year))];
    let resolved = false; let inTerm = false; let covered = false;
    for (const ay of years) {
      const intervals = termIntervals(rows.filter((r) => r.academic_year === ay));
      if (!intervals) continue;
      resolved = true;
      const span = [intervals[0][0], intervals[intervals.length - 1][1]];
      if (dateIso >= span[0] && dateIso <= span[1]) covered = true;
      if (intervals.some(([s, e]) => dateIso >= s && dateIso <= e)) inTerm = true;
    }
    if (!resolved) { unresolved.push({ name: la.name, slug: la.slug }); continue; }
    if (inTerm && !inBreak) termTime.push({ name: la.name, slug: la.slug });
    else off.push({ name: la.name, slug: la.slug, inYear: covered });
  }
  return { termTime, off, unresolved };
}

/**
 * The page's data: upcoming England & Wales bank holidays (today .. untilIso),
 * each classified against the school calendar. verdict: 'extra-day' (term time
 * for the clear majority), 'already-off' (school break for the clear
 * majority), or 'mixed'. exceptions lists the minority when it is small
 * enough to name.
 */
function classifyBankHolidays(authorities, entries, events, { fromIso, untilIso }) {
  return events
    .filter((e) => e.date >= fromIso && e.date <= untilIso)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((e) => {
      const { termTime, off, unresolved } = classifyDate(e.date, authorities, entries);
      const resolved = termTime.length + off.length;
      let verdict = 'mixed';
      if (resolved > 0 && termTime.length >= resolved * 0.9) verdict = 'extra-day';
      else if (resolved > 0 && off.length >= resolved * 0.9) verdict = 'already-off';
      const minority = verdict === 'extra-day' ? off : verdict === 'already-off' ? termTime : [];
      return {
        ...e,
        verdict,
        counts: { termTime: termTime.length, off: off.length, unresolved: unresolved.length },
        exceptions: minority.length <= 6 ? minority : [],
      };
    });
}

module.exports = { fetchBankHolidaysEnglandWales, classifyBankHolidays, classifyDate, termIntervals };
