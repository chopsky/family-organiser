-- Churn context on the deletion ledger.
--
-- deletion_audit_log has captured WHO deleted since Phase 8 (14 rows and
-- counting) but not the story around it: how long they stayed, where they
-- came from, and whether they ever activated. Those are the columns that
-- turn a ledger into churn analysis - "paid instals that delete within a
-- week" is unanswerable without them.
--
-- All nullable: the insert falls back to the base column set while this
-- migration is pending, so deletions are never blocked on it.

ALTER TABLE deletion_audit_log
  ADD COLUMN IF NOT EXISTS user_created_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS country TEXT,
  ADD COLUMN IF NOT EXISTS signup_source TEXT,
  ADD COLUMN IF NOT EXISTS signup_promo_code TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_linked BOOLEAN,
  ADD COLUMN IF NOT EXISTS onboarded BOOLEAN,
  ADD COLUMN IF NOT EXISTS ad_attribution JSONB;
