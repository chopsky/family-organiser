/**
 * Password strength validator.
 *
 * Two real-world attacks that the previous `length >= 8` rule didn't cover:
 *
 *   1. Reused / leaked passwords — 'password123', 'qwerty12345' etc. If a
 *      user's chosen password has appeared in any public breach, stuffing
 *      attacks will find it within hours. Checked via HaveIBeenPwned's
 *      Pwned Passwords API using k-anonymity (only the first 5 chars of
 *      the SHA-1 hash leave the server).
 *
 *   2. Personal-info passwords — the user's own name or email prefix. Easy
 *      to guess from any social engineering and commonly reused.
 *
 * Design notes:
 *   - Fails OPEN on HIBP network errors: a flaky third-party API must not
 *     block someone from creating an account. We log the miss and allow
 *     the password through.
 *   - No "contains uppercase / digit / symbol" rules. NIST 800-63B
 *     specifically advises against these — they push users toward
 *     predictable variations (Password1!) and don't actually raise entropy.
 *     Length + breach-check is the modern recommendation.
 */

const crypto = require('crypto');

const MIN_LENGTH = 10;
const MAX_LENGTH = 200;
const HIBP_TIMEOUT_MS = 3000;

/**
 * Check HaveIBeenPwned's Pwned Passwords database. Returns the number of
 * times this password has appeared in known breaches, or 0 if it hasn't.
 *
 * Uses the k-anonymity range API: we send only the first 5 hex characters
 * of the SHA-1 hash, the server returns every full hash beginning with
 * that prefix plus its breach count, and we check locally whether ours
 * is in the response. The plaintext password never leaves this process.
 */
async function hibpBreachCount(password) {
  try {
    const sha1 = crypto.createHash('sha1').update(password).digest('hex').toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);

    const resp = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      signal: AbortSignal.timeout(HIBP_TIMEOUT_MS),
      headers: { 'Add-Padding': 'true' }, // hides true response size from network observers
    });
    if (!resp.ok) return 0;

    const text = await resp.text();
    for (const line of text.split('\n')) {
      const [hashSuffix, countStr] = line.trim().split(':');
      if (hashSuffix === suffix) {
        return parseInt(countStr, 10) || 0;
      }
    }
    return 0;
  } catch (err) {
    // Fail open — never block signup on a flaky third-party API.
    // Worst case: a breached password slips through, but HIBP takes
    // meaningful checks up a massive notch on the happy path.
    console.warn('[password] HIBP check failed, allowing password through:', err.message);
    return 0;
  }
}

/**
 * Validate a password. Returns { valid: true } on pass, or
 * { valid: false, error: 'user-facing message' } on fail.
 *
 * `context` carries fields for personal-info checks. Both optional — if
 * omitted, those checks are skipped (useful for password reset where the
 * user's email might not be trivially available to the caller).
 */
async function validatePassword(password, { email = null, name = null } = {}) {
  if (!password || typeof password !== 'string') {
    return { valid: false, error: 'Password is required.' };
  }
  if (password.length < MIN_LENGTH) {
    return { valid: false, error: `Password must be at least ${MIN_LENGTH} characters.` };
  }
  if (password.length > MAX_LENGTH) {
    return { valid: false, error: `Password is too long (max ${MAX_LENGTH} characters).` };
  }

  const lower = password.toLowerCase();

  if (email) {
    const localPart = email.toLowerCase().split('@')[0];
    if (localPart && localPart.length >= 3 && lower.includes(localPart)) {
      return { valid: false, error: 'Password must not contain your email address.' };
    }
  }

  if (name && name.length >= 3 && lower.includes(name.toLowerCase())) {
    return { valid: false, error: 'Password must not contain your name.' };
  }

  const breachCount = await hibpBreachCount(password);
  if (breachCount > 0) {
    return {
      valid: false,
      error: `This password has appeared in ${breachCount.toLocaleString()} known data breaches. Please choose a different one.`,
    };
  }

  return { valid: true };
}

module.exports = { validatePassword, hibpBreachCount, MIN_LENGTH, MAX_LENGTH };
