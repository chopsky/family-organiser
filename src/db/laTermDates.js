/**
 * Data access for the LA term-dates directory (la_directory,
 * la_term_date_entries, la_import_runs).
 *
 * Kept separate from the monolithic src/db/queries.js because it's a
 * self-contained feature with its own tables. Uses the service-role client,
 * the same as the rest of the backend.
 */
const { supabaseAdmin: supabase } = require('./client');

// '*' (rather than an explicit list) so the read path degrades gracefully when
// the optional import_method column hasn't been migrated in yet - it's simply
// absent from the row instead of erroring the whole query.
const AUTHORITY_COLUMNS = '*';

// How long before an LA's data is considered stale and eligible for a refresh
// run. The monthly cron re-imports everything regardless; this is for the
// "onlyStale" manual/partial runs.
const STALE_AFTER_DAYS = 25;

// Give up auto-retrying a council after this many failed attempts. The ones
// that fail repeatedly are almost always structurally impossible (no LA-wide
// calendar, JS-only page), and retrying them on every --stale run just burns
// web_search credit. They stay visible under "Need attention" and can still be
// retried explicitly by slug. See docs/la-term-dates-directory.md.
const MAX_IMPORT_ATTEMPTS = 3;

/**
 * Paginated, searchable, alphabetical list of authorities.
 * `status` accepts the four enum values, or the synthetic 'attention' which
 * means "failed OR partial" (the remedy list).
 */
async function listAuthorities({ search, status, region, page = 1, pageSize = 25 } = {}) {
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safeSize = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 25));
  const from = (safePage - 1) * safeSize;

  let query = supabase
    .from('la_directory')
    .select(AUTHORITY_COLUMNS, { count: 'exact' })
    .order('name', { ascending: true })
    .range(from, from + safeSize - 1);

  if (search && search.trim()) query = query.ilike('name', `%${search.trim()}%`);
  if (region) query = query.eq('region', region);
  if (status === 'attention') query = query.in('import_status', ['failed', 'partial']);
  else if (status) query = query.eq('import_status', status);

  const { data, error, count } = await query;
  if (error) throw error;
  return { rows: data || [], total: count || 0, page: safePage, pageSize: safeSize };
}

