-- Add allergies column to users table (stores array of allergen keys as JSON text)
ALTER TABLE users ADD COLUMN IF NOT EXISTS allergies TEXT DEFAULT '[]';
