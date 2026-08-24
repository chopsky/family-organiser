/**
 * Invite short codes - the typeable companion to the invite link's 64-hex
 * token. A code must survive being read off one phone screen and typed into
 * another, so the alphabet drops every ambiguous glyph: I/L/O/S (vs 1/0/5)
 * and the digits 0/1/8. 29 chars ^ 6 = ~594M combos; with the public lookup
 * rate-limited and only dozens of codes live at once, enumeration isn't a
 * paying proposition - and the prize is a household display name that was
 * already being shared over WhatsApp in plaintext.
 *
 * The client mirrors normaliseInviteCode's rules (uppercase, strip
 * spaces/hyphens) - keep them in sync.
 */

const crypto = require('crypto');

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRTUVWXYZ2345679';
const CODE_LENGTH = 6;

function generateInviteCode() {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

/** Uppercase and strip the separators people naturally type or paste. */
function normaliseInviteCode(raw) {
  return String(raw || '').toUpperCase().replace(/[\s-]+/g, '');
}

function isValidInviteCodeShape(code) {
  if (code.length !== CODE_LENGTH) return false;
  for (const ch of code) if (!CODE_ALPHABET.includes(ch)) return false;
  return true;
}

/** KX7M4Q -> KX7-M4Q, purely for display. */
function displayInviteCode(code) {
  const c = normaliseInviteCode(code);
  return c.length === CODE_LENGTH ? `${c.slice(0, 3)}-${c.slice(3)}` : c;
}

module.exports = { generateInviteCode, normaliseInviteCode, isValidInviteCodeShape, displayInviteCode, CODE_ALPHABET, CODE_LENGTH };
