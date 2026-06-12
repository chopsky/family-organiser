-- Device calendar sync (EventKit) - Phase 1
-- Run this in the Supabase SQL Editor.
--
-- Extends external_calendar_feeds so an iPhone can act as a read-only sync
-- agent: the app reads the user's selected device calendars via EventKit and
-- uploads copies, which flow through the SAME feed-event pipeline (events in
-- calendar_events with external_feed_id + external_uid, cascade on unlink).
--
--   * source            - 'ical' (existing URL feeds) | 'device' (EventKit)
--   * device_calendar_id- EKCalendar.calendarIdentifier. DEVICE-LOCAL: changes
--                         on a new phone/reinstall, which is why reconnects
--                         "adopt" a stale link by (owner, display_name) match
--                         instead of trusting this id alone.
--   * device_owner_user_id - whose phone feeds this link (the member who
--                         granted EventKit access). Cascade with the user.
--   * last_sync_hash    - content hash of the last applied payload, so an
--                         unchanged calendar is a no-op (no delete+insert
--                         churn, no bandwidth).
--
-- feed_url for device rows is synthetic: 'device://<user_id>/<calendar_id>'.
-- It satisfies the NOT NULL + the (household_id, feed_url) unique index, which
-- makes re-links idempotent per device calendar.

ALTER TABLE external_calendar_feeds
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'ical',
  ADD COLUMN IF NOT EXISTS device_calendar_id text,
  ADD COLUMN IF NOT EXISTS device_owner_user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS last_sync_hash text;

-- Guard the discriminator. Drop+recreate so the migration is rerunnable.
ALTER TABLE external_calendar_feeds
  DROP CONSTRAINT IF EXISTS external_calendar_feeds_source_check;
ALTER TABLE external_calendar_feeds
  ADD CONSTRAINT external_calendar_feeds_source_check CHECK (source IN ('ical', 'device'));

-- "Which links does this member's phone own?" - used by adopt-on-reconnect
-- and the per-member connected-calendars list.
CREATE INDEX IF NOT EXISTS idx_external_calendar_feeds_device_owner
  ON external_calendar_feeds(device_owner_user_id)
  WHERE device_owner_user_id IS NOT NULL;
