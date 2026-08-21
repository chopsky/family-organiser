-- In-app notification centre.
--
-- Push notifications were fire-and-forget: the OS truncates a long body,
-- and tapping the notification opened the app with the message nowhere to
-- be found (founder report 2026-08-21). Every push we send is now also
-- recorded here so it can be read in full, in the app, afterwards.
--
-- One row per user per notification (a household-wide push writes one row
-- per recipient) - read state is personal, and so is the inbox.
--
-- Recorded even when delivery fails or the user has no device registered:
-- the centre is the durable copy, push is just the alert. Preference-
-- disabled categories are NOT recorded (an opt-out means "don't tell me").
--
-- Retention: 30 days, enforced by src/jobs/retention.js.
-- Server-only: RLS on, no policies (all access via the service role).

CREATE TABLE IF NOT EXISTS notifications (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  household_id UUID REFERENCES households(id) ON DELETE CASCADE,
  type         TEXT,                       -- data.type from the push payload
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,              -- the FULL text, never truncated
  data         JSONB,                      -- deep-link payload (event_id etc.)
  read_at      TIMESTAMP WITH TIME ZONE,
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- The list query: this user's notifications, newest first.
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications (user_id, created_at DESC);

-- The unread-badge query.
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications (user_id) WHERE read_at IS NULL;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
