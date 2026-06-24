// AES-256-GCM encryption for OAuth tokens stored in calendar_connections.
//
// Key comes from CALENDAR_TOKEN_KEY (base64 of 32 random bytes). Stored format
// is "base64(iv).base64(authTag).base64(ciphertext)" - the GCM auth tag means a
// tampered ciphertext fails to decrypt rather than returning garbage. If the key
// is ever rotated, existing ciphertexts become undecryptable and affected users
// simply re-connect (we mark the connection needs_reconnect on a decrypt error).

const crypto = require('crypto');

function getKey() {
  const raw = process.env.CALENDAR_TOKEN_KEY;
  if (!raw) throw new Error('CALENDAR_TOKEN_KEY is not set');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('CALENDAR_TOKEN_KEY must decode to 32 bytes — generate with crypto.randomBytes(32).toString("base64")');
  }
  return key;
}

// Encrypt a token string. Returns null for null/undefined input (so callers can
// pass a possibly-absent refresh_token straight through).
function encryptToken(plaintext) {
  if (plaintext == null) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${ct.toString('base64')}`;
}

// Decrypt a stored token. Throws on a malformed or tampered payload.
function decryptToken(payload) {
  if (payload == null) return null;
  const [ivB64, tagB64, ctB64] = String(payload).split('.');
  if (!ivB64 || !tagB64 || !ctB64) throw new Error('Malformed encrypted token');
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const pt = Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]);
  return pt.toString('utf8');
}

module.exports = { encryptToken, decryptToken };
