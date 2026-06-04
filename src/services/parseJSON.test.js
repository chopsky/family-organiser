// parseJSON pulls in callWithFailover/prompts at module load - stub the heavy
// deps so the pure parser is testable in isolation.
jest.mock('./ai-client', () => ({ callWithFailover: jest.fn(), LONG_TIMEOUT_MS: 1, REASONING_TIMEOUT_MS: 1 }));

const { parseJSON } = require('./ai');

describe('parseJSON', () => {
  test('parses clean JSON', () => {
    expect(parseJSON('{"a":1,"events":[]}', 'test')).toEqual({ a: 1, events: [] });
  });

  test('strips markdown fences', () => {
    expect(parseJSON('```json\n{"ok":true}\n```', 'test')).toEqual({ ok: true });
  });

  test('repairs trailing commas', () => {
    expect(parseJSON('{"events":[{"t":1},]}', 'test')).toEqual({ events: [{ t: 1 }] });
  });

  test('salvages a TRUNCATED response - keeps the complete events', () => {
    // Output cut off mid-way through the third event (unterminated string).
    const truncated = '{"type":"event","events":['
      + '{"title":"Cricket","date":"2026-06-08"},'
      + '{"title":"Drama","date":"2026-06-15"},'
      + '{"title":"Debat';
    const out = parseJSON(truncated, 'image scan');
    expect(out.type).toBe('event');
    expect(out.events).toEqual([
      { title: 'Cricket', date: '2026-06-08' },
      { title: 'Drama', date: '2026-06-15' },
    ]);
  });

  test('salvages a truncated email-extraction list', () => {
    const truncated = '{"email_type":"other","events":['
      + '{"title":"Grant\'s Birthday","date":"2027-01-26"},'
      + '{"title":"Tanur\'s Birthday","date":"2027-01-23"},'
      + '{"title":"Solly';
    const out = parseJSON(truncated, 'email extraction');
    expect(out.events.length).toBe(2);
    expect(out.events[1].title).toBe("Tanur's Birthday");
  });

  test('throws when nothing is recoverable', () => {
    expect(() => parseJSON('not json at all', 'test')).toThrow(/Failed to parse/);
  });
});
