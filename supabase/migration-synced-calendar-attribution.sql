-- Synced-calendar attribution: a subscribed/synced calendar belongs to a
-- household member (by default the person who connected it), and its events
-- inherit that member's colour + are attributed to them — instead of each feed
-- carrying its own pickable colour that can clash with a member's profile colour.
--
-- owner_member_id is the member the feed's events are attributed to:
--   - set (a users.id)  → events get that member's colour + assignment
--   - NULL              → "Shared" calendar (school / holidays / family): a
--                         neutral colour, attributed to no single person
--
-- Members in Housemait ARE rows in `users` (account + dependent), so this FKs to
-- users(id). Distinct from external_calendar_feeds.user_id, which records who
-- *connected* the subscription (unchanged).

ALTER TABLE external_calendar_feeds
  ADD COLUMN IF NOT EXISTS owner_member_id uuid REFERENCES users(id) ON DELETE SET NULL;

-- Backfill: existing feeds default to the subscriber (their own calendar). For
-- device feeds, the owner is the phone's owner if known. Shared/school calendars
-- can be re-pointed to NULL in the UI afterwards.
UPDATE external_calendar_feeds
SET owner_member_id = COALESCE(device_owner_user_id, user_id)
WHERE owner_member_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_external_feeds_owner_member
  ON external_calendar_feeds(owner_member_id)
  WHERE owner_member_id IS NOT NULL;
