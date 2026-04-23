/**
 * Unsubscribe tokens — Phase 7.
 *
 * One-click unsubscribe links in broadcast-stream emails ride on a
 * signed JWT carrying just the household_id. Verifying the token is
 * how we trust "yes, this request really did originate from our own
 * email" — without it, anyone who could guess a household id could
 * disable another household's trial nudges.
 *
 * We use JWT (rather than a bare HMAC) for three reasons:
 *   1. `jsonwebtoken` is already a project dep; no new crypto code.
 *   2. Built-in expiry — 90 days matches the useful life of an email
 *      (after which the trial has long finished and nudges no longer
 *      apply anyway).
 *   3. `aud` + `iss` claims let us reject a token intended for a
 *      different purpose (e.g. someone pasting a session JWT into the
 *      unsubscribe URL).
 *
 * Signed with UNSUBSCRIBE_TOKEN_SECRET — a SEPARATE secret from
 * JWT_SECRET. Splitting secrets limits blast radius: a leaked
 * unsubscribe secret lets attackers toggle trial_emails_enabled but
 * NOT impersonate session users.
 */

const jwt = require('jsonwebtoken');

const TOKEN_SECRET = process.env.UNSUBSCRIBE_TOKEN_SECRET;
const ISSUER = 'housemait';
const AUDIENCE = 'unsubscribe';
const EXPIRY = '90d';

function requireSecret() {
  if (!TOKEN_SECRET) {
    throw new Error(
      'UNSUBSCRIBE_TOKEN_SECRET is not set — cannot sign or verify ' +
      'unsubscribe tokens. Generate one with: openssl rand -base64 48'
    );
  }
}

/**
 * Sign a one-click unsubscribe token for a household.
 *
 * The token encodes only the household_id — no user identity. This is
 * deliberate: the preference (`trial_emails_enabled`) is a per-household
 * flag, so the token doesn't need to know which user clicked.
 */
function signToken(householdId) {
  requireSecret();
  if (!householdId) throw new Error('household_id is required');
  return jwt.sign({ hid: householdId }, TOKEN_SECRET, {
    issuer: ISSUER,
    audience: AUDIENCE,
    expiresIn: EXPIRY,
  });
}

/**
 * Verify a token and return the household_id. Throws with a descriptive
 * error on any failure mode — callers should catch broadly and show a
 * generic "invalid or expired link" page to the user rather than
 * leaking which specific check failed.
 */
function verifyToken(token) {
  requireSecret();
  if (!token) throw new Error('token is required');
  const payload = jwt.verify(token, TOKEN_SECRET, {
    issuer: ISSUER,
    audience: AUDIENCE,
  });
  if (!payload.hid) throw new Error('token payload is missing household_id');
  return payload.hid;
}

/**
 * Build the fully-qualified unsubscribe URL for a household. Used by
 * the email senders and by the List-Unsubscribe header generator.
 */
function unsubscribeUrl(householdId, apiUrl) {
  const base = apiUrl || process.env.API_URL || process.env.WEB_URL || 'http://localhost:3000';
  const token = signToken(householdId);
  return `${base}/api/unsubscribe?token=${encodeURIComponent(token)}`;
}

module.exports = { signToken, verifyToken, unsubscribeUrl };
