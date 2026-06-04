-- Event attachments: files (booking PDFs, letters, tickets) attached to a
-- calendar event. Stored in Cloudflare R2 (file_path = R2 key); this table
-- holds the metadata + link to the event. ON DELETE CASCADE so removing an
-- event cleans up its attachment rows (the R2 objects are deleted explicitly
-- by the delete route / event-delete path).

CREATE TABLE IF NOT EXISTS event_attachments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      UUID NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  household_id  UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,        -- display filename
  file_path     TEXT NOT NULL,        -- R2 storage key
  file_size     BIGINT,
  mime_type     TEXT,
  uploaded_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_attachments_event ON event_attachments (event_id);
CREATE INDEX IF NOT EXISTS idx_event_attachments_household ON event_attachments (household_id);
