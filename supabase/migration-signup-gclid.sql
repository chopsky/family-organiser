-- Google Ads click id captured at signup (?gclid= from account auto-tagging).
-- Separates paid signups from organic (both carry signup_source='termdates')
-- and enables offline conversion import back into Google Ads by gclid.
-- Written best-effort by createUserWithEmail - safe to run any time.
ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_gclid text;
COMMENT ON COLUMN users.signup_gclid IS 'Google Ads click id present at account creation; null = organic/non-ad signup';
