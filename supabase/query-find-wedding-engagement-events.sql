-- Find every LIVE calendar event in 2025-2027 whose title, description,
-- or location contains "wedding" or "engagement" (case-insensitive).
--
-- Read-only diagnostic query. Safe to run anytime.
--
-- Uses an overlap predicate (start <= range_end AND end >= range_start)
-- so events that span year boundaries are included exactly once.
--
-- ── Toggle hints ───────────────────────────────────────────────────────
-- 1. Include soft-deleted events: drop the `deleted_at IS NULL` line and
--    add `deleted_at` to the SELECT. Useful for verifying that an
--    earlier purge migration actually swept up everything it should
--    have (live rows show NULL, soft-deleted rows show a timestamp).
-- 2. Scope to one household: uncomment the household_id line near the
--    bottom and paste the right id.
-- 3. Different word: search for "anniversary", "birthday", etc. by
--    swapping the strings in the ILIKE block.
-- 4. Different date range: bump the boundary timestamps. UTC bounds
--    are fine for typical UK use; for strict local-time semantics,
--    add `AT TIME ZONE 'Europe/London'` on each side.

SELECT
  id,
  household_id,
  title,
  description,
  location,
  start_time,
  end_time,
  all_day,
  category,
  created_at
FROM calendar_events
WHERE deleted_at IS NULL
  AND start_time <= '2027-12-31 23:59:59+00'
  AND end_time   >= '2025-01-01 00:00:00+00'
  AND (
       title       ILIKE '%wedding%'
    OR title       ILIKE '%engagement%'
    OR description ILIKE '%wedding%'
    OR description ILIKE '%engagement%'
    OR location    ILIKE '%wedding%'
    OR location    ILIKE '%engagement%'
  )
  -- Uncomment to scope to your household:
  -- AND household_id = '7d60fde5-a2bb-4d6c-a69d-1f70daf28201'
ORDER BY start_time;
