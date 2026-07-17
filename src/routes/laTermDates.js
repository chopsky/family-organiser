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
const schoolDirDb = require('../db/schoolDirectory');
const { importAllAuthorities, importAuthority } = require('../services/laTermDatesImport');

// Public projection of a directory school - ONLY aggregate, non-household
// fields. Never expose household ids, source_text, or arbitration internals.
function publicSchool(s) {
  return {
    name: s.name,
    postcode: s.postcode,
    local_authority: s.local_authority,
    slug: s.slug,
    status: s.status,
    verified_count: s.verified_count,
    adopted_count: s.adopted_count || 0,
    date_count: s.date_count,
    source_type: s.source_type,
    last_imported_at: s.last_imported_at,
    last_verified_at: s.last_verified_at || null,
  };
}

// ── Read endpoints ──────────────────────────────────────────────────────────

router.get('/stats', async (req, res) => {
  try {
    const stats = await laDb.getStats();
    // Additive: parent-seeded independent-schools section. Self-heal to null
    // when the directory_schools migration hasn't been applied yet.
    stats.schools = await schoolDirDb.getSchoolDirectoryStats().catch(() => null);
    res.json(stats);
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

// ── Schools (parent-seeded shared records) ─────────────────────────────────

router.get('/schools', async (req, res) => {
  try {
    const { search, status, page, pageSize } = req.query;
    const result = await schoolDirDb.listDirectorySchools({ search, status, page, pageSize });
    res.json({ ...result, rows: result.rows.map(publicSchool) });
  } catch (err) {
    console.error('[la-term-dates] schools list failed:', err.message);
    res.status(500).json({ error: 'Could not load schools.' });
  }
});

router.get('/schools/:slug', async (req, res) => {
  try {
    const school = await schoolDirDb.getDirectorySchoolBySlug(req.params.slug);
    if (!school) return res.status(404).json({ error: 'Unknown school.' });
    const entries = await schoolDirDb.getDirectorySchoolDates(school.id);

    const byYear = {};
    for (const e of entries) {
      (byYear[e.academic_year] ||= []).push(e);
    }
    const academicYears = Object.keys(byYear)
      .sort()
      .map((year) => ({ academic_year: year, dates: byYear[year] }));

    res.json({ school: publicSchool(school), academicYears, dateCount: entries.length });
  } catch (err) {
    console.error('[la-term-dates] school detail failed:', err.message);
    res.status(500).json({ error: 'Could not load that school.' });
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
