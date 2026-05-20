const { Router } = require('express');
const multer = require('multer');
const ical = require('node-ical');
const pdfParse = require('pdf-parse');
const db = require('../db/queries');
const { callWithFailover, LONG_TIMEOUT_MS } = require('../services/ai-client');
const saTermDates = require('../services/saTermDates');
const { validateTermDates } = require('../services/termDateValidator');
const { requireAuth, requireAdmin, requireHousehold } = require('../middleware/auth');
const cache = require('../services/cache');

const VALID_EVENT_TYPES = new Set([
  'term_start', 'term_end',
  'half_term_start', 'half_term_end',
  'inset_day', 'bank_holiday',
]);

// Memory-storage multer for direct PDF uploads to the term-dates
// preview route. School term-date PDFs are tiny (a few KB to ~200KB);
// memory storage keeps the route stateless and avoids /tmp churn.
const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB cap — way more than any real school PDF
});

/**
 * Shared AI extractor used by both /import-website/preview and
 * /import-pdf/preview. Takes the already-extracted plain text from a
 * source (HTML strip OR pdfParse), runs the country-aware AI prompt,
 * parses the lenient JSON, normalises, validates, and returns the
 * shape the frontend preview UI expects.
 *
 * Factored out because the import-website route had picked up two
 * call sites for it (the original URL flow and a new direct-PDF-
 * upload flow). Identical extraction logic in both — only the way
 * we get pageText differs.
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
    timeoutMs: LONG_TIMEOUT_MS,
    maxTokens: 8192,
    responseFormat: 'json',
    useThinking: false,
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
 * Compute current + next academic-year strings for the household's
 * country. UK uses Sept-Aug, SA uses calendar-year.
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

const router = Router();

/**
 * GET /api/schools/search?q=oakwood&postcode=NW1
 * Search the GIAS school directory by name and optional postcode.
 */
