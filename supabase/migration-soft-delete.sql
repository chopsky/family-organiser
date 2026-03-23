-- Soft-delete support for calendar_events
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_calendar_events_deleted ON calendar_events(deleted_at) WHERE deleted_at IS NOT NULL;
