/**
 * Public API for the LA term-dates directory.
 *
 *   GET  /api/la-term-dates/stats                  headline counts + last run
 *   GET  /api/la-term-dates/authorities            paginated, searchable, A→Z
 *   GET  /api/la-term-dates/authorities/:slug      one authority + its dates
 *   GET  /api/la-term-dates/failures               the "needs a remedy" list
 *   POST /api/la-term-dates/import                  trigger an import (key-gated)
 *
 * The GETs are public (no PII - just published council dates) and are mounted
 * BEFORE the subscription gate in app.js. The POST is gated by a shared secret
 * (LA_IMPORT_KEY) so only an operator can kick off an import.
 */
const express = require('express');
const router = express.Router();
const laDb = require('../db/laTermDates');
const { importAllAuthorities, importAuthority } = require('../services/laTermDatesImport');

// ── Read endpoints ──────────────────────────────────────────────────────────

router.get('/stats', async (req, res) => {
  try {
    // Councils only - the parent-seeded school records are in-app only (some
    // schools deliberately gate their calendars; we don't republish them).
    res.json(await laDb.getStats());
  } catch (err) {
    console.error('[la-term-dates] stats failed:', err.message);
    res.status(500).json({ error: 'Could not load stats.' });
  }
});

router.get('/authorities', async (req, res) => {
  try {
    const { search, status, region, page, pageSize } = req.query;
    const result = await laDb.listAuthorities({ search, status, region, page, pageSize });
    res.json(result);
  } catch (err) {
    console.error('[la-term-dates] list failed:', err.message);
    res.status(500).json({ error: 'Could not load authorities.' });
  }
});

router.get('/authorities/:slug', async (req, res) => {
  try {
    const authority = await laDb.getAuthorityBySlug(req.params.slug);
    if (!authority) return res.status(404).json({ error: 'Unknown authority.' });
    const entries = await laDb.getEntriesForLA(authority.id);

    // Group dates by academic year for the UI.
    const byYear = {};
    for (const e of entries) {
      (byYear[e.academic_year] ||= []).push(e);
    }
    const academicYears = Object.keys(byYear)
      .sort()
      .map((year) => ({ academic_year: year, dates: byYear[year] }));

    res.json({ authority, academicYears, dateCount: entries.length });
  } catch (err) {
    console.error('[la-term-dates] detail failed:', err.message);
    res.status(500).json({ error: 'Could not load that authority.' });
  }
});

router.get('/failures', async (req, res) => {
  try {
    const { page, pageSize } = req.query;
    const result = await laDb.listAuthorities({ status: 'attention', page, pageSize });
    res.json(result);
  } catch (err) {
    console.error('[la-term-dates] failures failed:', err.message);
    res.status(500).json({ error: 'Could not load the remedy list.' });
  }
});

// The former public /schools endpoints are withdrawn - parent-seeded school
// records are in-app only (some schools gate their calendars deliberately).
// The OPERATOR can still inspect the roster with the import key:
//   GET /api/la-term-dates/schools?key=<LA_IMPORT_KEY>          full rows
//   GET /api/la-term-dates/schools/<slug>?key=<LA_IMPORT_KEY>   record + dates
// Anyone without the key gets 410 + noindex.
router.get(['/schools', '/schools/:slug'], async (req, res) => {
  const expected = process.env.LA_IMPORT_KEY;
  const provided = req.get('x-import-key') || req.query.key;
  if (!expected || provided !== expected) {
    return res.set('X-Robots-Tag', 'noindex').status(410).json({ error: 'School records are no longer public. Access your school\'s dates in the Housemait app.' });
  }
  try {
    const schoolDirDb = require('../db/schoolDirectory');
    res.set('X-Robots-Tag', 'noindex');
    if (req.params.slug) {
      const school = await schoolDirDb.getDirectorySchoolBySlug(req.params.slug);
      if (!school) return res.status(404).json({ error: 'Unknown school.' });
      const dates = await schoolDirDb.getDirectorySchoolDates(school.id);
      return res.json({ school, dates });
    }
    const { search, status, page, pageSize } = req.query;
    return res.json(await schoolDirDb.listDirectorySchools({ search, status, page, pageSize }));
  } catch (err) {
    console.error('[la-term-dates] operator schools view failed:', err.message);
    return res.status(500).json({ error: 'Could not load schools.' });
  }
});

// ── Import trigger (operator-only) ──────────────────────────────────────────

function requireImportKey(req, res, next) {
  const expected = process.env.LA_IMPORT_KEY;
  if (!expected) {
    return res.status(503).json({ error: 'Import trigger is not configured (set LA_IMPORT_KEY).' });
  }
  const provided = req.get('x-import-key') || req.query.key || (req.body && req.body.key);
  if (provided !== expected) {
    return res.status(401).json({ error: 'Invalid or missing import key.' });
  }
  next();
}

router.post('/import', requireImportKey, async (req, res) => {
  const { slug, onlyPending, onlyStale } = req.body || {};

  // Single authority → run synchronously and return the outcome (used by the
  // "Re-import" button on a failed council).
  if (slug) {
    try {
      const la = await laDb.getAuthorityBySlug(slug);
      if (!la) return res.status(404).json({ error: 'Unknown authority.' });
      const result = await importAuthority(la);
      return res.json({ ok: true, slug, ...result });
    } catch (err) {
      console.error('[la-term-dates] single import failed:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  // Full run → fire-and-forget (it takes many minutes); respond immediately.
  res.status(202).json({ ok: true, message: 'Import started. Watch the server logs / stats for progress.' });
  importAllAuthorities({ trigger: 'manual', onlyPending: !!onlyPending, onlyStale: !!onlyStale }).catch((err) =>
    console.error('[la-term-dates] manual import run failed:', err.message),
  );
});

module.exports = router;
