-- Star economy: rewards kids spend earned stars on + the ledger that tracks
-- every star movement. Shares one economy with the Tasks page - completing a
-- rewarded chore EARNS stars (chore route writes an 'earn' txn), redeeming a
-- reward SPENDS them, undo/delete REFUNDS.
--
--   rewards             - parent-set catalogue (what stars buy)
--   reward_redemptions  - the log; parents toggle `fulfilled`
--   star_transactions   - append-only ledger; a member's balance = SUM(delta)
--
-- The ledger is the source of truth for balances (no denormalised counter to
-- drift). Earn is idempotent per (chore definition, member, day) via a unique
-- (ref_type, ref_id) so toggling a chore can't double-credit. ref_id carries a
-- globally-unique uuid (definition id / redemption id) so there's no
-- cross-household collision; NULL ref_id (manual adjustments) stays unconstrained.
--
-- Server-only tables: RLS enabled, no policies (service-role bypasses).

CREATE TABLE IF NOT EXISTS rewards (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  emoji         TEXT,
  cost          INTEGER NOT NULL CHECK (cost >= 0),
  who           TEXT NOT NULL DEFAULT 'any',           -- 'any' or a member id (uuid as text)
  position      INTEGER NOT NULL DEFAULT 0,
  active        BOOLEAN NOT NULL DEFAULT true,          -- soft-hide instead of delete
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rewards_household ON rewards (household_id) WHERE active;

CREATE TABLE IF NOT EXISTS reward_redemptions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  reward_id     UUID REFERENCES rewards(id) ON DELETE SET NULL,  -- keep the log if the reward is later removed
  member_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,                          -- snapshot (reward may change/disappear)
  emoji         TEXT,
  cost          INTEGER NOT NULL,
  fulfilled     BOOLEAN NOT NULL DEFAULT false,         -- parent marks the reward as delivered
  fulfilled_at  TIMESTAMP WITH TIME ZONE,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reward_redemptions_household ON reward_redemptions (household_id, created_at DESC);

CREATE TABLE IF NOT EXISTS star_transactions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  member_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delta         INTEGER NOT NULL,                       -- + earn, - spend
  reason        TEXT NOT NULL CHECK (reason IN ('earn','spend','refund','adjust')),
  ref_type      TEXT,                                   -- 'chore_earn' | 'redeem' | null
  ref_id        TEXT,                                   -- definition:member:date  |  redemption id  | null
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_star_transactions_member ON star_transactions (household_id, member_id);
-- Idempotency: at most one ledger row per referenced event (lets the chore
-- toggle credit exactly once). NULL ref_id rows (manual adjustments) are exempt.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_star_transactions_ref ON star_transactions (ref_type, ref_id) WHERE ref_id IS NOT NULL;

ALTER TABLE rewards            ENABLE ROW LEVEL SECURITY;
ALTER TABLE reward_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE star_transactions  ENABLE ROW LEVEL SECURITY;
