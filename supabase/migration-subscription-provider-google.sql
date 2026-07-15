-- Google Play Billing: allow 'google' as a subscription provider.
--
-- The Android app sells subscriptions through Google Play Billing (via
-- RevenueCat, mirroring the iOS Apple-IAP integration). The RevenueCat
-- webhook now maps event.store PLAY_STORE -> subscription_provider='google';
-- this migration widens the CHECK constraint that previously only allowed
-- ('stripe', 'apple').
--
-- Run in the Supabase SQL editor. Idempotent.

ALTER TABLE households
  DROP CONSTRAINT IF EXISTS households_subscription_provider_check;

ALTER TABLE households
  ADD CONSTRAINT households_subscription_provider_check
  CHECK (subscription_provider IN ('stripe', 'apple', 'google'));

COMMENT ON COLUMN households.subscription_provider IS
  'Which billing rail owns this household''s subscription: stripe (web), apple (iOS IAP), google (Android Play Billing). Source-of-truth pivot for Manage-billing routing.';
