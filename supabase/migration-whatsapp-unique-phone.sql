-- One WhatsApp number = one linked Housemait account.
-- Run this in the Supabase SQL Editor.
--
-- The inbound webhook routes messages purely by phone number, so two users
-- both linked to the same number would blind the bot for BOTH households
-- (the lookup can't pick one). The application now enforces last-write-wins
-- (linking a number anywhere unlinks it everywhere else first); this
-- migration cleans up any legacy duplicates and makes the invariant
-- structural with a partial unique index.

-- 1. Dedupe: where several linked rows share a number, keep only the most
--    recently linked (ties broken by id) - matching the lookup's preference.
UPDATE users u
SET whatsapp_linked = false
WHERE u.whatsapp_linked = true
  AND u.whatsapp_phone IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM users v
    WHERE v.whatsapp_phone = u.whatsapp_phone
      AND v.whatsapp_linked = true
      AND v.id <> u.id
      AND (
        COALESCE(v.whatsapp_linked_at, 'epoch'::timestamptz) > COALESCE(u.whatsapp_linked_at, 'epoch'::timestamptz)
        OR (
          COALESCE(v.whatsapp_linked_at, 'epoch'::timestamptz) = COALESCE(u.whatsapp_linked_at, 'epoch'::timestamptz)
          AND v.id > u.id
        )
      )
  );

-- 2. Enforce: at most one LINKED row per number (unlinked history rows may
--    keep their phone for attribution).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_users_whatsapp_phone_linked
  ON users (whatsapp_phone)
  WHERE whatsapp_linked = true;
