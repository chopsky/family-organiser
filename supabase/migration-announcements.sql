-- Announcement broadcaster: lets a platform admin send a one-off
-- branded email to a slice of the user base (all verified users, iOS
-- users only, or just household admins).
--
-- Two-table design:
--   announcements        - one row per draft / sent announcement
--   announcement_recipients - one row per (announcement, user) so we
--                             can track per-user delivery, prevent
--                             dupes if "Send" is hit twice, and resume
--                             a partially-failed run.

CREATE TABLE IF NOT EXISTS announcements (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject            text NOT NULL,
  html               text NOT NULL,
  audience           text NOT NULL CHECK (audience IN ('all_verified', 'ios_users', 'admins_only')),
  created_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  -- Send-tracking columns. NULL sent_started_at = draft (audience
  -- resolved but no emails attempted yet). sent_completed_at set when
  -- every recipient has either succeeded or errored out.
  sent_started_at    timestamptz,
  sent_completed_at  timestamptz,
  recipient_count    integer NOT NULL DEFAULT 0,
  success_count      integer NOT NULL DEFAULT 0,
  failure_count      integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS announcements_created_at_idx
  ON announcements (created_at DESC);

CREATE TABLE IF NOT EXISTS announcement_recipients (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id uuid NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Snapshot the email at recipient-list time so a later email change
  -- doesn't break our audit trail (the user agreed to receive it at
  -- the address we had then).
  email           text NOT NULL,
  -- NULL until we successfully POST to Postmark. Setting this is the
  -- idempotency anchor - "Send" only processes rows where sent_at IS NULL.
  sent_at         timestamptz,
  error           text,
  UNIQUE (announcement_id, user_id)
);

-- Resumption + dupe-prevention queries hit this index.
CREATE INDEX IF NOT EXISTS announcement_recipients_pending_idx
  ON announcement_recipients (announcement_id)
  WHERE sent_at IS NULL AND error IS NULL;
