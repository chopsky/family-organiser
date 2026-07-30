-- Apple Ads install attribution, per USER (not household).
--
-- The app reads an AdServices token on first authenticated launch and the
-- backend redeems it with Apple. The full response is kept verbatim in
-- ad_attribution: { attribution, campaignId, adGroupId, keywordId?,
-- conversionType, clickDate, countryOrRegion, orgId }. An ORGANIC install is
-- recorded too, as { "attribution": false } - "we asked and Apple said no"
-- must be distinguishable from "we never asked", or every organic user would
-- retry the redemption on every launch.
--
-- ad_attribution_at is the redemption timestamp and doubles as the
-- "already answered" marker the route checks for idempotency.
--
-- Why per user: attribution belongs to whoever the install converted into.
-- A second adult joining an existing household on their own phone carries
-- their own install story.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS ad_attribution JSONB,
  ADD COLUMN IF NOT EXISTS ad_attribution_at TIMESTAMPTZ;
