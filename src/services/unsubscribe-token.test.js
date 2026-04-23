/**
 * Unit tests for the unsubscribe token helpers (Phase 7).
 *
 * Exercises the sign→verify round trip, tampering resistance, and
 * expiry handling. JWT library is real — we're testing our wrapping.
 */

process.env.UNSUBSCRIBE_TOKEN_SECRET = 'test-unsub-secret-phase-7';

const jwt = require('jsonwebtoken');
const { signToken, verifyToken, unsubscribeUrl } = require('./unsubscribe-token');

describe('unsubscribe-token', () => {
  test('sign + verify round-trip returns the original household_id', () => {
    const token = signToken('hh-123');
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3); // JWT has three parts
    expect(verifyToken(token)).toBe('hh-123');
  });

  test('rejects a token signed with a different secret (tampering)', () => {
    const bad = jwt.sign({ hid: 'hh-attacker' }, 'wrong-secret', {
      issuer: 'housemait', audience: 'unsubscribe', expiresIn: '90d',
    });
    expect(() => verifyToken(bad)).toThrow();
  });

  test('rejects a token with wrong audience (e.g. a session JWT pasted in)', () => {
    const sessionLike = jwt.sign({ hid: 'hh-legit' }, process.env.UNSUBSCRIBE_TOKEN_SECRET, {
      issuer: 'housemait', audience: 'session', expiresIn: '1h',
    });
    expect(() => verifyToken(sessionLike)).toThrow(/audience/i);
  });

  test('rejects a token with wrong issuer', () => {
    const wrongIssuer = jwt.sign({ hid: 'hh-legit' }, process.env.UNSUBSCRIBE_TOKEN_SECRET, {
      issuer: 'somebody-else', audience: 'unsubscribe', expiresIn: '90d',
    });
    expect(() => verifyToken(wrongIssuer)).toThrow(/issuer/i);
  });

  test('rejects an expired token', () => {
    const expired = jwt.sign({ hid: 'hh-legit' }, process.env.UNSUBSCRIBE_TOKEN_SECRET, {
      issuer: 'housemait', audience: 'unsubscribe', expiresIn: '-1s',
    });
    expect(() => verifyToken(expired)).toThrow(/jwt expired/i);
  });

  test('rejects a missing token', () => {
    expect(() => verifyToken(null)).toThrow(/token is required/i);
    expect(() => verifyToken('')).toThrow(/token is required/i);
  });

  test('signToken requires a household_id', () => {
    expect(() => signToken(null)).toThrow(/household_id is required/i);
  });

  test('unsubscribeUrl returns a fully-qualified URL with encoded token', () => {
    const url = unsubscribeUrl('hh-42', 'https://api.example.com');
    expect(url.startsWith('https://api.example.com/api/unsubscribe?token=')).toBe(true);
    const token = decodeURIComponent(url.split('token=')[1]);
    expect(verifyToken(token)).toBe('hh-42');
  });
});
