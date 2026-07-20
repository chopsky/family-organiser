-- WhatsApp activation capture sequence + brief sign-off tracking.
--
-- whatsapp_capture_log: one row per capture opener actually sent (the day
-- 1-3 questions that get a new household's life INTO Housemait - school,
-- activities, what's-on-this-week). Keyed per user so the picker never
-- repeats an opener and can count how many have gone out.
--
-- users.whatsapp_brief_signoff_sent_at: stamped when the one-time "I'll stop
-- the morning messages here" sign-off is sent to a long-silent user before
-- their daily brief drops to push-only. Once ever, hence a column not a log.

CREATE TABLE IF NOT EXISTS whatsapp_capture_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  opener_key text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, opener_key)
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_capture_log_user ON whatsapp_capture_log(user_id);

ALTER TABLE users ADD COLUMN IF NOT EXISTS whatsapp_brief_signoff_sent_at timestamptz;

-- users.whatsapp_pin_nudge_sent_at: stamped the first time the bot rides a
-- "pin this chat" ask on a delight moment (school-dates import, or sorting a
-- whole week of events at once). Claimed atomically so the ask appears once,
-- never as a cold standalone reminder. There is no pin API - pinning is a
-- client-side action - so this is the only lever we have on chat-list decay
-- beyond the morning brief, which re-ranks the chat every day anyway.
ALTER TABLE users ADD COLUMN IF NOT EXISTS whatsapp_pin_nudge_sent_at timestamptz;
