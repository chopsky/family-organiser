-- Add `country` to households for geo-gating UK-only features.
--
-- Why: the schools / term-dates import feature is UK-specific (GIAS data,
-- local-authority term-date sources, UK-style year groups like 'Reception',
-- 'Y1'..'Y13'). To launch in other countries cleanly, we need to know which
-- households are UK-based and which aren't, so we can:
--
--   • Show the full UK school experience to GB households (unchanged).
--   • Hide the schools section and show a 'Coming soon for your country'
--     placeholder to non-GB households.
--
-- ISO 3166-1 alpha-2 country code, plus 'OTHER' as a catch-all for countries
-- we don't list explicitly yet. NOT NULL with DEFAULT 'GB' so existing rows
-- get backfilled in place (current users are all UK).
--
-- CHECK constraint limits to the seven valid values we recognise today;
-- adding a new country is a one-line schema change + one-line frontend
-- dropdown update.

ALTER TABLE households
  ADD COLUMN IF NOT EXISTS country text NOT NULL DEFAULT 'GB';

-- Drop the constraint if it exists, then add - makes the migration re-runnable
-- and lets us extend the allow-list (e.g. adding ZA later) by re-running.
ALTER TABLE households DROP CONSTRAINT IF EXISTS households_country_check;
ALTER TABLE households
  ADD CONSTRAINT households_country_check
  CHECK (country IN ('GB','IE','US','CA','AU','NZ','ZA','OTHER'));

-- Partial index on non-GB rows. UK is the dominant tenant for the foreseeable
-- future; we only ever query country when filtering for non-default values
-- (analytics, region rollout dashboards, etc.). Indexing those is enough.
CREATE INDEX IF NOT EXISTS idx_households_country_non_gb
  ON households(country)
  WHERE country != 'GB';

COMMENT ON COLUMN households.country IS
  'ISO 3166-1 alpha-2 country code, or OTHER. Gates UK-only features like '
  'school directory and term-date imports. Defaults to GB on creation; the '
  'client auto-detects via Intl.DateTimeFormat timezone but the user can '
  'change it in household Settings (admin only).';
