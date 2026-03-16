-- Calendar Sync V2: subscriptions, categories, visibility
-- Run this migration after the initial calendar migration.

-- 1. Create calendar_subscriptions table
CREATE TABLE IF NOT EXISTS calendar_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES calendar_connections(id) ON DELETE CASCADE,
  external_calendar_id text NOT NULL,
  display_name text NOT NULL,
  category text NOT NULL DEFAULT 'general' CHECK (category IN ('general', 'birthday', 'public_holiday')),
  visibility text NOT NULL DEFAULT 'family' CHECK (visibility IN ('family', 'personal')),
  sync_enabled boolean NOT NULL DEFAULT true,
  last_synced_at timestamp with time zone,
  sync_token text,
  created_at timestamp with time zone DEFAULT now(),
  UNIQUE(connection_id, external_calendar_id)
);

-- 2. Add columns to calendar_events
ALTER TABLE calendar_events
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'general' CHECK (category IN ('general', 'birthday', 'public_holiday')),
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'family' CHECK (visibility IN ('family', 'personal')),
  ADD COLUMN IF NOT EXISTS source_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS subscription_id uuid REFERENCES calendar_subscriptions(id) ON DELETE SET NULL;

-- 3. Add subscription_id to calendar_sync_mappings
ALTER TABLE calendar_sync_mappings
  ADD COLUMN IF NOT EXISTS subscription_id uuid REFERENCES calendar_subscriptions(id) ON DELETE CASCADE;

-- 4. Indexes
CREATE INDEX IF NOT EXISTS idx_cal_events_category ON calendar_events(household_id, category);
CREATE INDEX IF NOT EXISTS idx_cal_events_visibility ON calendar_events(household_id, visibility, source_user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_connection ON calendar_subscriptions(connection_id);
