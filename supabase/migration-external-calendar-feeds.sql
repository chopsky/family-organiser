-- Migration: External calendar feed subscriptions (read-only inbound)
-- Run this in the Supabase SQL Editor.
--
-- Replaces the inbound side of the old two-way sync. Users paste an iCal
-- URL (Google/Apple/Outlook calendar export, school calendar, sports
-- fixtures, etc.) and Housemait pulls events read-only on a poll.
--
-- Key design decisions (Option 1 from the design discussion):
--   * Per-user feeds, household-visible events. One person subscribes the
--     family iCal once and the whole household sees it.
--   * Dedup at subscribe-time, not pull-time: unique on (household_id,
--     feed_url) so a second member of the household can't add the same
--     URL. Pull-time dedup across feeds (different URLs that produce
--     overlapping UIDs) is left for v2.
--   * Events live in calendar_events with external_feed_id + external_uid
--     columns. CASCADE on the FK so removing a feed cleans up its
--     events automatically. Soft-delete is handled by the application
--     layer if/when we want recoverable removal.

CREATE TABLE IF NOT EXISTS external_calendar_feeds (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid        NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
  household_id          uuid        NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  feed_url              text        NOT NULL,
  display_name          text        NOT NULL,
  color                 text        NOT NULL DEFAULT 'sky',
  sync_enabled          boolean     NOT NULL DEFAULT true,
  last_synced_at        timestamptz,
  last_error            text,
  consecutive_failures  integer     NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- One subscription per URL per household. Prevents Sarah and Tom both
-- subscribing the same iCloud Family export and creating duplicate event
-- rows. The error PostgREST returns on conflict is what the API
-- translates into the "Tom already subscribed this" friendly message.
CREATE UNIQUE INDEX IF NOT EXISTS idx_external_calendar_feeds_household_url
  ON external_calendar_feeds(household_id, feed_url);

CREATE INDEX IF NOT EXISTS idx_external_calendar_feeds_user
  ON external_calendar_feeds(user_id);

-- Add external-feed tracking to calendar_events. external_feed_id
-- identifies which feed an event came from (NULL = Housemait-originated
-- as before). external_uid is the iCal UID, used to upsert across polls
-- so updates apply to the same row instead of creating duplicates.
ALTER TABLE calendar_events
  ADD COLUMN IF NOT EXISTS external_feed_id uuid REFERENCES external_calendar_feeds(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS external_uid     text;

-- Speed up "give me all events from this feed" — used at poll time and
-- when removing a feed.
CREATE INDEX IF NOT EXISTS idx_calendar_events_external_feed
  ON calendar_events(external_feed_id)
  WHERE external_feed_id IS NOT NULL;

-- Upsert key for the pull: (feed, UID) must be unique per feed.
-- Deliberately NON-partial — a partial unique index can't be used by
-- Postgres' ON CONFLICT inference unless the INSERT's WHERE clause
-- matches the predicate, which Supabase JS's upsert doesn't expose.
-- Housemait-originated rows (both columns NULL) coexist fine because
-- (NULL, NULL) is distinct under default NULLS DISTINCT semantics.
CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_events_feed_uid
  ON calendar_events(external_feed_id, external_uid);

-- Enable Row Level Security to satisfy Supabase's "tables without RLS"
-- linter. Backend access uses the service_role key (which bypasses RLS),
-- so no policies are defined — RLS-enabled with zero policies means
-- "deny all" to anon/authenticated keys, which is the correct default
-- for tables only the API should touch. Matches the pattern used by
-- migration-rls-security.sql for ai_usage_log etc.
ALTER TABLE public.external_calendar_feeds ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.external_calendar_feeds IS
  'Read-only inbound calendar feed subscriptions. RLS enabled with no policies — only accessible via service_role key.';
