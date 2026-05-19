-- WhatsApp pairing codes (pull-push verification).
--
-- The old flow pushed a 6-digit OTP from the server to the user's
-- WhatsApp number via a Twilio Authentication Content Template. That
-- template requires Meta Business Verification, which a sole-trader
-- account can't easily complete.
--
-- The new flow inverts the direction:
--   1. App generates a short alphanumeric code and shows it to the user
--   2. User opens WhatsApp and messages the bot with that code
--   3. Inbound webhook consumes the code, links the phone to the user
--
-- The existing whatsapp_verification_codes table is reused — but `phone`
-- is no longer known up-front (we learn it from the inbound webhook),
-- so it has to be nullable. This migration just relaxes the NOT NULL.
--
-- Run in Supabase SQL Editor. Idempotent.

ALTER TABLE whatsapp_verification_codes
  ALTER COLUMN phone DROP NOT NULL;

NOTIFY pgrst, 'reload schema';
