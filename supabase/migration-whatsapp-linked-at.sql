-- Stamp the moment a user links their WhatsApp number.
--
-- Used by the morning-digest job to surface a rotating "💡 Did you know…"
-- footer for the first 14 days after a user connects WhatsApp, then
-- fall back to the standard "_Reply /help for all commands._" line.
-- That gives new users feature discovery cadence without overloading
-- the welcome message itself.
--
-- Existing linked users are backfilled with created_at — they're
-- almost all well past 14 days anyway, so they immediately get the
-- standard footer and don't see the tip series.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS whatsapp_linked_at timestamptz;

UPDATE users
SET whatsapp_linked_at = created_at
WHERE whatsapp_linked = true
  AND whatsapp_linked_at IS NULL;

NOTIFY pgrst, 'reload schema';
