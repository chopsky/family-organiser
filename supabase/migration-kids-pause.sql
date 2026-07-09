-- Kids-mode routine PAUSE (holiday / off-sick). A grown-up (behind the Child
-- Mode PIN) pauses a kid's routines; while paused the streak is protected -
-- missed days become neutral instead of breaking it - and the Quests screen
-- shows a "paused" state. Resuming closes the window; the paused days stay
-- frozen forever so the streak can't retroactively break.
--
--   kid_routine_pauses  - one row per pause period. end_date NULL = ongoing.
--                         At most one open pause per member (partial unique).
--
-- Server-only table: RLS enabled, no policies (service-role bypasses).

CREATE TABLE IF NOT EXISTS kid_routine_pauses (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  member_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_date    DATE NOT NULL,                          -- first frozen day (household-local)
  end_date      DATE,                                   -- last frozen day; NULL while ongoing
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kid_routine_pauses_member ON kid_routine_pauses (member_id);
-- One ongoing pause per kid at a time.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_kid_open_pause ON kid_routine_pauses (member_id) WHERE end_date IS NULL;

ALTER TABLE kid_routine_pauses ENABLE ROW LEVEL SECURITY;
