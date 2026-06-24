-- Google Calendar OAuth — Phase 2 (outbound writes, SAFE-by-scoping).
--
-- Phase 1 was read-only inbound. Phase 2 lets Housemait write its OWN family
-- events OUT to a dedicated "Housemait" secondary calendar it creates in the
-- user's Google account, using the calendar.app.created scope. By Google's
-- design that scope CANNOT read, modify, or delete the user's primary or any
-- other calendar — only the calendar this app created. So a Housemait bug can
-- never touch a user's real calendar data; that's a permission guarantee, not
-- just a code one.
--
-- Phase 1's calendar_connections already has the columns Phase 2 needs:
--   app_calendar_id  — the id of the created "Housemait" secondary calendar
--   writes_enabled   — per-connection outbound on/off (kill switch, default false)
-- This migration adds the two tables the write path needs: a mapping of which
-- Housemait event maps to which Google event (so deletes are mapping-ONLY,
-- never delete-by-absence), and an append-only audit of every outbound write.
--
-- Server-only: RLS on, no policies (service_role only), mirroring Phase 1.

-- One row per (connection, Housemait event) that we've pushed out. The presence
-- of a row is the ONLY thing that authorises a delete in Google — we never
-- delete a Google event we have no mapping for. google_calendar_id is stored
-- (always == the connection's app_calendar_id) so every write can assert it's
-- targeting the app calendar and nothing else.
CREATE TABLE IF NOT EXISTS calendar_sync_mappings (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id      uuid        NOT NULL REFERENCES calendar_connections(id) ON DELETE CASCADE,
  household_id       uuid        NOT NULL REFERENCES households(id)           ON DELETE CASCADE,
  housemait_event_id uuid        NOT NULL REFERENCES calendar_events(id)      ON DELETE CASCADE,
  google_calendar_id text        NOT NULL,                 -- always == connection.app_calendar_id
  google_event_id    text        NOT NULL,                 -- id Google assigned to the pushed event
  last_pushed_at     timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, housemait_event_id)               -- one mapping per event per connection
);

CREATE INDEX IF NOT EXISTS idx_calendar_sync_mappings_event
  ON calendar_sync_mappings(housemait_event_id);
CREATE INDEX IF NOT EXISTS idx_calendar_sync_mappings_connection
  ON calendar_sync_mappings(connection_id);

-- Append-only audit of every outbound write attempt. Survives connection
-- deletion on purpose (ids are plain columns, no FK) so a disconnect can't erase
-- the history of what we wrote. Anomaly alerting on delete spikes reads this.
CREATE TABLE IF NOT EXISTS calendar_write_audit (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id      uuid,
  household_id       uuid,
  google_calendar_id text,
  google_event_id    text,
  housemait_event_id uuid,
  op                 text        NOT NULL CHECK (op IN ('create','update','delete')),
  result             text        NOT NULL CHECK (result IN ('ok','error','skipped','blocked')),
  error              text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_calendar_write_audit_connection
  ON calendar_write_audit(connection_id, created_at DESC);

ALTER TABLE calendar_sync_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_write_audit  ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE calendar_sync_mappings IS
  'Housemait-event -> Google-event map for outbound sync. A row is the ONLY authorisation to delete a Google event (mapping-only deletes, never delete-by-absence). Server-only RLS.';
COMMENT ON TABLE calendar_write_audit IS
  'Append-only audit of every outbound Google Calendar write (create/update/delete). Survives disconnect. Server-only RLS.';
