-- Kids-mode daily-engagement, Phase 2: cosmetic star-shop.
--
-- Premium themes + collectible stickers a kid BUYS with earned stars. The
-- decoupling principle: a streak never grants a cosmetic - it pays out stars,
-- and stars buy cosmetics here. Free themes/avatars stay free (premium-on-top).
--
--   kid_cosmetics_owned  - one row per (member, cosmetic) a kid owns. The spend
--                          is written to star_transactions (ref_type 'cosmetic',
--                          idempotent per member+cosmetic), so the ledger stays
--                          the single source of truth for balances.
--
-- The catalogue (keys, cost, season) is authoritative in
-- src/services/kids-cosmetics.js; visual data (theme colours, sticker emoji)
-- lives on the frontend. This table only records ownership.
--
-- Server-only table: RLS enabled, no policies (service-role bypasses).

CREATE TABLE IF NOT EXISTS kid_cosmetics_owned (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  member_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cosmetic_key  TEXT NOT NULL,                          -- theme key ('galaxy') or 'sticker_*'
  kind          TEXT NOT NULL,                          -- 'theme' | 'sticker'
  source        TEXT NOT NULL DEFAULT 'star',           -- 'star' | 'seasonal' (reserved)
  acquired_on   DATE NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE (member_id, cosmetic_key)                       -- own once; makes the grant idempotent
);

CREATE INDEX IF NOT EXISTS idx_kid_cosmetics_household ON kid_cosmetics_owned (household_id);
CREATE INDEX IF NOT EXISTS idx_kid_cosmetics_member ON kid_cosmetics_owned (member_id);

ALTER TABLE kid_cosmetics_owned ENABLE ROW LEVEL SECURITY;
