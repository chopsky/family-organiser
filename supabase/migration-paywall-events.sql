-- Paywall telemetry: one row per wall interaction, so the hard-wall
-- experiment (docs/spec-soft-wall-free-mode.md) is decided by a funnel
-- panel instead of a feeling. Outcomes:
--   shown       - the wall rendered with real packages
--   converted   - a purchase completed at the wall
--   restored    - Restore purchases succeeded at the wall
--   skipped     - the (future) soft-wall ghost was taken
--   fallthrough - the wall failed OPEN (store/config trouble) by design
-- "abandoned" is derived at read time (shown with no terminal outcome
-- within 24h), never stored.

CREATE TABLE IF NOT EXISTS paywall_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL,
  user_id uuid,
  outcome text NOT NULL CHECK (outcome IN ('shown', 'converted', 'restored', 'skipped', 'fallthrough')),
  context text NOT NULL DEFAULT 'onboarding' CHECK (context IN ('onboarding', 'gate')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_paywall_events_household ON paywall_events (household_id, created_at);
CREATE INDEX IF NOT EXISTS idx_paywall_events_created ON paywall_events (created_at);

ALTER TABLE paywall_events ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
