-- Migration: hard-delete calendar_events soft-deleted >= 90 days ago
--
-- Phase 1 of the soft-delete housekeeping. The bulk-cleanup pass after
-- the two-way sync rip-out left ~50k rows sitting in calendar_events
-- with deleted_at NOT NULL. The partial index added in
-- migration-calendar-events-month-index.sql means they no longer hurt
-- query performance — but they still bloat the table, indexes, and
-- backups. 90 days is a conservative cutoff: anything that old is well
-- past any plausible "I deleted that by accident" recovery window.
--
-- Run order (all in the Supabase SQL Editor — no local tooling needed):
--   1. Run section 1 (PREVIEW) to count what will be deleted and
--      sanity-check.
--   2. Run section 2 (BACKUP) to snapshot the to-be-deleted rows into
--      sibling tables. Replaces pg_dump for our purposes — recovery is
--      a one-line INSERT...SELECT away.
--   3. Run section 3 (DELETE) inside its BEGIN/COMMIT transaction.
--   4. Run section 4 (POST) to refresh planner stats.
--
-- After a few weeks of confidence (or once you're happy nothing was
-- needed back), drop the backup tables — see section 5.
--
-- Phase 2 (later, optional): drop the cutoff to 30 days once Phase 1
-- has been uneventful.

-- ─── 1. PREVIEW ────────────────────────────────────────────────────────────
-- Run these SELECTs first. Do not run the DELETEs until you've eyeballed
-- the counts. Expected order of magnitude: tens of thousands.

-- How many calendar_events would be hard-deleted?
SELECT COUNT(*) AS events_to_purge
  FROM calendar_events
 WHERE deleted_at IS NOT NULL
   AND deleted_at < NOW() - INTERVAL '90 days';

-- How many event_assignees rows hang off those events?
-- (Worth knowing whether the FK has ON DELETE CASCADE; if not, we delete
-- assignees first.)
SELECT COUNT(*) AS assignees_on_purge_targets
  FROM event_assignees ea
  JOIN calendar_events ce ON ce.id = ea.event_id
 WHERE ce.deleted_at IS NOT NULL
   AND ce.deleted_at < NOW() - INTERVAL '90 days';

-- Inspect the FK action so we know whether assignees auto-cascade.
-- Look at the "delete_action" column. 'c' = CASCADE, 'a' = NO ACTION,
-- 'r' = RESTRICT, 'n' = SET NULL, 'd' = SET DEFAULT.
SELECT
  con.conname,
  con.confdeltype AS delete_action,
  pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class child  ON child.oid  = con.conrelid
JOIN pg_class parent ON parent.oid = con.confrelid
WHERE parent.relname = 'calendar_events'
  AND child.relname  = 'event_assignees';

-- Sample 10 of the rows that would be purged, to spot-check.
SELECT id, household_id, title, start_time, deleted_at
  FROM calendar_events
 WHERE deleted_at IS NOT NULL
   AND deleted_at < NOW() - INTERVAL '90 days'
 ORDER BY deleted_at
 LIMIT 10;


-- ─── 2. BACKUP ─────────────────────────────────────────────────────────────
-- Snapshot the rows we're about to purge into sibling tables. If anything
-- ever needs to be restored, we can SELECT from these — see section 5
-- for the recovery one-liners. Drop the backup tables once you're sure
-- nothing was needed (a couple of weeks is plenty).
--
-- These tables get the same column shape as the source via SELECT *. They
-- intentionally have NO indexes / FKs / constraints — they're a flat
-- recovery dump, not a working table.

CREATE TABLE calendar_events_purged_backup AS
SELECT * FROM calendar_events
 WHERE deleted_at IS NOT NULL
   AND deleted_at < NOW() - INTERVAL '90 days';

CREATE TABLE event_assignees_purged_backup AS
SELECT ea.*
  FROM event_assignees ea
  JOIN calendar_events ce ON ce.id = ea.event_id
 WHERE ce.deleted_at IS NOT NULL
   AND ce.deleted_at < NOW() - INTERVAL '90 days';

-- Verify the backups have the same row counts as the preview SELECTs
-- showed. If these don't match what you saw in section 1, STOP and
-- investigate before proceeding.
SELECT COUNT(*) AS events_backed_up    FROM calendar_events_purged_backup;
SELECT COUNT(*) AS assignees_backed_up FROM event_assignees_purged_backup;


-- ─── 3. DELETE ─────────────────────────────────────────────────────────────
-- ONLY RUN AFTER PREVIEW + BACKUP LOOK RIGHT.
--
-- Wrapped in a transaction so if anything goes wrong (locks, timeout,
-- you change your mind) you can ROLLBACK without leaving partial state.
-- If the FK delete_action above was 'c' (CASCADE), the assignees DELETE
-- below is redundant but harmless — keeps the migration safe to re-run
-- on a project where someone forgot to set CASCADE.

BEGIN;

-- 3a. Drop assignees first (works whether CASCADE is set or not).
DELETE FROM event_assignees
 WHERE event_id IN (
   SELECT id FROM calendar_events
    WHERE deleted_at IS NOT NULL
      AND deleted_at < NOW() - INTERVAL '90 days'
 );

-- 3b. Drop the events themselves.
DELETE FROM calendar_events
 WHERE deleted_at IS NOT NULL
   AND deleted_at < NOW() - INTERVAL '90 days';

COMMIT;


-- ─── 4. POST ───────────────────────────────────────────────────────────────
-- Refresh planner statistics. After deleting tens of thousands of rows,
-- the planner's row estimates for calendar_events are now stale.
ANALYZE calendar_events;
ANALYZE event_assignees;

-- (Optional) If you want to immediately reclaim disk and rebuild indexes:
--   VACUUM (ANALYZE, VERBOSE) calendar_events;
-- VACUUM FULL would compact the table more aggressively but takes an
-- ACCESS EXCLUSIVE lock; not recommended on a live table without a
-- maintenance window. Plain VACUUM is fine.


-- ─── 5. RECOVERY (only if needed) ──────────────────────────────────────────
-- If you ever need to restore the purged rows, run these. They're safe
-- to run multiple times because INSERT ... ON CONFLICT DO NOTHING skips
-- rows that are already present.
--
-- INSERT INTO calendar_events
-- SELECT * FROM calendar_events_purged_backup
-- ON CONFLICT (id) DO NOTHING;
--
-- INSERT INTO event_assignees
-- SELECT * FROM event_assignees_purged_backup
-- ON CONFLICT DO NOTHING;


-- ─── 6. CLEAN UP THE BACKUP TABLES (run later, when confident) ─────────────
-- After a few weeks with no need to restore, drop the backups to reclaim
-- the space.
--
-- DROP TABLE calendar_events_purged_backup;
-- DROP TABLE event_assignees_purged_backup;
