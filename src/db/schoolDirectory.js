/**
 * Data access for the shared school term-dates directory (directory_schools,
 * directory_school_term_dates + the household_schools.directory_school_id
 * link). Sister module to src/db/laTermDates.js and follows its conventions:
 * service-role client, '*' selects so optional columns degrade gracefully,
 * self-healing writes when a not-yet-migrated column is referenced.
 */
const { supabaseAdmin: supabase } = require('./client');

const SCHOOL_COLUMNS = '*';

// Does this error look like "column doesn't exist yet" (migration not applied)?
// PGRST204 = PostgREST unknown column on write; 42703 = Postgres undefined column.
function isMissingColumnError(error, col) {
  if (!error) return false;
  const msg = `${error.message || ''} ${error.code || ''}`;
  return new RegExp(col, 'i').test(msg) || /PGRST204|42703/.test(msg);
}

// "relation does not exist" (42P01 / PGRST205) - the migration hasn't been
// applied yet. Read paths degrade to empty so the public page and the in-app
// offer render gracefully instead of 500ing pre-migration.
function isMissingTableError(error) {
  if (!error) return false;
  const msg = `${error.message || ''} ${error.code || ''}`;
  return /42P01|PGRST205/.test(msg) || /does not exist/i.test(msg);
}

/**
 * Find a directory school by identity: URN when present (strongest), else the
 * normalized name_key + postcode pair. Returns the row or null.
 */
async function findDirectorySchool({ urn, nameKey, postcode } = {}) {
  if (urn) {
    const { data, error } = await supabase
      .from('directory_schools')
      .select(SCHOOL_COLUMNS)
      .eq('urn', String(urn))
      .maybeSingle();
    if (error) {
      if (isMissingTableError(error)) return null;
      throw error;
    }
    if (data) return data;
  }
  if (nameKey && postcode) {
    const { data, error } = await supabase
      .from('directory_schools')
      .select(SCHOOL_COLUMNS)
      .eq('name_key', nameKey)
      .eq('postcode', postcode)
      .maybeSingle();
    if (error) {
      if (isMissingTableError(error)) return null;
      throw error;
    }
    return data;
  }
  return null;
}

/**
 * Create a directory school. On a unique-constraint race (two households
 * seeding the same school concurrently: 23505) re-find and return the winner
 * with { created: false } so the caller falls through to the cross-check path.
 */
async function createDirectorySchool(fields) {
  const { data, error } = await supabase
    .from('directory_schools')
    .insert(fields)
    .select()
    .single();
  if (!error) return { school: data, created: true };
  if (error.code === '23505') {
    const existing = await findDirectorySchool({
      urn: fields.urn, nameKey: fields.name_key, postcode: fields.postcode,
    });
    if (existing) return { school: existing, created: false };
  }
  throw error;
}

async function getDirectorySchoolDates(directorySchoolId) {
  const { data, error } = await supabase
    .from('directory_school_term_dates')
    .select('academic_year, event_type, date, end_date, label')
    .eq('directory_school_id', directorySchoolId)
    .order('date', { ascending: true });
  if (error) throw error;
  return data || [];
}

/**
 * Replace the stored dates for the given academic years, then insert the new
 * set. Delete-then-insert keeps re-seeds/arbitration updates idempotent
 * (clone of laTermDates.replaceEntriesForLA).
 */
async function replaceDirectoryDates(directorySchoolId, academicYears, entries) {
  const { error: delErr } = await supabase
    .from('directory_school_term_dates')
    .delete()
    .eq('directory_school_id', directorySchoolId)
    .in('academic_year', academicYears);
  if (delErr) throw delErr;

  if (!entries || entries.length === 0) return 0;
  const rows = entries.map((e) => ({
    directory_school_id: directorySchoolId,
    academic_year: e.academic_year,
    event_type: e.event_type,
    date: e.date,
    end_date: e.end_date || null,
    label: e.label || null,
  }));
  const { error: insErr } = await supabase.from('directory_school_term_dates').insert(rows);
  if (insErr) throw insErr;
  return rows.length;
}

/**
 * Update a directory school. Friendly keys → columns; always stamps
 * updated_at. `verified_count_increment` / `adopted_count_increment` do a
 * read-modify-write (fine at this feature's volumes).
 */
async function updateDirectorySchool(id, fields = {}) {
  const update = { updated_at: new Date().toISOString() };
  if (fields.status !== undefined) update.status = fields.status;
  if (fields.source_url !== undefined) update.source_url = fields.source_url;
  if (fields.source_text !== undefined) update.source_text = fields.source_text;
  if (fields.source_type !== undefined) update.source_type = fields.source_type;
  if (fields.urn !== undefined) update.urn = fields.urn;
  if (fields.local_authority !== undefined) update.local_authority = fields.local_authority;
  if (fields.date_count !== undefined) update.date_count = fields.date_count;
  if (fields.verified_count !== undefined) update.verified_count = fields.verified_count;
  if (fields.adopted_count !== undefined) update.adopted_count = fields.adopted_count;
  if (fields.arbitration_note !== undefined) update.arbitration_note = fields.arbitration_note;
  if (fields.last_arbitrated_at !== undefined) update.last_arbitrated_at = fields.last_arbitrated_at;
  if (fields.last_verified_at !== undefined) update.last_verified_at = fields.last_verified_at;
  if (fields.last_imported_at !== undefined) update.last_imported_at = fields.last_imported_at;

  if (fields.verified_count_increment || fields.adopted_count_increment) {
    const { data: row, error: readErr } = await supabase
      .from('directory_schools').select('verified_count, adopted_count').eq('id', id).single();
    if (readErr) throw readErr;
    if (fields.verified_count_increment) update.verified_count = (row.verified_count || 0) + 1;
    if (fields.adopted_count_increment) update.adopted_count = (row.adopted_count || 0) + 1;
  }

  const { error } = await supabase.from('directory_schools').update(update).eq('id', id);
  if (error) throw error;
}

