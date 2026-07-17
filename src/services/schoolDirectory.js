/**
 * Shared school term-dates directory - the cross-household store for schools
 * that don't follow council dates (independent schools, custom calendars).
 *
 * Life cycle:
 *   1. SEED - the first parent's reviewed website/PDF import creates the
 *      central record (seedOrCrossCheck, called fire-and-forget from the
 *      import-website confirm route; a directory failure never fails the
 *      household's own import).
 *   2. ADOPT - later parents at the same school import the stored dates in
 *      one tap with zero AI calls (lookupDirectoryDatesForSchool + the
 *      adopt route), which links their school for propagation.
 *   3. VERIFY - adopting parents won't re-import, so the SYSTEM is the
 *      second checker: on adoption of a never-verified or stale (>90d)
 *      record, verifyDirectorySchool re-fetches the source and re-extracts
 *      once, diffing against the record (maybeVerifyDirectorySchool gates).
 *   4. ARBITRATE - when a fresh import (or system verification) disagrees
 *      with the record, ONE grounded AI call decides which set matches the
 *      school's published dates; the winner is applied.
 *   5. PROPAGATE - central updates fan out to every linked household so all
 *      parents at a school always hold identical dates.
 *
 * Identity: GIAS URN when the parent picked the school from search;
 * otherwise normalized name + postcode (no postcode + no URN = unlinkable,
 * skipped). Manual entries get a GIAS URN backfill attempt at seed time.
 */
const dirDb = require('../db/schoolDirectory');
const db = require('../db/queries');
const cache = require('./cache');
const { callClaude, REASONING_TIMEOUT_MS } = require('./ai-client');
const { fetchTermDatesPageText, extractTermDatesPreview, academicYearsForCountry } = require('./term-date-extract');

// Re-verify cadence: how long a system verification is trusted before the next
// adoption triggers a fresh check. Roughly once a term, matching the LA cache.
const VERIFY_STALE_DAYS = 90;
const SOURCE_TEXT_CAP = 16000;
const ARBITRATION_TEXT_CAP = 12000;

// ── Pure helpers (exported for tests) ───────────────────────────────────────

/** "St. Mary's C of E Primary!" → "st mary s c of e primary" */
function normalizeNameKey(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '') // strip diacritics
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "ha8 0np" / "HA80NP" → "HA8 0NP"-style: uppercase, single internal space. */
function normalizePostcode(pc) {
  const compact = String(pc || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!compact) return null;
  // UK postcodes: inward code is always the last 3 chars. Non-UK/short values
  // are left compact.
  if (compact.length > 3) return `${compact.slice(0, -3)} ${compact.slice(-3)}`;
  return compact;
}

/**
 * A household school's cross-household identity, or null when it can't be
 * safely linked (no URN and no postcode - name alone is too collision-prone).
 */
function schoolIdentity(school) {
  if (!school) return null;
  const urn = school.school_urn ? String(school.school_urn).trim() : null;
  const nameKey = normalizeNameKey(school.school_name || school.name);
  const postcode = normalizePostcode(school.postcode);
  if (!nameKey) return null;
  // No URN and no postcode: identity may still be resolvable via a unique
  // GIAS name match (async, in resolveIdentity) - so return the name-only
  // shape and let callers that can do the lookup decide.
  return { urn: urn || null, nameKey, postcode };
}

/**
 * Resolve a household school to a linkable identity, backfilling from GIAS
 * when the row is missing its URN: by name+postcode when a postcode exists,
 * else by EXACT-unique name. Optionally heals the household row. Returns the
 * identity (urn/nameKey/postcode) or null when it cannot be safely resolved.
 */
async function resolveIdentity(householdSchool, { heal = false } = {}) {
  const identity = schoolIdentity(householdSchool);
  if (!identity) return null;
  if (identity.urn) return identity;

  const gias = identity.postcode
    ? await dirDb.matchGiasByNamePostcode(identity.nameKey, identity.postcode, normalizeNameKey).catch(() => null)
    : await dirDb.matchGiasByExactNameUnique(identity.nameKey, normalizeNameKey).catch(() => null);
  if (gias?.urn) {
    identity.urn = String(gias.urn);
    if (!identity.postcode && gias.postcode) identity.postcode = normalizePostcode(gias.postcode);
    if (heal) {
      await db.updateHouseholdSchool(householdSchool.id, {
        school_urn: identity.urn,
        ...(gias.postcode && !householdSchool.postcode ? { postcode: gias.postcode } : {}),
        ...(gias.local_authority && !householdSchool.local_authority ? { local_authority: gias.local_authority } : {}),
      }).catch(() => {});
    }
  }
  // Without a URN, a bare name is too collision-prone to key a shared record.
  if (!identity.urn && !identity.postcode) return null;
  return identity;
}

