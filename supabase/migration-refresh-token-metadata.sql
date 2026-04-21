-- Add session-identifying metadata to refresh_tokens so users can see and
-- revoke their active sessions from Settings → Active sessions.
--
-- Run this in the Supabase SQL editor. All columns are nullable with sensible
-- defaults — existing rows remain valid, old sessions just show up as
-- "Unknown device / Unknown location" in the UI until the next refresh
-- repopulates them.
--
-- Privacy note: IP addresses in the refresh_tokens table fall under the
-- same auth-ephemera retention as the tokens themselves (see
-- src/jobs/retention.js — expired tokens are deleted daily at 04:00 UTC).

ALTER TABLE refresh_tokens
  ADD COLUMN IF NOT EXISTS user_agent    text,
  ADD COLUMN IF NOT EXISTS ip_address    text,
  ADD COLUMN IF NOT EXISTS last_used_at  timestamptz;

-- Backfill last_used_at from created_at for existing rows so the UI has
-- something sensible to show until the next refresh bumps it.
UPDATE refresh_tokens
  SET last_used_at = created_at
  WHERE last_used_at IS NULL;

-- Index for the "list my active sessions" query in Settings.
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_active
  ON refresh_tokens (user_id, revoked, expires_at);
