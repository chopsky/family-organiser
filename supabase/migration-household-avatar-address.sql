-- Household identity: avatar + street address.
--
-- Until now the Household card on the Family page showed only the
-- household name in an inline text field. The new design shows the
-- household as an identity card — circular profile photo + name +
-- street address — edited via a modal.
--
-- Two new columns:
--
--   avatar_url  TEXT   Public URL to a Supabase Storage object in
--                      the `avatars` bucket at path
--                      `<household_id>/household.<ext>`. Null means
--                      "use the family-placeholder.png fallback in
--                      the web/public directory".
--
--   address     TEXT   Free-text street address, typically populated
--                      via the Photon autocomplete on the edit modal
--                      (which returns formatted address strings like
--                      "Cissbury Ring S, London N12, UK"). Stored as
--                      a single field rather than parsed components
--                      because the user-facing display is the full
--                      string and we never need to query by city.
--
-- Both nullable so existing households pass through cleanly. Run in
-- Supabase SQL Editor. Idempotent.

ALTER TABLE households
  ADD COLUMN IF NOT EXISTS avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS address TEXT;

NOTIFY pgrst, 'reload schema';
