-- Free app, metered assistant (docs/spec-free-app-paid-assistant.md).
--
-- assistant_actions: one row per charged meter action (a 10-minute burst
-- anchored at its first message). The month's usage = rows since the 1st
-- in the household's timezone; the burst check = latest started_at within
-- the window. Deliberately append-only and tiny.
--
-- households.free_deal_announced_at: when the household was TOLD the free
-- deal (quota ladder step 0/backstop) - the meter is announced, never
-- discovered.
-- households.meter_limit_notice_at: throttle stamp for the over-limit
-- reply (full version daily, one-liner per new burst, silence within one).
-- households.farewell_brief_sent_at: the one farewell brief at lapse.

CREATE TABLE IF NOT EXISTS assistant_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL,
  user_id uuid,
  channel text,
  started_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assistant_actions_hh
  ON assistant_actions (household_id, started_at DESC);

ALTER TABLE households ADD COLUMN IF NOT EXISTS free_deal_announced_at timestamptz;
ALTER TABLE households ADD COLUMN IF NOT EXISTS meter_limit_notice_at timestamptz;
ALTER TABLE households ADD COLUMN IF NOT EXISTS farewell_brief_sent_at timestamptz;

ALTER TABLE assistant_actions ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
