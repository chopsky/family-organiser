-- Widen announcements.audience CHECK to include 'platform_admin' (self-test
-- audience for the email broadcaster - resolves to platform admins only so
-- the operator can dry-run a broadcast against their own inbox before
-- committing to the real audience).

ALTER TABLE announcements
  DROP CONSTRAINT IF EXISTS announcements_audience_check;

ALTER TABLE announcements
  ADD CONSTRAINT announcements_audience_check
  CHECK (audience IN ('all_verified', 'ios_users', 'admins_only', 'platform_admin'));
