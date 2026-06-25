-- LA term-dates directory
--
-- A standalone, public directory of UK local education authorities (sourced
-- from GIAS) and the school term dates they publish. Powers the searchable
-- /la-term-dates page and the monthly importer. Distinct from
-- `la_term_dates_cache` (which is the per-family Housemait import cache): this
-- is a complete, curated dataset Housemait can eventually pull from.
--
-- Server-side only: RLS is enabled with NO anon/user policies, so the only
-- reader/writer is the Express API using the Supabase service-role key (which
-- bypasses RLS). Apply in the Supabase SQL editor; safe to re-run.

-- One row per local authority (the GIAS "LA (name)" value, so the names line
-- up exactly with what Housemait's existing LA import already stores).
CREATE TABLE IF NOT EXISTS la_directory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,             -- GIAS "LA (name)", e.g. "Barnet"
  slug TEXT NOT NULL UNIQUE,             -- url-safe, e.g. "barnet"
  region TEXT,                           -- "England" | "Wales"
  school_count INT NOT NULL DEFAULT 0,   -- open schools in GIAS (context only)
  import_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (import_status IN ('pending', 'ok', 'partial', 'failed')),
  import_method TEXT                      -- how the dates were obtained: 'direct' (read the page) | 'search' (search-grounded fallback)
    CHECK (import_method IN ('direct', 'search')),
  import_error TEXT,                     -- why the last attempt fell short (for the "remedy" list)
  source_url TEXT,                       -- the official council page we extracted from
  date_count INT NOT NULL DEFAULT 0,     -- dated rows currently stored for this LA
  last_imported_at TIMESTAMPTZ,          -- last SUCCESSFUL import
  last_attempted_at TIMESTAMPTZ,         -- last attempt (success or failure)
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_la_directory_name ON la_directory (name);
CREATE INDEX IF NOT EXISTS idx_la_directory_status ON la_directory (import_status);

-- One row per dated entry, per LA, per academic year. Mirrors the shape of
-- school_term_dates so the rows drop straight into Housemait's import path.
CREATE TABLE IF NOT EXISTS la_term_date_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  la_id UUID NOT NULL REFERENCES la_directory(id) ON DELETE CASCADE,
  academic_year TEXT NOT NULL,          -- "2025-2026"
  event_type TEXT NOT NULL
    CHECK (event_type IN ('term_start', 'term_end', 'half_term_start', 'half_term_end', 'inset_day', 'bank_holiday')),
  date DATE NOT NULL,
  end_date DATE,                        -- nullable; spans multi-day breaks
  label TEXT,
  source_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_la_entries_la ON la_term_date_entries (la_id, academic_year);

-- One row per import run (monthly cron or manual) - operational visibility into
-- "did the periodic import actually run, and how did it do?".
CREATE TABLE IF NOT EXISTS la_import_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger TEXT NOT NULL DEFAULT 'manual',   -- 'cron' | 'manual'
  started_at TIMESTAMPTZ DEFAULT now(),
  finished_at TIMESTAMPTZ,
  total INT NOT NULL DEFAULT 0,
  succeeded INT NOT NULL DEFAULT 0,
  partial INT NOT NULL DEFAULT 0,
  failed INT NOT NULL DEFAULT 0,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_la_runs_started ON la_import_runs (started_at DESC);

ALTER TABLE la_directory ENABLE ROW LEVEL SECURITY;
ALTER TABLE la_term_date_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE la_import_runs ENABLE ROW LEVEL SECURITY;
-- No anon/user RLS policies by design: this data is only ever read/written by
-- the backend (service-role key), which the Express routes sit in front of.
