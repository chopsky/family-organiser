-- Term Dates v2 — metadata columns, iCal sync tracking, and academic_year backfill
-- Depends on: migration-school.sql

-- =============================================================================
-- 1. Add metadata columns to household_schools
-- =============================================================================

-- When term dates were last imported or modified for this school
ALTER TABLE household_schools
  ADD COLUMN IF NOT EXISTS term_dates_last_updated TIMESTAMP WITH TIME ZONE;

-- How dates were imported: 'local_authority', 'school_website', 'ical', 'manual'
ALTER TABLE household_schools
  ADD COLUMN IF NOT EXISTS term_dates_source TEXT;

-- iCal sync tracking
ALTER TABLE household_schools
  ADD COLUMN IF NOT EXISTS ical_last_sync TIMESTAMP WITH TIME ZONE;

ALTER TABLE household_schools
  ADD COLUMN IF NOT EXISTS ical_last_sync_status TEXT;

-- =============================================================================
-- 2. Enable individual term date editing via RLS policy for PATCH
--    (allows household members to update their own school's term dates)
-- =============================================================================

-- Drop policies first if they exist, then recreate
DO $$ BEGIN
  DROP POLICY IF EXISTS "Household members can update own term dates" ON school_term_dates;
  DROP POLICY IF EXISTS "Household members can read own term dates" ON school_term_dates;
  DROP POLICY IF EXISTS "Household members can insert own term dates" ON school_term_dates;
  DROP POLICY IF EXISTS "Household members can delete own term dates" ON school_term_dates;
END $$;

CREATE POLICY "Household members can update own term dates"
  ON school_term_dates
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM household_schools hs
      JOIN users u ON u.household_id = hs.household_id
      WHERE hs.id = school_term_dates.school_id
        AND u.id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM household_schools hs
      JOIN users u ON u.household_id = hs.household_id
      WHERE hs.id = school_term_dates.school_id
        AND u.id = auth.uid()
    )
  );

CREATE POLICY "Household members can read own term dates"
  ON school_term_dates
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM household_schools hs
      JOIN users u ON u.household_id = hs.household_id
      WHERE hs.id = school_term_dates.school_id
        AND u.id = auth.uid()
    )
  );

CREATE POLICY "Household members can insert own term dates"
  ON school_term_dates
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM household_schools hs
      JOIN users u ON u.household_id = hs.household_id
      WHERE hs.id = school_term_dates.school_id
        AND u.id = auth.uid()
    )
  );

CREATE POLICY "Household members can delete own term dates"
  ON school_term_dates
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM household_schools hs
      JOIN users u ON u.household_id = hs.household_id
      WHERE hs.id = school_term_dates.school_id
        AND u.id = auth.uid()
    )
  );

-- =============================================================================
-- 3. Backfill academic_year for any rows where it's NULL
--    UK academic year runs Sept–Aug, so:
--      dates in Sept–Dec  → "YYYY/YYYY+1" (using the date's year)
--      dates in Jan–Aug   → "YYYY-1/YYYY" (using the previous year)
-- =============================================================================

-- Note: academic_year is NOT NULL in the original schema, so NULLs should not
-- exist under normal operation. This is a safety backfill in case data was
-- inserted outside the normal flow or the constraint was temporarily relaxed.

UPDATE school_term_dates
SET academic_year = CASE
  WHEN EXTRACT(MONTH FROM date) >= 9 THEN
    EXTRACT(YEAR FROM date)::TEXT || '/' || (EXTRACT(YEAR FROM date) + 1)::TEXT
  ELSE
    (EXTRACT(YEAR FROM date) - 1)::TEXT || '/' || EXTRACT(YEAR FROM date)::TEXT
  END
WHERE academic_year IS NULL;

-- =============================================================================
-- 4. Index for faster lookups by academic year
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_school_term_dates_academic_year
  ON school_term_dates (academic_year);

CREATE INDEX IF NOT EXISTS idx_school_term_dates_school_year
  ON school_term_dates (school_id, academic_year);
