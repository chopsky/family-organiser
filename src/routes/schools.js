const { Router } = require('express');
const ical = require('node-ical');
const pdfParse = require('pdf-parse');
const db = require('../db/queries');
const { callWithFailover, LONG_TIMEOUT_MS } = require('../services/ai-client');
const { requireAuth, requireAdmin, requireHousehold } = require('../middleware/auth');
const cache = require('../services/cache');

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

    // Check shared cache first — another family may have already imported this LA's dates
    const cached = await db.getCachedLATermDates(school.local_authority, academicYear);
    let dates;
    let fromCache = false;

    if (cached) {
      dates = cached;
      fromCache = true;
      console.log(`[import-la] Cache hit for ${school.local_authority} ${academicYear}`);
    } else {
      console.log(`[import-la] Cache miss for ${school.local_authority} ${academicYear} — calling AI`);

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
 * POST /api/schools/:schoolId/import-website
 * Scrape term dates from a school's website using AI.
 */
router.post('/:schoolId/import-website', requireAuth, requireHousehold, requireAdmin, async (req, res) => {
  const { website_url } = req.body;
  if (!website_url?.trim()) {
    return res.status(400).json({ error: 'School website URL is required.' });
  }

  try {
    const now = new Date();
    const currentAY = now.getMonth() >= 8 ? `${now.getFullYear()}-${now.getFullYear() + 1}` : `${now.getFullYear() - 1}-${now.getFullYear()}`;
    const nextAY = `${parseInt(currentAY.split('-')[1])}-${parseInt(currentAY.split('-')[1]) + 1}`;

    // Fetch the webpage content
    let pageText;
    let rawHtml;
    try {
      const response = await fetch(website_url.trim(), {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; SchoolDatesBot/1.0)',
          'Accept': 'text/html,application/xhtml+xml',
        },
      });
      if (!response.ok) {
        return res.status(400).json({ error: `Website returned HTTP ${response.status}. Check the URL and try again.` });
      }
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
        .substring(0, 12000); // Allow more content for better context
    } catch (fetchErr) {
      return res.status(400).json({ error: `Could not fetch the website: ${fetchErr.message}` });
    }

    // If the page has little text content, look for PDF links containing term dates
    if (pageText.length < 200 || /term.dates/i.test(rawHtml)) {
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

    // Use AI to extract term dates from the page content
    const { text } = await callWithFailover({
      system: `You are an expert at extracting UK school term dates from website content. Extract ALL term dates you can find — for both the ${currentAY} academic year and the ${nextAY} academic year if available.

Look carefully for:
- Dates in any UK format (e.g. "3rd September 2025", "3 Sep 2025", "03/09/2025")
- Term names (Autumn, Spring, Summer)
- Half term breaks
- INSET/training days
- Bank holidays
- School-specific closures (e.g. religious holidays)

Return ONLY a valid JSON array with no other text:
[
  {"event_type": "term_start", "date": "YYYY-MM-DD", "label": "Description", "academic_year": "YYYY-YYYY"},
  {"event_type": "half_term_start", "date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD", "label": "Description", "academic_year": "YYYY-YYYY"},
  ...
]

Valid event_types: term_start, term_end, half_term_start, half_term_end, inset_day, bank_holiday
For half terms, use half_term_start with an end_date spanning the break.
For school-specific closures (religious holidays etc), use bank_holiday with a descriptive label.
Include the academic_year field (e.g. "${currentAY}" or "${nextAY}") for each entry.
If you genuinely cannot find any term dates in the content, return an empty array [].
Do NOT wrap in markdown code fences.`,
      messages: [{ role: 'user', content: `Extract all school term dates from this UK school website page content:\n\n${pageText}` }],
      timeoutMs: LONG_TIMEOUT_MS,
      maxTokens: 4096,
      useThinking: false,
      feature: 'school_website_extraction',
      householdId: req.householdId,
      userId: req.user.id,
    });

    let dates;
    try {
      const cleaned = text.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
      dates = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error('[import-website] AI response could not be parsed:', text.substring(0, 500));
      return res.status(500).json({ error: 'Could not extract structured term dates from the website. The page may not contain parseable date information. Try adding dates manually.' });
    }

    if (!Array.isArray(dates) || dates.length === 0) {
      return res.json({ imported: 0, message: 'No term dates found on that page. Try a different URL or add dates manually.' });
    }

    const termDates = dates.map(d => ({
      ...d,
      academic_year: d.academic_year || currentAY,
      source: 'website_scrape',
    }));

    // Load school metadata to check current source
    const school = await db.getHouseholdSchools(req.householdId)
      .then(schools => schools.find(s => s.id === req.params.schoolId));

    // If source changed, clear ALL existing dates first to avoid conflicts
    if (school?.term_dates_source && school.term_dates_source !== 'website_scrape') {
      await db.deleteAllTermDatesBySchool(req.params.schoolId);
    } else {
      // Same source — merge by academic year
      const datesByYear = {};
      for (const td of termDates) {
        (datesByYear[td.academic_year] ??= []).push(td);
      }
      for (const ay of Object.keys(datesByYear)) {
        await db.deleteTermDatesBySchoolAndAcademicYear(req.params.schoolId, ay);
      }
    }

    await db.addSchoolTermDates(req.params.schoolId, termDates);

    // Update household_schools metadata
    await db.updateHouseholdSchoolMeta(req.params.schoolId, {
      term_dates_source: 'website_scrape',
      term_dates_last_updated: new Date().toISOString(),
    });

    cache.invalidate(`schools:${req.householdId}`);
    cache.invalidate(`digest:${req.householdId}`);
    return res.json({
      imported: termDates.length,
      message: `Imported ${termDates.length} term date(s) from website.`,
    });
  } catch (err) {
    console.error('POST /api/schools/:id/import-website error:', err);
    return res.status(500).json({ error: `Failed to import from website: ${err.message}` });
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
 * Manual iCal sync — re-fetch and replace all ical_import dates for this school.
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
    const { getUserClient } = require('../db/client');
    const userDb = getUserClient(req.token);
    const { error: deleteErr } = await userDb
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