/** Stable comparison key for one dated entry (same shape as dedupeDates). */
function dateSetKey(d) {
  return `${d.academic_year}|${d.event_type}|${d.date}|${d.end_date || ''}`;
}

function groupByYear(dates) {
  const by = new Map();
  for (const d of dates || []) {
    if (!d || !d.academic_year) continue;
    if (!by.has(d.academic_year)) by.set(d.academic_year, new Set());
    by.get(d.academic_year).add(dateSetKey(d));
  }
  return by;
}

/**
 * Compare a new import against the stored record, per academic year.
 *   conflicts  - AYs present in BOTH sets whose entries differ
 *   additions  - AYs only the NEW set has (new info, e.g. next year published)
 *   identical  - no conflicts AND no additions
 * AYs only the STORED set has are never conflicts (the new import simply
 * didn't cover them - e.g. last year's dates still on file).
 */
function diffDateSets(storedDates, newDates) {
  const stored = groupByYear(storedDates);
  const fresh = groupByYear(newDates);
  const conflicts = [];
  const additions = [];
  for (const [ay, freshKeys] of fresh) {
    const storedKeys = stored.get(ay);
    if (!storedKeys) { additions.push(ay); continue; }
    const same = storedKeys.size === freshKeys.size && [...freshKeys].every((k) => storedKeys.has(k));
    if (!same) conflicts.push(ay);
  }
  return { identical: conflicts.length === 0 && additions.length === 0, conflicts, additions };
}

function slugFor(name, postcode) {
  const part = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return [part(name), part(postcode)].filter(Boolean).join('-') || 'school';
}

function cleanEntries(dates) {
  return (dates || [])
    .filter((d) => d && d.academic_year && d.event_type && d.date)
    .map((d) => ({
      academic_year: d.academic_year,
      event_type: d.event_type,
      date: d.date,
      end_date: d.end_date || null,
      label: d.label || null,
    }));
}

// ── Seeding + cross-check ───────────────────────────────────────────────────

/**
 * Called after a household's website/PDF import is confirmed. Never throws -
 * the household's own import must be untouched by directory problems.
 * Returns { action: 'skipped'|'seeded'|'confirmed'|'augmented'|'arbitrating' }.
 */
