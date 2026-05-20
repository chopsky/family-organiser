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

function findWeekdayInQuote(quote) {
  if (typeof quote !== 'string') return null;
  const lower = quote.toLowerCase();
  const keys = Object.keys(WEEKDAY_NAMES).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    const re = new RegExp(`\\b${key}\\b`, 'i');
    if (re.test(lower)) return { name: key, dow: WEEKDAY_NAMES[key] };
  }
  return null;
}

function checkDayOfWeek(row) {
  const d = parseISODate(row.date);
  if (!d || !row.source_quote) return;
  const found = findWeekdayInQuote(row.source_quote);
  if (!found) return;
  const actual = dayOfWeekUTC(d);
  if (actual !== found.dow) {
    row.warnings.push(
      `${row.date} is a ${WEEKDAY_LABEL[actual]}, source says ${WEEKDAY_LABEL[found.dow]}`
    );
  }
}

function checkInsetNotWeekend(row) {
  if (row.event_type !== 'inset_day') return;
  const d = parseISODate(row.date);
  if (!d) return;
  const dow = dayOfWeekUTC(d);
  if (dow === 0 || dow === 6) {
    row.warnings.push(`INSET day falls on a ${WEEKDAY_LABEL[dow]}`);
  }
}

function checkSaneWindow(row, now) {
  const d = parseISODate(row.date);
  if (!d) {
    row.warnings.push('Date could not be parsed');
    return;
  }
  const months = (d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
  if (months < -18 || months > 18) {
    row.warnings.push('Date is more than 18 months from today - double-check it');
  }
}

function checkSourceQuotePresent(row, sourceText) {
  if (!row.source_quote || !sourceText) return;
  const haystack = normaliseWhitespace(sourceText);
  const needle = normaliseWhitespace(row.source_quote);
  if (needle.length < 5) return;
  if (!haystack.includes(needle)) {
    row.warnings.push('Quote not found in source - possible hallucination');
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
          openStart.warnings.push('Two term_start entries without a term_end between them');
        }
        openStart = r;
      } else if (r.event_type === 'term_end') {
        if (!openStart) {
          r.warnings.push('term_end without a preceding term_start in the same academic year');
        } else {
          const s = parseISODate(openStart.date);
          const e = parseISODate(r.date);
          if (e <= s) {
            r.warnings.push('term_end is not after its term_start');
          }
          terms.push({ start: openStart, end: r });
          openStart = null;
        }
      }
    }
    if (openStart) {
      openStart.warnings.push('term_start without a matching term_end in the same academic year');
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
        r.warnings.push('Half-term date does not fall inside any term in the same academic year');
      }
    }
  }
}

function checkDuplicates(rows) {
  const seen = new Map();
  for (const r of rows) {
    const key = `${r.event_type}|${r.date}|${r.academic_year || ''}`;
    if (seen.has(key)) {
      r.warnings.push('Duplicate row (same type + date + year as another entry)');
    } else {
      seen.set(key, r);
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
