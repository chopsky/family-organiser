-- Add geolocation columns to users table for weather reports
ALTER TABLE users ADD COLUMN IF NOT EXISTS latitude double precision;
ALTER TABLE users ADD COLUMN IF NOT EXISTS longitude double precision;
