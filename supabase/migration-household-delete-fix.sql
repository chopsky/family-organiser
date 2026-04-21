-- Fix household deletion — three related problems rolled into one migration.
--
-- Run this in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- ─── Problem 1: event_reminders FK wasn't CASCADE ───────────────────────────
-- event_reminders.household_id was created in migration-event-reminders.sql
-- without an ON DELETE action, which defaults to NO ACTION and blocks
-- household deletion if any event reminders exist. Every other household-
-- scoped table uses ON DELETE CASCADE; this one was the stray.
--
-- ─── Problem 2: missing index on event_reminders.household_id ───────────────
-- The cascade from households had to full-scan event_reminders to find
-- matching rows. Slow on any meaningful dataset. (Other indexes existed
-- but only on (event_id) and (sent, remind_at) — neither helps here.)
--
-- ─── Problem 3: statement timeout during cascade ───────────────────────────
-- Even after fixing the FK and adding the index, a real household with a
-- year of data has enough tasks / events / reminders / logs to push the
-- cascade past Supabase's default ~30s statement_timeout. Account
-- deletion returned 'canceling statement due to statement timeout'.
-- Wrapping the delete in a SECURITY DEFINER function with a bumped
-- statement_timeout matches the existing disconnect_calendar_connection
-- pattern (see migration-disconnect-function.sql). Function calls don't
-- inherit the caller's timeout when explicitly SET.

-- ── 1. Re-point event_reminders.household_id at ON DELETE CASCADE ──────────
ALTER TABLE event_reminders
  DROP CONSTRAINT IF EXISTS event_reminders_household_id_fkey;
ALTER TABLE event_reminders
  ADD CONSTRAINT event_reminders_household_id_fkey
  FOREIGN KEY (household_id)
  REFERENCES households(id)
  ON DELETE CASCADE;

-- ── 2. Index for fast lookup by household_id ──────────────────────────────
CREATE INDEX IF NOT EXISTS idx_event_reminders_household_id
  ON event_reminders (household_id);

-- ── 3. Cascade-delete function with extended timeout ──────────────────────
CREATE OR REPLACE FUNCTION delete_household_cascade(p_household_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '5min'
AS $$
BEGIN
  -- Belt-and-braces pre-clean for event_reminders: if the FK fix above
  -- hasn't taken effect (e.g. old schema cached somewhere), removing
  -- these rows explicitly prevents a NO ACTION violation from blocking
  -- the household delete below. Cheap with the new index.
  DELETE FROM event_reminders WHERE household_id = p_household_id;

  -- Actual cascade: every household-scoped table has ON DELETE CASCADE
  -- after this migration, so this one DELETE takes care of everything.
  DELETE FROM households WHERE id = p_household_id;
END;
$$;

-- Only trusted roles can call it — the backend calls via the service
-- role; end users can't invoke it directly via PostgREST.
REVOKE ALL ON FUNCTION delete_household_cascade(uuid) FROM public;
GRANT EXECUTE ON FUNCTION delete_household_cascade(uuid) TO service_role;
