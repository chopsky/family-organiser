-- Add subcategory column for grocery items
ALTER TABLE shopping_items ADD COLUMN IF NOT EXISTS subcategory TEXT;

-- No constraint needed — subcategory is only used for display grouping
-- Valid values: dairy_eggs, produce, meat_seafood, pantry_grains, bakery, frozen, beverages, household_cleaning, personal_care, other
