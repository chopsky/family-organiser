-- Encrypt subscribed calendar addresses at rest.
--
-- A published ICS address is a bearer credential: Google's and Outlook's
-- "secret address" grants permanent read access to that calendar to anyone
-- holding the string. Stored as plaintext, a database leak is a calendar leak
-- for every household at once.
--
-- Only ONE new column is needed, and no index changes, because the address
-- splits by job rather than being replaced in place:
--
--   feed_url      stays the identity used by the UNIQUE (household_id,
--                 feed_url) index. For a secret address it becomes the opaque
--                 deterministic token `enc://<hmac>`, so dedupe keeps working
--                 exactly as before. Synthetic device:// and google://
--                 identifiers are left alone — they grant nothing and are
--                 looked up by exact value.
--   feed_url_enc  the address itself, AES-256-GCM.
--
-- (AES-GCM uses a random IV, so ciphertext in the unique index would silently
-- stop deduplicating — hence the separate deterministic identity column.)
--
-- AFTER running this, run the backfill, which needs the app's key and so
-- cannot be done in SQL:
--
--   node scripts/encrypt-feed-urls.js          (dry run, prints counts)
--   node scripts/encrypt-feed-urls.js --apply  (encrypts)
--
-- Requires CALENDAR_TOKEN_KEY to be set. Confirm with:
--   curl -s https://api.housemait.com/health   -> flags.feedUrlCrypto === true

ALTER TABLE external_calendar_feeds
  ADD COLUMN IF NOT EXISTS feed_url_enc text;

COMMENT ON COLUMN external_calendar_feeds.feed_url_enc IS
  'AES-256-GCM ciphertext of the subscribed calendar address (bearer credential). '
  'NULL for synthetic device:// and google:// identifiers, which are not secrets. '
  'See src/utils/feed-url-crypto.js.';

COMMENT ON COLUMN external_calendar_feeds.feed_url IS
  'Dedupe identity. For encrypted feeds this is the opaque token enc://<hmac>, '
  'NOT a usable address — read the address via resolveFeedUrl().';
