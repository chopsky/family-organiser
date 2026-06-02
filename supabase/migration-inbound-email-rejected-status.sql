-- Allow status='rejected' on inbound_email_log.
--
-- The original table (migration-inbound-email.sql) created the status check
-- constraint as:
--   CHECK (status IN ('pending', 'processing', 'completed', 'failed'))
-- but the inbound-email handler writes status='rejected' when a sender is
-- not on the household allowlist. That UPDATE silently violated the
-- constraint and was swallowed by a try/catch, leaving rejected rows
-- orphaned at 'pending' - and starving the Settings "we blocked some
-- forwarded mail" nudge, which only surfaces status='rejected' rows.
--
-- Drop and recreate the constraint to include 'rejected'.
-- Idempotent: safe to run more than once.

ALTER TABLE inbound_email_log
  DROP CONSTRAINT IF EXISTS inbound_email_log_status_check;

ALTER TABLE inbound_email_log
  ADD CONSTRAINT inbound_email_log_status_check
  CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'rejected'));

-- Heal any rows orphaned at 'pending' by the old broken path. A genuinely
-- in-flight email completes in seconds, so anything still 'pending' after a
-- minute is stuck. Classify by whether the sender is on the allowlist.
UPDATE inbound_email_log AS l
SET status = 'rejected',
    error_message = COALESCE(error_message, 'Sender not on this household''s allowlist.')
WHERE l.status = 'pending'
  AND l.created_at < now() - interval '1 minute'
  AND NOT EXISTS (
    SELECT 1 FROM household_inbound_senders s
    WHERE s.household_id = l.household_id
      AND lower(s.email) = lower(
        -- strip "Name <addr>" down to addr when present
        CASE
          WHEN l.from_email ~ '<[^>]+>'
            THEN substring(l.from_email from '<([^>]+)>')
          ELSE l.from_email
        END
      )
  );

UPDATE inbound_email_log
SET status = 'failed',
    error_message = COALESCE(error_message, 'Processing did not complete (healed orphaned pending row).')
WHERE status = 'pending'
  AND created_at < now() - interval '1 minute';
