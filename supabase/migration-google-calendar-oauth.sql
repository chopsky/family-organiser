-- Google Calendar OAuth — Phase 1 (inbound, read-only) foundation.
--
-- Slim revival of the old (dropped) calendar_connections, Google-only. Phase 1
-- uses the refresh token + selected calendars for a read-only inbound pull that
-- feeds the EXISTING external_calendar_feeds / calendar_events render pipeline.
-- The outbound columns (app_calendar_id, writes_enabled) are created now but
-- stay unused until Phase 2 (calendar.app.created writes + circuit breaker).
--
-- Security: tokens are encrypted at rest by the app (AES-256-GCM, key from
-- CALENDAR_TOKEN_KEY). RLS enabled with NO policies — only the service-role key
-- reaches this table, mirroring external_calendar_feeds.

CREATE TABLE IF NOT EXISTS calendar_connections (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid        NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
  household_id         uuid        NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  provider             text        NOT NULL DEFAULT 'google' CHECK (provider IN ('google')),
  google_email         text,                                   -- which account (display only)
  refresh_token        text,                                   -- ENCRYPTED. Null only if Google withheld one (then status=needs_reconnect)
  access_token         text,                                   -- ENCRYPTED, short-lived
  token_expires_at     timestamptz,
  scopes               text,                                   -- granted scopes (space-delimited)
  app_calendar_id      text,                                   -- Phase 2: the app-created "Housemait" calendar
  sync_enabled         boolean     NOT NULL DEFAULT true,      -- inbound pull on/off
  writes_enabled       boolean     NOT NULL DEFAULT false,     -- Phase 2 per-conn outbound kill switch
  status               text        NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','needs_reconnect','disabled')),
  last_inbound_sync_at timestamptz,
  last_error           text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_calendar_connections_household ON calendar_connections(household_id);

-- Each SELECTED Google calendar becomes one external_calendar_feeds row with
-- source='google', so inbound Google events flow through the SAME
-- render / dedup / per-member visibility / cleanup path as iCal + device feeds.
-- feed_url for these is synthetic ('google://<connection_id>/<google_cal_id>'),
-- set by the app — it satisfies NOT NULL + the (household_id, feed_url) unique
-- index so re-selecting a calendar is idempotent (mirrors the device pattern).
ALTER TABLE external_calendar_feeds
  ADD COLUMN IF NOT EXISTS connection_id      uuid REFERENCES calendar_connections(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS google_calendar_id text,
  ADD COLUMN IF NOT EXISTS sync_token         text;   -- Google incremental syncToken (per calendar)

-- Widen the source discriminator to include 'google'. Drop+recreate so rerunnable.
ALTER TABLE external_calendar_feeds
  DROP CONSTRAINT IF EXISTS external_calendar_feeds_source_check;
ALTER TABLE external_calendar_feeds
  ADD CONSTRAINT external_calendar_feeds_source_check CHECK (source IN ('ical', 'device', 'google'));

CREATE INDEX IF NOT EXISTS idx_external_calendar_feeds_connection
  ON external_calendar_feeds(connection_id)
  WHERE connection_id IS NOT NULL;

-- Server-only access (no policies), mirroring external_calendar_feeds.
ALTER TABLE calendar_connections ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE calendar_connections IS
  'Google Calendar OAuth connections (tokens encrypted at rest). RLS on, no policies - service_role only.';
