-- Extracurricular activities: allow weekend days (Saturday + Sunday).
--
-- The child_weekly_schedule.day_of_week column was constrained to 0-4
-- (Monday-Friday). Families have weekend clubs too (Saturday football,
-- Sunday swimming), so widen the range to 0-6 (Monday-Sunday), keeping
-- the same 0=Monday convention used everywhere in the app + AI prompts.
--
-- Idempotent: drops the existing CHECK (whatever Postgres auto-named it)
-- and adds a named one so re-running is a no-op and future migrations
-- can reference it by name.
--
-- Run this in the Supabase SQL editor.

DO $$
DECLARE
  con_name text;
BEGIN
  -- Find the existing day_of_week CHECK constraint by its definition,
  -- since the inline CREATE TABLE gave it an auto-generated name.
  SELECT conname INTO con_name
  FROM pg_constraint
  WHERE conrelid = 'child_weekly_schedule'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%day_of_week%between 0 and 4%';

  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE child_weekly_schedule DROP CONSTRAINT %I', con_name);
  END IF;

  -- Drop our named constraint too if a previous run created it, so this
  -- block is fully re-runnable.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'child_weekly_schedule'::regclass
      AND conname = 'child_weekly_schedule_day_of_week_check'
  ) THEN
    ALTER TABLE child_weekly_schedule DROP CONSTRAINT child_weekly_schedule_day_of_week_check;
  END IF;
END$$;

ALTER TABLE child_weekly_schedule
  ADD CONSTRAINT child_weekly_schedule_day_of_week_check
  CHECK (day_of_week BETWEEN 0 AND 6);
