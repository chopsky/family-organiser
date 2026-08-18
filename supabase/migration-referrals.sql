-- Referral scheme ("give a month, get a month") - phase 1.
--
-- Three pieces:
--
--   1. households.complimentary_until - a universal Premium credit that sits
--      ABOVE the billing providers. The subscription gate grants access while
--      now() < complimentary_until REGARDLESS of subscription_status, the same
--      way is_internal does. This deliberately avoids Apple's promotional-offer
--      machinery: an iOS user mid-Apple-trial loses nothing (the credit is
--      simply moot until it matters), and a paying user who cancels gets their
--      earned months before the paywall returns. Also usable as a manual
--      goodwill-credit tool from admin.
--
--   2. households.referral_code - the household's shareable code, minted
--      lazily on first visit to the referral surface. Short human string
--      (no ambiguous chars), unique where present.
--
--   3. referrals - one row per referred household, created at signup when a
--      new household owner carried a valid code. referred_email is the
--      NORMALISED email (lowercased, +tag stripped) and is UNIQUE across the
--      table's entire history: one email earns a referral reward once, ever.
--      referred_household_id is a PLAIN uuid on purpose - no FK, no cascade -
--      so deleting the referred account does NOT free the email for
--      re-referral (the refer -> activate -> delete -> re-refer loop would
--      otherwise mint a fresh household id and another 30 days each cycle).
--
-- users.referred_by_code mirrors signup_promo_code: captured at signup,
-- written best-effort so a pending migration can never fail account creation.
-- users.referral_offer_sent_at throttles the bot's one-time share line
-- (a durable column, not an in-memory Map - deploys wipe Maps).
--
-- Run this in the Supabase SQL Editor against production AND staging.

ALTER TABLE households ADD COLUMN IF NOT EXISTS complimentary_until timestamptz;
ALTER TABLE households ADD COLUMN IF NOT EXISTS referral_code text;

CREATE UNIQUE INDEX IF NOT EXISTS households_referral_code_key
  ON households (referral_code) WHERE referral_code IS NOT NULL;

COMMENT ON COLUMN households.complimentary_until IS
  'Premium credit independent of billing provider: gate passes while now() < this. Earned via referrals (30d each, capped 365d ahead) or granted manually.';
COMMENT ON COLUMN households.referral_code IS
  'Shareable referral code, lazily minted. housemait.com/gift/<code>.';

ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by_code text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_offer_sent_at timestamptz;

COMMENT ON COLUMN users.referred_by_code IS
  'Referral code carried at signup (like signup_promo_code). Only a new-household owner turns it into a referrals row.';
COMMENT ON COLUMN users.referral_offer_sent_at IS
  'When the WhatsApp bot last appended its one-time referral share line for this user.';

CREATE TABLE IF NOT EXISTS referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_household_id uuid NOT NULL,
  referred_household_id uuid NOT NULL,
  referred_email text NOT NULL,
  code text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  reward_days int NOT NULL DEFAULT 30,
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz
);

-- One referral per referred household, and one per email EVER (see header).
CREATE UNIQUE INDEX IF NOT EXISTS referrals_referred_household_key
  ON referrals (referred_household_id);
CREATE UNIQUE INDEX IF NOT EXISTS referrals_referred_email_key
  ON referrals (referred_email);
CREATE INDEX IF NOT EXISTS referrals_referrer_idx
  ON referrals (referrer_household_id);
CREATE INDEX IF NOT EXISTS referrals_status_idx
  ON referrals (status) WHERE status = 'pending';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'referrals_status_check'
  ) THEN
    ALTER TABLE referrals ADD CONSTRAINT referrals_status_check
      CHECK (status IN ('pending', 'activated', 'lapsed'));
  END IF;
END$$;

-- Service-role only, like every other table (RLS on, no policies).
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
