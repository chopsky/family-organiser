-- Backfill: dedupe "Previously purchased" rows in shopping_items.
--
-- Problem: until the route-level dedup landed (PATCH /shopping/:id), every
-- re-purchase of an item stacked another completed row on the list. The
-- "Previously purchased" UI surfaces all of them — so a household that's
-- bought milk three times sees three "milk" rows in the history.
--
-- Forward fix: src/routes/shopping.js + src/db/queries.js#purgePriorPurchases
--   delete prior completed rows on every fresh check-off.
--
-- This migration is the one-time backfill for households that already have
-- duplicate completed rows. It groups completed shopping_items by
-- (household_id, list_id, lower(trim(item))) and keeps only the row with
-- the most recent completed_at — every other row in each group is hard-
-- deleted.
--
-- ── Run order ──
-- 1. Run section 1 (preview) first. Confirm the preview row counts match
--    your expectations before wiping anything.
-- 2. Run section 2 (delete). It's wrapped in a transaction so you can
--    BEGIN; ... ROLLBACK; on staging if you want a dry run.
-- 3. Run section 3 (verify) to confirm zero duplicate groups remain.
--
-- Safe to run multiple times — section 2 is idempotent (re-running on a
-- clean dataset deletes zero rows).

-- ── 1. Preview: how many rows will be removed? ────────────────────────
-- Uncomment to inspect before deleting.
--
-- WITH ranked AS (
--   SELECT
--     id,
--     household_id,
--     list_id,
--     lower(trim(item)) AS item_key,
--     completed_at,
--     ROW_NUMBER() OVER (
--       PARTITION BY household_id, list_id, lower(trim(item))
--       ORDER BY completed_at DESC NULLS LAST, id DESC
--     ) AS rn
--   FROM shopping_items
--   WHERE completed = true
-- )
-- SELECT
--   COUNT(*) FILTER (WHERE rn = 1) AS rows_to_keep,
--   COUNT(*) FILTER (WHERE rn > 1) AS rows_to_delete,
--   COUNT(DISTINCT (household_id, list_id, item_key))
--     FILTER (WHERE rn > 1) AS distinct_dup_groups
-- FROM ranked;

-- ── 2. Delete duplicates ──────────────────────────────────────────────
BEGIN;

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY household_id, list_id, lower(trim(item))
      ORDER BY completed_at DESC NULLS LAST, id DESC
    ) AS rn
  FROM shopping_items
  WHERE completed = true
)
DELETE FROM shopping_items
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

COMMIT;

-- ── 3. Verify: should return 0 rows ────────────────────────────────────
-- Any (household_id, list_id, item_key) group that still has more than
-- one completed row indicates the dedupe didn't fire — investigate.
--
-- SELECT household_id, list_id, lower(trim(item)) AS item_key, COUNT(*)
-- FROM shopping_items
-- WHERE completed = true
-- GROUP BY household_id, list_id, lower(trim(item))
-- HAVING COUNT(*) > 1
-- ORDER BY COUNT(*) DESC;
