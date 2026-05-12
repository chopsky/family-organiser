-- One-time backfill: remove the UK supermarket shopping lists
-- (M&S / Tesco / Waitrose / Sainsbury's / Aldi) from households whose
-- country is NOT 'GB'. Those names were seeded for every household
-- pre-multi-region; they're now only relevant for UK families.
--
-- Safety: we ONLY delete a list if it has zero items. If a non-UK user
-- has been adding items to "Tesco" anyway (e.g. they live abroad and
-- still shop online from Tesco UK), we leave it alone — their data
-- stays, and they can rename or delete it themselves.
--
-- Idempotent: running twice in a row is a no-op once the empty lists
-- are gone.
--
-- Run in Supabase SQL editor.

-- ── Step 1: preview what will be deleted ──────────────────────────
-- Read-only — shows the household_id, country, list name, and item
-- count for every candidate row. Sanity-check the list before the
-- DELETE below.
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
WHERE (h.country IS NULL OR h.country <> 'GB')
  AND sl.name IN ('M&S', 'Tesco', 'Waitrose', 'Sainsbury''s', 'Aldi')
GROUP BY sl.id, sl.household_id, h.country, h.name, sl.name
ORDER BY h.country NULLS FIRST, h.name, sl.name;

-- ── Step 2: apply the delete (empty lists only) ───────────────────
DELETE FROM shopping_lists sl
WHERE sl.id IN (
  SELECT sl2.id
  FROM shopping_lists sl2
  JOIN households h ON h.id = sl2.household_id
  LEFT JOIN shopping_items si ON si.list_id = sl2.id
  WHERE (h.country IS NULL OR h.country <> 'GB')
    AND sl2.name IN ('M&S', 'Tesco', 'Waitrose', 'Sainsbury''s', 'Aldi')
  GROUP BY sl2.id
  HAVING COUNT(si.id) = 0
);

-- ── Step 3: verify ────────────────────────────────────────────────
-- Should return zero rows. Any remaining UK-supermarket lists in non-UK
-- households here would mean an empty one slipped through the DELETE.
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
WHERE (h.country IS NULL OR h.country <> 'GB')
  AND sl.name IN ('M&S', 'Tesco', 'Waitrose', 'Sainsbury''s', 'Aldi')
GROUP BY sl.id, sl.household_id, h.country, sl.name
HAVING COUNT(si.id) = 0;
