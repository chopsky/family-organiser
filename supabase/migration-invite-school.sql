-- Add school_id + year_group columns to the `invites` table.
--
-- Why: when an admin invites a Family Member (e.g. their 16-year-old child)
-- they may want to pre-fill the invitee's school + year group at invite time.
-- The fields are persisted on the invite row and copied onto the user when
-- they accept (alongside family_role / birthday / color_theme, which the
-- invites table already supported). Mirrors the same pre-fill mechanism, just
-- two more columns.
--
-- Both columns are nullable — the toggle defaults off, so most invites won't
-- carry school info.
--
-- Foreign key: school_id references household_schools(id). ON DELETE SET NULL
-- so deleting a household_schools row (or letting orphan-cleanup remove it)
-- doesn't break pending invites — the invitee just lands without a school
-- pre-filled, same as if the toggle had been off.

ALTER TABLE invites
  ADD COLUMN IF NOT EXISTS school_id  uuid REFERENCES household_schools(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS year_group text;

CREATE INDEX IF NOT EXISTS idx_invites_school ON invites (school_id);

COMMENT ON COLUMN invites.school_id  IS 'Pre-filled school for the invitee. Copied to users.school_id on acceptance.';
COMMENT ON COLUMN invites.year_group IS 'Pre-filled year group (Reception, Y1..Y13). Copied to users.year_group on acceptance.';
