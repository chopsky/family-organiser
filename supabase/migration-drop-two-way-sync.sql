-- Migration: drop dead two-way calendar sync tables + RPC
--
-- The application code that read/wrote these tables has been removed
-- (calendarSync.js, all OAuth/webhook routes, the Apple polling cron,
-- the disconnect endpoint, the Settings UI section). This migration
-- drops the underlying schema.
--
-- Order matters: calendar_sync_mappings has FKs to calendar_connections
-- and calendar_subscriptions. calendar_subscriptions has an FK to
-- calendar_connections. So we drop child tables before parents.
--
-- We also NULL out calendar_events.subscription_id before dropping
-- calendar_subscriptions, since some historical rows (including
-- soft-deleted ones) still reference it. The subscription_id column
-- itself is left in place — to be dropped in a separate cleanup
-- migration once we've verified nothing depends on it (e.g. analytics
-- queries, soft-delete restoration paths). Leaving the column also
-- gives a safety net: if for any reason a row still has a non-null
-- subscription_id value pointing at a now-deleted subscription row,
-- queries that filter `subscription_id IS NULL` continue to behave
-- correctly without us needing a backfill.
--
-- Run this in the Supabase SQL Editor.

-- 1. Decouple calendar_events from calendar_subscriptions so the FK
--    cascade doesn't matter. Pure UPDATE — no rows deleted.
UPDATE calendar_events
   SET subscription_id = NULL
 WHERE subscription_id IS NOT NULL;

-- 2. Drop the cascade RPC. It's no longer called anywhere.
DROP FUNCTION IF EXISTS public.disconnect_calendar_connection(uuid, text);

-- 3. Drop the join/state tables in dependency order. CASCADE handles
--    any straggler FKs we missed.
DROP TABLE IF EXISTS calendar_sync_mappings CASCADE;
DROP TABLE IF EXISTS calendar_subscriptions CASCADE;
DROP TABLE IF EXISTS calendar_connections   CASCADE;

-- 4. Drop the now-orphaned partial index on calendar_events. The column
--    it covers (subscription_id) still exists, just unused.
DROP INDEX IF EXISTS idx_calendar_events_subscription;
