-- Audit-log schema tweak — allow system-initiated deletions.
--
-- The Phase 8 migration created deletion_audit_log with user_id NOT NULL,
-- which was correct for self-service deletions (there's always a real user
-- clicking the button). The retention + orphan cleanup crons (Phase 8.5)
-- also write to this table but have no user to attribute — the deletion
-- is policy-driven.
--
-- Relaxing user_id to nullable lets the cron record a proper audit row
-- with user_id=NULL, user_email=NULL. ip_address and user_agent are
-- already nullable. deletion_mode still carries the CHECK constraint —
-- system deletions use 'household_deleted' (they are household deletes,
-- just system-initiated).
--
-- A NULL user_id is unambiguous: a real user always has a UUID. Queries
-- that need to filter "user-initiated vs system" can use
-- `WHERE user_id IS NOT NULL` / `IS NULL`.
--
-- Safe to re-run — DROP NOT NULL is idempotent for already-nullable
-- columns.

ALTER TABLE deletion_audit_log
  ALTER COLUMN user_id DROP NOT NULL;

COMMENT ON COLUMN deletion_audit_log.user_id IS
  'The user whose deletion-button click triggered this. NULL for system-initiated deletions from the retention / orphan cleanup crons (src/jobs/retention.js).';
