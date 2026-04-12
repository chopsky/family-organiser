-- Migration: Refresh tokens for session security
-- Run this in the Supabase SQL Editor.
--
-- Short-lived JWTs (1h) + rotating refresh tokens (7 days) replace the
-- old 30-day static JWT. Active users are never logged out; inactive
-- sessions expire after 7 days of no activity.

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      text UNIQUE NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked    boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token ON refresh_tokens (token);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user  ON refresh_tokens (user_id, revoked);
