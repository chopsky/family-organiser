-- Evening brief: a heads-up the night before, about TOMORROW.
--
-- Asked for by a user who kept seeing the 07:00 brief after they'd already
-- left for work. It's the same brief the morning job builds, pointed one day
-- forward, sent at 20:00 in the household's timezone.
--
-- OPT-IN, deliberately. whatsapp_daily_reminder is opt-OUT (absent/null/true
-- all mean "send") because the morning brief is the product's core habit and
-- predates the column. The evening brief is an addition, and nobody should
-- start receiving a new 8pm message because we shipped a feature — so this one
-- requires an explicit true, and a missing column reads as off.
--
-- Separate from whatsapp_daily_reminder on purpose: one switch for both would
-- mean turning off the morning brief silently killed the evening one too.

ALTER TABLE notification_preferences
  ADD COLUMN IF NOT EXISTS evening_brief boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN notification_preferences.evening_brief IS
  'Opt-in: send this member a brief about TOMORROW at 20:00 local, in addition '
  'to (not instead of) the 07:00 morning brief. Explicit true required — see '
  'sendDailyReminders({ variant: "evening" }).';
