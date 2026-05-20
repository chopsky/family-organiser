-- One-time backfill: remove the UK supermarket shopping lists
-- (M&S / Tesco / Waitrose / Sainsbury's / Aldi) from EVERY household.
--
-- Context: those names were seeded for every new household pre-multi-
-- region. Production usage data showed that 100% of items live in
-- "Default" - the supermarket-named lists were dead weight cluttering
-- the Shopping UI. The seeding code now only creates "Default" for all
-- new households (see DEFAULT_LISTS_BY_COUNTRY in src/db/queries.js).
-- This SQL cleans up the existing rows in the same spirit.
--
-- Safety: we ONLY delete a list if it has zero items. If any household
-- has somehow been using "Tesco" (none currently do, but defensive), we
-- leave it alone - their data stays, and they can rename or delete it
-- themselves.
--
-- Idempotent: running twice in a row is a no-op once the empty lists
-- are gone.
--
-- Run in Supabase SQL editor.

-- ── Step 1: preview what will be deleted ──────────────────────────
-- Read-only - shows the household_id, country, list name, and item
-- count for every candidate row. Sanity-check the list before the
-- DELETE below. Item count should be 0 for every row that the next
-- step actually removes (rows with items are preserved).
SELECT
  sl.id            AS list_id,
  sl.household_id,
  h.country,
  h.name           AS household_name,
  sl.name          AS list_name,
  COUNT(si.id)     AS item_count
FROM shopping_lists sl
JOIN households h ON h.id = sl.household_id
LEFT JOIN shopping_items si ON si.list_id = sl.id
WHERE sl.name IN ('M&S', 'Tesco', 'Waitrose', 'Sainsbury''s', 'Aldi')
GROUP BY sl.id, sl.household_id, h.country, h.name, sl.name
ORDER BY h.country NULLS FIRST, h.name, sl.name;

-- ── Step 2: apply the delete (empty lists only) ───────────────────
DELETE FROM shopping_lists sl
WHERE sl.id IN (
  SELECT sl2.id
  FROM shopping_lists sl2
  LEFT JOIN shopping_items si ON si.list_id = sl2.id
  WHERE sl2.name IN ('M&S', 'Tesco', 'Waitrose', 'Sainsbury''s', 'Aldi')
  GROUP BY sl2.id
  HAVING COUNT(si.id) = 0
);

-- ── Step 3: verify ────────────────────────────────────────────────
-- Should return zero rows. Any remaining UK-supermarket lists here
-- would mean an empty one slipped through the DELETE.
-- (Lists with items are deliberately preserved and won't appear here.)
SELECT
  sl.id            AS list_id,
  sl.household_id,
  h.country,
  sl.name          AS list_name,
  COUNT(si.id)     AS item_count
FROM shopping_lists sl
JOIN households h ON h.id = sl.household_id
LEFT JOIN shopping_items si ON si.list_id = sl.id
WHERE sl.name IN ('M&S', 'Tesco', 'Waitrose', 'Sainsbury''s', 'Aldi')
GROUP BY sl.id, sl.household_id, h.country, sl.name
HAVING COUNT(si.id) = 0;
