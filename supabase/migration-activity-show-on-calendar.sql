-- Per-activity "show on the family calendar" toggle.
--
-- Weekly extracurriculars (child_weekly_schedule) always render on the
-- kids' calendar in Child Mode; this flag additionally surfaces them on
-- the main adult calendar. Defaults TRUE - the add-activity modal ships
-- with the box checked, and existing activities appear on the calendar
-- until a parent unticks them.
--
-- Run this in the Supabase SQL editor.

ALTER TABLE child_weekly_schedule
  ADD COLUMN IF NOT EXISTS show_on_calendar boolean NOT NULL DEFAULT true;
