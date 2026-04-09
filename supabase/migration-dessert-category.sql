-- Add "dessert" as a recipe category and meal category

-- 1. Update the CHECK constraint on recipes.category to include 'dessert'
ALTER TABLE recipes DROP CONSTRAINT IF EXISTS recipes_category_check;
ALTER TABLE recipes ADD CONSTRAINT recipes_category_check
  CHECK (category IN ('breakfast', 'lunch', 'dinner', 'dessert', 'snack', 'other'));

-- 2. Add "Dessert" to all existing households that don't already have it
INSERT INTO meal_categories (household_id, name, colour, sort_order, active)
SELECT h.id, 'Dessert', '#F5B7B1', 3, true
FROM households h
WHERE NOT EXISTS (
  SELECT 1 FROM meal_categories mc
  WHERE mc.household_id = h.id AND LOWER(mc.name) = 'dessert'
);

-- 3. Bump Snack sort_order to 4 where Dessert is now 3
UPDATE meal_categories SET sort_order = 4
WHERE LOWER(name) = 'snack' AND sort_order = 3;
