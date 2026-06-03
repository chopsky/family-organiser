-- Trial pause: lets an admin freeze a household's trial clock (e.g. while
-- resolving an account issue) so it doesn't burn the user's trial days.
--
-- When trial_paused_at is set, the subscription gate keeps the household in
-- 'trialing' with access and never expires it. On resume, the admin endpoint
-- adds the paused duration back onto trial_ends_at and clears this column.

ALTER TABLE households
  ADD COLUMN IF NOT EXISTS trial_paused_at timestamptz;
