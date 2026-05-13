-- Inbound-email confirmation + UNDO support.
--
-- After processing a forwarded email, the webhook now sends a summary
-- reply ("ticked 3 off the list, added 2 events, …") with an UNDO link
-- so users can self-revert when the AI gets it wrong. Three new columns
-- on inbound_email_log support that:
--
--   actions_taken  JSONB     The IDs of every row created or modified
--                            by this email, grouped by kind:
--                              { checked_off: [shopping_item_id, …],
--                                added_items: [shopping_item_id, …],
--                                events:      [calendar_event_id, …],
--                                tasks:       [task_id, …] }
--                            Used by the undo endpoint to know what
--                            to roll back.
--
--   undo_token     TEXT      A 32-char random token included in the
--                            confirmation email's UNDO link. Single-
--                            use: cleared once undone_at is set.
--
--   undone_at      TIMESTAMP When the user clicked UNDO. NULL until
--                            then. Prevents double-undo and provides
--                            an audit trail.
--
-- All three are nullable so existing rows pass through cleanly.

ALTER TABLE inbound_email_log
  ADD COLUMN IF NOT EXISTS actions_taken JSONB,
  ADD COLUMN IF NOT EXISTS undo_token TEXT,
  ADD COLUMN IF NOT EXISTS undone_at TIMESTAMPTZ;

-- Index for undo-token lookup. UNIQUE because tokens are random and
-- must be globally unique; partial WHERE clause keeps the index lean
-- by excluding the (currently many) rows with no token set yet.
CREATE UNIQUE INDEX IF NOT EXISTS idx_inbound_email_log_undo_token
  ON inbound_email_log (undo_token)
  WHERE undo_token IS NOT NULL;

NOTIFY pgrst, 'reload schema';
