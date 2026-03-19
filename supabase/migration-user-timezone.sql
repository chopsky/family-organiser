-- Add timezone column to users table (auto-detected from browser)
ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone text;
