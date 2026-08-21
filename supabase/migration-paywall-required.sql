-- Which households must subscribe before they can use the app.
--
-- The iOS onboarding paywall (1.13.0+) is a HARD wall: a family that
-- signs up in the app subscribes at the end of setup, trial included.
-- But the wall lived only in the onboarding flow's in-memory state, so
-- closing the app on the payment screen and reopening it dropped the
-- (already created) household straight onto the dashboard. This column
-- is what makes the wall survive a relaunch.
--
-- Set at household creation, never inferred later, because it records a
-- PROMISE: only builds whose own onboarding presented a paywall may be
-- walled afterwards. Web signups and every app build before 1.13.0 were
-- promised a card-free trial and keep it - so the default is false and
-- existing households are untouched.

ALTER TABLE households
  ADD COLUMN IF NOT EXISTS paywall_required boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
