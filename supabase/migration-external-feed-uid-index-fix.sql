-- Migration: make idx_calendar_events_feed_uid non-partial so
-- ON CONFLICT can use it.
--
-- Why this exists: the original migration declared the unique index as
-- PARTIAL (WHERE external_feed_id IS NOT NULL) to keep it small.
-- Postgres allows ON CONFLICT against a partial index, but only when
-- the inserted row's WHERE clause matches the partial predicate — and
-- Supabase JS's `.upsert(... { onConflict: ... })` doesn't expose that
-- machinery. Result: every refresh threw
--   "there is no unique or exclusion constraint matching the ON
--   CONFLICT specification"
-- and the inbound feed couldn't reconcile its events.
--
-- The fix: drop the partial clause. The index gets slightly wider —
-- it now also covers rows where external_feed_id IS NULL (i.e.
-- Housemait-originated events) — but those rows have external_uid
-- IS NULL too, and Postgres treats (NULL, NULL) as distinct under
-- default NULLS DISTINCT semantics, so multiple Housemait-originated
-- events coexist fine in the index without conflict.
--
-- Net cost: index grows by ~one B-tree leaf per Housemait-originated
-- event. With ~1k–10k events per active household, this is negligible.

DROP INDEX IF EXISTS idx_calendar_events_feed_uid;

CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_events_feed_uid
  ON calendar_events(external_feed_id, external_uid);
