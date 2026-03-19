-- Shared LA term dates cache
-- Avoids repeat AI calls when multiple families import from the same local authority

CREATE TABLE IF NOT EXISTS la_term_dates_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  local_authority TEXT NOT NULL,
  academic_year TEXT NOT NULL,
  dates JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE (local_authority, academic_year)
);

ALTER TABLE la_term_dates_cache ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (backend uses service role key)
-- No user-facing RLS policies needed — this table is only accessed server-side
CREATE INDEX IF NOT EXISTS idx_la_cache_lookup ON la_term_dates_cache (local_authority, academic_year);
