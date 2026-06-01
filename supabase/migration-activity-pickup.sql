-- Migration: per-activity pickup person for after-school activities.
--
-- child_weekly_schedule rows (the after-school / weekly activities shown
-- under Family) gain an optional pickup_member_id pointing at the
-- household member responsible for collecting the child from that
-- activity. Nullable - "no pickup set" is the default.
--
-- Left as a plain uuid (no FK constraint) to match the loose style of
-- assignee columns elsewhere; the app resolves it against the household
-- member list and tolerates a stale id (renders "no pickup" if the
-- member was removed).
--
-- Run in the Supabase SQL Editor.

ALTER TABLE child_weekly_schedule
  ADD COLUMN IF NOT EXISTS pickup_member_id uuid;
