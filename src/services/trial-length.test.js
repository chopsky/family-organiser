/**
 * Version-aware trial length. The promise lives in the app binary, so the
 * server must honour whatever the asking client actually says on screen.
 */
const {
  TRIAL_DAYS, LEGACY_TRIAL_DAYS, parseVersion, trialDaysForRequest, trialEndsAtFor,
} = require('./trial-length');

/** Minimal Express-request stand-in. */
const reqWith = (headers) => ({
  get: (name) => headers[name.toLowerCase()] ?? null,
});

describe('parseVersion', () => {
  test('reads the marketing version out of an app-version header', () => {
    expect(parseVersion('1.12.0 (30)')).toEqual([1, 12, 0]);
    expect(parseVersion('1.13.0')).toEqual([1, 13, 0]);
    expect(parseVersion('2.0')).toEqual([2, 0, 0]);
  });
  test('junk and absence are unparseable', () => {
    expect(parseVersion('')).toBeNull();
    expect(parseVersion(null)).toBeNull();
    expect(parseVersion('unknown')).toBeNull();
  });
});

describe('trialDaysForRequest', () => {
  test('web always gets the current trial', () => {
    expect(trialDaysForRequest(reqWith({ 'x-client-platform': 'web' }))).toBe(TRIAL_DAYS);
    expect(trialDaysForRequest(reqWith({}))).toBe(TRIAL_DAYS);
    expect(trialDaysForRequest(null)).toBe(TRIAL_DAYS);
  });

  test('app builds whose copy still promises 30 days receive 30', () => {
    for (const v of ['1.11.0 (29)', '1.12.0 (30)', '1.9.4']) {
      expect(trialDaysForRequest(reqWith({ 'x-client-platform': 'ios', 'x-app-version': v })))
        .toBe(LEGACY_TRIAL_DAYS);
    }
  });

  test('app builds carrying the new copy receive the new trial', () => {
    for (const v of ['1.13.0 (31)', '1.14.2', '2.0.0']) {
      expect(trialDaysForRequest(reqWith({ 'x-client-platform': 'android', 'x-app-version': v })))
        .toBe(TRIAL_DAYS);
    }
  });

  test('a native client with no readable version gets the LONGER trial', () => {
    // The version header resolves asynchronously at app start, so a fast
    // signup can race it. Over-delivering is the only safe way to be wrong.
    expect(trialDaysForRequest(reqWith({ 'x-client-platform': 'ios' }))).toBe(LEGACY_TRIAL_DAYS);
    expect(trialDaysForRequest(reqWith({ 'x-client-platform': 'ios', 'x-app-version': 'beta' })))
      .toBe(LEGACY_TRIAL_DAYS);
  });
});

describe('paywallRequiredForRequest (MOTHBALLED - free-app model)', () => {
  const { paywallRequiredForRequest } = require('./trial-length');

  test('nobody is walled, on any platform or build - the standing decision', () => {
    expect(paywallRequiredForRequest(reqWith({ 'x-client-platform': 'ios', 'x-app-version': '1.13.0 (34)' }))).toBe(false);
    expect(paywallRequiredForRequest(reqWith({ 'x-client-platform': 'ios', 'x-app-version': '2.0.0' }))).toBe(false);
    expect(paywallRequiredForRequest(reqWith({ 'x-client-platform': 'web' }))).toBe(false);
    expect(paywallRequiredForRequest(reqWith({ 'x-client-platform': 'android', 'x-app-version': '1.13.0' }))).toBe(false);
    expect(paywallRequiredForRequest(null)).toBe(false);
  });
});

describe('trialEndsAtFor', () => {
  test('lands the requested number of days ahead', () => {
    const now = Date.parse('2026-09-01T09:00:00.000Z');
    expect(trialEndsAtFor(14, now)).toBe('2026-09-15T09:00:00.000Z');
    expect(trialEndsAtFor(30, now)).toBe('2026-10-01T09:00:00.000Z');
  });
});