/** Paginated, searchable, alphabetical list for the public Schools tab. */
async function listDirectorySchools({ search, status, page = 1, pageSize = 25 } = {}) {
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safeSize = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 25));
  const from = (safePage - 1) * safeSize;

  let query = supabase
    .from('directory_schools')
    .select(SCHOOL_COLUMNS, { count: 'exact' })
    .order('name', { ascending: true })
    .range(from, from + safeSize - 1);

  if (search && search.trim()) query = query.ilike('name', `%${search.trim()}%`);
  if (status) query = query.eq('status', status);

  const { data, error, count } = await query;
  if (error) {
    if (isMissingTableError(error)) return { rows: [], total: 0, page: safePage, pageSize: safeSize };
    throw error;
  }
  return { rows: data || [], total: count || 0, page: safePage, pageSize: safeSize };
}

async function getDirectorySchoolBySlug(slug) {
  const { data, error } = await supabase
    .from('directory_schools')
    .select(SCHOOL_COLUMNS)
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function getDirectorySchoolById(id) {
  const { data, error } = await supabase
    .from('directory_schools')
    .select(SCHOOL_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Headline counts for the public site's stats row. */
async function getSchoolDirectoryStats() {
  const countWhere = async (build) => {
    let q = supabase.from('directory_schools').select('id', { count: 'exact', head: true });
    q = build(q);
    const { count, error } = await q;
    if (error) throw error;
    return count || 0;
  };
  const [total, ok, needsAttention] = await Promise.all([
    countWhere((q) => q),
    countWhere((q) => q.eq('status', 'ok')),
    countWhere((q) => q.eq('status', 'needs_attention')),
  ]);
  const { count: dateCount } = await supabase
    .from('directory_school_term_dates')
    .select('id', { count: 'exact', head: true });
  return { total, ok, needsAttention, dateCount: dateCount || 0 };
}

/**
 * Household schools following a central record (the propagation fan-out).
 * Self-heals to [] when the link column hasn't been migrated yet.
 */
async function listLinkedHouseholdSchools(directorySchoolId) {
  const { data, error } = await supabase
    .from('household_schools')
    .select('id, household_id')
    .eq('directory_school_id', directorySchoolId);
  if (error) {
    if (isMissingColumnError(error, 'directory_school_id')) return [];
    throw error;
  }
  return data || [];
}

/**
 * Link a household school to its central record. Self-heals to a no-op when
 * the column isn't migrated yet (the rest of the flow still works; the link
 * just isn't recorded until the migration is applied).
 */
async function linkHouseholdSchoolToDirectory(householdSchoolId, directorySchoolId) {
  const { error } = await supabase
    .from('household_schools')
    .update({ directory_school_id: directorySchoolId })
    .eq('id', householdSchoolId);
  if (error && !isMissingColumnError(error, 'directory_school_id')) throw error;
  return !error;
}

/**
 * GIAS URN backfill for manually-entered schools: exact normalized-name match
 * within the postcode's rows. Postcode-first keeps the scan tiny. `normalize`
 * is injected by the service (single source of truth for name normalization).
 */
/**
 * Name-only GIAS match for manual schools with no URN AND no postcode.
 * Deliberately strict: the normalized name must match EXACTLY ONE open school
 * ("Highgate School" ≠ "Highgate Primary School"), else null - never guess.
 */
async function matchGiasByExactNameUnique(nameKey, normalize) {
  if (!nameKey || typeof normalize !== 'function') return null;
  const { data, error } = await supabase
    .from('schools_directory')
    .select('urn, name, postcode, local_authority, status')
    .ilike('name', `%${nameKey.split(' ').join('%')}%`)
    .eq('status', 'open')
    .limit(50);
  if (error) {
    if (isMissingTableError(error)) return null;
    throw error;
  }
  const hits = (data || []).filter((r) => normalize(r.name) === nameKey);
  if (hits.length !== 1) return null;
  return { urn: hits[0].urn, postcode: hits[0].postcode || null, local_authority: hits[0].local_authority || null };
}

async function matchGiasByNamePostcode(nameKey, postcode, normalize) {
  if (!nameKey || !postcode || typeof normalize !== 'function') return null;
  const { data, error } = await supabase
    .from('schools_directory')
    .select('urn, name, local_authority, postcode')
    .eq('postcode', postcode)
    .limit(25);
  if (error) throw error;
  const hit = (data || []).find((r) => normalize(r.name) === nameKey);
  return hit ? { urn: hit.urn, local_authority: hit.local_authority || null } : null;
}

module.exports = {
  findDirectorySchool,
  createDirectorySchool,
  getDirectorySchoolDates,
  replaceDirectoryDates,
  updateDirectorySchool,
  listDirectorySchools,
  getDirectorySchoolBySlug,
  getDirectorySchoolById,
  getSchoolDirectoryStats,
  listLinkedHouseholdSchools,
  linkHouseholdSchoolToDirectory,
  matchGiasByNamePostcode,
  matchGiasByExactNameUnique,
};
