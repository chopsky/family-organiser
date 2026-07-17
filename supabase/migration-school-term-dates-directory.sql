-- Shared school term-dates directory
--
-- Cross-household store for schools that DON'T follow council dates
-- (independent schools, academies with custom calendars). The first parent's
-- reviewed website/PDF import seeds a central record; later parents at the
-- same school adopt the identical dates with zero AI calls; a divergent fresh
-- import triggers automatic arbitration; central corrections propagate to
-- every linked household. Sister feature to the LA directory
-- (migration-la-term-dates-directory.sql) and follows the same conventions.
--
-- Server-side only: RLS is enabled with NO anon/user policies, so the only
-- reader/writer is the Express API using the service-role key (which bypasses
-- RLS). Apply in the Supabase SQL editor; safe to re-run.

-- One row per real-world school. Identity: GIAS URN when the parent picked the
-- school from search; otherwise normalized name + postcode (both required -
-- a school with neither is never linked).
CREATE TABLE IF NOT EXISTS directory_schools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  urn TEXT UNIQUE,                        -- GIAS URN when known; NULL for manual/SA entries
  name TEXT NOT NULL,                     -- display name (as the seeding parent entered/picked it)
  name_key TEXT NOT NULL,                 -- normalized: lowercase alphanumerics, single spaces
  postcode TEXT,                          -- normalized: uppercase, single internal space
  slug TEXT NOT NULL UNIQUE,              -- url-safe, e.g. "immanuel-college-wd23-4eb"
  local_authority TEXT,
  country TEXT NOT NULL DEFAULT 'GB',
  status TEXT NOT NULL DEFAULT 'ok'
    CHECK (status IN ('ok', 'needs_attention')),
  source_type TEXT CHECK (source_type IN ('website', 'pdf')),
  source_url TEXT,                        -- re-fetchable page for website imports; label for PDFs
  source_text TEXT,                       -- extracted-text snapshot (<=16k) grounding arbitration
  verified_count INT NOT NULL DEFAULT 1,  -- INDEPENDENT checks: seed import + system verifications + matching re-imports
  adopted_count INT NOT NULL DEFAULT 0,   -- households that imported FROM this record (not verifications)
  date_count INT NOT NULL DEFAULT 0,
  last_verified_at TIMESTAMPTZ,           -- last SYSTEM verification (NULL = seed-only so far)
  arbitration_note TEXT,                  -- last arbitration/verification outcome, for ops
  last_arbitrated_at TIMESTAMPTZ,
  first_imported_at TIMESTAMPTZ DEFAULT now(),
  last_imported_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- URN-less identity: at most one record per normalized name+postcode.
CREATE UNIQUE INDEX IF NOT EXISTS idx_directory_schools_name_pc
  ON directory_schools (name_key, COALESCE(postcode, ''));
CREATE INDEX IF NOT EXISTS idx_directory_schools_status ON directory_schools (status);

-- One row per dated entry, per school, per academic year. Same shape as
-- school_term_dates / la_term_date_entries so rows drop straight into the
-- existing import paths.
CREATE TABLE IF NOT EXISTS directory_school_term_dates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  directory_school_id UUID NOT NULL REFERENCES directory_schools(id) ON DELETE CASCADE,
  academic_year TEXT NOT NULL,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('term_start', 'term_end', 'half_term_start', 'half_term_end', 'inset_day', 'bank_holiday')),
  date DATE NOT NULL,
  end_date DATE,
  label TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dir_school_dates
  ON directory_school_term_dates (directory_school_id, academic_year);

-- The propagation link: which central record a household's school follows.
-- Set on seeding AND on adoption; cleared if the central record is deleted.
ALTER TABLE household_schools
  ADD COLUMN IF NOT EXISTS directory_school_id UUID
  REFERENCES directory_schools(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_household_schools_directory
  ON household_schools (directory_school_id);

ALTER TABLE directory_schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE directory_school_term_dates ENABLE ROW LEVEL SECURITY;
-- No anon/user RLS policies by design: this data is only ever read/written by
-- the backend (service-role key), which the Express routes sit in front of.
