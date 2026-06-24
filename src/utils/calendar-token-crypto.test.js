const crypto = require('crypto');

// A valid 32-byte key, set before requiring the module.
process.env.CALENDAR_TOKEN_KEY = crypto.randomBytes(32).toString('base64');
const { encryptToken, decryptToken } = require('./calendar-token-crypto');

describe('calendar-token-crypto', () => {
  test('round-trips a token', () => {
    const secret = '1//refresh-token-abc.DEF_123';
    const enc = encryptToken(secret);
    expect(enc).not.toContain(secret);          // ciphertext, not plaintext
    expect(enc.split('.')).toHaveLength(3);      // iv.tag.ct
    expect(decryptToken(enc)).toBe(secret);
  });

  test('null passes through both ways', () => {
    expect(encryptToken(null)).toBeNull();
    expect(decryptToken(null)).toBeNull();
  });

  test('a tampered ciphertext fails to decrypt (GCM auth tag)', () => {
    const enc = encryptToken('hello');
    const [iv, tag, ct] = enc.split('.');
    // Flip a byte in the ciphertext.
    const buf = Buffer.from(ct, 'base64');
    buf[0] = buf[0] ^ 0xff;
    const tampered = `${iv}.${tag}.${buf.toString('base64')}`;
    expect(() => decryptToken(tampered)).toThrow();
  });

  test('two encryptions of the same value differ (random IV)', () => {
    expect(encryptToken('same')).not.toBe(encryptToken('same'));
  });
});
