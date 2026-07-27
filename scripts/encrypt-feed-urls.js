#!/usr/bin/env node
/**
 * Encrypt existing subscribed calendar addresses at rest.
 *
 * Run AFTER migration-feed-url-encryption.sql. The encryption key lives in the
 * app's environment, not in Postgres, so this step cannot be done in SQL.
 *
 * For every feed whose feed_url is still a real http(s)/webcal address, this
 * writes the ciphertext to feed_url_enc and replaces feed_url with the opaque
 * deterministic token enc://<hmac> — which is what the existing
 * UNIQUE (household_id, feed_url) index keeps deduplicating on.
 *
 * Synthetic device:// and google:// identifiers are skipped: they grant
 * nothing and are looked up by exact value when a phone re-syncs.
 *
 * Safe by default: DRY RUN (prints what it would change). Pass --apply to write.
 *
 *   node scripts/encrypt-feed-urls.js          # dry run
 *   node scripts/encrypt-feed-urls.js --apply  # actually encrypt
 *
 * Idempotent — rows already carrying feed_url_enc are left alone, so it is
 * safe to re-run if it is interrupted part way.
 *
 * Requires SUPABASE_URL + SUPABASE_SERVICE_KEY and CALENDAR_TOKEN_KEY in .env.
 */
require('dotenv').config();
const { supabaseAdmin: db } = require('../src/db/client');
const {
  isSecretFeedUrl, feedUrlFingerprint, feedCryptoReady, ENC_PREFIX,
} = require('../src/utils/feed-url-crypto');
const { encryptToken } = require('../src/utils/calendar-token-crypto');

const APPLY = process.argv.includes('--apply');
const PAGE = 500;

async function main() {
  if (!feedCryptoReady()) {
    console.error('✗ CALENDAR_TOKEN_KEY is not set (or is not 32 bytes of base64).');
    console.error('  Generate one with:');
    console.error('  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"');
    process.exit(1);
  }

  // Paginate explicitly: an unbounded select silently caps at 1000 rows, which
  // would leave later feeds in plaintext while reporting success.
  let from = 0;
  let scanned = 0;
  let skippedSynthetic = 0;
  let alreadyDone = 0;
  let changed = 0;
  const failures = [];

  for (;;) {
    const { data, error } = await db
      .from('external_calendar_feeds')
      .select('id, feed_url, feed_url_enc')
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;

    for (const row of data) {
      scanned += 1;
      if (row.feed_url_enc) { alreadyDone += 1; continue; }
      if (!isSecretFeedUrl(row.feed_url)) { skippedSynthetic += 1; continue; }

      // Never print the address itself — that is the whole point of the change.
      if (!APPLY) { changed += 1; continue; }

      const { error: upErr } = await db
        .from('external_calendar_feeds')
        .update({
          feed_url: `${ENC_PREFIX}${feedUrlFingerprint(row.feed_url)}`,
          feed_url_enc: encryptToken(row.feed_url),
        })
        .eq('id', row.id);

      if (upErr) failures.push({ id: row.id, error: upErr.message });
      else changed += 1;
    }

    if (data.length < PAGE) break;
    from += PAGE;
  }

  console.log(`\nScanned              ${scanned}`);
  console.log(`Already encrypted    ${alreadyDone}`);
  console.log(`Synthetic (skipped)  ${skippedSynthetic}`);
  console.log(APPLY ? `Encrypted            ${changed}` : `Would encrypt        ${changed}`);
  if (failures.length) {
    console.log(`\n✗ ${failures.length} row(s) failed:`);
    for (const f of failures) console.log(`  ${f.id}: ${f.error}`);
    process.exitCode = 1;
  }
  if (!APPLY && changed > 0) console.log('\nDry run. Re-run with --apply to write.');
}

main().catch((err) => {
  console.error('Backfill failed:', err.message);
  process.exit(1);
});
