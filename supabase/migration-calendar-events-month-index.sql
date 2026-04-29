-- Migration: speed up GET /api/calendar/month
--
-- The month endpoint hits getCalendarEvents (src/db/queries.js), which
-- filters calendar_events by household_id + deleted_at IS NULL + a
-- start_time/end_time range. After importing thousands of inbound-feed
-- events, that query started hitting Supabase's 8s statement_timeout
-- (Postgres error code 57014) on uncached months — so the calendar page
-- 500s for any month not already in the in-process LRU.
--
-- The fix is a partial composite btree on the live (non-soft-deleted)
-- subset, ordered by household and start_time. Postgres can range-scan
-- (household_id, start_time) directly and the partial WHERE means it
-- only stores live rows — so the index stays small even as soft-deletes
-- accumulate.
--
-- We don't include end_time: the start_time filter alone narrows the
-- candidate set to ~1 month of rows per household, and a residual
-- end_time check is trivial. Adding end_time to the key would only
-- bloat the index.
--
-- CONCURRENTLY so we don't take an ACCESS EXCLUSIVE lock on the table
-- during creation. Must be run outside a transaction (no BEGIN/COMMIT
-- around it) — Supabase SQL Editor handles this if you paste the
-- statement on its own.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_calendar_events_household_start_live
  ON calendar_events (household_id, start_time)
  WHERE deleted_at IS NULL;

ANALYZE calendar_events;
