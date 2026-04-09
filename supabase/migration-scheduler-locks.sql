-- Scheduler deduplication locks
-- Prevents duplicate notifications when multiple instances overlap (e.g. rolling deploys)
-- Each lock is a unique (lock_key, lock_date) pair — if it already exists, skip sending.

CREATE TABLE IF NOT EXISTS scheduler_locks (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lock_key    TEXT NOT NULL,       -- e.g. 'daily_reminder:member:abc123' or 'overdue_nudge:household:xyz'
  lock_date   DATE NOT NULL,       -- the date this lock applies to
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(lock_key, lock_date)
);

-- Auto-cleanup: delete locks older than 7 days (keeps the table small)
CREATE INDEX IF NOT EXISTS idx_scheduler_locks_date ON scheduler_locks(lock_date);

-- RLS: this table is only accessed via supabaseAdmin (service key), no user-facing access
ALTER TABLE scheduler_locks ENABLE ROW LEVEL SECURITY;
