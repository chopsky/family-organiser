-- Migration: Store WhatsApp message body & response so the bot can replay
-- recent turns into the AI classifier for conversation context.
-- Run this in the Supabase SQL Editor.

ALTER TABLE whatsapp_message_log
  ADD COLUMN IF NOT EXISTS body text,
  ADD COLUMN IF NOT EXISTS response text;

-- Index to quickly fetch the most recent turns for a given user
CREATE INDEX IF NOT EXISTS idx_whatsapp_log_user_recent
  ON whatsapp_message_log (user_id, created_at DESC);
