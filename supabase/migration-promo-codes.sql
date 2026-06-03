-- Promo-code campaign system.
--
-- Shared "campaign" codes (e.g. FREEYEAR) that grant a free period - default
-- 1 year - by extending the household's trial. This is deliberately
-- backend-granted, NOT a Stripe/Apple/Google promo: it writes entitlement
-- straight onto the households row, which web (Stripe), iOS and a future
-- Android app all read, so one redemption syncs across every platform with
-- no store involvement.
--
-- Interaction with the initial trial: redeeming REPLACES the short trial with
-- a full window from now (greatest(current, now()+grant)), so a mid-trial user
-- gets a year from redemption - never "30 days + 1 year". It also revives an
-- expired household. trial_emails_enabled is set false so the signup-based
-- day-20/25/28 "trial ending" nudges don't wrongly fire during the comp.

CREATE TABLE IF NOT EXISTS promo_codes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             text    NOT NULL,
  description      text,
  grant_days       integer NOT NULL DEFAULT 365,
  max_redemptions  integer,                       -- NULL = unlimited
  redemption_count integer NOT NULL DEFAULT 0,
  expires_at       timestamptz,                   -- NULL = no campaign end date
  active           boolean NOT NULL DEFAULT true, -- kill switch
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Case-insensitive uniqueness: FREEYEAR == freeyear.
CREATE UNIQUE INDEX IF NOT EXISTS idx_promo_codes_code_lower ON promo_codes (lower(code));

CREATE TABLE IF NOT EXISTS promo_redemptions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promo_code_id       uuid NOT NULL REFERENCES promo_codes(id) ON DELETE CASCADE,
  household_id        uuid NOT NULL REFERENCES households(id)  ON DELETE CASCADE,
  redeemed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  granted_until       timestamptz NOT NULL,
  redeemed_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (promo_code_id, household_id)            -- can't redeem the same code twice
);

CREATE INDEX IF NOT EXISTS idx_promo_redemptions_household ON promo_redemptions (household_id);

-- Atomic redemption. All validation + grant happen inside one transaction
-- with row locks so a redemption cap can't be over-claimed under concurrency.
-- Returns jsonb: { ok: bool, reason?: text, granted_until?: ts, grant_days?: int }.
CREATE OR REPLACE FUNCTION redeem_promo_code(
  p_code         text,
  p_household_id uuid,
  p_user_id      uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code      promo_codes%ROWTYPE;
  v_household households%ROWTYPE;
  v_new_end   timestamptz;
BEGIN
  -- Lock the code row so the cap is race-safe.
  SELECT * INTO v_code FROM promo_codes
    WHERE lower(code) = lower(btrim(p_code)) AND active = true
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid');
  END IF;
  IF v_code.expires_at IS NOT NULL AND v_code.expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'expired');
  END IF;
  IF v_code.max_redemptions IS NOT NULL AND v_code.redemption_count >= v_code.max_redemptions THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'exhausted');
  END IF;

  SELECT * INTO v_household FROM households WHERE id = p_household_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_household');
  END IF;

  -- A comp can't pause live store/Stripe billing, so block paying subscribers.
  IF v_household.subscription_status = 'active' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_subscribed');
  END IF;

  -- Same code, same household - already used.
  IF EXISTS (SELECT 1 FROM promo_redemptions
             WHERE promo_code_id = v_code.id AND household_id = p_household_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_redeemed');
  END IF;

  -- No stacking: block if an earlier promo grant is still running.
  IF EXISTS (SELECT 1 FROM promo_redemptions
             WHERE household_id = p_household_id AND granted_until > now()) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_promo');
  END IF;

  -- Full window from now; never shorten a later existing end date.
  v_new_end := greatest(coalesce(v_household.trial_ends_at, now()),
                        now() + make_interval(days => v_code.grant_days));

  UPDATE households SET
    subscription_status  = 'trialing',
    trial_ends_at        = v_new_end,
    inactive_since       = NULL,
    trial_emails_enabled = false
  WHERE id = p_household_id;

  INSERT INTO promo_redemptions (promo_code_id, household_id, redeemed_by_user_id, granted_until)
  VALUES (v_code.id, p_household_id, p_user_id, v_new_end);

  UPDATE promo_codes SET redemption_count = redemption_count + 1 WHERE id = v_code.id;

  RETURN jsonb_build_object('ok', true, 'granted_until', v_new_end, 'grant_days', v_code.grant_days);
END;
$$;

-- Example campaign code (commented out - create via the admin endpoint or
-- uncomment & edit):
-- INSERT INTO promo_codes (code, description, grant_days, max_redemptions, expires_at)
--   VALUES ('FREEYEAR', 'Launch campaign - 1 year free', 365, 500, '2026-12-31T23:59:59Z');
