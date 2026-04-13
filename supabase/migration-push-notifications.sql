-- Push notification support: device tokens and notification preferences
-- Migration: push-notifications

-- Store APNs device tokens for push notifications
CREATE TABLE IF NOT EXISTS device_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    token text UNIQUE NOT NULL,
    platform text NOT NULL DEFAULT 'ios',
    active boolean DEFAULT true,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_device_tokens_user_active ON device_tokens (user_id, active);
CREATE INDEX IF NOT EXISTS idx_device_tokens_household_active ON device_tokens (household_id, active);

-- Per-user toggles for each notification category
CREATE TABLE IF NOT EXISTS notification_preferences (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    calendar_reminders boolean DEFAULT true,
    task_assigned boolean DEFAULT true,
    shopping_updated boolean DEFAULT true,
    meal_plan_updated boolean DEFAULT true,
    family_activity boolean DEFAULT true,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);
