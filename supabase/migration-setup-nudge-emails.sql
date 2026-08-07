-- Migration: "finish your setup" email nudges (T+24h, mirrors the WhatsApp
-- follow-up pattern in migration-whatsapp-followup.sql).
--
--   setup_nudge_sent_at  - stamped after the "finish setting up your family"
--                          email (verified users with no household yet).
--   verify_nudge_sent_at - stamped after the "confirm your email" re-send
--                          nudge (users who never verified).
--
-- One-shot per user per nudge; the scheduler only picks up NULL stamps.
-- NOTE: named migration-setup-nudge-emails.sql because migration-setup-nudges.sql
-- already exists (home-screen nudge dismissals - unrelated).
--
-- Run this in the Supabase SQL Editor against production AND staging.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS setup_nudge_sent_at timestamptz;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS verify_nudge_sent_at timestamptz;
