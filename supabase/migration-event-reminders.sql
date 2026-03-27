-- Event reminders and multi-assignee support for calendar events

-- ─── Event Reminders ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS event_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  household_id UUID NOT NULL REFERENCES households(id),
  remind_at TIMESTAMPTZ NOT NULL,
  reminder_offset TEXT NOT NULL,
  sent BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for the cron query: find unsent reminders that are due
CREATE INDEX IF NOT EXISTS idx_event_reminders_pending
  ON event_reminders (sent, remind_at)
  WHERE sent = false;

-- Index for lookups by event (e.g. when editing/deleting an event)
CREATE INDEX IF NOT EXISTS idx_event_reminders_event_id
  ON event_reminders (event_id);

-- RLS
ALTER TABLE event_reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "event_reminders_household_access"
  ON event_reminders
  FOR ALL
  USING (household_id IN (SELECT id FROM households))
  WITH CHECK (household_id IN (SELECT id FROM households));

-- ─── Event Assignees ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS event_assignees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  member_name TEXT,
  UNIQUE(event_id, member_id)
);

-- Index for lookups by event
CREATE INDEX IF NOT EXISTS idx_event_assignees_event_id
  ON event_assignees (event_id);

-- RLS
ALTER TABLE event_assignees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "event_assignees_household_access"
  ON event_assignees
  FOR ALL
  USING (event_id IN (SELECT id FROM calendar_events))
  WITH CHECK (event_id IN (SELECT id FROM calendar_events));
