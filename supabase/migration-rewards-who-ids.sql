-- Rewards: assign one reward to MULTIPLE members.
--
-- Replaces the single `who` TEXT ('any' or one member id) with a `who_ids`
-- UUID[] so a reward can target several people at once. Semantics:
--   who_ids = '{}'        -> applies to everyone (legacy 'any' rows)
--   who_ids = {a, b, ...} -> applies to those members
-- The "Anyone" chip is dropped from the UI; the empty-array fallback only
-- keeps pre-existing 'any' rewards visible.

ALTER TABLE rewards ADD COLUMN IF NOT EXISTS who_ids UUID[] NOT NULL DEFAULT '{}';

-- Backfill from the legacy single `who` (a member id as text). 'any' (and any
-- non-uuid value) stays an empty array = everyone.
UPDATE rewards
SET who_ids = ARRAY[who::uuid]
WHERE cardinality(who_ids) = 0
  AND who IS NOT NULL
  AND who <> 'any'
  AND who ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
