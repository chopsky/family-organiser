-- Migration: Add email/password auth, invites, and token tables
-- Run this in the Supabase SQL editor against your existing database

-- Add auth columns to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS email text UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT false;

-- Invites table
CREATE TABLE IF NOT EXISTS invites (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  email         text NOT NULL,
  token         text UNIQUE NOT NULL,
  invited_by    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  accepted_at   timestamp with time zone,
  expires_at    timestamp with time zone NOT NULL,
  created_at    timestamp with time zone DEFAULT now()
);

-- Email verification tokens
CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       text UNIQUE NOT NULL,
  used        boolean NOT NULL DEFAULT false,
  expires_at  timestamp with time zone NOT NULL,
  created_at  timestamp with time zone DEFAULT now()
);

-- Password reset tokens
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       text UNIQUE NOT NULL,
  used        boolean NOT NULL DEFAULT false,
  expires_at  timestamp with time zone NOT NULL,
  created_at  timestamp with time zone DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_invites_token ON invites(token);
CREATE INDEX IF NOT EXISTS idx_invites_email ON invites(email);
CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_token ON email_verification_tokens(token);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token ON password_reset_tokens(token);
CREATE INDEX IF NOT EXISTS idx_telegram_link_tokens_token ON telegram_link_tokens(token);
