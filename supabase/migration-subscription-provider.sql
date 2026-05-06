-- IAP Phase 1a — schema migration for dual-provider subscriptions.
--
-- Adds the columns + idempotency table needed to track Apple-IAP subscribers
-- alongside the existing Stripe ones. No code or behaviour changes here —
-- this just lets the schema represent who's billed via what.
--
-- Design notes
-- ------------
-- • `subscription_provider` is the source-of-truth pivot. 'stripe' is the
--   only legal value today; 'apple' becomes legal once RevenueCat is wired
--   in Phase 1b. Existing rows are backfilled to 'stripe' (every paying
--   household so far has been Stripe). NOT NULL with a default so callers
--   can rely on it being populated.
--
--   Down the line if Google Play / web-only tiers appear, the CHECK
--   widens — single column is intentional so queries like "all Apple
--   subscribers" stay one predicate.
--
-- • `revenuecat_app_user_id` is RevenueCat's external identifier for a
--   subscriber. We pass our `households.id` to the RevenueCat SDK on app
--   launch (via `Purchases.logIn(householdId)`); RevenueCat then echoes
--   that back as `app_user_id` in every webhook payload, so this column
--   gives O(1) lookup from a webhook event to a household row. Nullable
--   because Stripe-only households never set it. Unique to prevent two
--   households accidentally sharing one RevenueCat identity.
--
-- • `processed_revenuecat_events` mirrors `processed_stripe_events` —
--   RevenueCat retries webhooks for 72h on non-2xx responses, so we
--   need idempotency on the event UUID before applying state changes.
--
-- • Idempotent: every statement uses IF NOT EXISTS / DO block guards, so
--   re-running this migration is a no-op.
--
-- • RLS: `households` already has RLS enabled with no policies, so the new
--   columns are backend-only by default (service_role bypasses, anon/auth
--   sees nothing). We do the same for processed_revenuecat_events.
--
-- Run this in the Supabase SQL editor.

-- ──────────────────────────────────────────────────────────────────────
-- 1. Add provider columns to households
-- ──────────────────────────────────────────────────────────────────────

ALTER TABLE households
  ADD COLUMN IF NOT EXISTS subscription_provider     text NOT NULL DEFAULT 'stripe',
  ADD COLUMN IF NOT EXISTS revenuecat_app_user_id    text;

-- Backfill is automatic for ADD COLUMN ... DEFAULT (Postgres ≥ 11 is fast),
-- so all existing households now have subscription_provider = 'stripe'.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'households_subscription_provider_check'
  ) THEN
    ALTER TABLE households
      ADD CONSTRAINT households_subscription_provider_check
      CHECK (subscription_provider IN ('stripe', 'apple'));
  END IF;
END$$;

-- O(1) lookup from a RevenueCat webhook payload to a household row.
-- Nullable + UNIQUE is fine — Postgres allows multiple NULLs.
CREATE UNIQUE INDEX IF NOT EXISTS idx_households_revenuecat_app_user_id
  ON households (revenuecat_app_user_id)
  WHERE revenuecat_app_user_id IS NOT NULL;

-- ──────────────────────────────────────────────────────────────────────
-- 2. RevenueCat webhook idempotency table
-- ──────────────────────────────────────────────────────────────────────
-- RevenueCat retries non-2xx webhooks with exponential backoff for 72h.
-- The webhook handler INSERTs the event id first; if it conflicts (23505),
-- the event has already been processed and the handler returns 200 without
-- re-applying the state change.

CREATE TABLE IF NOT EXISTS processed_revenuecat_events (
  event_id      text PRIMARY KEY,
  event_type    text        NOT NULL,
  app_user_id   text,
  processed_at  timestamptz NOT NULL DEFAULT now()
);

-- Supports the cleanup job that purges rows older than 7 days
-- (RevenueCat doesn't retry beyond 72h, so a week is generous).
CREATE INDEX IF NOT EXISTS idx_processed_revenuecat_events_processed_at
  ON processed_revenuecat_events (processed_at);

ALTER TABLE processed_revenuecat_events ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE processed_revenuecat_events IS
  'RevenueCat webhook idempotency ledger. RLS enabled with no policies — only accessible via service_role key.';

COMMENT ON COLUMN households.subscription_provider IS
  'Which payment platform this household is billed through. ''stripe'' = web, ''apple'' = iOS IAP via RevenueCat. Default ''stripe'' covers all pre-IAP households.';

COMMENT ON COLUMN households.revenuecat_app_user_id IS
  'RevenueCat external user identifier (we pass households.id to Purchases.logIn at app launch). Nullable for Stripe-only households.';
