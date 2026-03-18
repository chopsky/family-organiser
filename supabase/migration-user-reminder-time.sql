-- Per-user daily reminder time (nullable — falls back to household default)
ALTER TABLE users ADD COLUMN IF NOT EXISTS reminder_time time;
