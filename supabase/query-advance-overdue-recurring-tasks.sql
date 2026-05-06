-- One-time backfill: advance every overdue incomplete recurring task
-- to the next scheduled instance >= today.
--
-- This SQL is the database-only equivalent of
-- src/db/queries.js#advanceOverdueRecurringTasks, which now runs daily
-- at 00:30 via cron. Use this query when you want to apply the fix
-- immediately rather than waiting for the next cron tick.
--
-- Implementation: a PL/pgSQL DO block that loops over each overdue
-- recurring task and advances its due_date one period at a time until
-- it lands >= CURRENT_DATE. This mirrors the JS implementation rather
-- than trying to compute the new date in a single expression — months
-- and years aren't fixed-length, so the per-task loop is both correct
-- and easy to reason about.
--
-- Idempotent: running twice in a row is a no-op (the second run finds
-- no tasks with due_date < CURRENT_DATE after the first run completes).
--
-- Run in Supabase SQL editor.

-- ── Step 1: preview what will change ────────────────────────────────
-- Read-only — shows the rows that will be touched and (per recurrence
-- type) what the next single advance would produce. The actual UPDATE
-- below loops until >= today, which may advance further than this
-- preview shows for very-overdue tasks. Run the full DO block to commit.
SELECT
  id,
  title,
  recurrence,
  due_date AS current_due,
  CURRENT_DATE - due_date AS days_overdue,
  CASE recurrence
    WHEN 'daily'    THEN due_date + 1
    WHEN 'weekly'   THEN due_date + 7
    WHEN 'biweekly' THEN due_date + 14
    WHEN 'monthly'  THEN (due_date + INTERVAL '1 month')::date
    WHEN 'yearly'   THEN (due_date + INTERVAL '1 year')::date
  END AS next_period
FROM tasks
WHERE recurrence IS NOT NULL
  AND completed = false
  AND due_date < CURRENT_DATE
ORDER BY days_overdue DESC;

-- ── Step 2: apply the fix ───────────────────────────────────────────
DO $$
DECLARE
  t RECORD;
  new_due DATE;
  iterations INT;
BEGIN
  FOR t IN
    SELECT id, title, due_date, recurrence
    FROM tasks
    WHERE recurrence IS NOT NULL
      AND completed = false
      AND due_date < CURRENT_DATE
  LOOP
    new_due := t.due_date;
    iterations := 0;

    -- Advance one period at a time until new_due >= today.
    -- Cap at 1000 iterations as a safety belt against runaway loops
    -- (would only matter for badly-formed data — even a daily task
    -- 5 years overdue is just ~1825 advances).
    WHILE new_due < CURRENT_DATE AND iterations < 1000 LOOP
      iterations := iterations + 1;
      new_due := CASE t.recurrence
        WHEN 'daily'    THEN new_due + 1
        WHEN 'weekly'   THEN new_due + 7
        WHEN 'biweekly' THEN new_due + 14
        WHEN 'monthly'  THEN (new_due + INTERVAL '1 month')::date
        WHEN 'yearly'   THEN (new_due + INTERVAL '1 year')::date
        ELSE NULL
      END;
      EXIT WHEN new_due IS NULL;
    END LOOP;

    IF new_due IS NOT NULL AND new_due > t.due_date THEN
      UPDATE tasks SET due_date = new_due WHERE id = t.id;
      RAISE NOTICE 'Advanced "%" (%): % → %', t.title, t.recurrence, t.due_date, new_due;
    END IF;
  END LOOP;
END$$;

-- ── Step 3: verify ──────────────────────────────────────────────────
-- Should return zero rows after the DO block runs successfully.
SELECT id, title, recurrence, due_date
FROM tasks
WHERE recurrence IS NOT NULL
  AND completed = false
  AND due_date < CURRENT_DATE;
