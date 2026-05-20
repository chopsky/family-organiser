-- Fix user deletion timeout.
--
-- Both the admin user-delete flow and the user-initiated "Delete my account"
-- flow run `DELETE FROM users WHERE id = ?`. PostgreSQL has to cascade
-- through every table that references users.id - refresh_tokens,
-- device_tokens, notification_preferences, event_reminders, event_assignees,
-- chat_messages / chat_conversations, audit logs, etc. For an account with
-- meaningful usage history the cascade exceeds Supabase's default
-- statement_timeout (~30s) and the delete fails with:
--
--   error code 57014 - canceling statement due to statement timeout
--
-- Same problem we had with household deletion (see
-- migration-household-delete-fix.sql) and same fix: wrap the delete in a
-- SECURITY DEFINER function that explicitly sets a longer timeout.
-- Functions don't inherit the caller's statement_timeout when SET
-- explicitly, so this works.
--
-- Run in Supabase SQL editor. Idempotent - safe to re-run.

CREATE OR REPLACE FUNCTION delete_user_cascade(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '5min'
AS $$
BEGIN
  -- Single delete; existing FK cascades take care of the dependent rows.
  -- The bumped timeout is the entire point of this function - without it,
  -- the cascade is cut off mid-flight by Supabase's default timeout.
  DELETE FROM users WHERE id = p_user_id;
END;
$$;

-- Only trusted roles can invoke it. The backend uses the service role;
-- end users can't call this via PostgREST.
REVOKE ALL ON FUNCTION delete_user_cascade(uuid) FROM public;
GRANT EXECUTE ON FUNCTION delete_user_cascade(uuid) TO service_role;
