-- Onboarding step telemetry: one row per step transition in the native v4
-- onboarding flow, keyed by an anonymous client-minted id (no account
-- exists yet for most of the flow - that invisibility is the whole reason
-- this table exists; the 30-day funnel showed iOS "100%" signup->onboarded
-- purely because pre-account quitters leave no trace).
--
-- Privacy: anon_id is a random UUID minted in localStorage at first
-- onboarding open. No PII, no device fingerprint. Rows age out of
-- usefulness quickly; a periodic purge can be added if volume ever asks.

CREATE TABLE IF NOT EXISTS onboarding_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  anon_id text NOT NULL,
  step text NOT NULL,
  action text NOT NULL CHECK (action IN ('enter', 'skip', 'back')),
  platform text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_events_anon ON onboarding_events (anon_id, created_at);
CREATE INDEX IF NOT EXISTS idx_onboarding_events_created ON onboarding_events (created_at);

ALTER TABLE onboarding_events ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
