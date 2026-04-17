-- Migration: Calendar sync health tracking
-- Run this in the Supabase SQL Editor.
--
-- Context: Apple CalDAV sync silently failed for 4 days because every poll
-- threw on bad credentials. The code only updated last_synced_at on success,
-- so stale data was indistinguishable from a never-polled subscription.
--
-- This migration adds explicit failure tracking so:
--   1. We can tell the difference between "never attempted" and "failing"
--   2. We can show a banner in the UI when sync is broken
--   3. We can auto-disable subs that have been failing for a long time,
--      to stop hammering the provider with bad credentials

ALTER TABLE calendar_subscriptions
  ADD COLUMN IF NOT EXISTS last_attempted_at   timestamptz,
  ADD COLUMN IF NOT EXISTS last_sync_error     text,
  ADD COLUMN IF NOT EXISTS consecutive_failures integer NOT NULL DEFAULT 0;

-- Index to find subscriptions currently in a failing state (non-null error).
CREATE INDEX IF NOT EXISTS idx_calendar_subscriptions_failing
  ON calendar_subscriptions (connection_id)
  WHERE last_sync_error IS NOT NULL;
