-- Data retention foundations — Phase 8.
--
-- Two small additions:
--   1. households.inactive_since — the earliest timestamp from which the
--      12-month retention clock starts. Set when a trial expires or a
--      subscription's current period ends, cleared when the user
--      resubscribes. The spec's 12-month cleanup cron (NOT yet built —
--      see TODO in src/jobs/scheduler.js) will look at this column to
--      decide which households to purge.
--
--   2. deletion_audit_log — append-only record of self-service account
--      deletions. Needed for GDPR compliance ("logs the deletion for
--      audit purposes"), for support cases ("did a real deletion
--      actually happen?") and for post-mortem if a user claims their
--      account was wrongly removed.
--
-- Both are additive. The existing cleanup/expiry logic will populate
-- inactive_since going forward; historical rows stay NULL (meaning
-- "still active / never expired" for the cleanup's purposes, which is
-- the correct default).
--
-- Run this in the Supabase SQL editor.

-- ──────────────────────────────────────────────────────────────────────
-- 1. households.inactive_since
-- ──────────────────────────────────────────────────────────────────────

ALTER TABLE households
  ADD COLUMN IF NOT EXISTS inactive_since timestamptz;

COMMENT ON COLUMN households.inactive_since IS
  'When the household became eligible for the 12-month retention clock. Set to trial_ends_at on trial expiry, to subscription_current_period_end on cancellation. Cleared on resubscription. NULL = household is currently active or has never had a trial/subscription lapse.';

-- Partial index for the cleanup cron query (when it's built): finds
-- households where inactive_since is beyond the 12-month threshold.
-- Partial because ~95% of rows will have inactive_since IS NULL
-- (they're active subscribers or within a live trial) and there's no
-- point indexing those.
CREATE INDEX IF NOT EXISTS idx_households_inactive_since
  ON households (inactive_since)
  WHERE inactive_since IS NOT NULL;

-- ──────────────────────────────────────────────────────────────────────
-- 2. deletion_audit_log
-- ──────────────────────────────────────────────────────────────────────
-- Append-only ledger of self-service account deletions. Written by the
-- DELETE /api/auth/account handler just before the rows are removed, so
-- there's a trail even after the user row is gone. We deliberately DO
-- NOT foreign-key household_id / user_id back to their origin tables:
-- those rows won't exist anymore by the time anyone queries this table.

CREATE TABLE IF NOT EXISTS deletion_audit_log (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  deleted_at     timestamptz NOT NULL DEFAULT now(),
  user_id        uuid        NOT NULL,     -- NOT a FK — user row is gone
  user_email     text,                     -- preserved for support lookups
  household_id   uuid,                     -- NOT a FK — household row may be gone
  household_name text,                     -- preserved for support lookups
  -- 'household_deleted' — sole member, whole household cascade-deleted
  -- 'user_only'         — multi-member household, only this user removed
  deletion_mode  text        NOT NULL CHECK (deletion_mode IN ('household_deleted', 'user_only')),
  -- Stripe state at deletion — null if they never subscribed.
  stripe_customer_id      text,
  stripe_subscription_id  text,
  -- True if we cancelled an active Stripe subscription as part of the
  -- deletion. Helps us answer "did we stop charging this person?".
  stripe_cancelled        boolean     NOT NULL DEFAULT false,
  -- IP + user-agent of the delete request. Privacy-adjacent; kept for
  -- 90 days and then pruned by the existing retention job. Matches the
  -- pattern we already use on refresh_tokens.
  ip_address     text,
  user_agent     text
);

CREATE INDEX IF NOT EXISTS idx_deletion_audit_log_deleted_at
  ON deletion_audit_log (deleted_at DESC);
CREATE INDEX IF NOT EXISTS idx_deletion_audit_log_user_id
  ON deletion_audit_log (user_id);
CREATE INDEX IF NOT EXISTS idx_deletion_audit_log_household_id
  ON deletion_audit_log (household_id);

-- RLS: same pattern as every other table in this codebase. Service
-- role (backend) has full access; no public policies means anon /
-- authenticated clients see nothing.
ALTER TABLE deletion_audit_log ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE deletion_audit_log IS
  'Append-only log of self-service account deletions. Written by the backend before the actual deletion runs. No FKs back to users/households — those rows are gone by the time this is queried. RLS enabled with no policies — service_role only.';
