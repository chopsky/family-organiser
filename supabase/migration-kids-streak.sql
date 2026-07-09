-- Kids-mode daily-engagement, Phase 1: streak milestone BADGES.
--
-- The streak itself is NOT stored - it's computed on read from the existing
-- chore_completions history (see src/services/kids-streak.js). This table only
-- records the once-ever milestone achievements a kid has unlocked, so the badge
-- shelf can list them and awards fire exactly once.
--
--   kid_badges  - one row per (member, badge_key). Milestone badges are
--                 permanent: earned via a streak reaching 7/30/100/365 days.
--                 The matching star BONUS is written to star_transactions with
--                 ref_type 'streak_milestone' (idempotent per member+tier), so
--                 the ledger stays the single source of truth for balances.
--
-- Decoupling principle: a streak pays out renewable STARS + these badges - it
-- never unlocks cosmetics directly. Cosmetics are bought with stars (Phase 2).
--
-- Server-only table: RLS enabled, no policies (service-role bypasses).

CREATE TABLE IF NOT EXISTS kid_badges (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  member_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_key     TEXT NOT NULL,                          -- 'streak_7' | 'streak_30' | 'streak_100' | 'streak_365'
  earned_on     DATE NOT NULL,                          -- household-local day the badge was unlocked
  meta          JSONB,                                  -- reserved (e.g. the streak length at unlock)
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE (member_id, badge_key)                         -- once-ever; makes the insert idempotent
);

CREATE INDEX IF NOT EXISTS idx_kid_badges_household ON kid_badges (household_id);
CREATE INDEX IF NOT EXISTS idx_kid_badges_member ON kid_badges (member_id);

ALTER TABLE kid_badges ENABLE ROW LEVEL SECURITY;
