-- School Life Integration — Phase 1
-- Creates tables for school management, term dates, weekly activities, and school events

-- 1. GIAS school directory (imported from GOV.UK CSV, ~25k rows)
CREATE TABLE IF NOT EXISTS schools_directory (
  urn TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT,
  phase TEXT,
  local_authority TEXT,
  address TEXT,
  postcode TEXT,
  status TEXT
);

-- 2. Schools linked to a household
CREATE TABLE IF NOT EXISTS household_schools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID REFERENCES households(id) ON DELETE CASCADE,
  school_name TEXT NOT NULL,
  school_urn TEXT,
  school_type TEXT,
  local_authority TEXT,
  postcode TEXT,
  uses_la_dates BOOLEAN DEFAULT true,
  ical_url TEXT,
  colour TEXT DEFAULT '#4A90D9',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 3. Term dates per school
CREATE TABLE IF NOT EXISTS school_term_dates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID REFERENCES household_schools(id) ON DELETE CASCADE,
  academic_year TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('term_start','term_end','half_term_start','half_term_end','inset_day','bank_holiday')),
  date DATE NOT NULL,
  end_date DATE,
  label TEXT,
  applies_to_year_groups TEXT[],
  source TEXT DEFAULT 'manual',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 4. Link children (dependents) to schools — add columns to existing users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES household_schools(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS year_group TEXT;

-- 5. Weekly recurring activities per child
CREATE TABLE IF NOT EXISTS child_weekly_schedule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id UUID REFERENCES users(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 4),
  activity TEXT NOT NULL,
  time_start TIME,
  time_end TIME,
  reminder_text TEXT,
  reminder_offset TEXT DEFAULT 'morning_of',
  term_only BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 6. One-off school events per child
CREATE TABLE IF NOT EXISTS child_school_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id UUID REFERENCES users(id) ON DELETE CASCADE,
  school_id UUID REFERENCES household_schools(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  date DATE NOT NULL,
  event_type TEXT DEFAULT 'other',
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS on all new tables
ALTER TABLE schools_directory ENABLE ROW LEVEL SECURITY;
ALTER TABLE household_schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_term_dates ENABLE ROW LEVEL SECURITY;
ALTER TABLE child_weekly_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE child_school_events ENABLE ROW LEVEL SECURITY;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_schools_directory_name ON schools_directory USING gin (to_tsvector('english', name));
CREATE INDEX IF NOT EXISTS idx_schools_directory_postcode ON schools_directory (postcode);
CREATE INDEX IF NOT EXISTS idx_household_schools_household ON household_schools (household_id);
CREATE INDEX IF NOT EXISTS idx_school_term_dates_school ON school_term_dates (school_id);
CREATE INDEX IF NOT EXISTS idx_child_weekly_schedule_child ON child_weekly_schedule (child_id);
CREATE INDEX IF NOT EXISTS idx_child_school_events_child ON child_school_events (child_id);
CREATE INDEX IF NOT EXISTS idx_users_school ON users (school_id);
