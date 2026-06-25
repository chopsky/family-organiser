/**
 * LA term-dates importer.
 *
 * Walks UK local education authorities and, for each, reuses Housemait's proven
 * three-step pipeline:
 *   1. findOfficialTermDatesUrl  - web-search the council's OWN term-dates page
 *   2. fetchTermDatesPageText    - fetch it (SSRF-guarded, browser UA)
 *   3. extractTermDatesPreview   - AI-extract validated dated rows
 *
 * Every authority ends in one of three states, recorded on its la_directory row:
 *   ok      - current academic-year dates were imported
 *   partial - some dates found, but not for the current year (worth a look)
 *   failed  - nothing usable; import_error explains why, so it can be remedied
 *
 * Nothing here is Housemait-household-specific: it writes to the standalone
 * la_directory / la_term_date_entries tables.
 */
const { findOfficialTermDatesUrl, extractTermDatesViaSearch } = require('./ai');
const { fetchTermDatesPageText, extractTermDatesPreview, academicYearsForCountry } = require('./term-date-extract');
const { validateTermDates } = require('./termDateValidator');
const laDb = require('../db/laTermDates');

// Polite + rate-limit-friendly: a handful of councils in flight at once. Each
// authority costs a web search + a page fetch + an ~8k-token extraction, so we
// don't want 183 of those firing simultaneously.
const DEFAULT_CONCURRENCY = 3;

