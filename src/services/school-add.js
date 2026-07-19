/**
 * School-add orchestration for the WhatsApp bot.
 *
 * The bot's activation opener asks "which school do the kids go to?" - this
 * service turns the answer into a linked school with term dates, reusing the
 * exact primitives the Schools page routes use (GIAS search, the shared LA
 * term-dates directory, the cross-household school directory, and the
 * website/PDF extractor).
 *
 * Trust rules (founder-set, 2026-07-19):
 *   - NEVER auto-match a school by name. Multiple "Queen Elizabeth's" exist;
 *     the caller must show the candidate (full name + address + postcode) and
 *     only call addConfirmedSchool() after an explicit user confirmation.
 *   - NEVER import council dates for a school that may set its own calendar.
 *     Only the explicit LA-maintained GIAS types below take the council path;
 *     academies, free schools and independents go directory-then-ask.
 *     Wrong dates are worse than no dates.
 */

const db = require('../db/queries');
const laDb = require('../db/laTermDates');
const schoolDirDb = require('../db/schoolDirectory');
const schoolDirectory = require('./schoolDirectory');
const cache = require('./cache');
const { findOfficialTermDatesUrl } = require('./ai');
const { extractTermDatesPreview, fetchTermDatesPageText } = require('./term-date-extract');

// GIAS establishment types that are LA-maintained and follow council term
// dates. Deliberately an allowlist: anything unrecognised is treated as
// setting its own calendar (the safe direction).
const LA_MAINTAINED_TYPES = [
  /^community school$/i,
  /^voluntary aided school$/i,
  /^voluntary controlled school$/i,
  /^foundation school$/i,
  /^community special school$/i,
  /^foundation special school$/i,
  /^local authority nursery school$/i,
  /^pupil referral unit$/i,
];

function followsCouncilDates(giasType) {
  const t = String(giasType || '').trim();
  return LA_MAINTAINED_TYPES.some((re) => re.test(t));
}

/**
 * GIAS candidates for a free-text school answer ("Ashfield Primary in
 * Leeds"). Returns up to `limit` rows shaped for confirmation copy.
 */
async function searchGiasCandidates(query, { limit = 5 } = {}) {
  const rows = (await db.searchSchools(String(query || '').trim())) || [];
  return rows.slice(0, limit).map((r) => ({
    urn: r.urn,
    name: r.name,
    type: r.type || null,
    phase: r.phase || null,
    local_authority: r.local_authority || null,
    address: r.address || null,
    postcode: r.postcode || null,
  }));
}

/** One-line human label for a candidate: "Ashfield Primary School - Moor Road, Leeds LS12 3SE". */
function candidateLabel(c) {
  const where = [c.address, c.postcode].filter(Boolean).join(' ');
  return where ? `${c.name} - ${where}` : c.name;
}

/**
 * Council term dates for an LA-maintained school, cheapest source first:
 * shared LA directory -> scrape cache -> live scrape of the council's own
 * page (which then feeds the cache for the next family). Mirrors
 * POST /api/schools/:id/import-la-dates.
 * Returns { imported, years } or throws with a user-safe .userMessage.
 */
