-- One-time backfill: advance every overdue incomplete recurring task
-- to the next scheduled instance >= today.
--
-- This SQL is the database-only equivalent of
-- src/db/queries.js#advanceOverdueRecurringTasks, which now runs daily
-- at 00:30 via cron. Use this query when you want to apply the fix
-- immediately rather than waiting for the next cron tick (e.g. right
-- after deploying the cron change so users don't see stale "overdue
-- 22 days" labels for one more night).
--
-- Idempotent — running twice in a row is a no-op (the second run finds
-- no tasks with due_date < today after the first run completes).
--
-- Run in Supabase SQL editor.

-- Preview what will change before committing.
SELECT
  id,
  title,
  recurrence,
  due_date AS old_due,
  CASE recurrence
    WHEN 'daily'    THEN
      due_date + ((CURRENT_DATE - due_date)::int) * INTERVAL '1 day'
    WHEN 'weekly'   THEN
      due_date + (CEIL((CURRENT_DATE - due_date)::numeric / 7) * 7)::int * INTERVAL '1 day'
    WHEN 'biweekly' THEN
      due_date + (CEIL((CURRENT_DATE - due_date)::numeric / 14) * 14)::int * INTERVAL '1 day'
    WHEN 'monthly'  THEN
      due_date + (CEIL(EXTRACT(EPOCH FROM (CURRENT_DATE - due_date)) / (30 * 86400))::int) * INTERVAL '1 month'
    WHEN 'yearly'   THEN
      due_date + (CEIL(EXTRACT(YEAR FROM AGE(CURRENT_DATE, due_date)))::int) * INTERVAL '1 year'
  END AS new_due
FROM tasks
WHERE recurrence IS NOT NULL
  AND completed = false
  AND due_date < CURRENT_DATE
ORDER BY due_date;

-- Once the preview looks right, run the UPDATE. The math mirrors
-- nextValidDueDate() in queries.js: advance by `recurrence` periods
-- enough times to land >= CURRENT_DATE.
UPDATE tasks SET due_date =
  CASE recurrence
    WHEN 'daily' THEN
      CURRENT_DATE
    WHEN 'weekly' THEN
      due_date + (CEIL((CURRENT_DATE - due_date)::numeric / 7) * 7)::int
    WHEN 'biweekly' THEN
      due_date + (CEIL((CURRENT_DATE - due_date)::numeric / 14) * 14)::int
    WHEN 'monthly' THEN
      due_date + (CEIL(EXTRACT(EPOCH FROM (CURRENT_DATE - due_date)) / (30 * 86400))::int) * INTERVAL '1 month'
    WHEN 'yearly' THEN
      due_date + (CEIL(EXTRACT(YEAR FROM AGE(CURRENT_DATE, due_date)))::int) * INTERVAL '1 year'
  END
WHERE recurrence IS NOT NULL
  AND completed = false
  AND due_date < CURRENT_DATE;

-- Verify: should return zero rows.
SELECT id, title, recurrence, due_date
FROM tasks
WHERE recurrence IS NOT NULL
  AND completed = false
  AND due_date < CURRENT_DATE;
