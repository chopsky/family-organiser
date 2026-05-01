-- Backfill: repair all-day calendar events corrupted by the legacy
-- two-way Apple Calendar sync.
--
-- Symptom (reported in late April / May 2026, when BST was active):
--   "All-day wedding events occupy two days. The wedding today shows
--    today AND tomorrow, with times 01:00 → 01:00."
--
-- Root cause:
--   Apple Calendar exports an all-day event as `DTSTART;VALUE=DATE:YYYYMMDD`
--   with `DTEND` = the day AFTER (Apple's DTEND is exclusive). The legacy
--   two-way sync (now removed) parsed that as a UTC timestamp and stored:
--     start_time = 2026-05-01 00:00:00+00
--     end_time   = 2026-05-02 00:00:00+00   -- exactly 24h later
--     all_day    = false                    -- never set
--
--   In BST (UTC+1, March–October), 00:00 UTC renders as 01:00 local — hence
--   the "1 AM" the user reported. The frontend's eventsForDate filter
--   compares UTC-date strings: an event with end_date_str = day+1 qualifies
--   for both day and day+1, so each wedding occupies two calendar days.
--
--   In GMT (winter) the same data renders correctly, which is why this only
--   surfaced once the clocks sprang forward.
--
-- Forward fix:
--   None needed — the two-way sync code was removed before this migration.
--   New all-day events created via the in-app calendar set all_day=true and
--   stable timestamps (see src/routes/calendar.js POST handler).
--
-- ── Run order ──────────────────────────────────────────────────────────
-- 1. Run section 1 (preview) and confirm the row count + a few sample
--    titles look right (weddings, etc).
-- 2. Run section 2 (backup) — creates a snapshot table for safety.
-- 3. Run section 3 (fix) — wrapped in a transaction so you can BEGIN; …
--    ROLLBACK; on staging if you want a dry run.
-- 4. Run section 4 (verify) — should return 0 rows.
-- 5. Drop the backup table once you've confirmed the fix held (section 5,
--    commented). Keep it around for at least a few days first.

-- ── 1. Preview ────────────────────────────────────────────────────────
-- How many rows match the fingerprint, and what do they look like?
-- Read-only — safe to run anytime.

SELECT
  id,
  household_id,
  title,
  start_time,
  end_time,
  end_time - start_time AS duration,
  all_day
FROM calendar_events
WHERE deleted_at IS NULL
  AND all_day = false
  AND (start_time AT TIME ZONE 'UTC')::time = '00:00:00'
  AND (end_time   AT TIME ZONE 'UTC')::time = '00:00:00'
  AND end_time > start_time
ORDER BY start_time DESC
LIMIT 100;


-- ── 2. Backup ─────────────────────────────────────────────────────────
-- Snapshot every affected row before we touch it. Same pattern as the
-- soft-delete purge migration. Drop this table once you're satisfied
-- (section 5).

CREATE TABLE IF NOT EXISTS calendar_events_imported_allday_backup AS
SELECT *
FROM calendar_events
WHERE deleted_at IS NULL
  AND all_day = false
  AND (start_time AT TIME ZONE 'UTC')::time = '00:00:00'
  AND (end_time   AT TIME ZONE 'UTC')::time = '00:00:00'
  AND end_time > start_time;


-- ── 3. Fix ────────────────────────────────────────────────────────────
-- For each corrupted row:
--   - Set all_day = true so the frontend renders it as a date-only event.
--   - Shave 1 second off end_time so the UTC date string no longer bleeds
--     into the next day. The frontend's eventsForDate filter splits ISO
--     strings on 'T' and compares date prefixes; with end_time at
--     23:59:59 the same day, the event no longer qualifies for day+1.
--
-- Wrapped in a transaction so you can ROLLBACK on staging if anything
-- looks wrong before COMMIT.

BEGIN;

UPDATE calendar_events
SET
  all_day = true,
  end_time = end_time - interval '1 second'
WHERE deleted_at IS NULL
  AND all_day = false
  AND (start_time AT TIME ZONE 'UTC')::time = '00:00:00'
  AND (end_time   AT TIME ZONE 'UTC')::time = '00:00:00'
  AND end_time > start_time;

COMMIT;


-- ── 4. Verify ─────────────────────────────────────────────────────────
-- Should return 0 rows. Any hits indicate the fingerprint missed
-- something — investigate before assuming the fix held.

SELECT
  id,
  household_id,
  title,
  start_time,
  end_time,
  all_day
FROM calendar_events
WHERE deleted_at IS NULL
  AND all_day = false
  AND (start_time AT TIME ZONE 'UTC')::time = '00:00:00'
  AND (end_time   AT TIME ZONE 'UTC')::time = '00:00:00'
  AND end_time > start_time;


-- ── 5. Cleanup (after a few days) ─────────────────────────────────────
-- Once the fix has held in production for a week or two and you've
-- confirmed the affected calendars look right, drop the backup table.
--
-- DROP TABLE calendar_events_imported_allday_backup;
