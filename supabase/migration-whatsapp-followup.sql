-- Migration: track the T+24h re-engagement email for users who signed up
-- but did not link WhatsApp. Engagement audit Tier 2 (G).
--
-- The scheduler.runWhatsAppFollowupCheck cron looks for verified users
-- whose accounts are 24h-7d old, have whatsapp_linked = false, and have
-- never been sent the follow-up. Once the email goes out we stamp this
-- column so the user is never re-emailed (re-engagement is one-shot;
-- if they ignore it, they ignore it - we don't nag).
--
-- Run this in the Supabase SQL Editor against production AND staging.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS whatsapp_followup_sent_at timestamptz;

-- Optional index for the cron's lookup. The WHERE clause filters on
-- whatsapp_linked + whatsapp_followup_sent_at + created_at, so a small
-- composite index keeps the scan cheap once the users table grows.
CREATE INDEX IF NOT EXISTS idx_users_whatsapp_followup_eligible
  ON users (whatsapp_linked, whatsapp_followup_sent_at, created_at)
  WHERE whatsapp_linked = false AND whatsapp_followup_sent_at IS NULL;
