-- Update color_theme to new palette (10 options replacing old 6)
-- Drop old constraint FIRST so updates don't violate it
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_color_theme_check;

-- Migrate existing values to nearest equivalents
UPDATE users SET color_theme = 'sage' WHERE color_theme IN ('green', 'orange') OR color_theme IS NULL;
UPDATE users SET color_theme = 'plum' WHERE color_theme = 'purple';
UPDATE users SET color_theme = 'coral' WHERE color_theme = 'red';
UPDATE users SET color_theme = 'sky' WHERE color_theme = 'blue';
UPDATE users SET color_theme = 'slate' WHERE color_theme = 'gray';

-- Add new constraint
ALTER TABLE users ADD CONSTRAINT users_color_theme_check
  CHECK (color_theme IN ('sage', 'plum', 'coral', 'amber', 'sky', 'rose', 'teal', 'lavender', 'terracotta', 'slate'));

-- Update default
ALTER TABLE users ALTER COLUMN color_theme SET DEFAULT 'sage';
