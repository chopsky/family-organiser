/**
 * Encryption at rest for subscribed calendar addresses.
 *
 * The property that matters most is dedupe stability: feed_url is the identity
 * behind UNIQUE (household_id, feed_url), so the token it becomes must be
 * deterministic. AES-GCM's random IV is exactly why the ciphertext cannot live
 * in that column, and a regression here would silently stop deduplicating
 * rather than fail loudly.
 */
const crypto = require('crypto');

const KEY = crypto.randomBytes(32).toString('base64');
const ORIGINAL_KEY = process.env.CALENDAR_TOKEN_KEY;

beforeAll(() => { process.env.CALENDAR_TOKEN_KEY = KEY; });
afterAll(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.CALENDAR_TOKEN_KEY;
  else process.env.CALENDAR_TOKEN_KEY = ORIGINAL_KEY;
});

const {
  isSecretFeedUrl, encryptFeedRow, resolveFeedUrl, maskFeedUrl,
  feedUrlFingerprint, feedCryptoReady, ENC_PREFIX,
} = require('./feed-url-crypto');

const SECRET = 'https://calendar.google.com/calendar/ical/abc123SECRET/basic.ics';

describe('isSecretFeedUrl', () => {
  it('treats real fetchable addresses as secrets', () => {
    expect(isSecretFeedUrl(SECRET)).toBe(true);
    expect(isSecretFeedUrl('webcal://p12-caldav.icloud.com/published/2/x')).toBe(true);
    expect(isSecretFeedUrl('http://example.com/cal.ics')).toBe(true);
  });

  it('does not treat synthetic identifiers as secrets', () => {
    // These grant nothing and are looked up by exact value when a phone
    // re-syncs, so encrypting them would break lookups to protect a non-secret.
    expect(isSecretFeedUrl('device://user-1/cal-2')).toBe(false);
    expect(isSecretFeedUrl('google://conn-1/cal-2')).toBe(false);
    expect(isSecretFeedUrl(null)).toBe(false);
  });
});

describe('encryptFeedRow', () => {
  it('moves the address into ciphertext and leaves an opaque identity token', () => {
    const row = encryptFeedRow({ household_id: 'h1', feed_url: SECRET });
    expect(row.feed_url.startsWith(ENC_PREFIX)).toBe(true);
    expect(row.feed_url).not.toContain('SECRET');
    expect(row.feed_url_enc).toBeTruthy();
    expect(row.feed_url_enc).not.toContain('SECRET');
    expect(row.household_id).toBe('h1');
  });

  it('gives the same identity token for the same address every time', () => {
    // The whole reason feed_url is not simply replaced by ciphertext: the
    // unique index must keep deduplicating.
    const a = encryptFeedRow({ feed_url: SECRET });
    const b = encryptFeedRow({ feed_url: SECRET });
    expect(a.feed_url).toBe(b.feed_url);
    // ...while the ciphertext itself differs, because the IV is random.
    expect(a.feed_url_enc).not.toBe(b.feed_url_enc);
  });

  it('gives different identity tokens for different addresses', () => {
    const a = encryptFeedRow({ feed_url: SECRET });
    const b = encryptFeedRow({ feed_url: `${SECRET}?x=1` });
    expect(a.feed_url).not.toBe(b.feed_url);
  });

  it('leaves synthetic rows completely untouched', () => {
    const row = { feed_url: 'device://user-1/cal-2', display_name: 'Sarah’s iPhone' };
    expect(encryptFeedRow(row)).toEqual(row);
    expect(encryptFeedRow(row).feed_url_enc).toBeUndefined();
  });

  it('is idempotent — re-encrypting an encrypted row is a no-op', () => {
    const once = encryptFeedRow({ feed_url: SECRET });
    expect(encryptFeedRow(once)).toEqual(once);
  });
});

describe('resolveFeedUrl', () => {
  it('round-trips the address', () => {
    expect(resolveFeedUrl(encryptFeedRow({ feed_url: SECRET }))).toBe(SECRET);
  });

  it('falls back to plaintext for rows written before the backfill ran', () => {
    // Reads must keep working throughout the rollout.
    expect(resolveFeedUrl({ feed_url: SECRET })).toBe(SECRET);
  });

  it('returns synthetic identifiers as-is', () => {
    expect(resolveFeedUrl({ feed_url: 'device://u/c' })).toBe('device://u/c');
  });

  it('returns null rather than throwing when the ciphertext cannot be read', () => {
    // Key rotated or absent: that feed needs re-adding, but it must not take
    // down a whole sync pass.
    const row = encryptFeedRow({ feed_url: SECRET });
    expect(resolveFeedUrl({ ...row, feed_url_enc: 'not.valid.ciphertext' })).toBeNull();
  });

  it('never mistakes the identity token for an address', () => {
    expect(resolveFeedUrl({ feed_url: `${ENC_PREFIX}deadbeef` })).toBeNull();
  });
});

describe('maskFeedUrl', () => {
  it('shows the host and hides the credential', () => {
    const masked = maskFeedUrl(SECRET);
    expect(masked).toBe('calendar.google.com · link hidden');
    expect(masked).not.toContain('SECRET');
  });

  it('names the source for synthetic identifiers instead of leaking ids', () => {
    expect(maskFeedUrl('device://user-abc/cal-1')).toBe('synced from a phone');
    expect(maskFeedUrl('device://user-abc/cal-1')).not.toContain('user-abc');
    expect(maskFeedUrl('google://conn-xyz/cal-1')).not.toContain('conn-xyz');
  });

  it('never echoes the fingerprint', () => {
    expect(maskFeedUrl(`${ENC_PREFIX}abcdef123456`)).toBe('link hidden');
  });

  it('handles nothing and nonsense', () => {
    expect(maskFeedUrl(null)).toBe('link hidden');
    expect(maskFeedUrl('not a url')).toBe('link hidden');
  });
});

describe('key handling', () => {
  it('reports ready when the key is present', () => {
    expect(feedCryptoReady()).toBe(true);
  });

  it('reports not-ready and fails closed when the key is missing', () => {
    const saved = process.env.CALENDAR_TOKEN_KEY;
    delete process.env.CALENDAR_TOKEN_KEY;
    expect(feedCryptoReady()).toBe(false);
    // Fail closed: never quietly store the credential in plaintext instead.
    expect(() => feedUrlFingerprint(SECRET)).toThrow(/CALENDAR_TOKEN_KEY/);
    expect(() => encryptFeedRow({ feed_url: SECRET })).toThrow(/CALENDAR_TOKEN_KEY/);
    process.env.CALENDAR_TOKEN_KEY = saved;
  });
});