async function seedOrCrossCheck({ householdSchool, dates, sourceUrl, sourceText, sourceType, householdId, country = 'GB' }) {
  try {
    const identity = await resolveIdentity(householdSchool, { heal: true });
    if (!identity) return { action: 'skipped', reason: 'no resolvable identity (no URN, no postcode, no unique GIAS name match)' };

    const entries = cleanEntries(dates);
    if (entries.length === 0) return { action: 'skipped', reason: 'no valid dates' };
    const years = [...new Set(entries.map((e) => e.academic_year))];
    const nowIso = new Date().toISOString();

    const existing = await dirDb.findDirectorySchool(identity);

    if (!existing) {
      const { school: created } = await dirDb.createDirectorySchool({
        urn: identity.urn,
        name: householdSchool.school_name || householdSchool.name,
        name_key: identity.nameKey,
        postcode: identity.postcode,
        slug: slugFor(householdSchool.school_name || householdSchool.name, identity.postcode),
        local_authority: householdSchool.local_authority || null,
        country,
        status: 'ok',
        source_type: sourceType === 'pdf' ? 'pdf' : 'website',
        source_url: sourceUrl || null,
        source_text: sourceText ? String(sourceText).slice(0, SOURCE_TEXT_CAP) : null,
        verified_count: 1,
        date_count: entries.length,
        last_imported_at: nowIso,
      }).catch(async (err) => {
        // Slug-only collision (identity re-find missed): retry once suffixed.
        if (err?.code === '23505') {
          return dirDb.createDirectorySchool({
            urn: identity.urn,
            name: householdSchool.school_name || householdSchool.name,
            name_key: identity.nameKey,
            postcode: identity.postcode,
            slug: `${slugFor(householdSchool.school_name || householdSchool.name, identity.postcode)}-${Date.now().toString(36).slice(-4)}`,
            local_authority: householdSchool.local_authority || null,
            country,
            status: 'ok',
            source_type: sourceType === 'pdf' ? 'pdf' : 'website',
            source_url: sourceUrl || null,
            source_text: sourceText ? String(sourceText).slice(0, SOURCE_TEXT_CAP) : null,
            verified_count: 1,
            date_count: entries.length,
            last_imported_at: nowIso,
          });
        }
        throw err;
      });
      await dirDb.replaceDirectoryDates(created.id, years, entries);
      await dirDb.linkHouseholdSchoolToDirectory(householdSchool.id, created.id);
      console.log(`[school-directory] Seeded "${created.name}" (${entries.length} dates) from household ${householdId}`);
      return { action: 'seeded', directorySchoolId: created.id };
    }

    // Existing record - link this household (they're at this school) and diff.
    const alreadyLinked = householdSchool.directory_school_id === existing.id;
    await dirDb.linkHouseholdSchoolToDirectory(householdSchool.id, existing.id);
    const storedDates = await dirDb.getDirectorySchoolDates(existing.id);
    const diff = diffDateSets(storedDates, entries);

    if (diff.identical) {
      // Independent import matching the record = genuine verification.
      await dirDb.updateDirectorySchool(existing.id, {
        ...(alreadyLinked ? {} : { verified_count_increment: true }),
        last_imported_at: nowIso,
      });
      return { action: 'confirmed', directorySchoolId: existing.id };
    }

    if (diff.conflicts.length === 0) {
      // Pure additions (e.g. next year now published) - no disagreement to
      // arbitrate. Apply the new years, corroborated by the matching overlap.
      await dirDb.replaceDirectoryDates(existing.id, diff.additions, entries.filter((e) => diff.additions.includes(e.academic_year)));
      const total = await dirDb.getDirectorySchoolDates(existing.id);
      await dirDb.updateDirectorySchool(existing.id, {
        ...(alreadyLinked ? {} : { verified_count_increment: true }),
        date_count: total.length,
        source_url: sourceUrl || existing.source_url,
        source_text: sourceText ? String(sourceText).slice(0, SOURCE_TEXT_CAP) : existing.source_text,
        source_type: sourceType === 'pdf' ? 'pdf' : (sourceUrl ? 'website' : existing.source_type),
        last_imported_at: nowIso,
      });
      await propagateDirectorySchoolDates(existing.id);
      return { action: 'augmented', directorySchoolId: existing.id, additions: diff.additions };
    }

    // Genuine disagreement - arbitrate in the background. The importing
    // household already has its own dates saved; arbitration will pull
    // everyone (including them) to whichever set is right.
    arbitrate({
      directorySchool: existing,
      storedDates,
      newDates: entries,
      newSource: { url: sourceUrl || null, text: sourceText || null, type: sourceType || 'website' },
      conflictYears: diff.conflicts,
      additions: diff.additions,
    }).catch((err) => console.error('[school-directory] arbitration failed:', err.message));
    return { action: 'arbitrating', directorySchoolId: existing.id, conflicts: diff.conflicts };
  } catch (err) {
    console.error('[school-directory] seedOrCrossCheck failed:', err.message);
    return { action: 'skipped', reason: err.message };
  }
}

// ── Arbitration ─────────────────────────────────────────────────────────────

function parseArbitrationVerdict(text) {
  try {
    const cleaned = (text || '').replace(/```(?:json)?\s*/gi, '').replace(/```\s*/g, '').trim();
    const first = cleaned.indexOf('{');
    const last = cleaned.lastIndexOf('}');
    if (first === -1 || last <= first) return null;
    const parsed = JSON.parse(cleaned.slice(first, last + 1));
    return Array.isArray(parsed?.years) ? parsed.years : null;
  } catch {
    return null;
  }
}

/**
 * ONE grounded AI call deciding, per conflicted academic year, whether the
 * stored record or the new import matches the school's official published
 * dates. Ground truth: a server-side re-fetch of the stored source when
 * possible (client-supplied text can't poison the record), else the stored
 * snapshot (PDF); the new side uses the forwarded page text.
 */