async function importCouncilDates(school, householdId, userId) {
  const la = school.local_authority;
  if (!la) {
    const err = new Error('no local authority on school');
    err.userMessage = `I couldn't work out which council sets ${school.school_name}'s dates.`;
    throw err;
  }
  const now = new Date();
  const academicYear = now.getMonth() >= 8
    ? `${now.getFullYear()}-${now.getFullYear() + 1}`
    : `${now.getFullYear() - 1}-${now.getFullYear()}`;
  const nextAY = `${parseInt(academicYear.split('-')[1], 10)}-${parseInt(academicYear.split('-')[1], 10) + 1}`;

  let dates = null;
  const dirDates = await laDb.getDirectoryTermDatesByName(la).catch(() => []);
  if (dirDates.length) dates = dirDates;
  if (!dates) {
    const cached = await db.getCachedLATermDates(la, academicYear).catch(() => null);
    if (cached) dates = cached;
  }
  if (!dates) {
    const sourceUrl = await findOfficialTermDatesUrl({ localAuthority: la, academicYear });
    if (!sourceUrl) {
      const err = new Error(`no term-dates page found for ${la}`);
      err.userMessage = `I couldn't find ${la}'s term-dates page just now.`;
      throw err;
    }
    const pageText = await fetchTermDatesPageText(sourceUrl);
    const result = await extractTermDatesPreview({
      pageText, country: 'GB', currentAY: academicYear, nextAY,
      householdId, userId, sourceLabel: sourceUrl,
    });
    const extracted = (result?.body?.dates || []).filter((d) => [academicYear, nextAY].includes(d.academic_year));
    if (!result?.ok || extracted.length === 0) {
      const err = new Error(`extraction empty for ${la}`);
      err.userMessage = `I found ${la}'s page but couldn't read this year's dates from it.`;
      throw err;
    }
    dates = extracted;
    await db.cacheLATermDates(la, academicYear, dates).catch(() => {});
  }

  const rows = dates.map((d) => ({
    ...d,
    academic_year: d.academic_year || academicYear,
    source: 'local_authority',
  }));
  await db.deleteAllTermDatesBySchool(school.id);
  await db.addSchoolTermDates(school.id, rows);
  await db.updateHouseholdSchoolMeta(school.id, {
    term_dates_source: 'local_authority',
    term_dates_last_updated: new Date().toISOString(),
  });
  cache.invalidate(`schools:${householdId}`);
  cache.invalidate(`digest:${householdId}`);
  return { imported: rows.length, years: [...new Set(rows.map((r) => r.academic_year).filter(Boolean))].sort() };
}

/**
 * Adopt the cross-household directory's dates for an own-calendar school.
 * Mirrors POST /api/schools/:id/adopt-directory-dates. Returns
 * { imported, years } or null when the directory has nothing for it.
 */
async function adoptDirectoryDates(school, householdId) {
  const hit = await schoolDirectory.lookupDirectoryDatesForSchool(school).catch(() => null);
  if (!hit || !(hit.dates || []).length) return null;
  const years = [...new Set(hit.dates.map((d) => d.academic_year))];
  for (const ay of years) {
    await db.deleteTermDatesBySchoolAndAcademicYear(school.id, ay);
  }
  await db.addSchoolTermDates(school.id, hit.dates.map((d) => ({ ...d, source: 'school_directory' })));
  await db.updateHouseholdSchoolMeta(school.id, {
    term_dates_source: 'school_directory',
    term_dates_last_updated: new Date().toISOString(),
  });
  await schoolDirDb.linkHouseholdSchoolToDirectory(school.id, hit.school.id).catch(() => {});
  await schoolDirDb.updateDirectorySchool(hit.school.id, { adopted_count_increment: true }).catch(() => {});
  cache.invalidate(`schools:${householdId}`);
  cache.invalidate(`digest:${householdId}`);
  // Adoption triggers independent re-verification when never/staleley checked.
  schoolDirectory.maybeVerifyDirectorySchool(hit.school);
  return { imported: hit.dates.length, years: years.sort() };
}

/**
 * The user confirmed a specific GIAS candidate. Create (or reuse) the
 * household school and try to fill its term dates.
 *
 * Returns { school, outcome, imported, years } where outcome is:
 *   'la_imported'       - council dates loaded (LA-maintained school)
 *   'directory_adopted' - another family's verified dates adopted
 *   'needs_source'      - own-calendar school, nothing on file: ask the
 *                         user for a photo / link / PDF
 * Import failures on the council path degrade to 'needs_source' rather than
 * throwing - the school itself is always created.
 */
