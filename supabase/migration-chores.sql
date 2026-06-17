-- Chores & routines (the redesigned Tasks page).
--
-- Unlike the existing `tasks` table (flat to-dos, one `completed` flag, one
-- due_date per row), the new Tasks page is built on RECURRING DEFINITIONS that
-- generate each day's view, with completion tracked PER PERSON and PER DAY.
-- These live in their own tables so the heavily-integrated `tasks` table (bot,
-- digest, reminders, WhatsApp) stays untouched - that table now backs the
-- Lists page's "To-dos" list instead.
--
--   chore_definitions  - the recurring template
--   chore_completions  - one row per (definition, member, day) that is done
--
-- Day-view generation (app layer, appliesOn): hide if start_date is after the
-- date; then weekly -> weekday in `days`; once -> due_date matches; daily ->
-- always. The view is definitions filtered by appliesOn LEFT JOINed to
-- completions for that date + member.
--
-- Both tables are reached only from the Node API via the service-role key, so
-- RLS is enabled with NO policies (browser/anon PostgREST gets zero rows;
-- service-role bypasses RLS). Same approach as the other server-only tables.

CREATE TABLE IF NOT EXISTS chore_definitions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  emoji         TEXT,                                  -- optional; no-icon tasks render compact
  type          TEXT NOT NULL DEFAULT 'chore' CHECK (type IN ('routine','chore')),
  assignee_ids  UUID[] NOT NULL DEFAULT '{}',          -- multi-person; appears in each assignee's column
  whens         TEXT[] NOT NULL DEFAULT '{}',          -- routines: subset of morning|afternoon|evening (multi-slot)
  repeat        TEXT NOT NULL DEFAULT 'daily' CHECK (repeat IN ('daily','weekly','once')),
  days          TEXT[] NOT NULL DEFAULT '{}',          -- weekly: subset of MON..SUN
  due_date      DATE,                                  -- once: the single day it applies
  start_date    DATE,                                  -- optional: only appears on/after this day
  due_time      TIME,                                  -- optional time-of-day chip
  reward        BOOLEAN NOT NULL DEFAULT false,        -- parent-elected: earns stars on completion
  stars         INTEGER NOT NULL DEFAULT 0,            -- star value when reward
  position      INTEGER NOT NULL DEFAULT 0,            -- manual drag-reorder
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT now(),
  archived_at   TIMESTAMP WITH TIME ZONE               -- soft-delete (NULL = active)
);

CREATE INDEX IF NOT EXISTS idx_chore_definitions_household ON chore_definitions (household_id) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_chore_definitions_assignees ON chore_definitions USING GIN (assignee_ids);

CREATE TABLE IF NOT EXISTS chore_completions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  definition_id  UUID NOT NULL REFERENCES chore_definitions(id) ON DELETE CASCADE,
  member_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  household_id   UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  date           DATE NOT NULL,                        -- the day this completion is for (household tz)
  completed_at   TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE (definition_id, member_id, date)              -- one completion per person per day per chore
);

CREATE INDEX IF NOT EXISTS idx_chore_completions_household_date ON chore_completions (household_id, date);
CREATE INDEX IF NOT EXISTS idx_chore_completions_def_date ON chore_completions (definition_id, date);

ALTER TABLE chore_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE chore_completions ENABLE ROW LEVEL SECURITY;
