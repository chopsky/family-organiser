/**
 * School search helpers.
 *
 * Extracted from queries.js so the tokenisation + ranking logic can be
 * unit-tested without a live Supabase connection. The DB query in
 * queries.js wires these together:
 *
 *   1. `tokenize(query)` — split the user's input into distinctive words,
 *      dropping English connectives ("in", "of", "the") and generic school
 *      nouns ("school", "academy", "primary") that appear in thousands of
 *      names and wouldn't meaningfully narrow the search.
 *   2. `buildOrFilter(tokens)` — build a PostgREST `or()` clause that
 *      matches any row where any token hits name / local_authority /
 *      address. Deliberately broad; JS filter tightens it.
 *   3. `filterAndRank(rows, tokens)` — keep only rows where every
 *      distinctive token is present somewhere in the combined searchable
 *      text, then rank rows that match entirely on name above rows that
 *      match via LA/address.
 *
 * Fixes the reported bug where "Queen Elizabeth's School in Barnet"
 * returned nothing because the old query did `name.ilike.%<full query>%`
 * and the literal "in Barnet" never appears in the name (it's stored as
 * "Queen Elizabeth's School, Barnet" with a comma, LA is a separate
 * column).
 */

// Strict stopwords: dropped from the tokeniser entirely. Safe because
// these rarely appear in school names or local authorities, so excluding
// them both from the DB filter and the "all tokens must match" check
// prevents false negatives on queries like "X school in Barnet".
const SEARCH_STOPWORDS = new Set([
  // English connectives
  'the', 'a', 'an', 'of', 'in', 'at', 'on', 'for', 'to', 'and', 'or',
  // Generic school nouns (every GIAS record has one; using them as a
  // primary filter returns ~24k matches and drowns the target)
  'school', 'schools', 'academy', 'academies', 'college', 'colleges',
  'primary', 'secondary', 'infant', 'infants', 'junior', 'juniors',
  'nursery', 'nurseries', 'high', 'grammar',
]);

/**
 * Split a query into words suitable for search.
 *
 * Returns:
 *   - allTokens:   every non-empty word (lowercased)
 *   - distinctive: allTokens minus stopwords, with ≥2 chars
 *
 * We split on whitespace AND common punctuation (commas, semicolons,
 * colons) so "Oakwood, Barnet" tokenises cleanly. Apostrophes and hyphens
 * are preserved so "Queen Elizabeth's" matches DB records spelled with
 * the apostrophe intact; parens and dots are stripped.
 */
function tokenize(query) {
  const trimmed = String(query || '').trim();
  if (!trimmed) return { allTokens: [], distinctive: [] };

  const allTokens = trimmed
    .toLowerCase()
    .split(/[\s,;:]+/)
    .map((t) => t.replace(/[().]/g, '').trim())
    .filter(Boolean);

  const distinctive = allTokens.filter(
    (t) => t.length >= 2 && !SEARCH_STOPWORDS.has(t)
  );

  return { allTokens, distinctive };
}

/**
 * Build a PostgREST `or()` filter string that matches any school whose
 * name, local_authority, or address substring-matches any of the given
 * tokens. Uses `*` as the ILIKE wildcard (PostgREST's filter-syntax
 * equivalent of `%`).
 *
 * We strip chars that are special in the filter syntax: commas (clause
 * separators), parens (grouping), asterisks (would become unwanted
 * wildcards). Apostrophes are kept — they URL-encode fine and match DB
 * values that contain them literally.
 */
function buildOrFilter(tokens) {
  const clauses = [];
  for (const raw of tokens) {
    const safe = String(raw).replace(/[,()*]/g, '');
    if (!safe) continue;
    clauses.push(`name.ilike.*${safe}*`);
    clauses.push(`local_authority.ilike.*${safe}*`);
    clauses.push(`address.ilike.*${safe}*`);
  }
  return clauses.join(',');
}

/**
 * Filter rows to those where every required token appears (case-insensitive)
 * in the combined name+LA+address+postcode text, then rank:
 *
 *   Tier 1: every token is in the NAME (user typed the school name)
 *   Tier 2: at least one token matches via LA or address
 *
 * Within each tier, sort alphabetically by name.
 *
 * Row shape: { name, local_authority, address, postcode, ... }
 */
function filterAndRank(rows, requiredTokens) {
  if (!Array.isArray(rows)) return [];
  if (!requiredTokens || requiredTokens.length === 0) return rows;

  const tokensLower = requiredTokens.map((t) => t.toLowerCase());

  const filtered = rows.filter((row) => {
    const hay = [row.name, row.local_authority, row.address, row.postcode]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return tokensLower.every((t) => hay.includes(t));
  });

  filtered.sort((a, b) => {
    const aName = (a.name || '').toLowerCase();
    const bName = (b.name || '').toLowerCase();
    const aNameAll = tokensLower.every((t) => aName.includes(t));
    const bNameAll = tokensLower.every((t) => bName.includes(t));
    if (aNameAll !== bNameAll) return aNameAll ? -1 : 1;
    return (a.name || '').localeCompare(b.name || '');
  });

  return filtered;
}

module.exports = {
  tokenize,
  buildOrFilter,
  filterAndRank,
  SEARCH_STOPWORDS,
};
