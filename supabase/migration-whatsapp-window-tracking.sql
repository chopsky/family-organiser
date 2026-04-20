-- Migration: track when we last received an inbound WhatsApp message from each user
-- Run this in the Supabase SQL Editor.
--
-- Purpose: Meta enforces a 24-hour customer-service window on WhatsApp
-- Business API. Free-form outbound messages only work if the user has
-- messaged us in the last 24 hours. Outside that window we must send a
-- pre-approved Content Template. This column is how we know.
--
-- Written by the inbound webhook every time we get a message from a linked
-- user. Read by src/services/whatsapp-templates.js to route each broadcast
-- to either the free-form or template code path.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS whatsapp_last_inbound_at timestamp with time zone;

-- Partial index on linked users only: most queries want "linked users whose
-- window has (or hasn't) expired". Narrower than an index over the full
-- users table.
CREATE INDEX IF NOT EXISTS idx_users_whatsapp_window
  ON users (whatsapp_last_inbound_at)
  WHERE whatsapp_linked = true;
