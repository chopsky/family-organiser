/**
 * Seasonal cross-council summaries for the public term-dates site: "when do
 * schools go back", "when is October half term", and so on, derived for every
 * authority at once.
 *
 * The derivation rules were learned the hard way (2026-08-19, the Bexley and
 * Manchester incidents):
 *
 *  1. Councils publish the SAME week off in different notations - some list
 *     the holiday week ("half term: 26-30 Oct"), others the break-up/return
 *     pair ("term ends 23 Oct / term starts 2 Nov"). Comparing labels across
 *     councils therefore lies. The council's own TERM STRUCTURE (last teaching
 *     day -> next opening day) is the authoritative signal, so it is primary;
 *     an explicit holiday-range row is only a fallback.
 *
 *  2. Some councils publish school-level variants alongside the council
 *     calendar (Bexley lists named schools taking a two-week break; Barking &
 *     Dagenham lists per-school INSET). Rows whose label names individual
 *     schools must never represent the council.
 *
 * Everything here is pure - callers fetch authorities + entries and pass them
 * in - so it can be unit-tested without a database.
 */

const D = (iso) => new Date(`${iso}T00:00:00Z`);
const toIso = (d) => d.toISOString().slice(0, 10);

/** Inclusive weekday (Mon-Fri) dates between two ISO dates. */
function weekdaysBetween(fromIso, untilIso) {
  const out = [];
  const cur = D(fromIso);
  const end = D(untilIso);
  while (cur <= end) {
    const dow = cur.getUTCDay();
    if (dow >= 1 && dow <= 5) out.push(toIso(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

/**
 * Rows that describe individual schools, not the council calendar. Keyed on a
 * PROPER-NOUN school name ("Danson Primary", "Thames View Infants"), never on
 * generic words - councils routinely write council-wide labels like "Schools
 * open Monday 24 August" (Leicester) which must stay council-wide.
 */
const SCHOOL_NAME_RE = /\b[A-Z][A-Za-z'.-]+ (School|Primary|Academy|Infants?|Juniors?|College)\b/;
function isSchoolScoped(row) {
  const label = row.label || '';
  return SCHOOL_NAME_RE.test(label) || /all schools except/i.test(label);
}

const inWindow = (row, from, to) => row.date >= from && row.date <= to;

/**
 * The council's break inside [from, to]: first weekday off and last weekday
 * off, as ISO dates. Term structure first; a published holiday range second.
 * Returns null when neither yields a plausible (2-15 weekday) break.
 */
function breakWindow(rows, { from, to }) {
  const within = rows.filter((r) => inWindow(r, from, to));

  const ends = within.filter((r) => r.event_type === 'term_end').sort((a, b) => a.date.localeCompare(b.date));
  const starts = within.filter((r) => r.event_type === 'term_start').sort((a, b) => a.date.localeCompare(b.date));
  if (ends.length && starts.length) {
    const end = ends[0];
    const start = starts.find((s) => s.date > end.date);
    if (start) {
      const a = D(end.date); a.setUTCDate(a.getUTCDate() + 1);
      const b = D(start.date); b.setUTCDate(b.getUTCDate() - 1);
      if (a <= b) {
        const days = weekdaysBetween(toIso(a), toIso(b));
        if (days.length >= 2 && days.length <= 15) {
          return { first: days[0], last: days[days.length - 1], weekdays: days.length, how: 'term structure' };
        }
      }
    }
  }

  const range = within
    .filter((r) => ['half_term_start', 'bank_holiday'].includes(r.event_type)
      && r.end_date && r.end_date !== r.date && !isSchoolScoped(r))
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  if (range) {
    const days = weekdaysBetween(range.date, range.end_date);
    if (days.length >= 2 && days.length <= 15) {
      return { first: days[0], last: days[days.length - 1], weekdays: days.length, how: 'published range' };
    }
  }
  return null;
}

/** Earliest term start inside [from, to] - "when do pupils go back". */
function firstDayBack(rows, { from, to }) {
  const starts = rows
    .filter((r) => r.event_type === 'term_start' && inWindow(r, from, to) && !isSchoolScoped(r))
    .map((r) => r.date)
    .sort();
  return starts[0] || null;
}

/** Latest term end inside [from, to] - "when do schools break up". */
function lastDayOfTerm(rows, { from, to }) {
  const ends = rows
    .filter((r) => r.event_type === 'term_end' && inWindow(r, from, to) && !isSchoolScoped(r))
    .map((r) => r.date)
    .sort();
  return ends.length ? ends[ends.length - 1] : null;
}

/**
 * Run one seasonal question over every authority.
 *
 * cfg: { ay, mode: 'start' | 'break' | 'end', from, to }
 * Returns:
 *   perCouncil - alphabetical [{ name, slug, first, last }] (last === first
 *                for single-date modes), resolved councils only
 *   groups     - distinct answers, largest first:
 *                [{ first, last, weekdays?, count, councils: [{name, slug}] }]
 *   unresolved - alphabetical [{ name, slug }] whose answer could not be
 *                derived (callers must SAY so, never guess)
 */
function summariseSeason(authorities, entries, cfg) {
  const byLa = new Map();
  for (const e of entries) {
    if (e.academic_year !== cfg.ay) continue;
    if (!byLa.has(e.la_id)) byLa.set(e.la_id, []);
    byLa.get(e.la_id).push(e);
  }

  const perCouncil = [];
  const unresolved = [];
  for (const la of authorities) {
    const rows = byLa.get(la.id) || [];
    let first = null; let last = null; let weekdays = null;
    if (cfg.mode === 'start') { first = firstDayBack(rows, cfg); last = first; }
    else if (cfg.mode === 'end') { first = lastDayOfTerm(rows, cfg); last = first; }
    else {
      const w = breakWindow(rows, cfg);
      if (w) ({ first, last, weekdays } = w);
    }
    if (first) perCouncil.push({ name: la.name, slug: la.slug, first, last, weekdays });
    else unresolved.push({ name: la.name, slug: la.slug });
  }
  perCouncil.sort((a, b) => a.name.localeCompare(b.name));
  unresolved.sort((a, b) => a.name.localeCompare(b.name));

  const byKey = new Map();
  for (const c of perCouncil) {
    const key = `${c.first}|${c.last}`;
    if (!byKey.has(key)) byKey.set(key, { first: c.first, last: c.last, weekdays: c.weekdays, count: 0, councils: [] });
    const g = byKey.get(key);
    g.count += 1;
    g.councils.push({ name: c.name, slug: c.slug });
  }
  const groups = [...byKey.values()].sort((a, b) => b.count - a.count || a.first.localeCompare(b.first));

  return { perCouncil, groups, unresolved };
}

module.exports = { summariseSeason, breakWindow, firstDayBack, lastDayOfTerm, weekdaysBetween, isSchoolScoped };
