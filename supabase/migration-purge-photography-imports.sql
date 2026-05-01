-- Purge: legacy two-way-sync events imported from Apple Photography
-- calendar.
--
-- Context:
--   The pre-removal two-way Apple Calendar sync imported the user's
--   Photography work calendar into Housemait alongside personal events.
--   The sync code is gone; the column that distinguished imports
--   (calendar_events.subscription_id) was nulled out by the
--   migration-drop-two-way-sync.sql cleanup. We can no longer tell
--   "where this row came from" from schema alone — but Photography
--   events have a distinctive title shape: they all contain either
--   "Wedding/Engagement" or "Destination Wedding".
--
-- Strategy:
--   Soft-delete (set deleted_at = now()) rather than hard-delete.
--   Reasons:
--     1. The codebase already filters out deleted_at IS NOT NULL rows
--        from every read path, so the user-visible result is identical
--        to a hard delete — but recoverable.
--     2. Matches the pattern established by the existing
--        migration-soft-delete.sql + migration-purge-old-soft-deletes
--        infrastructure. Soft-deleted rows age out via the scheduled
--        purge job (the existing soft-delete purge has a 90-day window).
--     3. If a Photography event was somehow misidentified by the title
--        filter, the user can flip deleted_at back to NULL within the
--        90-day window and recover it without DBA help.
--
-- ── Run order ──────────────────────────────────────────────────────────
-- 1. Preview (read-only) — confirm the row count + sample titles match
--    what you expect before committing.
-- 2. Soft-delete (BEGIN/COMMIT) — flip deleted_at = now() on the matched
--    rows. Wrapped in a transaction so you can ROLLBACK on staging.
-- 3. Verify — should return 0 LIVE rows matching the title filter.
-- 4. Recovery (commented) — copy + paste with the right cutoff timestamp
--    if you ever need to restore.

-- ── 1. Preview ────────────────────────────────────────────────────────
-- Read-only. Run this first and check:
--   - Row count looks plausible (your sense of how many photography
--     events live in the calendar).
--   - The sample titles all look photography-business-related.
--   - You're not seeing any titles that look like personal Housemait
--     events you typed yourself ("Sarah's birthday", "School play", etc).

SELECT
  id,
  household_id,
  title,
  start_time,
  end_time,
  all_day,
  created_at
FROM calendar_events
WHERE deleted_at IS NULL
  AND (
    title ILIKE '%Wedding/Engagement%'
    OR title ILIKE '%Destination Wedding%'
  )
  -- Uncomment + paste your household id for extra safety. Without
  -- this, the migration applies across every household in the DB —
  -- which is fine for "Wedding/Engagement" since it's a phrase
  -- specific to your photography business, but the scope guard is
  -- cheap belt-and-braces.
  -- AND household_id = '<your-household-id-here>'
ORDER BY start_time DESC
LIMIT 200;


-- ── 2. Soft-delete ────────────────────────────────────────────────────
-- Wrapped in BEGIN/COMMIT. On staging you can replace COMMIT with
-- ROLLBACK to dry-run.
--
-- Idempotent: re-running on a dataset that's already been cleaned
-- updates zero rows (the deleted_at IS NULL filter excludes anything
-- already soft-deleted).

BEGIN;

UPDATE calendar_events
SET deleted_at = now()
WHERE deleted_at IS NULL
  AND (
    title ILIKE '%Wedding/Engagement%'
    OR title ILIKE '%Destination Wedding%'
  )
  -- Uncomment to scope to your household:
  -- AND household_id = '<your-household-id-here>'
;

COMMIT;


-- ── 3. Verify ─────────────────────────────────────────────────────────
-- Should return 0 rows. Anything still here means the title filter
-- missed it — investigate before assuming the purge held.

SELECT
  id,
  household_id,
  title,
  start_time
FROM calendar_events
WHERE deleted_at IS NULL
  AND (
    title ILIKE '%Wedding/Engagement%'
    OR title ILIKE '%Destination Wedding%'
  );


-- ── 4. Recovery (only run if you need to undo) ────────────────────────
-- Soft-deleted rows are recoverable until the existing soft-delete
-- purge job hard-deletes them (90-day window per
-- migration-purge-old-soft-deletes-phase1.sql, currently scheduled to
-- run for the first time around late July 2026).
--
-- To restore everything this migration soft-deleted, replace the
-- timestamp in the WHERE clause with the moment you ran section 2
-- (give or take 30 seconds), then run:
--
-- UPDATE calendar_events
-- SET deleted_at = NULL
-- WHERE deleted_at >= '2026-05-01 12:00:00+00'  -- ← when you ran the purge
--   AND deleted_at <= '2026-05-01 12:00:30+00'  -- ← + 30s window
--   AND (
--     title ILIKE '%Wedding/Engagement%'
--     OR title ILIKE '%Destination Wedding%'
--   );
--
-- Restoring after the purge job has run is harder — the rows would have
-- been hard-deleted. The August 2026 purge run is your effective
-- "point of no return" deadline for this rollback path.
