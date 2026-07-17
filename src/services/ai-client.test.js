/**
 * Empty-response guard: a provider returning a 200 with blank text is not a
 * usable completion (Claude occasionally does this on an all-thinking turn),
 * and it surfaced to WhatsApp users as "the AI replied in a format I couldn't
 * read" — parseJSON('') throws "Unexpected end of JSON input". finalizeResult
 * turns that into a tagged, transient error so callWithFailover moves to the
 * next provider instead of returning "".
 *
 * Also covered here: the usage normalizers feeding ai_usage_log token counts,
 * and the block-array system-prompt handling that powers prompt caching
 * (static rules block cached via Anthropic cache_control; Gemini/GPT get the
 * blocks joined so their automatic prefix caches can hit).
 */
const {
  finalizeResult, isTransient,
  systemToText, systemToAnthropic,
  normalizeClaudeUsage, normalizeGeminiUsage, normalizeGptUsage,
  joinTextBlocks,
} = require('./ai-client');

describe('joinTextBlocks - verbatim citation-safe concatenation', () => {
  test('web-search citation splits (mid-sentence blocks) join without inserted newlines', () => {
    // Real shape from the native web_search tool: the cited span is its own
    // block and the closing punctuation opens the NEXT block. join('\n')
    // used to render this as an orphaned ". If you fancy…" line.
    const content = [
      { type: 'text', text: 'Friary Park has ' },
      { type: 'text', text: 'a playground, a skateboard park and a café' },
      { type: 'text', text: '. If you fancy something more active, there is bowling nearby.' },
    ];
    expect(joinTextBlocks(content)).toBe(
      'Friary Park has a playground, a skateboard park and a café. If you fancy something more active, there is bowling nearby.',
    );
  });

  test('model-authored paragraph breaks inside blocks are preserved', () => {
    const content = [
      { type: 'text', text: 'First paragraph.\n\n' },
      { type: 'text', text: 'Second paragraph.' },
    ];
    expect(joinTextBlocks(content)).toBe('First paragraph.\n\nSecond paragraph.');
  });

  test('non-text blocks are ignored; no text blocks returns null', () => {
    const content = [
      { type: 'server_tool_use', name: 'web_search' },
      { type: 'web_search_tool_result', content: [] },
    ];
    expect(joinTextBlocks(content)).toBeNull();
    expect(joinTextBlocks([...content, { type: 'text', text: ' answer ' }])).toBe('answer');
  });
});

describe('finalizeResult - empty-response guard', () => {
  test('returns { text, provider } for a real completion', () => {
    expect(finalizeResult('{"intent":"chat"}', 'claude')).toEqual({
      text: '{"intent":"chat"}',
      provider: 'claude',
      usage: null,
    });
  });

  test('carries normalized usage through when the provider supplies it', () => {
    const usage = { inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 };
    expect(finalizeResult('ok', 'claude', usage).usage).toEqual(usage);
  });

  test.each([
    ['empty string', ''],
    ['whitespace only', '   \n  '],
    ['null', null],
    ['undefined', undefined],
    ['non-string', 42],
  ])('throws a tagged, transient error on %s', (_label, value) => {
    let thrown;
    try { finalizeResult(value, 'claude'); } catch (err) { thrown = err; }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown.emptyResponse).toBe(true);
    // Tagged transient so the Claude→GPT failover path routes it too.
    expect(isTransient(thrown)).toBe(true);
    expect(thrown.message).toMatch(/claude returned an empty response/);
  });
});

describe('usage normalizers', () => {
  test('claude: inputTokens is the TOTAL prompt (uncached + cache read + cache write)', () => {
    expect(normalizeClaudeUsage({
      input_tokens: 500,
      output_tokens: 300,
      cache_read_input_tokens: 13000,
      cache_creation_input_tokens: 0,
    })).toEqual({ inputTokens: 13500, outputTokens: 300, cacheReadTokens: 13000, cacheWriteTokens: 0 });
  });

  test('gemini: thinking tokens fold into output (they are billed as output)', () => {
    expect(normalizeGeminiUsage({
      promptTokenCount: 1000,
      candidatesTokenCount: 200,
      thoughtsTokenCount: 700,
    })).toEqual({ inputTokens: 1000, outputTokens: 900, cacheReadTokens: 0, cacheWriteTokens: 0 });
  });

  test('gpt: prompt/completion naming maps over, cached prefix from details', () => {
    expect(normalizeGptUsage({
      prompt_tokens: 800,
      completion_tokens: 150,
      prompt_tokens_details: { cached_tokens: 512 },
    })).toEqual({ inputTokens: 800, outputTokens: 150, cacheReadTokens: 512, cacheWriteTokens: 0 });
  });

  test.each([
    ['claude', normalizeClaudeUsage],
    ['gemini', normalizeGeminiUsage],
    ['gpt', normalizeGptUsage],
  ])('%s: missing usage metadata → null (never a crash)', (_p, fn) => {
    expect(fn(undefined)).toBeNull();
    expect(fn(null)).toBeNull();
  });
});

describe('block-array system prompts (prompt caching)', () => {
  const blocks = [
    { text: 'STATIC RULES', cache: true },
    { text: 'HOUSEHOLD CONTEXT' },
  ];

  test('systemToText joins blocks for Gemini/GPT and passes strings through', () => {
    expect(systemToText(blocks)).toBe('STATIC RULES\n\nHOUSEHOLD CONTEXT');
    expect(systemToText('plain string')).toBe('plain string');
  });

  test('systemToAnthropic marks ONLY the cache:true block with cache_control', () => {
    expect(systemToAnthropic(blocks)).toEqual([
      { type: 'text', text: 'STATIC RULES', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'HOUSEHOLD CONTEXT' },
    ]);
    // Plain strings stay untouched for every legacy caller.
    expect(systemToAnthropic('plain string')).toBe('plain string');
  });
});
