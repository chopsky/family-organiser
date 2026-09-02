-- Per-council, per-academic-year diff recorded on every term-dates import.
-- Instrumentation only (no user-facing surface): after a few monthly runs the
-- rows answer "how often do councils actually change published dates?", the
-- fact that decides whether change alerts are worth building.
-- Run once in the Supabase SQL editor. Safe to re-run.

CREATE TABLE IF NOT EXISTS la_term_date_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  la_id UUID NOT NULL REFERENCES la_directory(id) ON DELETE CASCADE,
  run_id UUID REFERENCES la_import_runs(id) ON DELETE SET NULL,
  academic_year TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('identical', 'changed', 'new_year', 'removed_year')),
  added_count INT NOT NULL DEFAULT 0,
  removed_count INT NOT NULL DEFAULT 0,
  unchanged_count INT NOT NULL DEFAULT 0,
  added JSONB NOT NULL DEFAULT '[]'::jsonb,     -- [{event_type,date,end_date,label}]
  removed JSONB NOT NULL DEFAULT '[]'::jsonb,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_la_changes_detected ON la_term_date_changes (detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_la_changes_la ON la_term_date_changes (la_id, academic_year);
CREATE INDEX IF NOT EXISTS idx_la_changes_kind ON la_term_date_changes (kind);

ALTER TABLE la_term_date_changes ENABLE ROW LEVEL SECURITY;
-- Service-role only: written by the importer, read by the key-gated operator
-- endpoint GET /api/la-term-dates/changes. No public policy on purpose.