async function arbitrate({ directorySchool, storedDates, newDates, newSource, conflictYears, additions = [] }) {
  const nowIso = new Date().toISOString();

  // Grounding texts. Stored side: prefer a fresh server-side fetch.
  let storedText = directorySchool.source_text || '';
  if (directorySchool.source_url && /^https?:\/\//i.test(directorySchool.source_url)) {
    storedText = await fetchTermDatesPageText(directorySchool.source_url)
      .catch(() => directorySchool.source_text || '');
  }
  let newText = newSource.text || '';
  if (!newText && newSource.url && /^https?:\/\//i.test(newSource.url)) {
    newText = await fetchTermDatesPageText(newSource.url).catch(() => '');
  }

  const disputedStored = storedDates.filter((d) => conflictYears.includes(d.academic_year));
  const disputedNew = newDates.filter((d) => conflictYears.includes(d.academic_year));

  const system = `You are auditing school term dates. Two independent imports for the SAME school disagree. For each disputed academic year, decide which date-set matches the school's OFFICIAL published dates.

RULES:
- Ground EVERY decision in a verbatim quote from the source texts provided below. NEVER use prior knowledge or "typical" dates.
- If the texts indicate publication or update dates, newer official data wins.
- If a year's dates cannot be verified from the provided texts, the winner is "undecidable".

Return ONLY JSON, no prose:
{"years":[{"academic_year":"YYYY-YYYY","winner":"stored"|"new"|"undecidable","reason":"one sentence","evidence_quote":"verbatim snippet or null"}]}`;

  const user = `SCHOOL: ${directorySchool.name}${directorySchool.postcode ? ` (${directorySchool.postcode})` : ''}
DISPUTED YEARS: ${conflictYears.join(', ')}

=== STORED SOURCE (imported ${directorySchool.last_imported_at || 'earlier'}, ${directorySchool.source_type || 'unknown'}${directorySchool.source_url ? `, ${directorySchool.source_url}` : ''}) ===
${(storedText || '(no source text available)').slice(0, ARBITRATION_TEXT_CAP)}

=== NEW SOURCE (imported now, ${newSource.type}${newSource.url ? `, ${newSource.url}` : ''}) ===
${(newText || '(no source text available)').slice(0, ARBITRATION_TEXT_CAP)}

=== SET A - STORED record (disputed years only) ===
${JSON.stringify(disputedStored)}

=== SET B - NEW import (disputed years only) ===
${JSON.stringify(disputedNew)}`;

  let verdictYears = null;
  try {
    const { text } = await callClaude({
      system,
      messages: [{ role: 'user', content: user }],
      maxTokens: 4096,
      timeoutMs: REASONING_TIMEOUT_MS,
    });
    verdictYears = parseArbitrationVerdict(text);
  } catch (err) {
    console.warn('[school-directory] arbitration AI call failed:', err.message);
  }

  if (!verdictYears) {
    await dirDb.updateDirectorySchool(directorySchool.id, {
      status: 'needs_attention',
      arbitration_note: `Arbitration could not produce a verdict for ${conflictYears.join(', ')} - imports disagree.`,
      last_arbitrated_at: nowIso,
    });
    return { outcome: 'undecidable' };
  }

  const newWins = [];
  const storedWins = [];
  const undecidable = [];
  for (const ay of conflictYears) {
    const v = verdictYears.find((y) => y && y.academic_year === ay);
    if (v?.winner === 'new') newWins.push(ay);
    else if (v?.winner === 'stored') storedWins.push(ay);
    else undecidable.push(ay);
  }
  const reasons = verdictYears
    .filter((y) => y && y.reason)
    .map((y) => `${y.academic_year}: ${y.winner} - ${y.reason}`)
    .join(' | ')
    .slice(0, 900);

  if (undecidable.length > 0 && newWins.length === 0) {
    // Nothing decidable in the new set's favour and at least one open
    // question: leave the record alone, flag it, no propagation - the
    // importing parent keeps their own dates locally.
    await dirDb.updateDirectorySchool(directorySchool.id, {
      status: 'needs_attention',
      arbitration_note: `Undecidable for ${undecidable.length} year(s). ${reasons}`,
      last_arbitrated_at: nowIso,
    });
    return { outcome: 'undecidable', undecidable };
  }

  // Apply new-set wins (and any pure additions that rode along).
  const yearsToApply = [...newWins, ...additions];
  if (yearsToApply.length > 0) {
    await dirDb.replaceDirectoryDates(
      directorySchool.id,
      yearsToApply,
      newDates.filter((e) => yearsToApply.includes(e.academic_year)),
    );
  }
  const total = await dirDb.getDirectorySchoolDates(directorySchool.id);
  await dirDb.updateDirectorySchool(directorySchool.id, {
    status: undecidable.length > 0 ? 'needs_attention' : 'ok',
    ...(newWins.length > 0
      ? {
          // The record materially changed: old verifications no longer
          // describe the current data.
          verified_count: 1,
          source_url: newSource.url || directorySchool.source_url,
          source_text: newSource.text ? String(newSource.text).slice(0, SOURCE_TEXT_CAP) : directorySchool.source_text,
          source_type: newSource.type === 'pdf' ? 'pdf' : (newSource.url ? 'website' : directorySchool.source_type),
          last_imported_at: nowIso,
        }
      : {}),
    date_count: total.length,
    arbitration_note: reasons || `Resolved: ${newWins.length} year(s) to the new import, ${storedWins.length} kept.`,
    last_arbitrated_at: nowIso,
  });

  // Propagate the canonical outcome to every linked household - including
  // the divergent importer, who gets pulled back when the stored set won.
  await propagateDirectorySchoolDates(directorySchool.id);
  return { outcome: 'resolved', newWins, storedWins, undecidable };
}

