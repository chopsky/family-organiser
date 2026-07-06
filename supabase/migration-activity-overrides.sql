-- Per-date OVERRIDES for weekly activities: "piano is at 16:00 today and
-- Grandma collects" without touching the series. Rides on activity_skips
-- (one exception row per activity+date): kind='skip' hides the date (the
-- existing behaviour), kind='override' keeps it but replaces the time
-- and/or pickup person for that one occurrence. UNIQUE(activity_id, date)
-- already guarantees a date can't be both skipped and overridden.
-- Run AFTER migration-activity-skips.sql.

ALTER TABLE activity_skips ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'skip';
ALTER TABLE activity_skips ADD COLUMN IF NOT EXISTS time_start TIME;
ALTER TABLE activity_skips ADD COLUMN IF NOT EXISTS time_end TIME;
ALTER TABLE activity_skips ADD COLUMN IF NOT EXISTS pickup_member_id UUID REFERENCES users(id) ON DELETE SET NULL;
