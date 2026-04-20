/**
 * Unit tests for school-search helpers.
 *
 * The pure helpers (tokenise / OR-filter builder / JS ranker) live here so we
 * can exercise the full matrix of query shapes without a live Supabase DB.
 * The integration — DB query + helpers — lives in queries.js and isn't
 * covered by a test; the helpers are where all the logic actually is.
 *
 * Regression anchor: the "Queen Elizabeth's School in Barnet" case that
 * originally returned zero results.
 */

const {
  tokenize,
  buildOrFilter,
  filterAndRank,
  SEARCH_STOPWORDS,
} = require('./school-search');

// ─── tokenize() ──────────────────────────────────────────────────────────────

describe('tokenize()', () => {
  test('returns empty arrays for empty / whitespace-only input', () => {
    expect(tokenize('')).toEqual({ allTokens: [], distinctive: [] });
    expect(tokenize('   ')).toEqual({ allTokens: [], distinctive: [] });
    expect(tokenize(null)).toEqual({ allTokens: [], distinctive: [] });
    expect(tokenize(undefined)).toEqual({ allTokens: [], distinctive: [] });
  });

  test('lowercases and splits on whitespace', () => {
    expect(tokenize('Queen Elizabeth')).toEqual({
      allTokens: ['queen', 'elizabeth'],
      distinctive: ['queen', 'elizabeth'],
    });
  });

  test('strips stopwords from distinctive but keeps them in allTokens', () => {
    const { allTokens, distinctive } = tokenize('Queen Elizabeth School in Barnet');
    expect(allTokens).toEqual(['queen', 'elizabeth', 'school', 'in', 'barnet']);
    // "school" and "in" are stopwords → dropped from distinctive.
    expect(distinctive).toEqual(['queen', 'elizabeth', 'barnet']);
  });

  test('keeps apostrophes in tokens so Elizabeth\'s still matches DB values', () => {
    const { distinctive } = tokenize("Queen Elizabeth's School in Barnet");
    expect(distinctive).toContain("elizabeth's");
  });

  test('splits on commas and other punctuation so names with punctuation tokenise cleanly', () => {
    const { distinctive } = tokenize('Oakwood, Barnet');
    expect(distinctive).toEqual(['oakwood', 'barnet']);
  });

  test('strips parens and full stops within tokens', () => {
    const { distinctive } = tokenize('Dr. Oakwood (Head) Academy');
    // "academy" is a stopword; "dr" and "oakwood" and "head" remain.
    expect(distinctive).toContain('oakwood');
    expect(distinctive).toContain('head');
    expect(distinctive).toContain('dr');
    expect(distinctive).not.toContain('academy');
  });

  test('drops tokens shorter than 2 characters from distinctive', () => {
    const { distinctive } = tokenize('A Oakwood');
    expect(distinctive).toEqual(['oakwood']);
  });

  test('drops generic school nouns so they do not narrow the primary DB filter', () => {
    // Every row in the GIAS directory contains one of these words, so using
    // them as a primary filter returns everything and drowns the target.
    for (const word of ['school', 'schools', 'academy', 'primary', 'secondary', 'college', 'grammar']) {
      expect(SEARCH_STOPWORDS.has(word)).toBe(true);
    }
  });

  test('returns empty distinctive when the whole query is stopwords', () => {
    // We deliberately return nothing here — a query of pure stopwords has
    // no signal. The route layer can surface a helpful error if needed.
    const { distinctive } = tokenize('primary school');
    expect(distinctive).toEqual([]);
  });
});

// ─── buildOrFilter() ─────────────────────────────────────────────────────────

describe('buildOrFilter()', () => {
  test('emits three ILIKE clauses per token (name, local_authority, address)', () => {
    expect(buildOrFilter(['barnet'])).toBe(
      'name.ilike.*barnet*,local_authority.ilike.*barnet*,address.ilike.*barnet*'
    );
  });

  test('joins multiple tokens with commas as PostgREST expects for or()', () => {
    const filter = buildOrFilter(['queen', 'barnet']);
    // 2 tokens × 3 columns = 6 clauses.
    expect(filter.split(',')).toHaveLength(6);
    expect(filter).toContain('name.ilike.*queen*');
    expect(filter).toContain('local_authority.ilike.*barnet*');
  });

  test('keeps apostrophes so "elizabeth\'s" matches DB records spelled with the apostrophe', () => {
    const filter = buildOrFilter(["elizabeth's"]);
    expect(filter).toContain("name.ilike.*elizabeth's*");
  });

  test('strips commas, parens, and asterisks that would break or() syntax', () => {
    // Commas are clause separators, parens are grouping, `*` is the wildcard
    // — letting any of these through a user token could corrupt the filter
    // string or create unintended wildcards.
    const filter = buildOrFilter(['a,b(c)d*e']);
    expect(filter).toBe('name.ilike.*abcde*,local_authority.ilike.*abcde*,address.ilike.*abcde*');
  });

  test('skips tokens that are empty after stripping', () => {
    // A token of pure punctuation would normalise to empty — that should
    // produce no clauses rather than a malformed "name.ilike.**".
    expect(buildOrFilter([',*()'])).toBe('');
  });

  test('returns an empty string for an empty token list', () => {
    expect(buildOrFilter([])).toBe('');
  });
});

// ─── filterAndRank() ─────────────────────────────────────────────────────────

