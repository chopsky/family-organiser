-- "Skip just today" for a recurring chore: hide one definition on one date for
-- the whole household without deleting it (the alternative to "Delete for
-- everyone"). One row per (definition, date); the day-view filters these out.
-- Server-only: RLS on, no policies.

CREATE TABLE IF NOT EXISTS chore_skips (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  definition_id  UUID NOT NULL REFERENCES chore_definitions(id) ON DELETE CASCADE,
  household_id   UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  date           DATE NOT NULL,
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE (definition_id, date)
);

CREATE INDEX IF NOT EXISTS idx_chore_skips_household_date ON chore_skips (household_id, date);

ALTER TABLE chore_skips ENABLE ROW LEVEL SECURITY;
