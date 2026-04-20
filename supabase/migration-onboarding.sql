-- Migration: track onboarding completion per user
-- Run this in the Supabase SQL editor.
--
-- Purpose: the frontend redirects users without a completed onboarding
-- flow to the /onboarding wizard on login. This column is the single
-- source of truth for "has the user finished the welcome wizard".
--
-- The backfill sets onboarded_at = now() for everyone who already exists
-- — they're active users who would be surprised by a sudden onboarding
-- flow. New signups created AFTER this migration runs will start with
-- NULL and be routed through the wizard.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS onboarded_at timestamp with time zone;

-- Backfill existing users so we don't surprise them with a wizard next
-- time they log in. Only touches rows where the column is still NULL, so
-- this is idempotent — safe to re-run without clobbering newer signups.
UPDATE users SET onboarded_at = now() WHERE onboarded_at IS NULL;