// ── System verification (the "second parent" no human will be) ─────────────

/**
 * Fire-and-forget from the adopt route when the record has never been
 * system-verified or the last check is stale. Cheap no-op gating lives in
 * maybeVerifyDirectorySchool; this does the actual work: re-fetch the
 * source, ONE fresh extraction, diff, and arbitrate on divergence.
 */
async function verifyDirectorySchool(directorySchoolId) {
  const school = await dirDb.getDirectorySchoolById(directorySchoolId);
  if (!school) return { action: 'skipped', reason: 'not found' };
  // PDF-seeded records have no re-fetchable source: they stay seed-verified
  // until a parent re-imports. (The UI labels them "from PDF".)
  if (school.source_type !== 'website' || !school.source_url || !/^https?:\/\//i.test(school.source_url)) {
    return { action: 'skipped', reason: 'no re-fetchable source' };
  }

  const nowIso = new Date().toISOString();
  let pageText;
  try {
    pageText = await fetchTermDatesPageText(school.source_url);
  } catch (err) {
    // Don't retry-hammer a dead page: stamp the attempt, note it, move on.
    await dirDb.updateDirectorySchool(directorySchoolId, {
      last_verified_at: nowIso,
      arbitration_note: `System verification could not read ${school.source_url}: ${err.message}`,
    }).catch(() => {});
    return { action: 'failed', reason: err.message };
  }

  const { currentAY, nextAY } = academicYearsForCountry(school.country || 'GB');
  let extracted = [];
  try {
    const result = await extractTermDatesPreview({
      pageText,
      country: school.country || 'GB',
      currentAY,
      nextAY,
      sourceLabel: school.source_url,
    });
    if (result.ok) extracted = cleanEntries(result.body?.dates || []);
  } catch (err) {
    await dirDb.updateDirectorySchool(directorySchoolId, {
      last_verified_at: nowIso,
      arbitration_note: `System verification extraction failed: ${err.message}`,
    }).catch(() => {});
    return { action: 'failed', reason: err.message };
  }
  if (extracted.length === 0) {
    await dirDb.updateDirectorySchool(directorySchoolId, {
      last_verified_at: nowIso,
      arbitration_note: 'System verification found no extractable dates on the source page.',
    }).catch(() => {});
    return { action: 'failed', reason: 'no dates extracted' };
  }

  const storedDates = await dirDb.getDirectorySchoolDates(directorySchoolId);
  const diff = diffDateSets(storedDates, extracted);

  if (diff.identical) {
    await dirDb.updateDirectorySchool(directorySchoolId, {
      verified_count_increment: true,
      last_verified_at: nowIso,
      arbitration_note: 'System verification matched the stored dates.',
    });
    console.log(`[school-directory] Verified "${school.name}" - matches source`);
    return { action: 'verified' };
  }

  if (diff.conflicts.length === 0) {
    // The source now publishes additional years - fold them in.
    await dirDb.replaceDirectoryDates(directorySchoolId, diff.additions, extracted.filter((e) => diff.additions.includes(e.academic_year)));
    const total = await dirDb.getDirectorySchoolDates(directorySchoolId);
    await dirDb.updateDirectorySchool(directorySchoolId, {
      verified_count_increment: true,
      date_count: total.length,
      last_verified_at: nowIso,
      arbitration_note: `System verification matched + added ${diff.additions.join(', ')}.`,
    });
    await propagateDirectorySchoolDates(directorySchoolId);
    return { action: 'verified', additions: diff.additions };
  }

  // The source disagrees with the record - same arbitration path as a
  // divergent parent import, with the fresh fetch as the "new" side.
  const res = await arbitrate({
    directorySchool: school,
    storedDates,
    newDates: extracted,
    newSource: { url: school.source_url, text: pageText, type: 'website' },
    conflictYears: diff.conflicts,
    additions: diff.additions,
  });
  await dirDb.updateDirectorySchool(directorySchoolId, { last_verified_at: nowIso }).catch(() => {});
  return { action: 'arbitrated', result: res };
}

