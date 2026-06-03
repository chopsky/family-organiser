jest.mock('../db/queries', () => ({
  getActiveDeviceTokens: jest.fn(),
  getNotificationPreferences: jest.fn(),
  getHouseholdDeviceTokens: jest.fn(),
  unregisterDeviceToken: jest.fn(),
}));

const { _isEnvironmentMismatch } = require('./push');

describe('isEnvironmentMismatch (APNs environment retry decision)', () => {
  test('retries on the explicit environment reasons', () => {
    expect(_isEnvironmentMismatch('{"reason":"BadEnvironmentKeyInToken"}')).toBe(true);
    expect(_isEnvironmentMismatch('{"reason":"BadCertificateEnvironment"}')).toBe(true);
  });

  test('retries on BadDeviceToken (token-auth env mismatch surfaces this way)', () => {
    expect(_isEnvironmentMismatch('{"reason":"BadDeviceToken"}')).toBe(true);
  });

  test('does NOT retry on unrelated errors', () => {
    expect(_isEnvironmentMismatch('{"reason":"Unregistered"}')).toBe(false);
    expect(_isEnvironmentMismatch('{"reason":"PayloadTooLarge"}')).toBe(false);
    expect(_isEnvironmentMismatch('{"reason":"TopicDisallowed"}')).toBe(false);
    expect(_isEnvironmentMismatch('')).toBe(false);
    expect(_isEnvironmentMismatch(null)).toBe(false);
  });
});
