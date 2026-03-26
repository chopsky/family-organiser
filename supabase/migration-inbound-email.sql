-- Add inbound_email_token to households
ALTER TABLE households
  ADD COLUMN IF NOT EXISTS inbound_email_token TEXT UNIQUE;

UPDATE households
SET inbound_email_token = encode(gen_random_bytes(6), 'hex')
WHERE inbound_email_token IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_households_inbound_token
  ON households(inbound_email_token);

-- Inbound email log table
CREATE TABLE IF NOT EXISTS inbound_email_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id    UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  from_email      TEXT NOT NULL,
  subject         TEXT,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  items_extracted INTEGER DEFAULT 0,
  items_added     INTEGER DEFAULT 0,
  error_message   TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inbound_email_log_household
  ON inbound_email_log(household_id, created_at DESC);

-- Add source column to shopping_items
ALTER TABLE shopping_items
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual';
