-- Migration: change default timezone for new households from
-- Africa/Johannesburg to Europe/London.
--
-- Housemait targets UK families. The original schema's default of
-- Africa/Johannesburg was a leftover from an earlier development pass
-- and shouldn't apply to any new household created from now on.
--
-- This migration only touches the COLUMN DEFAULT — existing rows are
-- left as-is. If a household was set up with the old default and the
-- user genuinely lives in South Africa, that's still the right
-- timezone for them. UK users who got the old default and never
-- changed their household timezone in Settings will need a separate
-- backfill if you want to fix them — that's a judgement call I won't
-- make automatically. Run this query to find them:
--
--   SELECT id, name, timezone
--     FROM households
--    WHERE timezone = 'Africa/Johannesburg';
--
-- and then update individually if appropriate.

ALTER TABLE households
  ALTER COLUMN timezone SET DEFAULT 'Europe/London';