async function addConfirmedSchool({ householdId, userId, gias }) {
  const councilSchool = followsCouncilDates(gias.type);

  let school = gias.urn
    ? await db.getHouseholdSchoolByUrn(householdId, gias.urn).catch(() => null)
    : null;
  if (!school) {
    school = await db.createHouseholdSchool(householdId, {
      school_name: gias.name,
      school_urn: gias.urn || null,
      school_type: gias.type || null,
      local_authority: gias.local_authority || null,
      postcode: gias.postcode || null,
      uses_la_dates: councilSchool,
    });
    cache.invalidate(`schools:${householdId}`);
    cache.invalidate(`digest:${householdId}`);
  }

  if (councilSchool) {
    try {
      const { imported, years } = await importCouncilDates(school, householdId, userId);
      return { school, outcome: 'la_imported', imported, years };
    } catch (err) {
      console.error('[school-add] council import failed:', err.message);
      // School exists; fall through to the ask-for-source path with the
      // friendly reason attached.
      return { school, outcome: 'needs_source', imported: 0, years: [], reason: err.userMessage || null };
    }
  }

  const adopted = await adoptDirectoryDates(school, householdId);
  if (adopted) {
    return { school, outcome: 'directory_adopted', imported: adopted.imported, years: adopted.years };
  }
  return { school, outcome: 'needs_source', imported: 0, years: [] };
}

/**
 * Fetch a school-website (or council) URL the user sent and import the term
 * dates it contains onto `school`. Seeds the cross-household directory so
 * the next family at this school adopts instantly.
 * Returns { imported, years }; throws with .userMessage on any miss.
 */
async function importTermDatesFromUrl({ school, url, householdId, userId }) {
  let pageText;
  try {
    pageText = await fetchTermDatesPageText(url);
  } catch (err) {
    const e = new Error(`fetch failed: ${err.message}`);
    e.userMessage = "I couldn't open that link.";
    throw e;
  }
  const now = new Date();
  const currentAY = now.getMonth() >= 8
    ? `${now.getFullYear()}-${now.getFullYear() + 1}`
    : `${now.getFullYear() - 1}-${now.getFullYear()}`;
  const nextAY = `${parseInt(currentAY.split('-')[1], 10)}-${parseInt(currentAY.split('-')[1], 10) + 1}`;
  const result = await extractTermDatesPreview({
    pageText, country: 'GB', currentAY, nextAY,
    householdId, userId, sourceLabel: url,
  });
  const dates = result?.body?.dates || [];
  if (!result?.ok || dates.length === 0) {
    const e = new Error('no dates extracted from url');
    e.userMessage = "I opened it, but couldn't find term dates on that page.";
    throw e;
  }
  const rows = dates.map((d) => ({
    event_type: d.event_type,
    date: d.date,
    end_date: d.end_date || null,
    label: d.label || null,
    academic_year: d.academic_year || currentAY,
    source: 'whatsapp_import',
  })).filter((r) => r.event_type && r.date);
  for (const ay of [...new Set(rows.map((r) => r.academic_year))]) {
    await db.deleteTermDatesBySchoolAndAcademicYear(school.id, ay).catch(() => {});
  }
  await db.addSchoolTermDates(school.id, rows);
  await db.updateHouseholdSchoolMeta(school.id, {
    term_dates_source: 'whatsapp_import',
    term_dates_last_updated: new Date().toISOString(),
  }).catch(() => {});
  cache.invalidate(`schools:${householdId}`);
  cache.invalidate(`digest:${householdId}`);
  // Fire-and-forget: this family's import becomes the directory seed for the
  // next family at the same school. A directory failure never fails the user.
  try {
    schoolDirectory.seedOrCrossCheck({
      householdSchool: { ...school, term_dates_source: 'whatsapp_import' },
      dates: rows,
      sourceType: 'website',
      sourceUrl: url,
      householdId,
    });
  } catch { /* seeding is best-effort */ }
  return { imported: rows.length, years: [...new Set(rows.map((r) => r.academic_year))].sort() };
}

module.exports = {
  followsCouncilDates,
  searchGiasCandidates,
  candidateLabel,
  addConfirmedSchool,
  importTermDatesFromUrl,
  // exported for tests
  importCouncilDates,
  adoptDirectoryDates,
  LA_MAINTAINED_TYPES,
};
