-- Multi-currency Tier 1 — schema migration for the currency a household
-- is billed in.
--
-- Adds the column the Stripe webhook handler writes when a subscription
-- is created or its price changes, so the in-app Settings → Plan card
-- and any future locale-aware UI can render the right currency symbol
-- without re-fetching the Subscription from Stripe on every page load.
--
-- Design notes
-- ------------
-- • `subscription_currency` mirrors the Stripe Price's currency code in
--   lowercase ISO-4217 (`gbp`, `usd`, `eur`, `aud`, `cad`, `zar`).
--   Lowercase because that's exactly what Stripe returns in its API
--   responses — keeping the same casing avoids a normalisation step in
--   both directions.
--
-- • Nullable, no default. Existing households haven't been billed in any
--   specific currency until they checked out — leaving NULL is more
--   honest than backfilling to 'gbp'. The webhook handler populates it
--   on checkout.session.completed and customer.subscription.updated.
--
-- • CHECK constraint guards against typos / unexpected currencies.
--   Update the IN list when adding new locales — Tier 1 ships with six.
--
-- • Idempotent: every statement uses IF NOT EXISTS / DO block guards.
--
-- Run this in the Supabase SQL editor.

ALTER TABLE households
  ADD COLUMN IF NOT EXISTS subscription_currency text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'households_subscription_currency_check'
  ) THEN
    ALTER TABLE households
      ADD CONSTRAINT households_subscription_currency_check
      CHECK (
        subscription_currency IS NULL OR
        subscription_currency IN ('gbp', 'usd', 'eur', 'aud', 'cad', 'zar')
      );
  END IF;
END$$;

COMMENT ON COLUMN households.subscription_currency IS
  'Lowercase ISO-4217 currency code the active subscription is billed in (e.g. ''gbp'', ''usd''). Populated by the Stripe webhook handler from the Price object''s currency. NULL for households that have never subscribed.';
