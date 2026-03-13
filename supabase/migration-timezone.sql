-- Add timezone support for daily reminders
-- Run this in the Supabase SQL editor

ALTER TABLE households ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Africa/Johannesburg';
