/**
 * Per-council diff of term dates between what the directory held and what a
 * re-import found - the instrumentation behind the "should we build change
 * alerts?" question. Council calendars are believed to change rarely once
 * published; this records whether that is actually true, one row per
 * council-year per import, so the change rate can be read off in a few months
 * instead of guessed. Pure: the importer passes rows in and persists the result.
 *
 * Rows are compared on (event_type, date, end_date). Labels are deliberately
 * ignored: councils reword "Autumn half term" freely and that is not a change
 * families need to hear about.
 */

const keyOf = (r) => `${r.event_type}|${r.date}|${r.end_date || ''}`;
const strip = (r) => ({ event_type: r.event_type, date: r.date, end_date: r.end_date || null, label: r.label || null });

/**
 * Diff one academic year. Returns { academic_year, kind, added, removed,
 * unchanged } where kind is 'new_year' (nothing held before), 'identical',
 * 'changed', or 'removed_year' (held before, nothing now).
 */
function diffYear(academicYear, existingRows, freshRows) {
  const before = new Map(existingRows.map((r) => [keyOf(r), r]));
  const after = new Map(freshRows.map((r) => [keyOf(r), r]));
  const added = [...after.entries()].filter(([k]) => !before.has(k)).map(([, r]) => strip(r));
  const removed = [...before.entries()].filter(([k]) => !after.has(k)).map(([, r]) => strip(r));
  const unchanged = [...after.keys()].filter((k) => before.has(k)).length;
  let kind;
  if (!before.size && after.size) kind = 'new_year';
  else if (before.size && !after.size) kind = 'removed_year';
  else if (!added.length && !removed.length) kind = 'identical';
  else kind = 'changed';
  return { academic_year: academicYear, kind, added, removed, unchanged };
}

/**
 * Diff every academic year the import is about to replace.
 * `years` - the academic years being replaced (the importer's yearsToReplace)
 * `existingRows` - everything the directory held for the council
 * `freshRows` - the rows about to be inserted
 */
function diffTermDates(years, existingRows, freshRows) {
  return years.map((ay) => diffYear(
    ay,
    (existingRows || []).filter((r) => r.academic_year === ay),
    (freshRows || []).filter((r) => r.academic_year === ay),
  ));
}

/** One-line log form: "+2 -1 (changed)" */
function describeDiff(d) {
  return `+${d.added.length} -${d.removed.length} (${d.kind})`;
}

module.exports = { diffTermDates, diffYear, describeDiff };
