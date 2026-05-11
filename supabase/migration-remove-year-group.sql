-- Remove `year_group` from the data model.
--
-- Rationale: storing a child's school + year together is genuinely sensitive
-- ("Y3 at Wolfson Hillel Primary" points an attacker at a specific child at
-- a specific school in a known catchment area). The functional value year
-- group provided was minimal:
--
--   • AI chat context — but age is already derivable from the existing
--     `birthday` column, which the AI already has access to.
--   • UI badges — purely cosmetic ("Y3, Wolfson Hillel" vs just the
--     school name).
--   • applies_to_year_groups on school_term_dates — schema-only; no code
--     ever filtered term dates by year group.
--
-- Net: minimal product win, real child-safety risk. Removed entirely.
--
-- This migration drops the columns AND any existing data in them. Idempotent
-- via DROP COLUMN IF EXISTS so it's safe to re-run.

ALTER TABLE users   DROP COLUMN IF EXISTS year_group;
ALTER TABLE invites DROP COLUMN IF EXISTS year_group;
ALTER TABLE school_term_dates DROP COLUMN IF EXISTS applies_to_year_groups;
