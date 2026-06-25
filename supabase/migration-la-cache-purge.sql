-- One-time purge of poisoned LA term-dates cache rows.
--
-- Before 2026-06-25 the "Import from local authority" flow asked the LLM to
-- RECALL a council's term dates (the prompt literally said "if not certain, use
-- typical dates"), then cached that guess and served it to every other family
-- in the same local authority. Those cached rows are hallucinated and are still
-- returned on a cache hit, so we delete them. The next import per LA then
-- regenerates from the council's real page (see docs/school-term-dates.md).
--
-- Scoped by date so it only removes pre-fix rows: anything written by the new
-- flow has a fresh created_at and is left intact. Safe to re-run.
--
-- Run in the Supabase SQL editor (or psql) against the production database.

DELETE FROM la_term_dates_cache
WHERE created_at < '2026-06-25';

-- To nuke the entire cache instead (also fine; it is pure, regenerable cache):
--   TRUNCATE la_term_dates_cache;
