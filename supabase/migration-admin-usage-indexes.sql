-- Migration: indexes for the admin dashboard's per-user usage lookups.
-- Run this in the Supabase SQL editor.
--
-- Why: the admin pages query these tables in ways the original indexes
-- don't cover:
--
--   1. ai_usage_log filtered by user_id (per-user usage card, top-users
--      aggregation, recent-calls list). Existing indexes are
--      (household_id, created_at) and (provider, created_at) only, so
--      per-user reads are sequential scans.
--
--   2. whatsapp_message_log filtered by user_id (the Users list's
--      "Last WhatsApp" column runs one ORDER BY created_at DESC LIMIT 1
--      per user per page; per-user usage card reads all rows). Existing
--      index is (household_id, created_at) only.
--
-- Both are cheap partial-width btrees; at current volumes the scans are
-- tolerable, but these make the admin pages stay fast as the logs grow.

CREATE INDEX IF NOT EXISTS idx_ai_usage_user
  ON ai_usage_log (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_whatsapp_log_user
  ON whatsapp_message_log (user_id, created_at DESC);
