-- Allow 'school' as a calendar_events category.
--
-- The bot's school_event intent (INSET days, non-uniform days, trips) tags
-- events category='school', and Calendar.jsx already styles them amber - but
-- the CHECK constraint from migration-calendar-sync-v2.sql only allowed
-- ('general','birthday','public_holiday'), so every bot-created school event
-- failed with calendar_events_category_check. The handler currently falls
-- back to 'general' when the constraint rejects 'school'; after this runs,
-- school events keep their category (and amber styling).
--
-- Run in the Supabase SQL editor. Idempotent.

ALTER TABLE calendar_events
  DROP CONSTRAINT IF EXISTS calendar_events_category_check;

ALTER TABLE calendar_events
  ADD CONSTRAINT calendar_events_category_check
  CHECK (category IN ('general', 'birthday', 'public_holiday', 'school'));
