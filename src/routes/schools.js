const { Router } = require('express');
const ical = require('node-ical');
const db = require('../db/queries');
const { callWithFailover } = require('../services/ai-client');
const { requireAuth, requireAdmin, requireHousehold } = require('../middleware/auth');

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
    const schools = await db.getHouseholdSchools(req.householdId);
    const members = await db.getHouseholdMembers(req.householdId);

    // Enrich each school with its children and term dates
    const enriched = await Promise.all(schools.map(async (school) => {
      const children = members.filter(m => m.school_id === school.id);
      const termDates = await db.getSchoolTermDates(school.id);

      // Get activities for each child at this school
      const childrenWithActivities = await Promise.all(children.map(async (child) => {
        const activities = await db.getChildActivities(child.id);
        return { ...child, activities };
      }));

      return { ...school, children: childrenWithActivities, term_dates: termDates };
    }));

    return res.json({ schools: enriched });
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
router.delete('/:id', requireAuth, requireHousehold, requireAdmin, async (req, res) => {
  try {
    await db.deleteHouseholdSchool(req.params.id, req.householdId);
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

    if (termDates.length > 0) {
      await db.addSchoolTermDates(req.params.schoolId, termDates);
    }

    // Save iCal URL on the school
    await db.updateHouseholdSchool(req.params.schoolId, { ical_url: ical_url.trim() });

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
    return res.json({ school: updated });
  } catch (err) {
    console.error('PATCH /api/schools/:id error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
