-- Admin Dashboard: platform admin flag, soft-disable, and Phase 2 logging tables

-- Platform admin flag (separate from household-level role)
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_users_platform_admin ON users (is_platform_admin) WHERE is_platform_admin = true;

-- Soft-disable for user accounts
ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMPTZ DEFAULT NULL;

-- ─── Phase 2 scaffolding ────────────────────────────────────────────────────

-- AI usage tracking
CREATE TABLE IF NOT EXISTS ai_usage_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID REFERENCES households(id) ON DELETE SET NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  feature TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  latency_ms INTEGER,
  is_failover BOOLEAN DEFAULT false,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_household ON ai_usage_log (household_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_provider ON ai_usage_log (provider, created_at DESC);

-- WhatsApp message log
CREATE TABLE IF NOT EXISTS whatsapp_message_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID REFERENCES households(id) ON DELETE SET NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  direction TEXT NOT NULL,
  message_type TEXT NOT NULL,
  intent TEXT,
  processing_ms INTEGER,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_log_household ON whatsapp_message_log (household_id, created_at DESC);
