-- Fix: event_reminders.household_id was created without an ON DELETE action,
-- which defaults to NO ACTION and blocks household deletion if any event
-- reminder rows exist for that household. This breaks self-service account
-- deletion (see src/routes/auth.js DELETE /api/auth/account) for any user
-- who is the sole member of a household that's ever had an event reminder.
--
-- Recreating the constraint with ON DELETE CASCADE so household deletion
-- cleans up its event reminders in one shot, consistent with every other
-- household-scoped table (calendar_events, tasks, shopping_items, …).
--
-- Run this in the Supabase SQL editor.

-- Drop the old, broken constraint. The constraint name matches PostgreSQL's
-- default convention ({table}_{column}_fkey).
ALTER TABLE event_reminders
  DROP CONSTRAINT IF EXISTS event_reminders_household_id_fkey;

-- Re-add with ON DELETE CASCADE so household deletes cascade through it.
ALTER TABLE event_reminders
  ADD CONSTRAINT event_reminders_household_id_fkey
  FOREIGN KEY (household_id)
  REFERENCES households(id)
  ON DELETE CASCADE;
