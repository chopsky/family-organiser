-- WhatsApp notification preferences.
--
-- The notification_preferences table previously only held push-side
-- toggles (calendar_reminders, task_assigned, …). The WhatsApp bot
-- has been sending five distinct message types unconditionally -
-- anyone with whatsapp_linked=true gets all of them. This migration
-- adds per-type opt-out columns so users can turn off any subset
-- from Settings → Notifications.
--
-- All default true so existing users see no change after deploy.
--
-- Columns map 1-1 to cron jobs:
--   whatsapp_daily_reminder         → src/jobs/reminders.js  (morning digest)
--   whatsapp_event_reminders        → src/jobs/event-reminders.js
--   whatsapp_weekly_digest          → src/jobs/digest.js  (Sunday recap)
--   whatsapp_overdue_nudge          → src/jobs/overdue-nudge.js
--   whatsapp_subscription_reminder  → src/jobs/subscription-reminders.js
--
-- Run in Supabase SQL Editor. Idempotent.

ALTER TABLE notification_preferences
  ADD COLUMN IF NOT EXISTS whatsapp_daily_reminder boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS whatsapp_event_reminders boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS whatsapp_weekly_digest boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS whatsapp_overdue_nudge boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS whatsapp_subscription_reminder boolean DEFAULT true;

NOTIFY pgrst, 'reload schema';
