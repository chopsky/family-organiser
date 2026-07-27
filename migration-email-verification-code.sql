-- Email verification by CODE as well as by link.
--
-- The link is a navigation: it opens a new page, often in a different browser
-- than the one the person signed up in. Onboarding v4 holds the calendar
-- address they pasted in memory only (it's a bearer credential and is never
-- persisted), so that navigation destroys it — someone who connected a
-- calendar, saw "244 events found", and verified by link silently got no
-- calendar at all. A code is typed into the page they're already on, so the
-- session survives and everything they set up actually lands.
--
-- Both redeem the SAME row. The link stays because it's a Universal Link that
-- opens the iOS app directly, which is genuinely better when the email is read
-- on the phone. Neither path is removed.
--
--   code      6 chars from 23456789ABCDEFGHJKMNPQRSTVWXYZ — the alphabet the
--             WhatsApp pairing codes already use, with 0/O/1/I/L/U removed so
--             it survives being read off one screen and typed into another.
--   attempts  guessing guard. ~729M combinations is only safe with a short TTL
--             AND a cap; without one a code is far weaker than the token.

ALTER TABLE email_verification_tokens
  ADD COLUMN IF NOT EXISTS code text,
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;

-- Lookup is (user's email -> their newest unused code), so index the code for
-- the redemption query. Not unique: codes are short and scoped to one account,
-- so two live rows may legitimately share one.
CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_code
  ON email_verification_tokens (code)
  WHERE code IS NOT NULL AND used = false;

COMMENT ON COLUMN email_verification_tokens.code IS
  'Short human-typeable verification code. Redeems the same row as `token`; '
  'lets verification finish without leaving the page. See '
  'POST /api/auth/verify-email-code.';
COMMENT ON COLUMN email_verification_tokens.attempts IS
  'Failed code entries. The row is burned past MAX_CODE_ATTEMPTS so a short '
  'code cannot be brute-forced.';
