/**
 * normaliseImageData strips a data-URI prefix the vision APIs reject. The iOS
 * app sent "data:image/jpeg;base64,/9j/4AA..." straight through, and both
 * Claude and Gemini 400'd on "invalid base64 data" - every iOS photo recipe
 * import failed. Raw base64 (web app, WhatsApp media) must pass untouched.
 */
const { normaliseImageData } = require('./image-data');

describe('normaliseImageData', () => {
  test('strips a data:image/jpeg;base64, prefix and keeps the raw base64', () => {
    const r = normaliseImageData('data:image/jpeg;base64,/9j/4AAQSkZJRg==');
    expect(r).toEqual({ data: '/9j/4AAQSkZJRg==', mediaType: 'image/jpeg' });
  });

  test('lifts the media type out of the URI (png overrides the default)', () => {
    const r = normaliseImageData('data:image/png;base64,iVBORw0KGgo=', 'image/jpeg');
    expect(r).toEqual({ data: 'iVBORw0KGgo=', mediaType: 'image/png' });
  });

  test('handles extra params before base64 (charset etc.)', () => {
    const r = normaliseImageData('data:image/webp;charset=utf-8;base64,UklGRg==');
    expect(r).toEqual({ data: 'UklGRg==', mediaType: 'image/webp' });
  });

  test('a data URI with no media type falls back to the caller default', () => {
    const r = normaliseImageData('data:;base64,QUJD', 'image/heic');
    expect(r).toEqual({ data: 'QUJD', mediaType: 'image/heic' });
  });

  test('raw base64 passes through untouched (web / WhatsApp media)', () => {
    const raw = '/9j/4AAQSkZJRgABAQAAAQABAAD';
    expect(normaliseImageData(raw)).toEqual({ data: raw, mediaType: 'image/jpeg' });
    expect(normaliseImageData(raw, 'image/png')).toEqual({ data: raw, mediaType: 'image/png' });
  });

  test('trims incidental whitespace/newlines around the payload', () => {
    expect(normaliseImageData('  data:image/jpeg;base64,QUJD  ').data).toBe('QUJD');
    expect(normaliseImageData('\nQUJD\n').data).toBe('QUJD');
  });

  test('non-string input is returned as-is with the fallback type (no throw)', () => {
    expect(normaliseImageData(undefined)).toEqual({ data: undefined, mediaType: 'image/jpeg' });
    expect(normaliseImageData(null, 'image/png')).toEqual({ data: null, mediaType: 'image/png' });
  });

  test('a base64 string that merely contains "base64," is not mistaken for a prefix', () => {
    // Only a leading data: URI is stripped; "base64," mid-string is left alone.
    const r = normaliseImageData('c29tZWJhc2U2NCxkYXRh');
    expect(r.data).toBe('c29tZWJhc2U2NCxkYXRh');
  });
});
