-- Migration: calendar_events tombstone purge (30-day retention) + weekly-sweep function
--
-- Supersedes migration-purge-old-soft-deletes-phase1.sql (written when the
-- graveyard was ~50k rows and never applied). Measured 2026-07-03:
--
--   total rows                     2,318,283
--   tombstoned (deleted_at set)    2,310,859   (99.7% of the table)
--   tombstones older than 30 days  2,310,701   <- what this purges
--   tombstones created last 60d          202   (the old sync-era leak is dead)
--   live rows                          7,424
--
-- The tombstones are dead weight: every reader filters deleted_at IS NULL
-- (calendar queries, outbound ICS feed, reminders), the bot/kids undo
-- window is 10 minutes, and the "recently deleted" restore list only
-- becomes more usable when trimmed to 30 days. They actively hurt: an
-- interrupted pg_dump's COPY of this table has blocked ALTER TABLE
-- migrations before, and COUNT/scan queries time out.
--
-- All FKs referencing calendar_events (event_reminders, event_assignees,
-- event_attachments, google-sync mappings) are ON DELETE CASCADE, so a
-- hard DELETE is clean. Supabase's daily backups/PITR cover the (remote)
-- "need it back" case; rows this old are sync bookkeeping, not user data.
--
-- HOW TO RUN (Supabase SQL Editor):
--   1. Run section 1 and sanity-check the counts.
--   2. Run section 2 (creates the batch-purge function used both here and
--      by the weekly src/jobs/calendar-tombstone-purge.js sweep).
--   3. Run section 3 (the batched initial purge). Takes a few minutes.
--   4. Run section 4 (index + ANALYZE) after the purge, when the index
--      only has a handful of rows to include.

-- ─── 1. PREVIEW ──────────────────────────────────────────────────────────────

SELECT
  count(*)                                                             AS total_rows,
  count(*) FILTER (WHERE deleted_at IS NOT NULL)                       AS tombstoned,
  count(*) FILTER (WHERE deleted_at < now() - interval '30 days')      AS purgeable_30d,
  count(*) FILTER (WHERE deleted_at >= now() - interval '30 days')     AS kept_recent_tombstones
FROM calendar_events;


-- ─── 2. BATCH-PURGE FUNCTION ────────────────────────────────────────────────
-- Deletes ONE batch of expired tombstones and returns the count. Callers
-- loop until it returns 0 - each call is its own transaction, so no
-- long-held locks and no giant WAL spike. Used by:
--   • section 3 below (initial bulk purge), and
--   • the weekly retention sweep in src/jobs/calendar-tombstone-purge.js
--     (via supabaseAdmin.rpc), so the graveyard never regrows.
--
-- p_retention_days is floored at 7 as a fat-finger guard: the bot/kids
-- undo window is minutes and the restore UI is meant for "last few days"
-- accidents, but nothing should ever be able to purge fresh tombstones.

CREATE OR REPLACE FUNCTION public.purge_calendar_tombstones(
  p_retention_days integer DEFAULT 30,
  p_batch_size     integer DEFAULT 10000
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '5min'
AS $$
DECLARE
  v_deleted integer;
BEGIN
  IF p_retention_days < 7 THEN
    RAISE EXCEPTION 'purge_calendar_tombstones: retention below 7 days refused (got %)', p_retention_days;
  END IF;
  IF p_batch_size < 1 OR p_batch_size > 100000 THEN
    RAISE EXCEPTION 'purge_calendar_tombstones: batch size must be 1-100000 (got %)', p_batch_size;
  END IF;

  -- The IN-subquery is served by the partial index
  -- idx_calendar_events_deleted (deleted_at WHERE deleted_at IS NOT NULL)
  -- from migration-soft-delete.sql. FK cascades clean up reminders,
  -- assignees, attachments and sync mappings.
  DELETE FROM calendar_events
   WHERE id IN (
     SELECT id
       FROM calendar_events
      WHERE deleted_at IS NOT NULL
        AND deleted_at < now() - make_interval(days => p_retention_days)
      LIMIT p_batch_size
   );

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- Backend calls this via RPC with the service key; nothing else should.
REVOKE ALL ON FUNCTION public.purge_calendar_tombstones(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_calendar_tombstones(integer, integer) TO service_role;


-- ─── 3. INITIAL BULK PURGE (batched) ────────────────────────────────────────
-- ~2.31M rows at 50k per batch ≈ 47 batches. The editor runs this whole
-- block as one transaction, but each DELETE only row-locks the rows it
-- removes - normal app reads/writes are unaffected. Just don't run a DDL
-- migration at the same moment. Expect a few minutes; progress is
-- reported via RAISE NOTICE per batch.
--
-- If the editor times the block out anyway, run this single statement
-- repeatedly until it returns 0 instead:
--   SELECT public.purge_calendar_tombstones(30, 50000);

SET statement_timeout = '30min';

DO $$
DECLARE
  v_batch integer;
  v_total bigint := 0;
BEGIN
  LOOP
    v_batch := public.purge_calendar_tombstones(30, 50000);
    v_total := v_total + v_batch;
    EXIT WHEN v_batch = 0;
    RAISE NOTICE 'purged batch of % (running total %)', v_batch, v_total;
  END LOOP;
  RAISE NOTICE 'tombstone purge complete: % rows hard-deleted', v_total;
END;
$$;

RESET statement_timeout;


-- ─── 4. INDEX + STATS (run AFTER the purge) ─────────────────────────────────
-- Partial index on (household_id, deleted_at) for per-household tombstone
-- reads: the "recently deleted" restore list (getDeletedCalendarEvents)
-- and restore-by-id. Created after the purge on purpose - post-purge it
-- indexes a few hundred rows instead of 2.3M. The existing partial index
-- idx_calendar_events_deleted (deleted_at only) keeps serving the global
-- retention sweep.

CREATE INDEX IF NOT EXISTS idx_calendar_events_household_deleted
  ON calendar_events(household_id, deleted_at)
  WHERE deleted_at IS NOT NULL;

-- Refresh planner stats - row estimates are wildly stale after removing
-- 99.7% of the table. Autovacuum will reclaim dead tuples on its own;
-- run a manual `VACUUM (ANALYZE) calendar_events;` instead if you want
-- the space marked reusable immediately. (VACUUM FULL would shrink the
-- file on disk but takes an ACCESS EXCLUSIVE lock - skip unless there's
-- a maintenance window.)
ANALYZE calendar_events;

-- Confirm: tombstoned should be a few hundred, purgeable_30d should be 0.
SELECT
  count(*)                                                         AS total_rows,
  count(*) FILTER (WHERE deleted_at IS NOT NULL)                   AS tombstoned,
  count(*) FILTER (WHERE deleted_at < now() - interval '30 days')  AS purgeable_30d
FROM calendar_events;
