-- Performance index for calendar event queries
-- Covers the main query: WHERE household_id = X AND deleted_at IS NULL AND start_time <= Y AND end_time >= Z
CREATE INDEX IF NOT EXISTS idx_cal_events_range
  ON calendar_events(household_id, start_time, end_time)
  WHERE deleted_at IS NULL;
