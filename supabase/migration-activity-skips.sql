-- "Skip just this day" for a child's weekly extracurricular activity: hide
-- one activity on one date everywhere it's expanded (adult calendar, Kids
-- Mode My Days, After-School card, morning digest, outbound ICS feed)
-- without touching the series. One row per (activity, date); expansion
-- sites filter these out. Mirrors chore_skips.
-- Server-only: RLS on, no policies.

CREATE TABLE IF NOT EXISTS activity_skips (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id    UUID NOT NULL REFERENCES child_weekly_schedule(id) ON DELETE CASCADE,
  household_id   UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  date           DATE NOT NULL,
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE (activity_id, date)
);

CREATE INDEX IF NOT EXISTS idx_activity_skips_household_date ON activity_skips (household_id, date);

ALTER TABLE activity_skips ENABLE ROW LEVEL SECURITY;