/** Drop exact-duplicate dated rows the extractor may emit for the same entry. */
function dedupeDates(dates) {
  const seen = new Set();
  const out = [];
  for (const d of dates) {
    const key = `${d.academic_year}|${d.event_type}|${d.date}|${d.end_date || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out;
}

/**
 * Import one authority end-to-end and persist the outcome. Always resolves
 * (never throws) with { status, error?, source_url?, dateCount?, method? } so a
 * batch run can't be derailed by one bad council.
 *
 * Two-tier: read the council's own page directly (most trustworthy), and only
 * if that's blocked/empty fall back to search-grounded extraction (recovers the
 * many councils whose pages sit behind a WAF that 403s direct bots but lets
 * search engines through).
 */
async function importAuthority(la, { currentAY, nextAY } = {}) {
  const ays = currentAY && nextAY ? { currentAY, nextAY } : academicYearsForCountry('GB');
  const attemptedAt = new Date().toISOString();
  const attempts = (la.import_attempts || 0) + 1;
  const inYear = (d) => d.academic_year === ays.currentAY || d.academic_year === ays.nextAY;

  try {
    // The official council URL - kept as provenance even when the direct fetch
    // is blocked and we fall back to search. Re-runs reuse the URL we already
    // found (stored on the LA), which skips a whole web_search per authority.
    // A stale/broken cached URL just fails the direct fetch and falls through
    // to the search path below, exactly like a council we have never resolved.
    const url = la.source_url || await findOfficialTermDatesUrl({ localAuthority: la.name, academicYear: ays.currentAY });

    // ── 1) Direct: read the council's own page. ────────────────────────────
    let dates = [];
    let method = null;
    let directError = url ? null : 'No official council term-dates page could be found via web search.';
    if (url) {
      try {
        const pageText = await fetchTermDatesPageText(url);
        const result = await extractTermDatesPreview({ pageText, country: 'GB', currentAY: ays.currentAY, nextAY: ays.nextAY, sourceLabel: url });
        if (result.ok) {
          const found = (result.body.dates || []).filter(inYear);
          if (found.length) { dates = found; method = 'direct'; }
          else directError = 'Found the council page but no term dates were extractable from it.';
        } else {
          directError = result.body?.error || 'The page was read but no structured dates could be extracted.';
        }
      } catch (err) {
        directError = `Found ${url} but could not read it: ${err.message}`;
      }
    }

    // ── 2) Fallback: search-grounded extraction. ───────────────────────────
    if (!dates.length) {
      const searchDates = await extractTermDatesViaSearch({ localAuthority: la.name, academicYears: [ays.currentAY, ays.nextAY] });
      const normalised = searchDates
        .map((d) => ({ ...d, academic_year: d.academic_year || ays.currentAY }))
        .filter(inYear);
      // Same source-quote validation the direct path runs internally.
      const validated = validateTermDates(normalised, normalised.map((d) => d.source_quote || '').join('\n'));
      if (validated.length) { dates = validated; method = 'search'; }
    }

    dates = dedupeDates(dates.filter(inYear));
    if (!dates.length) {
      const error = directError || 'No term dates could be found, by direct fetch or web search.';
      await laDb.updateAuthorityStatus(la.id, { status: 'failed', error, source_url: url || null, import_method: null, last_attempted_at: attemptedAt, import_attempts: attempts });
      return { status: 'failed', error };
    }

    const entries = dates.map((d) => ({
      academic_year: d.academic_year,
      event_type: d.event_type,
      date: d.date,
      end_date: d.end_date || null,
      label: d.label || null,
      source_url: url || null,
    }));
    await laDb.replaceEntriesForLA(la.id, [ays.currentAY, ays.nextAY], entries);

    // 'ok' once we have THIS year's dates. Only next-year (no current) is the
    // genuinely-partial case worth surfacing; current-only is normal (next
    // year often isn't published until spring) and stays 'ok'.
    const haveCurrent = dates.some((d) => d.academic_year === ays.currentAY);
    const status = haveCurrent ? 'ok' : 'partial';
    const note = haveCurrent ? null : `Only ${ays.nextAY} dates were found - ${ays.currentAY} was not available.`;
    await laDb.updateAuthorityStatus(la.id, {
      status,
      error: note,
      source_url: url || null,
      import_method: method,
      date_count: entries.length,
      last_imported_at: new Date().toISOString(),
      last_attempted_at: attemptedAt,
      import_attempts: attempts,
    });
    return { status, source_url: url, dateCount: entries.length, method };
  } catch (err) {
    const error = err.message || 'Unexpected import error.';
    await laDb.updateAuthorityStatus(la.id, { status: 'failed', error, last_attempted_at: attemptedAt, import_attempts: attempts }).catch(() => {});
    return { status: 'failed', error };
  }
}

/**
 * Import many authorities with bounded concurrency, logging an la_import_runs
 * row. Returns the tally. `onlyPending` / `onlyStale` / `slugs` scope the set.
 */
async function importAllAuthorities({
  trigger = 'manual',
  concurrency = DEFAULT_CONCURRENCY,
  onlyPending = false,
  onlyStale = false,
  slugs = null,
} = {}) {
  const authorities = await laDb.listAllAuthorities({ onlyPending, onlyStale, slugs });
  const run = await laDb.createImportRun(trigger);
  const tally = { total: authorities.length, succeeded: 0, partial: 0, failed: 0 };

  if (authorities.length === 0) {
    await laDb.finishImportRun(run.id, { ...tally, notes: 'No authorities matched the run filter.' });
    return { runId: run.id, ...tally };
  }

  const { currentAY, nextAY } = academicYearsForCountry('GB');
  let cursor = 0;
  const worker = async () => {
    while (cursor < authorities.length) {
      const idx = cursor++;
      const la = authorities[idx];
      const res = await importAuthority(la, { currentAY, nextAY });
      if (res.status === 'ok') tally.succeeded += 1;
      else if (res.status === 'partial') tally.partial += 1;
      else tally.failed += 1;
      console.log(
        `[la-import] ${idx + 1}/${authorities.length} ${la.name}: ${res.status}` +
          (res.error ? ` - ${res.error}` : ''),
      );
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, authorities.length) }, worker));
  await laDb.finishImportRun(run.id, tally);
  return { runId: run.id, ...tally };
}

module.exports = { importAuthority, importAllAuthorities, dedupeDates, DEFAULT_CONCURRENCY };
