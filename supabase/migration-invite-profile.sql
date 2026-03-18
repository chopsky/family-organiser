-- Add profile fields to invites table so admins can pre-fill new member info
ALTER TABLE invites ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE invites ADD COLUMN IF NOT EXISTS family_role text;
ALTER TABLE invites ADD COLUMN IF NOT EXISTS birthday date;
ALTER TABLE invites ADD COLUMN IF NOT EXISTS color_theme text;
