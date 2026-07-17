/**
 * Deterministic validation pass over AI-extracted school term dates.
 *
 * The AI in `/import-website` (src/routes/schools.js) drafts a list
 * of dates from a school's website or PDF. Before showing them to the
 * admin, we run this pass to annotate each row with `warnings: string[]`
 * - non-blocking hints that surface as yellow chips in the preview UI.
 *
 * The biggest single class of AI mistake here is an off-by-one date
 * (a weekday name in the source text doesn't match the date the model
 * emitted). `dayOfWeekMatchesSource` exists to catch exactly that.
 *
 * All checks are pure functions of the input rows + the original source
 * text. No side effects, no DB. Adding a new rule is a matter of
 * pushing onto `warnings` from a new helper.
 */

const WEEKDAY_NAMES = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
};
const WEEKDAY_LABEL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function parseISODate(s) {
  if (typeof s !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const d = new Date(`${s}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dayOfWeekUTC(d) {
  return d.getUTCDay();
}

function normaliseWhitespace(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Find all weekday mentions in the quote, with their position.
 * A "match" is a {name, dow, position} triple. Longest-name keys are
 * tried first so "tuesday" wins over "tues" when both appear (we don't
 * want to double-count the same word).
 */
function findAllWeekdaysInQuote(quote) {
  if (typeof quote !== 'string') return [];
  const lower = quote.toLowerCase();
  const keys = Object.keys(WEEKDAY_NAMES).sort((a, b) => b.length - a.length);
  // Track positions already consumed by a longer match so "tuesday" at
  // position 5 doesn't also fire "tues" at position 5.
  const taken = new Set();
  const matches = [];
  for (const key of keys) {
    const re = new RegExp(`\\b${key}\\b`, 'gi');
    let m;
    while ((m = re.exec(lower)) !== null) {
      const start = m.index;
      let collides = false;
      for (let i = start; i < start + key.length; i++) {
        if (taken.has(i)) { collides = true; break; }
      }
      if (collides) continue;
      for (let i = start; i < start + key.length; i++) taken.add(i);
      matches.push({ name: key, dow: WEEKDAY_NAMES[key], position: start });
    }
  }
  return matches;
}

function checkDayOfWeek(row) {
  const d = parseISODate(row.date);
  if (!d || !row.source_quote) return;
  const matches = findAllWeekdaysInQuote(row.source_quote);
  if (matches.length === 0) return;

  // Single weekday in the quote: simple case, just compare.
  // Multiple weekdays: the quote probably contains a date range like
  // "Monday 13 April – Thursday 25 June" — pick the weekday closest in
  // the string to the row's day-of-month number, since that's the one
  // that applies to THIS date. Without this disambiguation we'd
  // false-flag the Monday term-start as "source says Thursday".
  let chosen;
  if (matches.length === 1) {
    chosen = matches[0];
  } else {
    const dayNum = String(d.getUTCDate());
    const lower = row.source_quote.toLowerCase();
    // Find every standalone occurrence of the day number in the quote;
    // pick the weekday whose start-position is nearest one of them.
    // `\b` so we match "13" but not "131" inside another number. The
    // optional ordinal suffix matters: UK schools write "10th April", and
    // there is no \b between "10" and "th", so without it the day number
    // is never found, the code falls back to the FIRST weekday in the
    // quote, and every end-date in a "Monday 5th – Friday 10th" range
    // quote gets false-flagged against the range's START weekday.
    const numRe = new RegExp(`\\b${dayNum}(?:st|nd|rd|th)?\\b`, 'g');
    const dayPositions = [];
    let nm;
    while ((nm = numRe.exec(lower)) !== null) dayPositions.push(nm.index);
    if (dayPositions.length === 0) {
      // No day-of-month in the quote — fall back to first weekday.
      chosen = matches[0];
    } else {
      // Distance is measured EDGE to edge (the gap between the two tokens),
      // not start to start. UK dates put the weekday BEFORE the number
      // ("Monday 25"), so start-to-start distance made the whole weekday's
      // length count against it: in "Monday 25 – Friday 29" the gap from
      // "Monday" to "25" is 1 char, but start-to-start it scored 7 vs
      // Friday's 5 — anchoring 25 to FRIDAY and false-flagging a correct
      // date (real Highgate School import). Ties prefer the preceding
      // weekday for the same convention.
      let bestDist = Infinity;
      for (const wd of matches) {
        const wdEnd = wd.position + wd.name.length;
        for (const dp of dayPositions) {
          const numEnd = dp + dayNum.length;
          const dist = wd.position >= numEnd
            ? wd.position - numEnd // weekday after the number
            : dp >= wdEnd
              ? dp - wdEnd         // weekday before the number
              : 0;                 // overlap (defensive)
          const precedes = wd.position < dp;
          if (dist < bestDist || (dist === bestDist && precedes && chosen && chosen.position > dp)) {
            bestDist = dist;
            chosen = wd;
          }
        }
      }
    }
  }

  const actual = dayOfWeekUTC(d);
  if (actual !== chosen.dow) {
    row.warnings.push(
      `${row.date} is a ${WEEKDAY_LABEL[actual]} but the source says ${WEEKDAY_LABEL[chosen.dow]}. The date might be off by a day — check before saving.`
    );
  }
}

function checkInsetNotWeekend(row) {
  if (row.event_type !== 'inset_day') return;
  const d = parseISODate(row.date);
  if (!d) return;
  const dow = dayOfWeekUTC(d);
  if (dow === 0 || dow === 6) {
    row.warnings.push(`INSET day falls on a ${WEEKDAY_LABEL[dow]} — schools normally hold these on a weekday.`);
  }
}

function checkSaneWindow(row, now) {
  const d = parseISODate(row.date);
  if (!d) {
    row.warnings.push('That date couldn\'t be read. Edit it before saving.');
    return;
  }
  const months = (d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
  if (months < -18 || months > 18) {
    row.warnings.push('More than 18 months from today — double-check the year.');
  }
}

// Aggressive normalisation for fuzzy presence checks: lowercase, unify dash
// variants, expand &, drop remaining punctuation, collapse whitespace. So
// "Rosh Hashana – Early Finish (1.05)" and "rosh hashana - early finish 1 05"
// compare as the same word stream.
function normaliseForMatch(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[‐-―−]/g, '-')        // – — etc -> hyphen
    .replace(/[‘’“”]/g, "'")   // smart quotes
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function checkSourceQuotePresent(row, sourceText) {
  if (!row.source_quote || !sourceText) return;
  const needleWs = normaliseWhitespace(row.source_quote);
  if (needleWs.length < 5) return;

  // 1. Exact (whitespace-normalised) substring - the cheap, strict case.
  if (normaliseWhitespace(sourceText).includes(needleWs)) return;

  // 2. Punctuation-insensitive substring. The AI routinely normalises dashes,
  //    quotes and brackets, so a verbatim match almost never survives - this
  //    catches those without crying wolf.
  const haystack = normaliseForMatch(sourceText);
  const needle = normaliseForMatch(row.source_quote);
  if (needle && haystack.includes(needle)) return;

  // 3. Token overlap. The quote is often a lightly-reworded label, so only
  //    warn when little of it actually appears on the page (the real
  //    signature of an invented snippet). Significant tokens = words 3+ chars.
  const tokens = needle.split(' ').filter((w) => w.length >= 3);
  if (tokens.length === 0) return;
  const present = tokens.filter((w) => haystack.includes(w)).length;
  if (present / tokens.length < 0.5) {
    row.warnings.push("The quoted text isn't on the source page — the AI may have invented this date.");
  }
}

function checkTermOrderingAndHalfTermContainment(rows) {
  const byAY = new Map();
  for (const r of rows) {
    const ay = r.academic_year || '__unknown__';
    if (!byAY.has(ay)) byAY.set(ay, []);
    byAY.get(ay).push(r);
  }
  for (const yearRows of byAY.values()) {
    const sorted = [...yearRows]
      .filter(r => parseISODate(r.date))
      .sort((a, b) => parseISODate(a.date) - parseISODate(b.date));

    const terms = [];
    let openStart = null;
    for (const r of sorted) {
      if (r.event_type === 'term_start') {
        if (openStart) {
          openStart.warnings.push("Two term-starts in a row — a term-end is missing between them.");
        }
        openStart = r;
      } else if (r.event_type === 'term_end') {
        if (!openStart) {
          r.warnings.push("Term-end has no matching term-start before it.");
        } else {
          const s = parseISODate(openStart.date);
          const e = parseISODate(r.date);
          if (e <= s) {
            r.warnings.push("Term-end is on or before its term-start — one of the dates is probably wrong.");
          }
          terms.push({ start: openStart, end: r });
          openStart = null;
        }
      }
    }
    if (openStart) {
      openStart.warnings.push("Term-start has no matching term-end after it.");
    }

    for (const r of sorted) {
      if (r.event_type !== 'half_term_start' && r.event_type !== 'half_term_end') continue;
      const d = parseISODate(r.date);
      const inside = terms.some(({ start, end }) => {
        const s = parseISODate(start.date);
        const e = parseISODate(end.date);
        return d >= s && d <= e;
      });
      if (!inside) {
        r.warnings.push("Half-term falls outside any term — the term boundaries are probably missing or wrong.");
      }
    }
  }
}

function checkDuplicates(rows) {
  const seen = new Map();
  for (const r of rows) {
    const key = `${r.event_type}|${r.date}|${r.academic_year || ''}`;
    if (seen.has(key)) {
      r.warnings.push('Duplicate of another row — you can delete one of them.');
    } else {
      seen.set(key, r);
    }
  }

  // Same event_type + same academic year + same normalised label, on a
  // *nearly identical* date: almost certainly the same real-world event with
  // one row hallucinated or off by a day. The AI sometimes emits both a
  // "last day of attendance" and the term-end date when the PDF only gives
  // one. We only flag rows whose dates sit close together — generic labels
  // like "Half term" legitimately recur several times an academic year
  // (October, February, May half-terms), and those are months apart, so a
  // large gap means two genuinely distinct events, not a duplicate.
  const NEAR_DUP_DAYS = 14;
  const byLabel = new Map();
  for (const r of rows) {
    const label = normaliseWhitespace(r.label);
    if (!label) continue;
    const k = `${r.event_type}|${r.academic_year || ''}|${label}`;
    if (!byLabel.has(k)) byLabel.set(k, []);
    byLabel.get(k).push(r);
  }
  for (const group of byLabel.values()) {
    if (group.length < 2) continue;
    for (let i = 1; i < group.length; i++) {
      const di = parseISODate(group[i].date);
      if (!di) continue;
      // Only earlier rows in the group are considered "the original", so each
      // real-world duplicate is flagged once (on the later-listed row).
      const near = [];
      for (let j = 0; j < i; j++) {
        const dj = parseISODate(group[j].date);
        if (!dj) continue;
        const gapDays = Math.abs(di - dj) / 86400000;
        if (gapDays > 0 && gapDays <= NEAR_DUP_DAYS) near.push(group[j].date);
      }
      if (near.length) {
        group[i].warnings.push(
          `Same label and academic year as another row (${near.join(', ')}) but a nearby different date — one of them is probably wrong.`
        );
      }
    }
  }
}

/**
 * @param {Array<object>} dates
 * @param {string} sourceText
 * @param {Date}   [now]
 * @returns {Array<object>}
 */
function validateTermDates(dates, sourceText, now) {
  const ts = now instanceof Date ? now : new Date();
  const rows = (Array.isArray(dates) ? dates : []).map(r => ({ ...r, warnings: [] }));

  for (const row of rows) {
    checkDayOfWeek(row);
    checkInsetNotWeekend(row);
    checkSaneWindow(row, ts);
    checkSourceQuotePresent(row, sourceText);
  }
  checkTermOrderingAndHalfTermContainment(rows);
  checkDuplicates(rows);

  return rows;
}

module.exports = { validateTermDates };
