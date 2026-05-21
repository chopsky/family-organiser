-- Household preferences: structured, AI-consulted facts about a family
-- that influence meal planning, recipe suggestions, scheduling, and
-- general assistant behaviour. Distinct from household_notes (which is
-- a free-form, recall-on-demand KV store) - preferences are ALWAYS
-- considered automatically when the classifier reasons about food,
-- activities, or member-specific decisions.
--
-- Example rows:
--   member_id=Lynn, key=allergy,    value=nuts
--   member_id=Mason, key=dislike,   value=mushrooms
--   member_id=null,  key=dietary,   value=we don't eat pork
--   member_id=null,  key=preference, value=Tuesdays are soccer night
--
-- The classifier writes these when it detects preference statements in
-- WhatsApp / in-app chat ("Lynn's allergic to nuts", "we don't eat
-- pork"). Auto-surfaced back into prompts via getHouseholdPreferences.

CREATE TABLE IF NOT EXISTS household_preferences (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  member_id    uuid REFERENCES users(id) ON DELETE CASCADE,
  key          text NOT NULL,
  value        text NOT NULL,
  source       text NOT NULL DEFAULT 'inferred'
                 CHECK (source IN ('explicit', 'inferred', 'manual')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Most queries hit (household_id) for the full list, or
-- (household_id, member_id) when filtering to a specific person's
-- preferences. Both covered by this composite index.
CREATE INDEX IF NOT EXISTS household_preferences_household_member_idx
  ON household_preferences (household_id, member_id);

-- Prevent exact duplicates: the same key+value for the same member in
-- the same household should resolve to a single row (we update its
-- updated_at on re-detection rather than inserting a duplicate). NULLs
-- compare as distinct in Postgres by default, so the COALESCE makes
-- member_id null preferences also dedupe correctly.
CREATE UNIQUE INDEX IF NOT EXISTS household_preferences_unique_idx
  ON household_preferences (
    household_id,
    COALESCE(member_id, '00000000-0000-0000-0000-000000000000'),
    key,
    value
  );

-- updated_at touch on insert OR update. Simple trigger - no per-column
-- diffing needed because this table is small enough that any write is
-- a meaningful event.
CREATE OR REPLACE FUNCTION touch_household_preferences_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS household_preferences_updated_at ON household_preferences;
CREATE TRIGGER household_preferences_updated_at
  BEFORE UPDATE ON household_preferences
  FOR EACH ROW EXECUTE FUNCTION touch_household_preferences_updated_at();
