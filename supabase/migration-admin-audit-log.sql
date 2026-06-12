-- Admin audit log
-- Records every successful MUTATING action taken through the platform-admin
-- API surface (/api/admin/*) for accountability + traceability. Rows are
-- written fire-and-forget by the adminAudit middleware after the response
-- finishes, so logging never blocks or fails an admin request. Bodies are
-- redacted (secrets/tokens stripped, long strings truncated) before storage.

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_name    TEXT,
  method        TEXT NOT NULL,
  path          TEXT NOT NULL,
  status_code   INTEGER NOT NULL,
  target_id     TEXT,
  params        JSONB,
  body          JSONB,
  ip            TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Newest-first listing is the common read; actor lookup for "what did X do".
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created_at ON admin_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_actor ON admin_audit_log (actor_user_id);
