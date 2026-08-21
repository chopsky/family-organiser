-- Free trial: 30 days -> 14 days.
--
-- Why: at 30 days the subscribe-or-not decision lands a month after the
-- moment of need, and often mid-school-holiday when a family organiser is
-- at its quietest. 14 days is two full school weeks - two Monday scrambles,
-- two weekend plans - and the decision lands while term is still running.
--
-- The application now sets trial_ends_at EXPLICITLY at household creation
-- (src/services/trial-length.js), because the length depends on which
-- client is asking: app builds up to 1.12.0 have "Free for 30 days" baked
-- into their bundle and must still receive 30. This default is the backstop
-- for any row created outside that path.
--
-- Existing households are untouched: a column default only applies to new
-- inserts, so every household currently on trial keeps the 30 days it was
-- promised.

ALTER TABLE households
  ALTER COLUMN trial_ends_at SET DEFAULT (now() + INTERVAL '14 days');

NOTIFY pgrst, 'reload schema';
