-- Incremental migration: add la_directory.import_method
--
-- Provenance for each authority's dates: 'direct' (read the council's own page)
-- vs 'search' (the search-grounded fallback used when the page is WAF-blocked).
--
-- Run this if you applied migration-la-term-dates-directory.sql BEFORE the
-- import_method column was added to it. No-op (IF NOT EXISTS) on fresh installs
-- where the base migration already includes the column. Safe to re-run.

ALTER TABLE la_directory
  ADD COLUMN IF NOT EXISTS import_method TEXT
  CHECK (import_method IN ('direct', 'search'));
