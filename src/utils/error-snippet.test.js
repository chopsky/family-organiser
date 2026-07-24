const { shortenError } = require('./error-snippet');

describe('shortenError', () => {
  test('lifts the message out of an Anthropic-style "400 {json}" error', () => {
    const raw = '400 {"type":"error","error":{"type":"invalid_request_error","message":"messages.0.content.0.image.source.base64: invalid base64 data"},"request_id":"req_x"}';
    expect(shortenError(raw)).toBe('400 messages.0.content.0.image.source.base64: invalid base64 data');
  });

  test('lifts the message out of a Gemini-style nested error', () => {
    const raw = '{"error":{"code":400,"message":"API key not valid","status":"INVALID_ARGUMENT"}}';
    expect(shortenError(raw)).toBe('API key not valid');
  });

  test('the 64KB base64-echo error is capped to a readable length (never dumps the payload)', () => {
    // Gemini echoes the entire image in its message field.
    const huge = 'data:image/jpeg;base64,' + '/9j/4AAU'.repeat(9000); // ~72KB
    const raw = `{"error":{"code":400,"message":"Base64 decoding failed for \\"${huge}\\""}}`;
    const out = shortenError(raw);
    expect(out.length).toBeLessThanOrEqual(201); // 200 + the ellipsis
    expect(out.startsWith('Base64 decoding failed for')).toBe(true);
    expect(out.endsWith('…')).toBe(true);
  });

  test('collapses whitespace/newlines', () => {
    expect(shortenError('timeout   after\n30000ms')).toBe('timeout after 30000ms');
  });

  test('plain (non-JSON) errors pass through, truncated if long', () => {
    expect(shortenError('fetch failed')).toBe('fetch failed');
    expect(shortenError('x'.repeat(500)).endsWith('…')).toBe(true);
  });

  test('null / empty in → null out', () => {
    expect(shortenError(null)).toBeNull();
    expect(shortenError(undefined)).toBeNull();
    expect(shortenError('')).toBe('');
  });
});
