-- Signup promo capture (school-fair campaign and similar).
--
-- When a user signs up via a tagged link (e.g. /signup?promo=HILLELFEST) we
-- store the code on their account so it can be surfaced ("your 25% discount is
-- ready") and auto-applied at the Stripe annual checkout, even weeks later
-- during the free trial. Nullable text; uppercased by the app.

ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_promo_code text;
