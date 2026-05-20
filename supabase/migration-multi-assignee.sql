-- Multi-assignee support for tasks and calendar_events.
--
-- Before: single FK (assigned_to uuid + assigned_to_name text). A task or
-- event could only belong to one household member. "Remind Lynn AND Grant
-- to give Logan eye drops weekly" silently dropped the second name.
--
-- After: array columns (assigned_to_ids uuid[] + assigned_to_names text[]).
-- One row, shared completion (when anyone ticks done, it's done for
-- everyone in the array). Empty array = "everyone in the household"
-- (matches the old assigned_to IS NULL fallback used by the scheduler).

-- ---------- tasks ----------

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS assigned_to_ids   uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS assigned_to_names text[] NOT NULL DEFAULT '{}';

UPDATE tasks
  SET assigned_to_ids   = ARRAY[assigned_to],
      assigned_to_names = ARRAY[assigned_to_name]
  WHERE assigned_to IS NOT NULL
    AND assigned_to_ids = '{}';

ALTER TABLE tasks
  DROP COLUMN IF EXISTS assigned_to,
  DROP COLUMN IF EXISTS assigned_to_name;

CREATE INDEX IF NOT EXISTS tasks_assigned_to_ids_idx
  ON tasks USING GIN (assigned_to_ids);

-- ---------- calendar_events ----------

ALTER TABLE calendar_events
  ADD COLUMN IF NOT EXISTS assigned_to_ids   uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS assigned_to_names text[] NOT NULL DEFAULT '{}';

UPDATE calendar_events
  SET assigned_to_ids   = ARRAY[assigned_to],
      assigned_to_names = ARRAY[assigned_to_name]
  WHERE assigned_to IS NOT NULL
    AND assigned_to_ids = '{}';

ALTER TABLE calendar_events
  DROP COLUMN IF EXISTS assigned_to,
  DROP COLUMN IF EXISTS assigned_to_name;

CREATE INDEX IF NOT EXISTS calendar_events_assigned_to_ids_idx
  ON calendar_events USING GIN (assigned_to_ids);
