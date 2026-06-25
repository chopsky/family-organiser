-- Track how many times each local authority has been attempted by the term-
-- dates importer, so the importer can stop auto-retrying councils that fail
-- repeatedly (almost always structurally impossible: no LA-wide calendar, or a
-- JS-only page). Without this, every --stale / monthly run re-paid the full
-- web_search cost for the same dead councils. See docs/la-term-dates-directory.md.
--
-- Run in the Supabase SQL editor. Idempotent. The importer self-heals if this
-- hasn't been applied yet (it just doesn't cap retries until it is).

ALTER TABLE la_directory
  ADD COLUMN IF NOT EXISTS import_attempts INTEGER NOT NULL DEFAULT 0;

-- Backfill: anything already imported or failed has been attempted at least
-- once, so the attempt cap starts counting from a sensible baseline rather than
-- treating every prior council as a fresh, never-tried authority.
UPDATE la_directory
  SET import_attempts = 1
  WHERE import_attempts = 0
    AND import_status IN ('ok', 'partial', 'failed');
