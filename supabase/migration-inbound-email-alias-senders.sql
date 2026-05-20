-- Inbound email: memorable alias + sender allowlist.
--
-- Before this change the inbound email address was just the 12-char
-- hex token (`74e142d0586a@inbound.housemait.com`) and ANYONE who
-- learned that token could send mail that the AI would process. This
-- migration introduces two protections:
--
--   1. A memorable alias the user picks ("shapiro" → "shapiro@
--      inbound.housemait.com") so the address is easy to share and
--      remember. The long random token also continues to work as a
--      fallback / backup address.
--
--   2. A per-household allowlist of sender email addresses. Inbound
--      mail is now only processed when the From: header matches an
--      entry on this list - both for the alias address and for the
--      long token address. This prevents accidental disclosure of
--      either address from being abused as a spam vector.
--
-- Backfill: existing households get their current members' email
-- addresses copied into the allowlist so forwarding keeps working
-- from any registered family member's email account. Households
-- with an alias unset just keep using the token until they pick one.
--
-- Run in Supabase SQL Editor. Idempotent.

-- Memorable alias on households. UNIQUE so multiple families can't
-- claim the same one. Nullable - households without one fall back
-- to the long token.
ALTER TABLE households
  ADD COLUMN IF NOT EXISTS email_alias TEXT UNIQUE;

-- Allowlist of sender emails per household. Composite uniqueness so
-- the same address can't be added twice for one household, but the
-- same address CAN appear under multiple households (a child in two
-- families uses the same Gmail to forward to both).
CREATE TABLE IF NOT EXISTS household_inbound_senders (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  added_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at  TIMESTAMPTZ,
  UNIQUE (household_id, email)
);

-- Index for the webhook's hottest query: "does this From: appear on
-- this household's allowlist?".
CREATE INDEX IF NOT EXISTS idx_inbound_senders_household_email
  ON household_inbound_senders (household_id, lower(email));

-- Backfill existing households: copy each member's email into the
-- allowlist so forwarding keeps working without manual intervention.
-- INSERT … ON CONFLICT DO NOTHING handles the case where this
-- migration is re-run after a partial application.
INSERT INTO household_inbound_senders (household_id, email, added_by)
SELECT DISTINCT u.household_id, lower(u.email), u.id
FROM users u
WHERE u.email IS NOT NULL
  AND u.email <> ''
  AND u.household_id IS NOT NULL
ON CONFLICT (household_id, email) DO NOTHING;

NOTIFY pgrst, 'reload schema';
