-- Add unit and description fields to shopping items
ALTER TABLE shopping_items ADD COLUMN IF NOT EXISTS unit TEXT;
ALTER TABLE shopping_items ADD COLUMN IF NOT EXISTS description TEXT;
