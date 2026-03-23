-- Migration: Shopping page redesign
-- Adds shopping_lists table, aisle_category column, and migrates existing data.

-- 1. Create shopping_lists table
CREATE TABLE IF NOT EXISTS shopping_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shopping_lists_household ON shopping_lists(household_id);

-- 2. Add new columns to shopping_items
ALTER TABLE shopping_items ADD COLUMN IF NOT EXISTS list_id UUID REFERENCES shopping_lists(id) ON DELETE CASCADE;
ALTER TABLE shopping_items ADD COLUMN IF NOT EXISTS aisle_category TEXT DEFAULT 'Other';

-- 3. Create a "Default" list for every household that has shopping items
INSERT INTO shopping_lists (household_id, name)
SELECT DISTINCT household_id, 'Default'
FROM shopping_items
WHERE household_id NOT IN (
  SELECT household_id FROM shopping_lists WHERE name = 'Default'
);

-- Also create a "Default" list for households with no items (so every household has one)
INSERT INTO shopping_lists (household_id, name)
SELECT id, 'Default'
FROM households
WHERE id NOT IN (
  SELECT household_id FROM shopping_lists WHERE name = 'Default'
);

-- 4. Assign all existing items to their household's Default list
UPDATE shopping_items si
SET list_id = sl.id
FROM shopping_lists sl
WHERE sl.household_id = si.household_id
  AND sl.name = 'Default'
  AND si.list_id IS NULL;

-- 5. Map old categories to new aisle_categories

-- household → Household & Cleaning
UPDATE shopping_items
SET aisle_category = 'Household & Cleaning'
WHERE category = 'household';

-- clothing, pets, school, party, gifts, other → Other
UPDATE shopping_items
SET aisle_category = 'Other'
WHERE category IN ('clothing', 'pets', 'school', 'party', 'gifts', 'other');

-- groceries → keyword-based matching
-- Dairy & Eggs
UPDATE shopping_items
SET aisle_category = 'Dairy & Eggs'
WHERE category = 'groceries'
  AND aisle_category = 'Other'
  AND item ~* '\m(milk|cheese|yoghurt|yogurt|butter|eggs?|cream)\M';

-- Produce
UPDATE shopping_items
SET aisle_category = 'Produce'
WHERE category = 'groceries'
  AND aisle_category = 'Other'
  AND item ~* '\m(apple|banana|mango|broccoli|carrot|tomato|onion|potato|pepper|lettuce|cucumber|spinach|avocado|lemon|garlic|fruit|vegetable|berries|strawberr|blueberr|grapes?|oranges?|pear|celery|mushroom|courgette|zucchini|sweetcorn|corn)\M';

-- Meat & Seafood
UPDATE shopping_items
SET aisle_category = 'Meat & Seafood'
WHERE category = 'groceries'
  AND aisle_category = 'Other'
  AND item ~* '\m(chicken|beef|pork|lamb|sausage|mince|steak|bacon|ham|salmon|fish|prawn|turkey|droewors|biltong)\M';

-- Bakery
UPDATE shopping_items
SET aisle_category = 'Bakery'
WHERE category = 'groceries'
  AND aisle_category = 'Other'
  AND item ~* '\m(bread|rolls?|baguette|croissant|muffin|bagel|wraps?|cake)\M';

-- Pantry & Grains
UPDATE shopping_items
SET aisle_category = 'Pantry & Grains'
WHERE category = 'groceries'
  AND aisle_category = 'Other'
  AND item ~* '\m(rice|pasta|noodle|cereal|flour|sugar|oil|vinegar|sauce|ketchup|beans?|lentils?|stock|spice|bolognese|honey|jam|peanut butter|oats|canned|tin)\M';

-- Frozen Foods
UPDATE shopping_items
SET aisle_category = 'Frozen Foods'
WHERE category = 'groceries'
  AND aisle_category = 'Other'
  AND item ~* '\m(frozen|ice cream|pizza|chips|fish fingers|nuggets|smoothie melts)\M';

-- Beverages
UPDATE shopping_items
SET aisle_category = 'Beverages'
WHERE category = 'groceries'
  AND aisle_category = 'Other'
  AND item ~* '\m(juice|water|cola|coffee|tea|squash|wine|beer|drink|soda|lemonade)\M';

-- Personal Care
UPDATE shopping_items
SET aisle_category = 'Personal Care'
WHERE category = 'groceries'
  AND aisle_category = 'Other'
  AND item ~* '\m(soap|shampoo|toothpaste|toothbrush|deodorant|nappy|nappies|wipes)\M';

-- Household & Cleaning (from groceries)
UPDATE shopping_items
SET aisle_category = 'Household & Cleaning'
WHERE category = 'groceries'
  AND aisle_category = 'Other'
  AND item ~* '\m(paper towel|kitchen roll|bin bag|cling film|foil|sponge|bleach|detergent|washing|dishwasher|cleaning)\M';

-- Remaining unmatched groceries stay as 'Other' (already the default)

-- 6. Set NOT NULL on list_id now that all rows have been assigned
ALTER TABLE shopping_items ALTER COLUMN list_id SET NOT NULL;

-- Add index on list_id for query performance
CREATE INDEX IF NOT EXISTS idx_shopping_items_list ON shopping_items(list_id);

-- 7. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
