-- Add 'party' and 'gifts' categories to shopping_items
ALTER TABLE shopping_items
  DROP CONSTRAINT IF EXISTS shopping_items_category_check,
  ADD CONSTRAINT shopping_items_category_check
    CHECK (category IN ('groceries', 'clothing', 'household', 'school', 'pets', 'party', 'gifts', 'other'));
