-- Invite short codes: a typeable companion to the 64-hex invite token, so a
-- second adult who installs the app straight from the App Store (no invite
-- link, therefore no token) can still join the family's existing household
-- during onboarding instead of accidentally founding a second one.
--
-- 6 chars from A-Z2-9 minus I/L/O/S (28-char alphabet, ~482M combos),
-- generated alongside the token on every NEW invite. Old invites keep
-- working link-only; no backfill. Until this migration runs, invite
-- creation silently retries without the column (same degradation pattern
-- as paywall_required) - nothing breaks, invites just come without codes.

ALTER TABLE invites ADD COLUMN IF NOT EXISTS code text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_invites_code
  ON invites (code) WHERE code IS NOT NULL;

NOTIFY pgrst, 'reload schema';
