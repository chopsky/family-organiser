-- Subscription email dedupe — Phase 7.
--
-- Purpose: the daily trial-email cron (src/jobs/trial-emails.js) runs
-- once per day at 09:00 Europe/London. Without a dedupe barrier, a
-- rolling deploy or accidentally-duplicate scheduler run could send the
-- same household two "Your trial ends in 2 days" emails. The UNIQUE
-- constraint below makes that impossible at the DB level — the second
-- INSERT conflicts and the sender skips the send.
--
-- We don't need to track individual recipients; the trial emails are
-- addressed to the household's admin (the account member who created
-- the household), so dedup is per-household-per-email-type.
--
-- email_type values used by the cron:
--   'welcome'              — day 1, fires from /api/auth/create-household
--   'trial_day_20'         — day 20 nudge (broadcast stream, respects opt-out)
--   'trial_day_25'         — day 25 nudge
--   'trial_day_28'         — day 28 final push
--   'trial_expired'        — day 30+ transactional (always sends)
--
-- Run this in the Supabase SQL editor.

CREATE TABLE IF NOT EXISTS sent_emails (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  uuid        NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  email_type    text        NOT NULL,
  sent_at       timestamptz NOT NULL DEFAULT now(),

  -- One row per (household, email type). A second INSERT of the same
  -- pair raises 23505 (unique_violation) which the sender catches and
  -- treats as "already sent". If you ever add a new email_type, older
  -- rows with different email_type values don't block the new one.
  CONSTRAINT sent_emails_household_type_unique UNIQUE (household_id, email_type)
);

-- Lookup index for "has this household been sent X yet?" queries.
-- Covered by the unique constraint above in Postgres, but kept explicit
-- here so a future DBA reviewing the schema doesn't miss the intent.
CREATE INDEX IF NOT EXISTS idx_sent_emails_household_type
  ON sent_emails (household_id, email_type);

-- RLS: matches the pattern on every other table in this codebase. All
-- access is via service_role (the Node backend) — no policies means
-- anon / authenticated clients see nothing, which is what we want.
ALTER TABLE sent_emails ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE sent_emails IS
  'Dedupe ledger for subscription lifecycle emails (welcome, trial nudges, expiry). One row per (household, email type). RLS enabled with no policies — service_role only.';
