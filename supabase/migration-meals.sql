-- Meals Feature Migration
-- Run this in the Supabase SQL editor

-- 1. recipes — household recipe library
CREATE TABLE IF NOT EXISTS recipes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id     UUID REFERENCES households(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  category         TEXT NOT NULL DEFAULT 'dinner'
                     CHECK (category IN ('breakfast', 'lunch', 'dinner', 'snack', 'other')),
  ingredients      JSONB DEFAULT '[]',
  method           TEXT,
  prep_time_mins   INTEGER,
  cook_time_mins   INTEGER,
  servings         INTEGER,
  dietary_tags     TEXT[] DEFAULT '{}',
  source_type      TEXT DEFAULT 'manual'
                     CHECK (source_type IN ('manual', 'url', 'photo', 'whatsapp', 'ai_generated')),
  source_url       TEXT,
  notes            TEXT,
  is_favourite     BOOLEAN DEFAULT false,
  image_url        TEXT,
  created_at       TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at       TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 2. meal_plan — weekly/daily meal assignments
CREATE TABLE IF NOT EXISTS meal_plan (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id     UUID REFERENCES households(id) ON DELETE CASCADE,
  recipe_id        UUID REFERENCES recipes(id) ON DELETE SET NULL,
  date             DATE NOT NULL,
  category         TEXT NOT NULL DEFAULT 'dinner',
  meal_name        TEXT NOT NULL,
  notes            TEXT,
  is_recurring     BOOLEAN DEFAULT false,
  recurrence_day   TEXT,
  added_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 3. meal_categories — customisable meal slots per household
CREATE TABLE IF NOT EXISTS meal_categories (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id     UUID REFERENCES households(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  colour           TEXT DEFAULT '#AED6F1',
  sort_order       INTEGER DEFAULT 0,
  active           BOOLEAN DEFAULT true
);

-- Enable RLS on all tables
ALTER TABLE recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_plan ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_categories ENABLE ROW LEVEL SECURITY;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_recipes_household ON recipes(household_id);
CREATE INDEX IF NOT EXISTS idx_recipes_household_category ON recipes(household_id, category);
CREATE INDEX IF NOT EXISTS idx_meal_plan_household ON meal_plan(household_id);
CREATE INDEX IF NOT EXISTS idx_meal_plan_household_date ON meal_plan(household_id, date);
CREATE INDEX IF NOT EXISTS idx_meal_categories_household ON meal_categories(household_id);

-- NOTE: Default meal categories (e.g. Breakfast, Lunch, Dinner, Snack) should be
-- created per household when they first access the meals feature. This is handled
-- in application code, not via SQL seed data.
