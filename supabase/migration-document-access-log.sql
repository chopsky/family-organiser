-- Migration: per-household audit trail for document downloads
--
-- A common ask from households storing sensitive docs (passport scans,
-- NHS letters, contracts) is "did anyone else look at this?". Without
-- a log we can't answer that. This migration adds a lightweight access
-- log: one row per signed-URL request, scoped to household so admins
-- can see who opened what and when.
--
-- We log on the *signed-URL fetch* (GET /api/documents/:id/url), not
-- on the eventual R2 GET. Reasons:
--   - The signed URL is what the user actively requests; a stale URL
--     still in browser cache later isn't the same thing.
--   - We don't sit between the browser and R2 (it's a direct fetch),
--     so we'd need bucket-level access logging from Cloudflare to see
--     R2 hits — heavyweight + cross-system.
--   - The per-fetch log captures the user's intent at the moment of
--     access, which is what households want to see.
--
-- Privacy note: ip / user_agent are nullable so we have the option
-- to not log them later (e.g. for users who turn off "rich logging"
-- in settings, if we ever ship that). For now we always populate them
-- since they're useful for distinguishing legit access from suspicious.
--
-- Retention: rows persist until the parent document is deleted (FK
-- cascade) or the household is deleted (FK cascade). We don't auto-
-- prune old log rows yet — could be a P2 housekeeping job if volume
-- becomes an issue.

CREATE TABLE IF NOT EXISTS document_access_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id   uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  household_id  uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id       uuid REFERENCES users(id) ON DELETE SET NULL,
  action        text NOT NULL DEFAULT 'download',
  ip            text,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT NOW()
);

-- Recent activity per household (the admin "Recent activity" feed).
-- DESC on created_at because we always want newest first.
CREATE INDEX IF NOT EXISTS idx_doc_access_log_household_created
  ON document_access_log (household_id, created_at DESC);

-- Per-document history (the "who has opened this file?" lookup on a
-- specific document detail screen).
CREATE INDEX IF NOT EXISTS idx_doc_access_log_document_created
  ON document_access_log (document_id, created_at DESC);

-- RLS: this table is server-only, just like refresh_tokens etc. The
-- API uses the service-role key which bypasses RLS. Anon must never
-- reach this table — it would leak per-user document access patterns.
ALTER TABLE document_access_log ENABLE ROW LEVEL SECURITY;
