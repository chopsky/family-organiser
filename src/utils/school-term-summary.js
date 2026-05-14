/**
 * Compact human-readable summary of a household's school term dates,
 * pitched at the AI prompt (NOT at the user). Used so the chat
 * assistant and WhatsApp bot can answer questions like "when does
 * the current school term end?" / "when is the next break?" from
 * the household's actual school data rather than hallucinating from
 * the model's general training (which heavily biases toward UK
 * patterns even for SA / US / AU households).
 *
 * Input shapes:
 *   schools     - rows from household_schools (need id + school_name)
 *   termDates   - rows from school_term_dates with event_type, date,
 *                 end_date, label, school_id, academic_year
 *   today       - Date object (defaults to now)
 *
 * Output: a multi-line string ready to embed in a system prompt.
 * Empty string when there's nothing useful to surface.
 *
 * Format example (Herzlia, mid-May 2026):
 *
 *   Herzlia
 *     Terms:
 *       - Term 1: 14 Jan 2026 – 27 Mar 2026 (past)
 *       - Term 2: 14 Apr 2026 – 26 Jun 2026 (CURRENT — ends in 43 days)
 *       - Term 3: 21 Jul 2026 – 18 Sep 2026
 *       - Term 4: 30 Sep 2026 – 3 Dec 2026
 *     Upcoming closures:
 *       - 15 May 2026: Yom Yerushalayim
 *       - 22 May 2026: Shavuot — School Closed
 *       - 23 May 2026: Shavuot
 *
 * Deliberately omits closures in the past — the AI only needs them
 * for future-facing answers. Caps closures at 12 entries to keep
 * the prompt compact.
 */
function summariseSchoolTermDates(schools, termDates, today = new Date()) {
  if (!Array.isArray(schools) || schools.length === 0) return '';
  if (!Array.isArray(termDates) || termDates.length === 0) return '';

  const todayIso = isoDate(today);
  const sections = [];

  for (const school of schools) {
    const rows = termDates.filter((d) => d.school_id === school.id);
    if (rows.length === 0) continue;

    const lines = [school.school_name];

    // Pair each term_start with the next term_end after it.
    const starts = rows
      .filter((d) => d.event_type === 'term_start')
      .sort((a, b) => a.date.localeCompare(b.date));
    const ends = rows
      .filter((d) => d.event_type === 'term_end')
      .sort((a, b) => a.date.localeCompare(b.date));

    if (starts.length) {
      lines.push('  Terms:');
      for (let i = 0; i < starts.length; i++) {
        const start = starts[i];
        const nextStart = starts[i + 1];
        const end = ends.find((e) =>
          e.date >= start.date && (!nextStart || e.date < nextStart.date)
        );
        if (!end) continue;
        const label = start.label?.replace(/\s+starts?\b/i, '').trim() || 'Term';
        const status = computeTermStatus(start.date, end.date, todayIso);
        lines.push(`    - ${label}: ${formatDate(start.date)} – ${formatDate(end.date)}${status}`);
      }
    }

    // Upcoming closures (anything in the future that's not a term
    // boundary). Caps at 12 so the prompt stays compact even for
    // schools with dense holiday lists (Jewish schools, etc.).
    const upcomingClosures = rows
      .filter((d) =>
        d.event_type !== 'term_start' &&
        d.event_type !== 'term_end' &&
        d.date >= todayIso
      )
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 12);
    if (upcomingClosures.length) {
      lines.push('  Upcoming closures:');
      for (const c of upcomingClosures) {
        const range = c.end_date && c.end_date !== c.date
          ? `${formatDate(c.date)} – ${formatDate(c.end_date)}`
          : formatDate(c.date);
        lines.push(`    - ${range}: ${c.label || prettyEventType(c.event_type)}`);
      }
    }

    if (lines.length > 1) sections.push(lines.join('\n'));
  }

  return sections.join('\n\n');
}

function isoDate(d) {
  return d.toISOString().split('T')[0];
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T12:00:00Z'); // noon UTC avoids TZ edge
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function prettyEventType(t) {
  return ({
    half_term_start: 'Half-term break',
    half_term_end: 'Half-term ends',
    inset_day: 'INSET day',
    bank_holiday: 'Public holiday',
  })[t] || t;
}

function computeTermStatus(startIso, endIso, todayIso) {
  if (todayIso > endIso) return ' (past)';
  if (todayIso < startIso) {
    const days = daysBetween(todayIso, startIso);
    return ` (starts in ${days} day${days === 1 ? '' : 's'})`;
  }
  const daysLeft = daysBetween(todayIso, endIso);
  return ` (CURRENT — ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'})`;
}

function daysBetween(fromIso, toIso) {
  const from = new Date(fromIso + 'T00:00:00Z');
  const to = new Date(toIso + 'T00:00:00Z');
  return Math.max(0, Math.round((to - from) / 86400000));
}

module.exports = { summariseSchoolTermDates };
