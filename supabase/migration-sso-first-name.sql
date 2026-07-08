-- Backfill: shorten existing Google/Apple (SSO) members' stored names to the
-- FIRST NAME only, so it matches the new signup behaviour (SSO signups now store
-- just the first name — the surname is usually already in the household name, so
-- "Grant Shapiro" reads awkwardly as a member name on the Family card, calendar
-- and greeting).
--
-- Scope: ONLY auth_provider google/apple. Those names were auto-populated from
-- the SSO account — the user never chose them. Email-signup users are left alone
-- (they typed their own name). Dependents have no auth_provider, so they're
-- untouched.
--
-- Caveat: a compound first name ("Mary Jane") keeps only the first token ("Mary").
-- Anyone who wants their full name back can edit it on their profile.
--
-- Preview BEFORE running (nothing is changed by this SELECT):
--   SELECT id, email, name, split_part(trim(name), ' ', 1) AS new_name, auth_provider
--   FROM users
--   WHERE auth_provider IN ('google', 'apple')
--     AND name IS NOT NULL
--     AND position(' ' IN trim(name)) > 0;

UPDATE users
SET name = split_part(trim(name), ' ', 1)
WHERE auth_provider IN ('google', 'apple')
  AND name IS NOT NULL
  AND position(' ' IN trim(name)) > 0;
