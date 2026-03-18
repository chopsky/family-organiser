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

-- Also update calendar_events color constraint
ALTER TABLE calendar_events DROP CONSTRAINT IF EXISTS calendar_events_color_check;

UPDATE calendar_events SET color = 'sage' WHERE color IN ('green', 'orange');
UPDATE calendar_events SET color = 'plum' WHERE color = 'purple';
UPDATE calendar_events SET color = 'coral' WHERE color = 'red';
UPDATE calendar_events SET color = 'sky' WHERE color = 'blue';
UPDATE calendar_events SET color = 'slate' WHERE color = 'gray';

ALTER TABLE calendar_events ADD CONSTRAINT calendar_events_color_check
  CHECK (color IN ('sage', 'plum', 'coral', 'amber', 'sky', 'rose', 'teal', 'lavender', 'terracotta', 'slate'));

ALTER TABLE calendar_events ALTER COLUMN color SET DEFAULT 'sage';
