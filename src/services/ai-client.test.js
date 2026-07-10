/**
 * Empty-response guard: a provider returning a 200 with blank text is not a
 * usable completion (Claude occasionally does this on an all-thinking turn),
 * and it surfaced to WhatsApp users as "the AI replied in a format I couldn't
 * read" — parseJSON('') throws "Unexpected end of JSON input". finalizeResult
 * turns that into a tagged, transient error so callWithFailover moves to the
 * next provider instead of returning "".
 */
const { finalizeResult, isTransient } = require('./ai-client');

describe('finalizeResult - empty-response guard', () => {
  test('returns { text, provider } for a real completion', () => {
    expect(finalizeResult('{"intent":"chat"}', 'claude')).toEqual({
      text: '{"intent":"chat"}',
      provider: 'claude',
    });
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
