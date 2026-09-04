-- Feedback channels (2026-09-04): the three "tell Grant" routes.
--
--   user_feedback            - the Settings "Something missing?" box and the
--                              one-tap answers to the day-3 "what made you
--                              sign up?" email. Every row is also emailed to
--                              ADMIN_ALERT_EMAIL the moment it lands; this
--                              table is the ledger the weekly digest reads.
--   deletion_audit_log.exit_* - the reason chosen in the delete-account
--                              modal, plus the optional free-text line.
--
-- All writes are best-effort while this is pending: the feedback route still
-- emails, and a deletion falls back to the column set it already knows.

CREATE TABLE IF NOT EXISTS user_feedback (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid,
  household_id uuid,
  kind         text NOT NULL CHECK (kind IN ('app', 'signup_reason')),
  answer       text,
  message      text,
  context      text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_feedback_created_at_idx ON user_feedback (created_at DESC);
ALTER TABLE user_feedback ENABLE ROW LEVEL SECURITY;

ALTER TABLE deletion_audit_log
  ADD COLUMN IF NOT EXISTS exit_reason text,
  ADD COLUMN IF NOT EXISTS exit_detail text;

NOTIFY pgrst, 'reload schema';
