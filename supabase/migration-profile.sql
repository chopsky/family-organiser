-- Add profile fields to users table
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS family_role text,
  ADD COLUMN IF NOT EXISTS birthday date,
  ADD COLUMN IF NOT EXISTS color_theme text DEFAULT 'orange';

-- Add check constraint for color_theme (ignore if already exists)
DO $$
BEGIN
  ALTER TABLE users ADD CONSTRAINT users_color_theme_check
    CHECK (color_theme IN ('orange','blue','green','purple','red','gray'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
