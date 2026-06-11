/**
 * School term-date extraction — shared service.
 *
 * Lifted out of src/routes/schools.js so it can be reused outside the routes
 * layer (the WhatsApp bot imports term dates from a pasted/uploaded calendar
 * via the same extractor). Behaviour is unchanged; schools.js now imports
 * these from here.
 *
 * Depends only on services (ai-client, termDateValidator) — no route/express
 * coupling.
 */

const { callWithFailover, REASONING_TIMEOUT_MS } = require('./ai-client');
const { validateTermDates } = require('./termDateValidator');

const VALID_EVENT_TYPES = new Set([
  'term_start', 'term_end',
  'half_term_start', 'half_term_end',
  'inset_day', 'bank_holiday',
]);

/**
 * Shared AI extractor used by /import-website/preview, /import-pdf/preview, and
 * the WhatsApp bot. Takes already-extracted plain text (HTML strip / pdfParse /
 * document-extract), runs the country-aware AI prompt, parses the lenient JSON,
 * normalises, validates, and returns the shape the preview UI expects:
 *   { ok, status, body: { dates: [...], source_url, source_text_preview } }
 */
async function extractTermDatesPreview({ pageText, country, currentAY, nextAY, householdId, userId, sourceLabel }) {
  if (!pageText || pageText.length < 50) {
    return {
      ok: false,
      status: 400,
      body: { error: 'The source has very little text content. The PDF might be a scanned image, or the page might be JavaScript-rendered. Try downloading the term-dates PDF and uploading it directly.' },
    };
  }

  const promptByCountry = {
    ZA: {
      intro: `You are an expert at extracting South African school term dates from website or PDF content. South African schools run on the calendar year (January–December) with four terms. From 2026, a unified national calendar applies to every public school. Extract ALL term dates you can find - for both ${currentAY} and ${nextAY} if available.

The source may label terms as "Term 1", "Term 2" or as "FIRST TERM", "SECOND TERM", "THIRD TERM", "FOURTH TERM" - treat both labelings identically.

CRITICAL: South African schools do NOT have "half-terms" (that's UK terminology). DO NOT emit half_term_start or half_term_end events. South Africa's school year is four discrete terms with breaks BETWEEN terms, not WITHIN them. Anything labelled as a "break" inside a term is either (a) a named religious / public holiday, or (b) a brief multi-day school closure - both go in as bank_holiday with end_date if multi-day.

Use only these event_types for SA:
• term_start, term_end - for term boundaries
• bank_holiday - for everything else: public holidays, religious holidays (Chanukah, Pesach, Rosh Hashanah, Yom Kippur, Sukkot, Shavuot, etc.), any "BREAK" inside a term. Use end_date for multi-day entries.`,
      lookFor: [
        'Dates in any common format ("3 January 2026", "03/01/2026", "2026-01-03")',
        'Term boundaries - when "FIRST TERM" / "TERM 1" says e.g. "Wednesday 14 January - Friday 27 March", emit one term_start and one term_end',
        'Named religious holidays (Chanukah, Pesach, Rosh Hashanah, Yom Kippur, Sukkot, Shavuot, etc.) → bank_holiday, with end_date if multi-day',
        'South African public holidays (Human Rights Day, Freedom Day, Workers Day, Youth Day, Heritage Day, Day of Reconciliation, etc.) → bank_holiday',
        'Any "BREAK" entries within a term (e.g. "PESACH BREAK") → bank_holiday with end_date',
      ],
      ayFormat: `"${currentAY}" or "${nextAY}"`,
      userIntro: 'Extract all school term dates and closures from this South African school year planner. Emit one JSON entry per date you find - terms, holidays, and closures all go into the same array. Do not emit half_term_start or half_term_end events:',
    },
    GB: {
      intro: `You are an expert at extracting UK school term dates from website content. Extract ALL term dates you can find - for both the ${currentAY} academic year and the ${nextAY} academic year if available.`,
      lookFor: [
        'Dates in any UK format (e.g. "3rd September 2025", "3 Sep 2025", "03/09/2025")',
        'Term names (Autumn, Spring, Summer)',
        'Half term breaks',
        'INSET/training days',
        'Bank holidays',
        'School-specific closures (e.g. religious holidays)',
      ],
      ayFormat: `"${currentAY}" or "${nextAY}"`,
      userIntro: 'Extract all school term dates from this UK school website page content:',
    },
  };
  const cfg = promptByCountry[country] || promptByCountry.GB;

  const { text } = await callWithFailover({
    system: `${cfg.intro}

Look carefully for:
${cfg.lookFor.map((line) => `- ${line}`).join('\n')}

Return ONLY a valid JSON array with no other text:
[
  {"event_type": "term_start", "date": "YYYY-MM-DD", "label": "Description", "academic_year": "YYYY-YYYY", "source_quote": "the exact snippet from the source text containing this date"},
  {"event_type": "half_term_start", "date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD", "label": "Description", "academic_year": "YYYY-YYYY", "source_quote": "..."},
  ...
]

Valid event_types: term_start, term_end, half_term_start, half_term_end, inset_day, bank_holiday
For half terms / mid-term breaks, use half_term_start with an end_date spanning the break.
For school-specific closures (religious holidays etc), use bank_holiday with a descriptive label.
Include the academic_year field (${cfg.ayFormat}) for each entry.

CRITICAL - source_quote field:
- For every entry, include a "source_quote" field with the EXACT substring from the source text (10–80 characters) that contains this date.
- Copy verbatim - do not paraphrase, reformat, or invent text.
- If a weekday name appears next to the date in the source (e.g. "Monday 6 January"), include it. This helps us spot off-by-one mistakes.
- If you genuinely cannot find a clean snippet for an entry, set source_quote to null.

If you genuinely cannot find any term dates in the content, return an empty array [].
Do NOT wrap in markdown code fences.`,
    messages: [{ role: 'user', content: `${cfg.userIntro}\n\n${pageText}` }],
    timeoutMs: REASONING_TIMEOUT_MS,
    maxTokens: 8192,
    responseFormat: 'json',
    useThinking: true,
    preferClaude: true,
    feature: 'school_website_extraction',
    householdId,
    userId,
  });

  let dates;
  try {
    let cleaned = text
      .replace(/```(?:json)?\s*/gi, '')
      .replace(/```\s*/g, '')
      .trim();
    const firstBracket = cleaned.indexOf('[');
    const lastBracket = cleaned.lastIndexOf(']');
    if (firstBracket !== -1 && lastBracket > firstBracket) {
      cleaned = cleaned.substring(firstBracket, lastBracket + 1);
    }
    dates = JSON.parse(cleaned);
  } catch {
    console.error('[import-term-dates] AI response could not be parsed:', text.substring(0, 2000));
    return {
      ok: false,
      status: 500,
      body: { error: 'The source was read but the AI could not extract structured dates from it. Try a different file or add dates manually.' },
    };
  }

  if (!Array.isArray(dates) || dates.length === 0) {
    return {
      ok: true,
      status: 200,
      body: {
        dates: [],
        source_url: sourceLabel || null,
        source_text_preview: '',
        message: 'No term dates found. Try a different source or add dates manually.',
      },
    };
  }

  const normalised = dates
    .filter((d) => d && typeof d === 'object')
    .map((d) => ({ ...d, academic_year: d.academic_year || currentAY }));
  const validated = validateTermDates(normalised, pageText);

  return {
    ok: true,
    status: 200,
    body: {
      dates: validated,
      source_url: sourceLabel || null,
      source_text_preview: pageText.substring(0, 800),
    },
  };
}

/**
 * Compute current + next academic-year strings for the household's country.
 * UK uses Sept-Aug, SA uses calendar-year.
 */
function academicYearsForCountry(country) {
  const now = new Date();
  if (country === 'ZA') {
    return {
      currentAY: String(now.getFullYear()),
      nextAY: String(now.getFullYear() + 1),
    };
  }
  const currentAY = now.getMonth() >= 8
    ? `${now.getFullYear()}-${now.getFullYear() + 1}`
    : `${now.getFullYear() - 1}-${now.getFullYear()}`;
  const nextAY = `${parseInt(currentAY.split('-')[1])}-${parseInt(currentAY.split('-')[1]) + 1}`;
  return { currentAY, nextAY };
}

module.exports = { extractTermDatesPreview, academicYearsForCountry, VALID_EVENT_TYPES };
