-- Subscription tracker - Household members tell the bot about
-- recurring paid subscriptions (Netflix, Spotify, Disney+, gym, etc.)
-- and Housemait nudges 3 days before each renewal so they can cancel
-- if they want.
--
-- All edits flow through the bot (chat-managed in v1, no Settings UI).
--
-- Renewal cadence is captured as (recurrence, renewal_day_of_month,
-- renewal_month) so the cron can advance next_renewal_at without
-- re-parsing user text. next_renewal_at is denormalised for the daily
-- "renewing in the next N days" query - the cron updates it after
-- each cycle.

CREATE TABLE IF NOT EXISTS household_subscriptions (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id           uuid        NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name                   text        NOT NULL,
  amount                 numeric(10, 2),
  currency               text        CHECK (currency ~ '^[A-Z]{3}$'),    -- ISO 4217 (GBP, USD, ZAR, …)
  recurrence             text        NOT NULL CHECK (recurrence IN ('monthly', 'yearly')),
  renewal_day_of_month   integer     CHECK (renewal_day_of_month BETWEEN 1 AND 31),
  renewal_month          integer     CHECK (renewal_month BETWEEN 1 AND 12),  -- yearly only
  next_renewal_at        date        NOT NULL,
  notes                  text,
  reminded_for_date      date,        -- last next_renewal_at we sent a reminder for (idempotency)
  created_by             uuid        REFERENCES users(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_household_subscriptions_household
  ON household_subscriptions (household_id);

-- Cron pulls "renewing in the next 3 days" - narrow the scan by date.
CREATE INDEX IF NOT EXISTS idx_household_subscriptions_next_renewal
  ON household_subscriptions (next_renewal_at);

NOTIFY pgrst, 'reload schema';