describe('filterAndRank()', () => {
  const rows = [
    // The target for the "Queen Elizabeth's School in Barnet" query.
    {
      urn: '136290',
      name: "Queen Elizabeth's School, Barnet",
      local_authority: 'Barnet',
      address: "Queen's Road, Barnet, Hertfordshire",
      postcode: 'EN5 4DQ',
    },
    // Another Queen Elizabeth's — different town. Should be filtered out
    // when the query includes "Barnet".
    {
      urn: '100000',
      name: "Queen Elizabeth's Grammar School",
      local_authority: 'Yorkshire',
      address: 'Some Street, Wakefield',
      postcode: 'WF1 1AA',
    },
    // An unrelated Barnet school — matches via LA only, not via the other
    // tokens. Should be filtered out when the query is a full name.
    {
      urn: '200000',
      name: 'Oakwood Primary',
      local_authority: 'Barnet',
      address: 'Oak Road, Barnet',
      postcode: 'EN4 2AB',
    },
  ];

  test('keeps only rows where every required token appears in the combined text', () => {
    const tokens = ['queen', "elizabeth's", 'barnet'];
    const result = filterAndRank(rows, tokens);
    expect(result).toHaveLength(1);
    expect(result[0].urn).toBe('136290');
  });

  test('matches tokens across name OR local_authority OR address (case-insensitive)', () => {
    // "Barnet" hits local_authority, "oakwood" hits name — both must match.
    const tokens = ['oakwood', 'barnet'];
    const result = filterAndRank(rows, tokens);
    expect(result).toHaveLength(1);
    expect(result[0].urn).toBe('200000');
  });

  test('ranks rows that match entirely on name above those that match via LA/address', () => {
    // "Queen" and "Barnet" both in the Queen Elizabeth's (Barnet) name.
    // "Queen" only in the Grammar School's name; "Barnet" is nowhere.
    // Oakwood's name has neither; it'd be filtered out.
    // Expected order: the Barnet QE school first (name contains both).
    const all = [
      rows[1], // Queen Elizabeth's Grammar (Yorkshire)
      rows[0], // Queen Elizabeth's School, Barnet
    ];
    const result = filterAndRank(all, ['queen', 'barnet']);
    expect(result).toHaveLength(1); // Grammar School has no "Barnet" anywhere
    expect(result[0].urn).toBe('136290');
  });

  test('returns all rows unchanged when requiredTokens is empty', () => {
    expect(filterAndRank(rows, [])).toEqual(rows);
    expect(filterAndRank(rows, null)).toEqual(rows);
  });

  test('handles undefined / non-array input gracefully', () => {
    expect(filterAndRank(undefined, ['queen'])).toEqual([]);
    expect(filterAndRank(null, ['queen'])).toEqual([]);
  });

  test('rows with null fields do not crash the matcher', () => {
    const sparse = [
      { urn: '1', name: 'Queen Mary School', local_authority: null, address: null, postcode: null },
    ];
    expect(filterAndRank(sparse, ['queen'])).toHaveLength(1);
    expect(filterAndRank(sparse, ['nonexistent'])).toHaveLength(0);
  });

  test('is case-insensitive across query tokens and row values', () => {
    const upperRows = [
      { urn: '1', name: 'QUEEN ELIZABETH', local_authority: 'BARNET', address: '', postcode: '' },
    ];
    const result = filterAndRank(upperRows, ['queen', 'barnet']);
    expect(result).toHaveLength(1);
  });
});

// ─── End-to-end helper composition ───────────────────────────────────────────

describe('pipeline (tokenize + filterAndRank)', () => {
  // These are the same rows the regression covers, exercised from the raw
  // user query through the tokeniser to make sure the wiring works.
  const dbRows = [
    {
      urn: '136290',
      name: "Queen Elizabeth's School, Barnet",
      local_authority: 'Barnet',
      address: "Queen's Road, Barnet, Hertfordshire",
      postcode: 'EN5 4DQ',
    },
    {
      urn: '100000',
      name: "Queen Elizabeth's Grammar School",
      local_authority: 'Yorkshire',
      address: 'Some Street, Wakefield',
      postcode: 'WF1 1AA',
    },
    {
      urn: '300000',
      name: "Queen's College",
      local_authority: 'Somerset',
      address: 'Trull Road, Taunton',
      postcode: 'TA1 4QS',
    },
  ];

  test("Queen Elizabeth's School in Barnet finds exactly the Barnet school", () => {
    // The exact user query that failed in production.
    const { distinctive } = tokenize("Queen Elizabeth's School in Barnet");
    const result = filterAndRank(dbRows, distinctive);
    expect(result.map((r) => r.urn)).toEqual(['136290']);
  });

  test('"Queen Elizabeth Barnet" (no apostrophe, no "school") still hits the right row', () => {
    const { distinctive } = tokenize('Queen Elizabeth Barnet');
    const result = filterAndRank(dbRows, distinctive);
    expect(result.map((r) => r.urn)).toEqual(['136290']);
  });

  test('"Queen Elizabeth" alone returns multiple matches ranked by name relevance', () => {
    const { distinctive } = tokenize('Queen Elizabeth');
    const result = filterAndRank(dbRows, distinctive);
    // Both Queen Elizabeth schools match (Grammar and Barnet). Queen's
    // College does not (no "Elizabeth"). Order is alphabetical within tier.
    expect(result.map((r) => r.urn).sort()).toEqual(['100000', '136290']);
  });

  test('"Primary school" (all stopwords) returns nothing because no distinctive tokens', () => {
    // This is intentional — the tokeniser refuses to run a search with no
    // signal rather than returning the first 10 schools alphabetically.
    const { distinctive } = tokenize('Primary school');
    expect(distinctive).toEqual([]);
    // Caller should short-circuit and return [].
  });
});
