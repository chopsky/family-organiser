-- Stale device-calendar nudge throttle.
-- Run this in the Supabase SQL Editor.
--
-- A device-synced calendar only updates when the owning iPhone opens the
-- app (foreground sync). If the owner stops opening Housemait, their
-- calendars silently freeze while the family keeps seeing stale events.
-- A daily cron now pushes the OWNER a gentle "open the app and it'll
-- catch up" nudge; this column records when the last nudge went out so
-- the cron can throttle (once per stale period, repeat at most weekly,
-- and stop entirely for long-dead links).

ALTER TABLE external_calendar_feeds
  ADD COLUMN IF NOT EXISTS stale_nudge_sent_at timestamptz;
