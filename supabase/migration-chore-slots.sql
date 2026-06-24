-- Per-slot routine completion. A routine assigned to multiple time-of-day
-- slots (e.g. Morning + Evening) renders one instance per slot; each must be
-- tickable independently. Previously chore_completions was UNIQUE
-- (definition_id, member_id, date), so a single completion row marked every
-- slot done at once. Add a `slot` ('' for chores/anyone, 'morning'|'afternoon'
-- |'evening' for routines) and widen the uniqueness to include it.
ALTER TABLE chore_completions
  ADD COLUMN IF NOT EXISTS slot TEXT NOT NULL DEFAULT '';

ALTER TABLE chore_completions
  DROP CONSTRAINT IF EXISTS chore_completions_definition_id_member_id_date_key;

ALTER TABLE chore_completions
  ADD CONSTRAINT chore_completions_def_member_date_slot_key
  UNIQUE (definition_id, member_id, date, slot);
