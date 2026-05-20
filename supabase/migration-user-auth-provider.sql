-- Track how each user signed in (email-and-password, Google SSO, Apple SSO).
--
-- The Settings → Account card needs to surface this so users can see
-- "you're signed in with Google" vs just their email. Before this
-- migration we had no way to tell - Google/Apple SSO users were
-- written to the `users` table indistinguishably from password
-- accounts.
--
-- Values:
--   'email'   → signed up / signed in with email + password
--   'google'  → most recent sign-in was via Google SSO
--   'apple'   → most recent sign-in was via Apple SSO
--   NULL     → unknown (legacy rows we can't classify retroactively)
--
-- Stamped on every successful authentication so it always reflects
-- the LATEST credential the user used. If a user signed up with
-- Google and later sets a password, the column would re-stamp to
-- 'email' on their next email/password login - which matches what
-- the user would consider their "current way of signing in".
--
-- Backfill heuristic: users with a password_hash are very likely
-- email/password users. Users without one almost certainly came via
-- SSO. We can't tell Google from Apple retroactively, so SSO rows
-- stay NULL and will be re-stamped at next sign-in.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS auth_provider TEXT
    CHECK (auth_provider IN ('email', 'google', 'apple'));

UPDATE users
SET auth_provider = 'email'
WHERE password_hash IS NOT NULL
  AND auth_provider IS NULL;

NOTIFY pgrst, 'reload schema';
