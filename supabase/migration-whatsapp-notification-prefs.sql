-- Migration: Per-user WhatsApp notification preferences
-- Run this in the Supabase SQL Editor.
--
-- Context: Every household member with whatsapp_linked = true currently
-- receives every activity broadcast (task added, shopping checked off,
-- event added, etc.). Some members want to stay connected to the bot
-- for sending messages but don't want the constant ambient broadcasts.
--
-- Default is true so existing members see no behaviour change; they can
-- opt out in Settings → WhatsApp.

ALTER TABLE notification_preferences
  ADD COLUMN IF NOT EXISTS whatsapp_activity boolean NOT NULL DEFAULT true;
