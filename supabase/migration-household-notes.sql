-- Household notes: key-value memory for the WhatsApp bot
CREATE TABLE IF NOT EXISTS household_notes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  key           text NOT NULL,
  value         text NOT NULL,
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at    timestamp with time zone DEFAULT now(),
  created_at    timestamp with time zone DEFAULT now(),
  UNIQUE(household_id, key)
);

CREATE INDEX IF NOT EXISTS idx_notes_household ON household_notes(household_id);
