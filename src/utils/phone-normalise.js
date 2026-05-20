/**
 * Normalise a user-entered phone number into E.164 (+CCNXXXXXXXXX).
 *
 * Real users type their phone in their local convention:
 *
 *   • UK    "07700 900000"      (national, leading 0)
 *   • SA    "083 358 6883"      (national, leading 0)
 *   • US    "(555) 123-4567"    (national, no leading 0)
 *   • Any   "+27 83 358 6883"   (already E.164, formatted)
 *
 * Twilio only accepts E.164 - anything else gets rejected with code
 * 21211. Previously this route just did `phone.startsWith('+') ?? '+' +
 * phone`, which turned "0833586883" into "+0833586883" and Twilio
 * (rightly) refused it.
 *
 * Rules, in order:
 *   1. Strip everything except digits and a single leading '+'.
 *   2. If starts with '+', it's already E.164 - return as-is (cleaned).
 *   3. If starts with '00', that's the international dial-out prefix
 *      used in much of the world - replace with '+'.
 *   4. If starts with '0', it's a national-format trunk prefix -
 *      strip the 0 and prepend the household's country dial code.
 *   5. If starts with the household's dial code already (no +), just
 *      prepend '+'. Catches users who typed "27833586883" without +.
 *   6. Otherwise prepend '+' + dial code. Last resort - treat as
 *      a local number with no trunk prefix.
 *
 * Returns the normalised string. Caller is responsible for validating
 * the result (digits, length) before sending to Twilio.
 */

const DIAL_CODES = {
  GB: '44',
  IE: '353',
  US: '1',
  CA: '1',
  AU: '61',
  NZ: '64',
  ZA: '27',
};

function normaliseWhatsAppPhone(raw, countryCode) {
  if (!raw) return '';
  // Strip spaces, dashes, parens, dots, etc. Keep digits and leading '+'.
  let cleaned = String(raw).trim();
  const hasPlus = cleaned.startsWith('+');
  cleaned = cleaned.replace(/[^\d]/g, '');
  if (!cleaned) return '';

  // Case 1: already had a + → it's E.164 (or meant to be).
  if (hasPlus) return '+' + cleaned;

  // Case 2: international dial-out 00 → replace with +.
  if (cleaned.startsWith('00')) return '+' + cleaned.slice(2);

  const dial = DIAL_CODES[(countryCode || 'GB').toUpperCase()] || '44';

  // Case 3: national-format trunk prefix → strip the 0, prepend dial.
  if (cleaned.startsWith('0')) return '+' + dial + cleaned.slice(1);

  // Case 4: already starts with dial code but missing '+'.
  if (cleaned.startsWith(dial)) return '+' + cleaned;

  // Case 5: pure local digits with neither + nor leading 0 → prepend
  // the household's dial code. This covers e.g. a US user who typed
  // "5551234567" without trunk prefix.
  return '+' + dial + cleaned;
}

module.exports = { normaliseWhatsAppPhone };
