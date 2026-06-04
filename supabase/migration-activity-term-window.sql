-- Term-aware weekly activities.
--
-- Until now a child_weekly_schedule row was open-ended ("Aftercare on Mondays")
-- with no date range, so it showed during every term forever and there was
-- only one slot per weekday - you couldn't set up next term's activities
-- without overwriting this term's.
--
-- These columns scope an activity to a date window (typically a school term):
--   start_date / end_date - the term window; reminders only surface the
--     activity when today falls inside it.
--   term_label            - a display label, e.g. "Autumn Term 2026", used to
--     group the weekly grid by term in the UI.
--
-- All NULL = "ongoing" (no window), which is exactly the existing behaviour,
-- so every current row keeps working with no backfill needed.

ALTER TABLE child_weekly_schedule ADD COLUMN IF NOT EXISTS start_date DATE;
ALTER TABLE child_weekly_schedule ADD COLUMN IF NOT EXISTS end_date DATE;
ALTER TABLE child_weekly_schedule ADD COLUMN IF NOT EXISTS term_label TEXT;
