-- Per-occurrence delete for RECURRING calendar events: one row per
-- (event, date) hides that single occurrence everywhere events are
-- expanded (calendar, dashboard digest, morning reminders, ICS feed,
-- AI ground truth) without touching the series - the recurring-event
-- counterpart of activity_skips.
--
-- `date` is the occurrence's start date sliced straight from its ISO
-- timestamp (UTC date). Both the writer (web sends the slice of the
-- server-produced occurrence start) and the reader (expansion slices
-- the same ISO) derive it identically, so no timezone drift.
-- Server-only: RLS on, no policies.

CREATE TABLE IF NOT EXISTS event_skips (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      UUID NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  household_id  UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  date          DATE NOT NULL,
  created_by    UUID,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE (event_id, date)
);

CREATE INDEX IF NOT EXISTS idx_event_skips_household ON event_skips (household_id);

ALTER TABLE event_skips ENABLE ROW LEVEL SECURITY;
