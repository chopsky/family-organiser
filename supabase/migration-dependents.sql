-- Add member_type column to distinguish account holders from dependents (infants, pets, etc.)
ALTER TABLE users ADD COLUMN IF NOT EXISTS member_type text NOT NULL DEFAULT 'account'
  CHECK (member_type IN ('account', 'dependent'));
