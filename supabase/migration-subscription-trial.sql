-- Subscription & 30-day free trial — Phase 1 (schema only).
--
-- Adds billing/trial state to households, plus a Stripe webhook idempotency
-- table. No backend or frontend changes in this migration — those land in
-- later phases.
--
-- Design notes
-- ------------
-- • State lives on `households`, not `users`. A trial and a subscription are
--   both household-wide: all family members share one trial period and one
--   billing relationship. Storing on `users` would require reconciling
--   conflicting per-user state for the same household.
--
-- • RLS: all reads/writes from the app go through the Node backend using
--   the Supabase service_role key, which bypasses RLS (see
--   migration-enable-rls-all.sql for the pattern). We therefore do NOT
--   create "household member can SELECT" policies — there is no Supabase
--   Auth session on the client to evaluate auth.uid() against, so such
--   policies would never fire. RLS stays enabled with no policies, which
--   means: anon/authenticated keys see nothing, service_role sees
--   everything. If the app ever migrates to direct Supabase client access,
--   these policies need to be added then.
--
-- • Idempotent: every statement uses IF NOT EXISTS / ADD COLUMN IF NOT
--   EXISTS / ADD CONSTRAINT ... IF NOT EXISTS, so re-running is a no-op.
--
-- Run this in the Supabase SQL editor.

-- ──────────────────────────────────────────────────────────────────────
-- 1. Add subscription & trial columns to households
-- ──────────────────────────────────────────────────────────────────────

ALTER TABLE households
  ADD COLUMN IF NOT EXISTS trial_started_at                 timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS trial_ends_at                    timestamptz DEFAULT (now() + INTERVAL '30 days'),
  ADD COLUMN IF NOT EXISTS subscription_status              text        DEFAULT 'trialing',
  ADD COLUMN IF NOT EXISTS stripe_customer_id               text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id           text,
  ADD COLUMN IF NOT EXISTS subscription_plan                text,
  ADD COLUMN IF NOT EXISTS subscription_current_period_end  timestamptz,
  -- Internal/beta accounts that bypass all subscription checks (founders,
  -- family, testers). Set manually in the DB or via admin tools — never
  -- expose as a user-facing setting.
  ADD COLUMN IF NOT EXISTS is_internal                      boolean     DEFAULT false NOT NULL,
  -- User preference for marketing-ish trial nudge emails (days 20/25/28).
  -- The welcome (day 1) and final-expiry (day 30) emails are transactional
  -- and ignore this flag.
  ADD COLUMN IF NOT EXISTS trial_emails_enabled             boolean     DEFAULT true  NOT NULL;

-- Check constraints — split out so they can be added idempotently. Postgres
-- doesn't support IF NOT EXISTS on ADD CONSTRAINT directly, so we guard
-- with a catalog check.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'households_subscription_status_check'
  ) THEN
    ALTER TABLE households
      ADD CONSTRAINT households_subscription_status_check
      CHECK (subscription_status IN ('trialing', 'active', 'expired', 'cancelled'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'households_subscription_plan_check'
  ) THEN
    ALTER TABLE households
      ADD CONSTRAINT households_subscription_plan_check
      CHECK (subscription_plan IS NULL OR subscription_plan IN ('monthly', 'annual'));
  END IF;
END$$;

-- Unique indexes on Stripe IDs — prevents two household rows ever pointing
-- at the same Stripe customer or subscription, which would be a data bug.
-- Nullable columns + UNIQUE is fine in Postgres (multiple NULLs allowed).
CREATE UNIQUE INDEX IF NOT EXISTS idx_households_stripe_customer
  ON households (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_households_stripe_subscription
  ON households (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

-- Used by the daily nudge cron — "find all trialing households whose
-- trial_ends_at falls in the target window".
CREATE INDEX IF NOT EXISTS idx_households_trial_ends_at
  ON households (trial_ends_at)
  WHERE subscription_status = 'trialing';

-- ──────────────────────────────────────────────────────────────────────
-- 2. Stripe webhook idempotency table
-- ──────────────────────────────────────────────────────────────────────
-- Stripe occasionally redelivers events (network retries, manual dashboard
-- replays). The webhook handler does an INSERT here first; if it conflicts,
-- the event has already been processed and the handler returns 200 without
-- re-applying the state change.

CREATE TABLE IF NOT EXISTS processed_stripe_events (
  event_id      text PRIMARY KEY,
  event_type    text        NOT NULL,
  processed_at  timestamptz NOT NULL DEFAULT now()
);

-- Supports the cleanup job that purges rows older than 30 days (Stripe
-- doesn't replay events older than that).
CREATE INDEX IF NOT EXISTS idx_processed_stripe_events_processed_at
  ON processed_stripe_events (processed_at);

-- ──────────────────────────────────────────────────────────────────────
-- 3. RLS
-- ──────────────────────────────────────────────────────────────────────
-- `households` already has RLS enabled (see migration-enable-rls-all.sql)
-- with no policies, which means only service_role can read/write. The new
-- columns inherit that automatically — no policy work needed for reads
-- (backend uses service_role) and writes are already denied to anon/auth.
--
-- Do the same for processed_stripe_events: RLS on, no policies.

ALTER TABLE processed_stripe_events ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE processed_stripe_events IS
  'Stripe webhook idempotency ledger. RLS enabled with no policies — only accessible via service_role key.';