async function getAuthorityBySlug(slug) {
  const { data, error } = await supabase
    .from('la_directory')
    .select(AUTHORITY_COLUMNS)
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function getEntriesForLA(laId) {
  const { data, error } = await supabase
    .from('la_term_date_entries')
    .select('academic_year, event_type, date, end_date, label, source_url')
    .eq('la_id', laId)
    .order('date', { ascending: true });
  if (error) throw error;
  return data || [];
}

/**
 * Look up an authority by the name stored on household_schools.local_authority
 * (the GIAS "LA (name)" string, which the directory is keyed by too) and return
 * its term-date entries for the given academic year(s) - ready to drop into a
 * school. `academicYears` may be a single string or an array (the importer
 * pulls both the current and next year). Case-insensitive exact name match;
 * only authorities with usable data (ok/partial) count. Returns [] when the LA
 * isn't in the directory or has no dates for those years yet, so the caller can
 * fall back to the live scrape. This is how Housemait's "Import from local
 * authority" reads the directory.
 */
async function getDirectoryTermDatesByName(localAuthority, academicYears) {
  const years = (Array.isArray(academicYears) ? academicYears : [academicYears]).filter(Boolean);
  if (!localAuthority || !years.length) return [];
  const { data: la, error: laErr } = await supabase
    .from('la_directory')
    .select('id, name, import_status')
    .ilike('name', localAuthority.trim()) // no wildcards = case-insensitive equality
    .in('import_status', ['ok', 'partial'])
    .maybeSingle();
  if (laErr) throw laErr;
  if (!la) return [];

  const { data, error } = await supabase
    .from('la_term_date_entries')
    .select('academic_year, event_type, date, end_date, label')
    .eq('la_id', la.id)
    .in('academic_year', years)
    .order('date', { ascending: true });
  if (error) throw error;
  return data || [];
}

/** Headline counts for the dashboard + the latest run. */
async function getStats() {
  const countWhere = async (build) => {
    let q = supabase.from('la_directory').select('id', { count: 'exact', head: true });
    q = build(q);
    const { count, error } = await q;
    if (error) throw error;
    return count || 0;
  };

  const [total, ok, partial, failed, pending] = await Promise.all([
    countWhere((q) => q),
    countWhere((q) => q.eq('import_status', 'ok')),
    countWhere((q) => q.eq('import_status', 'partial')),
    countWhere((q) => q.eq('import_status', 'failed')),
    countWhere((q) => q.eq('import_status', 'pending')),
  ]);

  const { count: dateCount } = await supabase
    .from('la_term_date_entries')
    .select('id', { count: 'exact', head: true });

  const lastRun = await getLatestRun();
  return { total, ok, partial, failed, pending, dateCount: dateCount || 0, lastRun };
}

/**
 * Replace every stored date for an LA within the given academic years, then
 * insert the freshly extracted set. Delete-then-insert (the same approach the
 * school iCal sync uses) keeps re-imports idempotent without needing a
 * composite unique constraint.
 */
async function replaceEntriesForLA(laId, academicYears, entries) {
  const { error: delErr } = await supabase
    .from('la_term_date_entries')
    .delete()
    .eq('la_id', laId)
    .in('academic_year', academicYears);
  if (delErr) throw delErr;

  if (!entries || entries.length === 0) return 0;
  const rows = entries.map((e) => ({
    la_id: laId,
    academic_year: e.academic_year,
    event_type: e.event_type,
    date: e.date,
    end_date: e.end_date || null,
    label: e.label || null,
    source_url: e.source_url || null,
  }));
  const { error: insErr } = await supabase.from('la_term_date_entries').insert(rows);
  if (insErr) throw insErr;
  return rows.length;
}

/**
 * Update an authority's import outcome. Accepts friendly keys
 * (status/error) and maps them to columns; always stamps updated_at.
 */
async function updateAuthorityStatus(laId, fields = {}) {
  const update = { updated_at: new Date().toISOString() };
  if (fields.status !== undefined) update.import_status = fields.status;
  if (fields.import_method !== undefined) update.import_method = fields.import_method;
  if (fields.error !== undefined) update.import_error = fields.error;
  if (fields.source_url !== undefined) update.source_url = fields.source_url;
  if (fields.date_count !== undefined) update.date_count = fields.date_count;
  if (fields.last_imported_at !== undefined) update.last_imported_at = fields.last_imported_at;
  if (fields.last_attempted_at !== undefined) update.last_attempted_at = fields.last_attempted_at;
  if (fields.import_attempts !== undefined) update.import_attempts = fields.import_attempts;

  let { error } = await supabase.from('la_directory').update(update).eq('id', laId);
  // Self-heal if an optional column hasn't been migrated in yet (import_method
  // and import_attempts both post-date the base table): strip the offending
  // column and retry, so a long import run still records each authority's
  // status instead of failing wholesale.
  for (const col of ['import_method', 'import_attempts']) {
    if (error && col in update && new RegExp(col, 'i').test(error.message || '')) {
      delete update[col];
      ({ error } = await supabase.from('la_directory').update(update).eq('id', laId));
    }
  }
  if (error) throw error;
}

/**
 * Authorities to run an import over. Default: all. `slugs` restricts to a set;
 * `onlyPending` to never-imported; `onlyStale` to never-imported or older than
 * STALE_AFTER_DAYS.
 */
async function listAllAuthorities({ onlyPending = false, onlyStale = false, slugs = null } = {}) {
  // source_url + import_attempts are selected so the importer can reuse a known
  // council URL (skipping a web_search) and count attempts. import_attempts is
  // newer than the base table, so we degrade gracefully if it isn't migrated.
  const build = (withAttempts) => {
    const cols = withAttempts
      ? 'id, name, slug, import_status, source_url, import_attempts'
      : 'id, name, slug, import_status, source_url';
    let query = supabase.from('la_directory').select(cols).order('name', { ascending: true });
    if (slugs && slugs.length) query = query.in('slug', slugs);
    if (onlyPending) query = query.eq('import_status', 'pending');
    if (onlyStale) {
      const cutoff = new Date(Date.now() - STALE_AFTER_DAYS * 86400000).toISOString();
      // Stale = never succeeded, or last success older than the window...
      query = query.or(`last_imported_at.is.null,last_imported_at.lt.${cutoff}`);
      // ...but stop auto-retrying councils that have failed too many times.
      if (withAttempts) query = query.or(`import_status.neq.failed,import_attempts.lt.${MAX_IMPORT_ATTEMPTS}`);
    }
    return query;
  };

  let { data, error } = await build(true);
  if (error && /import_attempts/i.test(error.message || '')) {
    ({ data, error } = await build(false)); // column not migrated yet
  }
  if (error) throw error;
  return data || [];
}

async function createImportRun(trigger = 'manual') {
  const { data, error } = await supabase
    .from('la_import_runs')
    .insert({ trigger })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function finishImportRun(runId, { total = 0, succeeded = 0, partial = 0, failed = 0, notes = null } = {}) {
  const { error } = await supabase
    .from('la_import_runs')
    .update({ finished_at: new Date().toISOString(), total, succeeded, partial, failed, notes })
    .eq('id', runId);
  if (error) throw error;
}

async function getLatestRun() {
  const { data, error } = await supabase
    .from('la_import_runs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

module.exports = {
  STALE_AFTER_DAYS,
  listAuthorities,
  getAuthorityBySlug,
  getEntriesForLA,
  getDirectoryTermDatesByName,
  getStats,
  replaceEntriesForLA,
  updateAuthorityStatus,
  listAllAuthorities,
  createImportRun,
  finishImportRun,
  getLatestRun,
};