router.get('/search', async (req, res) => {
  const { q, postcode } = req.query;
  if (!q || q.trim().length < 2) {
    return res.status(400).json({ error: 'Search query must be at least 2 characters.' });
  }

  try {
    const results = await db.searchSchools(q.trim(), postcode?.trim() || null);
    return res.json({ schools: results });
  } catch (err) {
    console.error('GET /api/schools/search error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/schools
 * List all schools linked to the current household, with children and term dates.
 */
router.get('/', requireAuth, requireHousehold, async (req, res) => {
  try {
    const cacheKey = `schools:${req.householdId}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const [schools, members] = await Promise.all([
      db.getHouseholdSchools(req.householdId),
      db.getHouseholdMembers(req.householdId),
    ]);

    // Auto-cleanup orphaned schools (no children linked)
    const activeSchools = [];
    for (const school of schools) {
      const children = members.filter(m => m.school_id === school.id);
      if (children.length === 0) {
        db.deleteHouseholdSchool(school.id, req.householdId).catch(e =>
          console.error('Auto-cleanup failed:', e.message)
        );
        continue;
      }
      activeSchools.push({ ...school, _children: children });
    }

    // Batch-fetch all term dates and activities in 2 queries (not N+1)
    const schoolIds = activeSchools.map(s => s.id);
    const childIds = activeSchools.flatMap(s => s._children.map(c => c.id));
    const [allTermDates, allActivities] = await Promise.all([
      db.getTermDatesBySchoolIds(schoolIds),
      db.getActivitiesByChildIds(childIds),
    ]);

    // Group by school/child
    const termDatesBySchool = {};
    for (const td of allTermDates) {
      (termDatesBySchool[td.school_id] ??= []).push(td);
    }
    const activitiesByChild = {};
    for (const act of allActivities) {
      (activitiesByChild[act.child_id] ??= []).push(act);
    }

    const enriched = activeSchools.map(school => ({
      ...school,
      children: school._children.map(child => ({
        ...child,
        activities: activitiesByChild[child.id] || [],
      })),
      term_dates: termDatesBySchool[school.id] || [],
      _children: undefined,
    }));

    const result = { schools: enriched };
    cache.set(cacheKey, result, 1800); // 30 min TTL
    return res.json(result);
  } catch (err) {
    console.error('GET /api/schools error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/schools
 * Link a school to the household. If the school URN already exists, return existing.
 */
router.post('/', requireAuth, requireHousehold, requireAdmin, async (req, res) => {
  const { school_name, school_urn, school_type, local_authority, postcode, uses_la_dates, colour } = req.body;

  if (!school_name?.trim()) {
    return res.status(400).json({ error: 'School name is required.' });
  }

  try {
    // Check if this school (by URN) is already linked to this household
    if (school_urn) {
      const existing = await db.getHouseholdSchoolByUrn(req.householdId, school_urn);
      if (existing) {
        return res.json({ school: existing, existing: true });
      }
    }

    const school = await db.createHouseholdSchool(req.householdId, {
      school_name: school_name.trim(),
      school_urn,
      school_type,
      local_authority,
      postcode,
      uses_la_dates,
      colour,
    });

    cache.invalidate(`schools:${req.householdId}`);
    cache.invalidate(`digest:${req.householdId}`);
    return res.status(201).json({ school, existing: false });
  } catch (err) {
    console.error('POST /api/schools error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/schools/:id
 * Remove a school from the household.
 */
router.delete('/:id', requireAuth, requireHousehold, async (req, res) => {
  try {
    await db.deleteHouseholdSchool(req.params.id, req.householdId);
    cache.invalidate(`schools:${req.householdId}`);
    cache.invalidate(`digest:${req.householdId}`);
    return res.json({ message: 'School removed.' });
  } catch (err) {
    console.error('DELETE /api/schools error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/schools/:schoolId/term-dates
 * Add term dates for a school (batch).
 */
router.post('/:schoolId/term-dates', requireAuth, requireHousehold, requireAdmin, async (req, res) => {
  const { dates } = req.body;
  if (!Array.isArray(dates) || dates.length === 0) {
    return res.status(400).json({ error: 'dates array is required.' });
  }

  try {
    const created = await db.addSchoolTermDates(req.params.schoolId, dates);
    cache.invalidate(`schools:${req.householdId}`);
    cache.invalidate(`digest:${req.householdId}`);
    return res.status(201).json({ term_dates: created });
  } catch (err) {
    console.error('POST /api/schools/:id/term-dates error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/schools/:schoolId/term-dates
 * Get term dates for a school.
 */
router.get('/:schoolId/term-dates', requireAuth, requireHousehold, async (req, res) => {
  try {
    const termDates = await db.getSchoolTermDates(req.params.schoolId);
    return res.json({ term_dates: termDates });
  } catch (err) {
    console.error('GET /api/schools/:id/term-dates error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/schools/term-dates/:dateId
 * Remove a single term date entry.
 */
router.delete('/term-dates/:dateId', requireAuth, requireHousehold, requireAdmin, async (req, res) => {
  try {
    await db.deleteSchoolTermDate(req.params.dateId);
    cache.invalidate(`schools:${req.householdId}`);
    cache.invalidate(`digest:${req.householdId}`);
    return res.json({ message: 'Term date removed.' });
  } catch (err) {
    console.error('DELETE /api/schools/term-dates error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/schools/:schoolId/term-dates
 *
 * Bulk-remove every term date for the school. Also clears the
 * source/last-updated metadata so the UI doesn't keep advertising
 * "Source: SA national, last updated yesterday" after the user has
 * binned the lot. The school row itself is untouched - children
 * remain linked, and the user can re-import from any source.
 */
router.delete('/:schoolId/term-dates', requireAuth, requireHousehold, requireAdmin, async (req, res) => {
  try {
    // Ownership check - the schoolId in the URL must belong to the
    // caller's household. Without this, an admin in household A could
    // wipe household B's dates by guessing UUIDs.
    const schools = await db.getHouseholdSchools(req.householdId);
    const school = schools.find((s) => s.id === req.params.schoolId);
    if (!school) return res.status(404).json({ error: 'School not found.' });

    await db.deleteAllTermDatesBySchool(req.params.schoolId);
    await db.updateHouseholdSchoolMeta(req.params.schoolId, {
      term_dates_source: null,
      term_dates_last_updated: null,
    });
    cache.invalidate(`schools:${req.householdId}`);
    cache.invalidate(`digest:${req.householdId}`);
    return res.json({ message: `All term dates cleared for ${school.school_name}.` });
  } catch (err) {
    console.error('DELETE /api/schools/:id/term-dates error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/schools/activities
 * Add a weekly activity for a child.
 */
router.post('/activities', requireAuth, requireHousehold, requireAdmin, async (req, res) => {
  const { child_id, day_of_week, activity, time_start, time_end, reminder_text } = req.body;

  if (!child_id || day_of_week === undefined || !activity?.trim()) {
    return res.status(400).json({ error: 'child_id, day_of_week, and activity are required.' });
  }

  if (day_of_week < 0 || day_of_week > 4) {
    return res.status(400).json({ error: 'day_of_week must be 0 (Monday) to 4 (Friday).' });
  }

  try {
    const created = await db.addChildActivity({
      child_id,
      day_of_week,
      activity: activity.trim(),
      time_start: time_start || null,
      time_end: time_end || null,
      reminder_text: reminder_text || null,
    });
    cache.invalidate(`schools:${req.householdId}`);
    return res.status(201).json({ activity: created });
  } catch (err) {
    console.error('POST /api/schools/activities error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/schools/activities/:childId
 * Get weekly schedule for a child.
 */
router.get('/activities/:childId', requireAuth, requireHousehold, async (req, res) => {
  try {
    const activities = await db.getChildActivities(req.params.childId);
    return res.json({ activities });
  } catch (err) {
    console.error('GET /api/schools/activities/:childId error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/schools/activities/:activityId
 * Remove a weekly activity.
 */
router.delete('/activities/:activityId', requireAuth, requireHousehold, requireAdmin, async (req, res) => {
  try {
    await db.deleteChildActivity(req.params.activityId);
    cache.invalidate(`schools:${req.householdId}`);
    return res.json({ message: 'Activity removed.' });
  } catch (err) {
    console.error('DELETE /api/schools/activities error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/schools/:schoolId/import-ical
 * Import events from a school's iCal feed URL.
 * Uses AI to categorise events into term dates, INSET days, etc.
 */
router.post('/:schoolId/import-ical', requireAuth, requireHousehold, requireAdmin, async (req, res) => {
  const { ical_url } = req.body;
  if (!ical_url?.trim()) {
    return res.status(400).json({ error: 'iCal URL is required.' });
  }

  try {
    // Fetch and parse the iCal feed
    const events = await ical.async.fromURL(ical_url.trim());
    const eventList = Object.values(events)
      .filter(e => e.type === 'VEVENT')
      .map(e => ({
        title: e.summary || 'Untitled',
        date: e.start ? new Date(e.start).toISOString().split('T')[0] : null,
        end_date: e.end ? new Date(e.end).toISOString().split('T')[0] : null,
        description: e.description || '',
      }))
      .filter(e => e.date);

    if (eventList.length === 0) {
      return res.json({ imported: 0, message: 'No events found in the iCal feed.' });
    }

    // Use AI to categorise the events
    const categorisePrompt = `You are categorising school calendar events. For each event, determine the category.

Events to categorise:
${eventList.map((e, i) => `${i + 1}. "${e.title}" on ${e.date}${e.end_date && e.end_date !== e.date ? ` to ${e.end_date}` : ''}`).join('\n')}

Return a JSON array where each element has:
- index: the event number (1-based)
- category: one of: term_start, term_end, half_term_start, half_term_end, inset_day, bank_holiday, parents_evening, sports_day, performance, trip, exam, other
- label: a clean display label

Only return valid JSON array, nothing else.`;

    const { text } = await callWithFailover({
      system: 'You categorise school calendar events. Return only valid JSON.',
      messages: [{ role: 'user', content: categorisePrompt }],
      timeoutMs: LONG_TIMEOUT_MS,
      maxTokens: 4096,
      useThinking: false,
      feature: 'school_ical_categorize',
      householdId: req.householdId,
      userId: req.user.id,
    });

    let categorised;
    try {
      const cleaned = text.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
      categorised = JSON.parse(cleaned);
    } catch {
      categorised = eventList.map((e, i) => ({ index: i + 1, category: 'other', label: e.title }));
    }

    // Import categorised events as term dates
    const termDateTypes = ['term_start', 'term_end', 'half_term_start', 'half_term_end', 'inset_day', 'bank_holiday'];
    const termDates = [];
    const now = new Date();
    const academicYear = now.getMonth() >= 8 ? `${now.getFullYear()}-${now.getFullYear() + 1}` : `${now.getFullYear() - 1}-${now.getFullYear()}`;

    for (const cat of categorised) {
      const event = eventList[cat.index - 1];
      if (!event) continue;

      if (termDateTypes.includes(cat.category)) {
        termDates.push({
          academic_year: academicYear,
          event_type: cat.category,
          date: event.date,
          end_date: event.end_date !== event.date ? event.end_date : null,
          label: cat.label || event.title,
          source: 'ical_import',
        });
      }
    }

    // Clear all existing dates when switching to iCal (full replacement)
    await db.deleteAllTermDatesBySchool(req.params.schoolId);

    if (termDates.length > 0) {
      await db.addSchoolTermDates(req.params.schoolId, termDates);
    }

    // Save iCal URL on the school and update metadata
    await db.updateHouseholdSchool(req.params.schoolId, { ical_url: ical_url.trim() });
    await db.updateHouseholdSchoolMeta(req.params.schoolId, {
      term_dates_source: 'ical_import',
      term_dates_last_updated: new Date().toISOString(),
      ical_last_sync: new Date().toISOString(),
      ical_last_sync_status: 'success',
    });

    cache.invalidate(`schools:${req.householdId}`);
    cache.invalidate(`digest:${req.householdId}`);
    return res.json({
      imported: termDates.length,
      total_events: eventList.length,
      message: `Imported ${termDates.length} term dates from ${eventList.length} events.`,
    });
  } catch (err) {
    console.error('POST /api/schools/:id/import-ical error:', err);
    return res.status(500).json({ error: `Failed to import calendar: ${err.message}` });
  }
});

/**
 * POST /api/schools/:schoolId/import-la-dates
 * Scrape term dates from the school's local authority website using AI.
 */
/**
 * POST /api/schools/:schoolId/import-sa-term-dates
 *
 * Import the unified South African national school term dates onto this
 * school. From 2026 onwards SA has a single national calendar that
 * applies to every public school across all 9 provinces, so there's no
 * per-LA / per-province / per-school logic to negotiate - one tap copies
 * the national dates onto the household school.
 *
 * Body: { years?: number[] }  defaults to [current year].
 * Send years: [2026, 2027] to import two years at once.
 */
router.post('/:schoolId/import-sa-term-dates', requireAuth, requireHousehold, requireAdmin, async (req, res) => {
  try {
    const schools = await db.getHouseholdSchools(req.householdId);
    const school = schools.find(s => s.id === req.params.schoolId);
    if (!school) return res.status(404).json({ error: 'School not found.' });

    const years = Array.isArray(req.body?.years) && req.body.years.length
      ? req.body.years.filter((y) => Number.isInteger(y) && y >= 2026 && y <= 2100)
      : [new Date().getFullYear()];

    if (!years.length) return res.status(400).json({ error: 'No valid years provided.' });

    const inserted = await saTermDates.importToSchool(school.id, years);

    if (inserted === 0) {
      return res.status(404).json({
        error: 'No South African term dates found for the requested year(s). They may not have been published yet.',
      });
    }

    // Invalidate same caches as the other school-mutation endpoints -
    // notably schools:<id>, which /api/schools reads and the calendar
    // page pulls from. Without this the calendar would keep showing
    // the stale "no term dates" snapshot for up to 30 minutes (cache
    // TTL) after the user successfully imported the SA national dates.
    cache.invalidate(`schools:${req.householdId}`);
    cache.invalidate(`digest:${req.householdId}`);
    return res.json({
      message: `Imported ${inserted} term-date entries for ${school.school_name}.`,
      count: inserted,
      years,
    });
  } catch (err) {
    console.error('POST /api/schools/:id/import-sa-term-dates error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:schoolId/import-la-dates', requireAuth, requireHousehold, requireAdmin, async (req, res) => {
  try {
    // Get the school's LA
    const schools = await db.getHouseholdSchools(req.householdId);
    const school = schools.find(s => s.id === req.params.schoolId);
    if (!school) return res.status(404).json({ error: 'School not found.' });

    // If local_authority is missing, try to look it up from GIAS directory
    if (!school.local_authority && school.school_urn) {
      const giasResults = await db.searchSchoolByUrn(school.school_urn);
      if (giasResults?.local_authority) {
        school.local_authority = giasResults.local_authority;
        // Also update the household school record for next time
        await db.updateHouseholdSchool(school.id, { local_authority: giasResults.local_authority });
      }
    }
    if (!school.local_authority) return res.status(400).json({ error: 'No local authority associated with this school. Please check the school details.' });

    const now = new Date();
    const academicYear = now.getMonth() >= 8 ? `${now.getFullYear()}-${now.getFullYear() + 1}` : `${now.getFullYear() - 1}-${now.getFullYear()}`;

    // Check shared cache first - another family may have already imported this LA's dates
    const cached = await db.getCachedLATermDates(school.local_authority, academicYear);
    let dates;
    let fromCache = false;

    if (cached) {
      dates = cached;
      fromCache = true;
      console.log(`[import-la] Cache hit for ${school.local_authority} ${academicYear}`);
    } else {
      console.log(`[import-la] Cache miss for ${school.local_authority} ${academicYear} - calling AI`);

      // Use AI to find and extract LA term dates
      const { text } = await callWithFailover({
        system: `You are a UK school term date researcher. When given a local authority name, provide the term dates for the ${academicYear} academic year.

You should know the standard UK school term structure:
- Autumn term: September to December (with October half term)
- Spring term: January to March/April (with February half term)
- Summer term: April to July (with May/June half term)

Provide your best knowledge of the dates for this specific local authority. If you're not certain of exact dates, use typical dates for that region.

Return ONLY a valid JSON array with objects like:
[
  {"event_type": "term_start", "date": "2025-09-03", "label": "Autumn term starts"},
  {"event_type": "half_term_start", "date": "2025-10-27", "end_date": "2025-10-31", "label": "Autumn half term"},
  {"event_type": "term_end", "date": "2025-12-19", "label": "Autumn term ends"},
  ...
]

Valid event_types: term_start, term_end, half_term_start, half_term_end, inset_day, bank_holiday
For half terms, use half_term_start with an end_date spanning the week.
Include all 6 terms (3 terms × start + end) plus 3 half terms.`,
        messages: [{ role: 'user', content: `What are the school term dates for ${school.local_authority} council for the ${academicYear} academic year?` }],
        timeoutMs: LONG_TIMEOUT_MS,
        maxTokens: 4096,
        useThinking: false,
        feature: 'school_la_term_dates',
        householdId: req.householdId,
        userId: req.user.id,
      });

      try {
        const cleaned = text.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
        dates = JSON.parse(cleaned);
      } catch {
        return res.status(500).json({ error: 'Could not parse term dates from AI response.' });
      }

      if (!Array.isArray(dates) || dates.length === 0) {
        return res.status(500).json({ error: 'No term dates found.' });
      }

      // Cache the results for other families in the same LA
      await db.cacheLATermDates(school.local_authority, academicYear, dates);
    }

    // Add academic year and source to each date
    const termDates = dates.map(d => ({
      ...d,
      academic_year: academicYear,
      source: 'local_authority',
    }));

    // If source changed (e.g. website_scrape → local_authority), clear ALL existing dates first
    // Otherwise just clear the matching academic year for a clean merge
    if (school.term_dates_source && school.term_dates_source !== 'local_authority') {
      await db.deleteAllTermDatesBySchool(req.params.schoolId);
    } else {
      await db.deleteTermDatesBySchoolAndAcademicYear(req.params.schoolId, academicYear);
    }
    await db.addSchoolTermDates(req.params.schoolId, termDates);

    // Update household_schools metadata
    await db.updateHouseholdSchoolMeta(req.params.schoolId, {
      term_dates_source: 'local_authority',
      term_dates_last_updated: new Date().toISOString(),
    });

    cache.invalidate(`schools:${req.householdId}`);
    cache.invalidate(`digest:${req.householdId}`);
    return res.json({
      imported: termDates.length,
      local_authority: school.local_authority,
      message: `Updated ${termDates.length} dates for ${academicYear}.${fromCache ? '' : ' These dates are now cached for other families.'}`,
    });
  } catch (err) {
    console.error('POST /api/schools/:id/import-la-dates error:', err);
    return res.status(500).json({ error: `Failed to import LA dates: ${err.message}` });
  }
});

/**
 * POST /api/schools/:schoolId/import-website/preview
 *
 * Fetches the school's website / PDF, runs the AI extractor, and
 * runs a deterministic validation pass - but does NOT touch the
 * database. The admin sees the proposed dates in a preview UI, edits
 * any that look wrong, then POSTs the approved list to /confirm.
 *
 * This is the safety net for a feature that previously trusted the
 * AI's first-pass output and wrote straight to the canonical store.
 */
router.post('/:schoolId/import-website/preview', requireAuth, requireHousehold, requireAdmin, async (req, res) => {
  const { website_url } = req.body;
  if (!website_url?.trim()) {
    return res.status(400).json({ error: 'School website URL is required.' });
  }

  try {
    // Country-aware framing. UK schools use Autumn/Spring/Summer terms on
    // a Sept-Aug academic year; SA schools use Term 1-4 on a Jan-Dec
    // calendar year. Without this branch the AI defaults to UK vocab and
    // misses SA's Term 1 / Term 2 / etc., or rejects the page entirely
    // because it doesn't "look like" a UK school calendar.
    const household = await db.getHouseholdById(req.householdId);
    const country = household?.country || 'GB';

    const now = new Date();
    let currentAY;
    let nextAY;
    if (country === 'ZA') {
      // SA school year = calendar year. AY label is just the year number.
      currentAY = String(now.getFullYear());
      nextAY = String(now.getFullYear() + 1);
    } else {
      // UK + everyone else uses Sept-Aug AY.
      currentAY = now.getMonth() >= 8 ? `${now.getFullYear()}-${now.getFullYear() + 1}` : `${now.getFullYear() - 1}-${now.getFullYear()}`;
      nextAY = `${parseInt(currentAY.split('-')[1])}-${parseInt(currentAY.split('-')[1]) + 1}`;
    }

    // Direct-PDF short-circuit. Pasting a `.pdf` URL into the website
    // import (common for SA / private schools that publish a year-planner
    // PDF) used to land in a dead zone: response.text() decoded the PDF's
    // binary bytes as text, yielding gibberish that the HTML pipeline
    // then "stripped" into more gibberish, and the PDF-discovery code
    // below only fired when the response was actual HTML linking to PDFs.
    // Now we detect the direct case via the URL extension *and* the
    // Content-Type header, and route to pdfParse before any HTML logic.
    const trimmedUrl = website_url.trim();
    const looksLikePdfUrl = /\.pdf(\?|#|$)/i.test(trimmedUrl);

    let pageText;
    let rawHtml = '';

    if (looksLikePdfUrl) {
      try {
        const pdfResponse = await fetch(trimmedUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SchoolDatesBot/1.0)' },
        });
        if (!pdfResponse.ok) {
          return res.status(400).json({ error: `PDF returned HTTP ${pdfResponse.status}. Check the URL and try again.` });
        }
        const pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer());
        const pdfData = await pdfParse(pdfBuffer);
        pageText = (pdfData.text || '').trim().substring(0, 16000);
        if (pageText.length < 50) {
          return res.status(400).json({ error: 'The PDF appears to contain no extractable text. It may be a scanned image - try a different URL or add dates manually.' });
        }
        console.log('[import-website] Direct PDF - extracted', pageText.length, 'chars from', trimmedUrl);
      } catch (pdfErr) {
        return res.status(400).json({ error: `Could not parse the PDF: ${pdfErr.message}` });
      }
    } else {
      // HTML path - the original flow.
      try {
        const response = await fetch(trimmedUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; SchoolDatesBot/1.0)',
            'Accept': 'text/html,application/xhtml+xml,application/pdf',
          },
        });
        if (!response.ok) {
          return res.status(400).json({ error: `Website returned HTTP ${response.status}. Check the URL and try again.` });
        }

        // Belt-and-braces: a server might serve a PDF without a .pdf
        // path (e.g. a CGI endpoint). Detect by Content-Type and re-route.
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/pdf')) {
          const pdfBuffer = Buffer.from(await response.arrayBuffer());
          const pdfData = await pdfParse(pdfBuffer);
          pageText = (pdfData.text || '').trim().substring(0, 16000);
          if (pageText.length < 50) {
            return res.status(400).json({ error: 'The PDF appears to contain no extractable text. It may be a scanned image - try a different URL or add dates manually.' });
          }
          console.log('[import-website] Content-Type PDF - extracted', pageText.length, 'chars from', trimmedUrl);
        } else {
          rawHtml = await response.text();
          // Strip HTML but try to preserve table/list structure for better AI parsing
          pageText = rawHtml
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
            .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
            .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
            .replace(/<\/tr>/gi, '\n')
            .replace(/<\/li>/gi, '\n')
            .replace(/<\/p>/gi, '\n')
            .replace(/<\/div>/gi, '\n')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/h[1-6]>/gi, '\n')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/gi, ' ')
            .replace(/&amp;/gi, '&')
            .replace(/[ \t]+/g, ' ')
            .replace(/\n\s*\n/g, '\n')
            .trim()
            .substring(0, 12000);
        }
      } catch (fetchErr) {
        return res.status(400).json({ error: `Could not fetch the website: ${fetchErr.message}` });
      }
    }

    // If the page has little text content, look for PDF links containing term dates
    if (!looksLikePdfUrl && rawHtml && (pageText.length < 200 || /term.dates/i.test(rawHtml))) {
      const pdfLinks = [];
      const pdfRegex = /href=["']([^"']*\.pdf[^"']*)["']/gi;
      let pdfMatch;
      while ((pdfMatch = pdfRegex.exec(rawHtml)) !== null) {
        let pdfUrl = pdfMatch[1];
        if (pdfUrl.startsWith('/')) {
          const urlObj = new URL(website_url.trim());
          pdfUrl = `${urlObj.origin}${pdfUrl}`;
        } else if (!pdfUrl.startsWith('http')) {
          const base = website_url.trim().replace(/\/[^/]*$/, '/');
          pdfUrl = `${base}${pdfUrl}`;
        }
        pdfLinks.push(pdfUrl);
      }

      // Match PDFs for both current and next academic year
      const yearsToMatch = [
        parseInt(currentAY.split('-')[0]),
        parseInt(currentAY.split('-')[1]),
        parseInt(nextAY.split('-')[1]),
      ];
      const relevantPdfs = pdfLinks.filter(url => {
        const lower = url.toLowerCase();
        return (lower.includes('term') || lower.includes('date') || lower.includes('calendar')) &&
          yearsToMatch.some(y => lower.includes(String(y)));
      });
      const pdfsToTry = relevantPdfs.length > 0 ? relevantPdfs : pdfLinks.filter(url =>
        url.toLowerCase().includes('term') || url.toLowerCase().includes('date')
      );

      // Download and combine text from all relevant PDFs
      const pdfTexts = [];
      for (const pdfUrl of pdfsToTry.slice(0, 4)) {
        try {
          console.log('[import-website] Fetching PDF:', pdfUrl);
          const pdfResponse = await fetch(pdfUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SchoolDatesBot/1.0)' },
          });
          if (!pdfResponse.ok) continue;
          const pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer());
          const pdfData = await pdfParse(pdfBuffer);
          if (pdfData.text && pdfData.text.trim().length > 20) {
            console.log('[import-website] Extracted', pdfData.text.length, 'chars from PDF');
            pdfTexts.push(pdfData.text.trim());
          }
        } catch (pdfErr) {
          console.warn('[import-website] Could not parse PDF:', pdfErr.message);
        }
      }
      if (pdfTexts.length > 0) {
        pageText = pdfTexts.join('\n\n---\n\n').substring(0, 16000);
      }
    }

    if (pageText.length < 50) {
      return res.status(400).json({ error: 'The page appears to have very little text content. Term dates may be in a PDF or image that could not be read. Try adding dates manually.' });
    }

    console.log('[import-website] Extracted', pageText.length, 'chars from', website_url);

    // Country-specific framing for the AI. The vocab and academic-year
    // shape varies enough that a UK-flavoured prompt confidently misses
    // SA dates (and vice versa). Each branch tells the AI exactly which
    // term names to recognise and which AY format to emit.
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

    // Use AI to extract term dates from the page content
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
      timeoutMs: LONG_TIMEOUT_MS,
      // 8192: a full SA year planner can emit 80+ entries (terms × 2 +
      // ~40 holidays per year × 2 years). The old 4096 cap silently
      // truncated Gemini's response mid-array, leaving the parser with
      // invalid JSON. 8192 leaves comfortable headroom.
      maxTokens: 8192,
      // responseFormat: 'json' tells the Gemini call to set
      // responseMimeType='application/json', which forces valid JSON at
      // the API layer. Without it, Gemini occasionally emits
      // conversational prose around the array and the parser chokes.
      // Claude doesn't have an equivalent knob, but it usually behaves;
      // the lenient JSON extraction further down is its safety net.
      responseFormat: 'json',
      useThinking: false,
      feature: 'school_website_extraction',
      householdId: req.householdId,
      userId: req.user.id,
    });

    // Lenient JSON extraction. Models occasionally:
    //   • Wrap the response in ```json … ``` (handled by the original
    //     regex) or in plain ``` (now also handled).
    //   • Prefix prose like "Here are the term dates I found:" before
    //     the JSON. We dig out the first `[` … last `]` substring.
    //   • Return "I cannot find any term dates" prose - caught when
    //     the slice still fails to parse.
    let dates;
    try {
      // Step 1: strip any markdown code fences anywhere in the response.
      let cleaned = text
        .replace(/```(?:json)?\s*/gi, '')
        .replace(/```\s*/g, '')
        .trim();
      // Step 2: if there's prose before/after, slice to the JSON array.
      const firstBracket = cleaned.indexOf('[');
      const lastBracket = cleaned.lastIndexOf(']');
      if (firstBracket !== -1 && lastBracket > firstBracket) {
        cleaned = cleaned.substring(firstBracket, lastBracket + 1);
      }
      dates = JSON.parse(cleaned);
    } catch {
      console.error('[import-website] AI response could not be parsed:', text.substring(0, 2000));
      return res.status(500).json({
        error: 'The school dates page or PDF was downloaded, but the AI could not extract structured dates from it. Try a different URL, an iCal feed, or add dates manually.',
      });
    }

    if (!Array.isArray(dates) || dates.length === 0) {
      return res.json({
        dates: [],
        source_url: website_url.trim(),
        source_text_preview: '',
        message: 'No term dates found on that page. Try a different URL or add dates manually.',
      });
    }

    // Default missing academic_year before validation so the AY-pairing
    // logic groups rows correctly.
    const normalised = dates
      .filter(d => d && typeof d === 'object')
      .map(d => ({
        ...d,
        academic_year: d.academic_year || currentAY,
      }));

    const validated = validateTermDates(normalised, pageText);

    return res.json({
      dates: validated,
      source_url: website_url.trim(),
      // ~800 chars of the source text gives the admin enough context
      // to eyeball a single date by hand if a warning makes them suspicious.
      source_text_preview: pageText.substring(0, 800),
    });
  } catch (err) {
    console.error('POST /api/schools/:id/import-website/preview error:', err);
    return res.status(500).json({ error: `Failed to import from website: ${err.message}` });
  }
});

/**
 * POST /api/schools/:schoolId/import-pdf/preview
 *
 * Fallback for term-date PDFs that we can't reach via URL — typically
 * because the school hosts them behind SharePoint / Google Drive
 * share links (Immanuel College, many private schools), or because
 * the term dates page is a JavaScript-rendered SPA we can't read.
 *
 * The user downloads the PDF from their browser and uploads it here;
 * we pdfParse the bytes and feed the text through the same AI extractor
 * as the URL flow. The preview shape, validator output, and confirm-
 * to-save endpoint are all identical, so the rest of the wizard is
 * unchanged.
 *
 * Multipart upload, field name 'file'. 10MB cap is way more than any
 * real school term-date PDF; the route lives behind requireAdmin so
 * abuse risk is low.
 */
router.post('/:schoolId/import-pdf/preview', requireAuth, requireHousehold, requireAdmin, pdfUpload.single('file'), async (req, res) => {
  if (!req.file?.buffer) {
    return res.status(400).json({ error: 'No file uploaded.' });
  }
  // Cheap MIME sanity check. Multer's fileFilter would be the canonical
  // spot but inline here keeps the route self-contained — there's only
  // one type we accept.
  const mime = req.file.mimetype || '';
  const looksLikePdf = mime === 'application/pdf' || req.file.originalname?.toLowerCase().endsWith('.pdf');
  if (!looksLikePdf) {
    return res.status(400).json({ error: 'Please upload a PDF file (got ' + (mime || 'unknown type') + ').' });
  }

  try {
    const household = await db.getHouseholdById(req.householdId);
    const country = household?.country || 'GB';
    const { currentAY, nextAY } = academicYearsForCountry(country);

    let pageText;
    try {
      const pdfData = await pdfParse(req.file.buffer);
      pageText = (pdfData.text || '').trim().substring(0, 16000);
    } catch (pdfErr) {
      return res.status(400).json({ error: `Could not read the PDF: ${pdfErr.message}` });
    }
    if (pageText.length < 50) {
      return res.status(400).json({ error: 'The PDF appears to contain no extractable text. It may be a scanned image — add term dates manually instead.' });
    }

    console.log('[import-pdf] Extracted', pageText.length, 'chars from upload', req.file.originalname);

    const result = await extractTermDatesPreview({
      pageText,
      country,
      currentAY,
      nextAY,
      householdId: req.householdId,
      userId: req.user.id,
      sourceLabel: req.file.originalname || 'uploaded.pdf',
    });
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error('POST /api/schools/:id/import-pdf/preview error:', err);
    return res.status(500).json({ error: `Failed to import from PDF: ${err.message}` });
  }
});

/**
 * POST /api/schools/:schoolId/import-website/confirm
 *
 * Writes the admin-approved list of term dates to the database. This
 * is the only path that mutates state - /preview is read-only AI work.
 *
 * Body: { dates: [{event_type, date, end_date?, label, academic_year, ...}] }
 * The client is allowed to edit any field before sending. We re-validate
 * the shape here because the request is now coming from an editable form.
 */
router.post('/:schoolId/import-website/confirm', requireAuth, requireHousehold, requireAdmin, async (req, res) => {
  const { dates } = req.body || {};
  if (!Array.isArray(dates) || dates.length === 0) {
    return res.status(400).json({ error: 'No dates to save.' });
  }

  // Server-side sanity check - the preview client can edit anything,
  // so don't trust the shape blindly.
  const errors = [];
  const cleaned = [];
  for (let i = 0; i < dates.length; i++) {
    const d = dates[i] || {};
    if (!VALID_EVENT_TYPES.has(d.event_type)) {
      errors.push(`Row ${i + 1}: invalid event_type "${d.event_type}"`);
      continue;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date || '')) {
      errors.push(`Row ${i + 1}: invalid date "${d.date}"`);
      continue;
    }
    if (d.end_date && !/^\d{4}-\d{2}-\d{2}$/.test(d.end_date)) {
      errors.push(`Row ${i + 1}: invalid end_date "${d.end_date}"`);
      continue;
    }
    if (!d.academic_year || typeof d.academic_year !== 'string') {
      errors.push(`Row ${i + 1}: missing academic_year`);
      continue;
    }
    cleaned.push({
      event_type: d.event_type,
      date: d.date,
      end_date: d.end_date || null,
      label: d.label || '',
      academic_year: d.academic_year,
      source: 'website_scrape',
    });
  }
  if (errors.length > 0) {
    return res.status(400).json({ error: 'Some rows are invalid.', details: errors });
  }

  try {
    const school = await db.getHouseholdSchools(req.householdId)
      .then(schools => schools.find(s => s.id === req.params.schoolId));

    if (school?.term_dates_source && school.term_dates_source !== 'website_scrape') {
      await db.deleteAllTermDatesBySchool(req.params.schoolId);
    } else {
      const datesByYear = {};
      for (const td of cleaned) {
        (datesByYear[td.academic_year] ??= []).push(td);
      }
      for (const ay of Object.keys(datesByYear)) {
        await db.deleteTermDatesBySchoolAndAcademicYear(req.params.schoolId, ay);
      }
    }

    await db.addSchoolTermDates(req.params.schoolId, cleaned);
    await db.updateHouseholdSchoolMeta(req.params.schoolId, {
      term_dates_source: 'website_scrape',
      term_dates_last_updated: new Date().toISOString(),
    });

    cache.invalidate(`schools:${req.householdId}`);
    cache.invalidate(`digest:${req.householdId}`);
    return res.json({
      imported: cleaned.length,
      message: `Imported ${cleaned.length} term date(s) from website.`,
    });
  } catch (err) {
    console.error('POST /api/schools/:id/import-website/confirm error:', err);
    return res.status(500).json({ error: `Failed to save term dates: ${err.message}` });
  }
});

/**
 * PATCH /api/schools/:schoolId/term-dates/:dateId
 * Edit an individual term date (date, end_date, label, event_type).
 */
router.patch('/:schoolId/term-dates/:dateId', requireAuth, requireHousehold, requireAdmin, async (req, res) => {
  const { date, end_date, label, event_type } = req.body;
  const updates = {};
  if (date !== undefined) updates.date = date;
  if (end_date !== undefined) updates.end_date = end_date;
  if (label !== undefined) updates.label = label;
  if (event_type !== undefined) updates.event_type = event_type;

  if (!Object.keys(updates).length) {
    return res.status(400).json({ error: 'No valid fields to update.' });
  }

  try {
    const updated = await db.updateSchoolTermDate(req.params.dateId, updates);
    cache.invalidate(`schools:${req.householdId}`);
    cache.invalidate(`digest:${req.householdId}`);
    return res.json({ term_date: updated });
  } catch (err) {
    console.error('PATCH /api/schools/:schoolId/term-dates/:dateId error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/schools/:schoolId/sync-ical
 * Manual iCal sync - re-fetch and replace all ical_import dates for this school.
 */
router.post('/:schoolId/sync-ical', requireAuth, requireHousehold, requireAdmin, async (req, res) => {
  try {
    // Get the school record and check it has an ical_url
    const schools = await db.getHouseholdSchools(req.householdId);
    const school = schools.find(s => s.id === req.params.schoolId);
    if (!school) return res.status(404).json({ error: 'School not found.' });
    if (!school.ical_url) return res.status(400).json({ error: 'No iCal URL configured for this school.' });

    // Fetch and parse the iCal feed
    const events = await ical.async.fromURL(school.ical_url);
    const eventList = Object.values(events)
      .filter(e => e.type === 'VEVENT')
      .map(e => ({
        title: e.summary || 'Untitled',
        date: e.start ? new Date(e.start).toISOString().split('T')[0] : null,
        end_date: e.end ? new Date(e.end).toISOString().split('T')[0] : null,
        description: e.description || '',
      }))
      .filter(e => e.date);

    if (eventList.length === 0) {
      await db.updateHouseholdSchoolMeta(req.params.schoolId, {
        ical_last_sync: new Date().toISOString(),
        ical_last_sync_status: 'success_empty',
      });
      return res.json({ success: true, dates_synced: 0, message: 'No events found in the iCal feed.' });
    }

    // Use AI to categorise the events (same logic as import-ical)
    const categorisePrompt = `You are categorising school calendar events. For each event, determine the category.

Events to categorise:
${eventList.map((e, i) => `${i + 1}. "${e.title}" on ${e.date}${e.end_date && e.end_date !== e.date ? ` to ${e.end_date}` : ''}`).join('\n')}

Return a JSON array where each element has:
- index: the event number (1-based)
- category: one of: term_start, term_end, half_term_start, half_term_end, inset_day, bank_holiday, parents_evening, sports_day, performance, trip, exam, other
- label: a clean display label

Only return valid JSON array, nothing else.`;

    const { text } = await callWithFailover({
      system: 'You categorise school calendar events. Return only valid JSON.',
      messages: [{ role: 'user', content: categorisePrompt }],
      timeoutMs: LONG_TIMEOUT_MS,
      maxTokens: 4096,
      useThinking: false,
      feature: 'school_ical_categorize',
      householdId: req.householdId,
      userId: req.user.id,
    });

    let categorised;
    try {
      const cleaned = text.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
      categorised = JSON.parse(cleaned);
    } catch {
      categorised = eventList.map((e, i) => ({ index: i + 1, category: 'other', label: e.title }));
    }

    const termDateTypes = ['term_start', 'term_end', 'half_term_start', 'half_term_end', 'inset_day', 'bank_holiday'];
    const termDates = [];

    for (const cat of categorised) {
      const event = eventList[cat.index - 1];
      if (!event) continue;

      if (termDateTypes.includes(cat.category)) {
        // Determine academic year from the event date
        const eventDate = new Date(event.date);
        const eventMonth = eventDate.getMonth(); // 0-indexed
        const eventYear = eventDate.getFullYear();
        const academicYear = eventMonth >= 7
          ? `${eventYear}-${eventYear + 1}`
          : `${eventYear - 1}-${eventYear}`;

        termDates.push({
          academic_year: academicYear,
          event_type: cat.category,
          date: event.date,
          end_date: event.end_date !== event.date ? event.end_date : null,
          label: cat.label || event.title,
          source: 'ical_import',
        });
      }
    }

    // Delete ALL existing ical_import dates for this school, then insert fresh
    const { supabaseAdmin } = require('../db/client');
    const { error: deleteErr } = await supabaseAdmin
      .from('school_term_dates')
      .delete()
      .eq('school_id', req.params.schoolId)
      .eq('source', 'ical_import');
    if (deleteErr) throw deleteErr;

    if (termDates.length > 0) {
      await db.addSchoolTermDates(req.params.schoolId, termDates);
    }

    // Update metadata
    await db.updateHouseholdSchoolMeta(req.params.schoolId, {
      ical_last_sync: new Date().toISOString(),
      ical_last_sync_status: 'success',
      term_dates_last_updated: new Date().toISOString(),
    });

    cache.invalidate(`schools:${req.householdId}`);
    cache.invalidate(`digest:${req.householdId}`);
    return res.json({
      success: true,
      dates_synced: termDates.length,
      message: `Synced ${termDates.length} term dates from iCal feed.`,
    });
  } catch (err) {
    // Update metadata with failure status
    try {
      await db.updateHouseholdSchoolMeta(req.params.schoolId, {
        ical_last_sync: new Date().toISOString(),
        ical_last_sync_status: `error: ${err.message}`,
      });
    } catch { /* ignore meta update failure */ }

    console.error('POST /api/schools/:id/sync-ical error:', err);
    return res.status(500).json({ error: `Failed to sync iCal feed: ${err.message}` });
  }
});

/**
 * PATCH /api/schools/:id
 * Update school details (colour, ical_url, etc).
 */
router.patch('/:id', requireAuth, requireHousehold, requireAdmin, async (req, res) => {
  const { colour, ical_url, school_name } = req.body;
  const updates = {};
  if (colour !== undefined) updates.colour = colour;
  if (ical_url !== undefined) updates.ical_url = ical_url;
  if (school_name !== undefined) updates.school_name = school_name;

  if (!Object.keys(updates).length) {
    return res.status(400).json({ error: 'No valid fields to update.' });
  }

  try {
    const updated = await db.updateHouseholdSchool(req.params.id, updates);
    cache.invalidate(`schools:${req.householdId}`);
    return res.json({ school: updated });
  } catch (err) {
    console.error('PATCH /api/schools/:id error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