/** Gate + fire verifyDirectorySchool when due. Never throws. */
function maybeVerifyDirectorySchool(school) {
  try {
    if (!school?.id) return false;
    const last = school.last_verified_at ? new Date(school.last_verified_at).getTime() : 0;
    const due = !last || (Date.now() - last) > VERIFY_STALE_DAYS * 86400000;
    if (!due) return false;
    verifyDirectorySchool(school.id)
      .catch((err) => console.error('[school-directory] verification failed:', err.message));
    return true;
  } catch {
    return false;
  }
}

// ── Propagation ─────────────────────────────────────────────────────────────

/**
 * Push the central record's dates to every linked household school so all
 * parents at the school hold identical dates. Per-AY delete-then-insert for
 * the years the directory holds; per-household soft failure (one broken
 * household must not block the rest). Silent in v1 (no broadcast).
 */
async function propagateDirectorySchoolDates(directorySchoolId) {
  const entries = await dirDb.getDirectorySchoolDates(directorySchoolId);
  if (entries.length === 0) return { updated: 0 };
  const years = [...new Set(entries.map((e) => e.academic_year))];
  const linked = await dirDb.listLinkedHouseholdSchools(directorySchoolId);
  let updated = 0;

  for (const hs of linked) {
    try {
      for (const ay of years) {
        await db.deleteTermDatesBySchoolAndAcademicYear(hs.id, ay);
      }
      await db.addSchoolTermDates(hs.id, entries.map((e) => ({ ...e, source: 'school_directory' })));
      await db.updateHouseholdSchoolMeta(hs.id, {
        term_dates_source: 'school_directory',
        term_dates_last_updated: new Date().toISOString(),
      });
      cache.invalidate(`schools:${hs.household_id}`);
      cache.invalidate(`digest:${hs.household_id}`);
      updated += 1;
    } catch (err) {
      console.error(`[school-directory] propagation failed for household school ${hs.id}:`, err.message);
    }
  }
  if (updated > 0) console.log(`[school-directory] Propagated ${entries.length} dates to ${updated} household(s)`);
  return { updated };
}

// ── Adoption read ───────────────────────────────────────────────────────────

/**
 * The offer shown on the import screen: does the directory hold usable dates
 * for this household's school? Returns { school, dates } or null. Only 'ok'
 * records are offered (needs_attention ones shouldn't spread).
 */
async function lookupDirectoryDatesForSchool(householdSchool) {
  const identity = await resolveIdentity(householdSchool);
  if (!identity) return null;
  const school = await dirDb.findDirectorySchool(identity);
  if (!school || school.status !== 'ok') return null;
  const dates = await dirDb.getDirectorySchoolDates(school.id);
  if (dates.length === 0) return null;
  return { school, dates };
}

module.exports = {
  VERIFY_STALE_DAYS,
  normalizeNameKey,
  normalizePostcode,
  schoolIdentity,
  resolveIdentity,
  dateSetKey,
  diffDateSets,
  slugFor,
  cleanEntries,
  seedOrCrossCheck,
  arbitrate,
  verifyDirectorySchool,
  maybeVerifyDirectorySchool,
  propagateDirectorySchoolDates,
  lookupDirectoryDatesForSchool,
};
