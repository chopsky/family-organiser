/**
 * Encryption at rest for subscribed calendar addresses.
 *
 * A published ICS address is a bearer credential. Google's and Outlook's
 * "secret address" grants permanent read access to that calendar to anyone
 * holding the string, and iCloud's published link is genuinely public. Storing
 * them as plaintext means a database leak is a calendar leak for every
 * household at once.
 *
 * ── Why the address is not simply replaced by ciphertext ────────────────────
 * external_calendar_feeds has a UNIQUE index on (household_id, feed_url) which
 * is what stops two people in a house subscribing to the same calendar twice.
 * AES-256-GCM uses a random IV, so the same URL encrypts to a different string
 * every time — put ciphertext in that column and the index silently stops
 * deduplicating.
 *
 * So the columns split by job:
 *   feed_url      identity. For a secret address this becomes the opaque,
 *                 deterministic token `enc://<fingerprint>`, which keeps the
 *                 existing unique index working with no schema change to it.
 *   feed_url_enc  the secret itself, AES-256-GCM.
 *
 * The fingerprint is an HMAC (not a bare hash) so that possessing the database
 * without the key doesn't let an attacker confirm a guessed URL.
 *
 * ── What is deliberately NOT encrypted ──────────────────────────────────────
 * Synthetic addresses — `device://<user>/<calendar>` and
 * `google://<connection>/<calendar>` — are internal identifiers, not
 * credentials: they grant nothing and are looked up by exact value when a
 * phone re-syncs or a Google calendar is re-selected. Encrypting them would
 * break those lookups to protect a value that isn't a secret.
 */

const crypto = require('crypto');
const { encryptToken, decryptToken } = require('./calendar-token-crypto');

/** Prefix marking a feed_url that is an opaque identity token, not an address. */
const ENC_PREFIX = 'enc://';

/**
 * True for addresses that are real fetchable URLs, i.e. the ones that carry a
 * credential. Synthetic device:// and google:// identifiers return false.
 */
function isSecretFeedUrl(url) {
  return typeof url === 'string' && /^(https?|webcal):\/\//i.test(url.trim());
}

/** True if this feed_url is an identity token rather than a usable address. */
function isEncryptedPlaceholder(feedUrl) {
  return typeof feedUrl === 'string' && feedUrl.startsWith(ENC_PREFIX);
}

function getKey() {
  const raw = process.env.CALENDAR_TOKEN_KEY;
  if (!raw) {
    throw new Error(
      'CALENDAR_TOKEN_KEY is not set — calendar addresses cannot be stored securely. '
      + 'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('CALENDAR_TOKEN_KEY must decode to 32 bytes');
  return key;
}

/** True when the environment can actually encrypt. Surfaced on /health. */
function feedCryptoReady() {
  try { getKey(); return true; } catch { return false; }
}

/**
 * Deterministic keyed fingerprint of an address — the dedupe identity. Same
 * URL always maps to the same token, so the unique index behaves exactly as it
 * did when the column held the address itself.
 */
function feedUrlFingerprint(url) {
  return crypto.createHmac('sha256', getKey())
    .update(String(url).trim())
    .digest('hex');
}

/**
 * Turn a caller's feed row into its at-rest form.
 *
 * Secret addresses come back as { feed_url: 'enc://…', feed_url_enc: '…' };
 * synthetic ones are returned untouched. Safe to call on any row — it is a
 * no-op for rows without a feed_url, and idempotent for already-encrypted ones.
 */
function encryptFeedRow(row) {
  const url = row?.feed_url;
  if (!isSecretFeedUrl(url)) return row; // synthetic, absent, or already a token
  return {
    ...row,
    feed_url: `${ENC_PREFIX}${feedUrlFingerprint(url)}`,
    feed_url_enc: encryptToken(url),
  };
}

/**
 * The usable address for a stored feed. Prefers the ciphertext, falling back to
 * feed_url — which covers synthetic identifiers and any row written before the
 * backfill ran, so reads keep working throughout the rollout.
 *
 * Returns null if a row is encrypted but undecryptable (key rotated or absent);
 * callers treat that as a feed that needs re-adding rather than crashing a
 * whole sync pass.
 */
function resolveFeedUrl(feed) {
  if (feed?.feed_url_enc) {
    try {
      return decryptToken(feed.feed_url_enc);
    } catch {
      return null;
    }
  }
  // An enc:// token with no ciphertext alongside it is not an address.
  return isEncryptedPlaceholder(feed?.feed_url) ? null : (feed?.feed_url ?? null);
}

/**
 * Display form. The credential sits in the middle of these URLs, so surfaces
 * that list feeds show the host and nothing else — never the full address.
 */
function maskFeedUrl(url) {
  if (!url) return 'link hidden';
  const s = String(url).trim();
  // Synthetic identifiers carry a user/connection id, which is noise in a list
  // and needlessly specific — name the source instead.
  if (s.startsWith('device://')) return 'synced from a phone';
  if (s.startsWith('google://')) return 'Google Calendar (connected)';
  if (s.startsWith(ENC_PREFIX)) return 'link hidden';
  if (!isSecretFeedUrl(s)) return 'link hidden';
  try {
    return `${new URL(s.replace(/^webcal:/i, 'https:')).hostname} · link hidden`;
  } catch {
    return 'link hidden';
  }
}

module.exports = {
  ENC_PREFIX,
  isSecretFeedUrl,
  isEncryptedPlaceholder,
  feedCryptoReady,
  feedUrlFingerprint,
  encryptFeedRow,
  resolveFeedUrl,
  maskFeedUrl,
};
