-- Fix calendar sync mapping "ping-pong" that caused every event to be
-- re-linked on every poll (see log-analysis notes in commit d68a692).
--
-- Run this in the Supabase SQL editor.
--
-- ─── The bug ────────────────────────────────────────────────────────────
-- calendar_sync_mappings was created with UNIQUE(event_id, connection_id).
-- That means one-mapping-per-event-per-connection. When Apple CalDAV sends
-- a new external_event_id for an event (recurring-series expansion using
-- a different occurrence UID, iCloud re-indexing, calendar moves), the
-- upsert done at write time conflicts on (event_id, connection_id) and
-- OVERWRITES the existing row's external_event_id. The very next poll
-- then can't find the old UID, falls back to title+time matching, and
-- "re-links" the event all over again.
--
-- ─── The fix ────────────────────────────────────────────────────────────
-- Switch the uniqueness to (connection_id, external_event_id). Each Apple
-- UID gets its own durable mapping row; multiple UIDs can coexist for a
-- single event. The per-UID lookup used by processChange() now hits a
-- stable row every time, so "Re-linking" stops firing for events that
-- legitimately already have a mapping — the count stabilises at zero
-- once the first post-migration sync replaces the orphaned rows.
--
-- This also unblocks future improvements: multiple calendar subscriptions
-- overlapping on the same event, shared-calendar sync, cross-account
-- mirrors — none of which the old 1:1 schema supported cleanly.

-- ── 1. Clean up accidental duplicates before tightening the constraint ──
-- Under the old constraint, (connection_id, external_event_id) was only
-- "mostly" unique — two different events sharing the same external UID
-- for the same connection was possible in edge cases (e.g. a prior
-- upsert-swap then create). Keep the most recently synced row per pair.
DELETE FROM calendar_sync_mappings a
USING calendar_sync_mappings b
WHERE a.id != b.id
  AND a.connection_id = b.connection_id
  AND a.external_event_id = b.external_event_id
  AND (a.last_synced_at, a.id) < (b.last_synced_at, b.id);

-- ── 2. Drop the old unique constraint ──────────────────────────────────
-- Constraint name follows PostgreSQL's default convention for UNIQUE
-- constraints declared inline in CREATE TABLE: {table}_{columns}_key.
ALTER TABLE calendar_sync_mappings
  DROP CONSTRAINT IF EXISTS calendar_sync_mappings_event_id_connection_id_key;

-- ── 3. Add the new unique constraint ───────────────────────────────────
-- Matches the shape of every lookup in src/services/calendarSync.js so
-- upsert on-conflict and select lookups key off the same columns.
ALTER TABLE calendar_sync_mappings
  ADD CONSTRAINT calendar_sync_mappings_connection_id_external_event_id_key
  UNIQUE (connection_id, external_event_id);

-- ── 4. Index for fast "any other mappings for this event?" checks ──────
-- The new delete flow asks "after removing this UID's mapping, does the
-- event still have any other mappings?" That's a query by event_id which
-- used to ride the old unique constraint's index. With the constraint
-- gone, add the index explicitly.
CREATE INDEX IF NOT EXISTS idx_calendar_sync_mappings_event_id
  ON calendar_sync_mappings (event_id);
