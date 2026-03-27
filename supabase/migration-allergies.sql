-- Add allergies column to households table (stores array of allergen keys as JSON text)
ALTER TABLE households ADD COLUMN IF NOT EXISTS allergies TEXT DEFAULT '[]';
