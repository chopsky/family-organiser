-- Unify the colour palette used by users.color_theme and
-- calendar_events.color. Production hit "Invalid color 'burnt-orange'"
-- when assigning a member whose theme is one of the 16-colour palette
-- to an event: the route validator and DB CHECK constraints were
-- behind the COLOR_THEMES list in db/queries.js.
--
-- Source of truth for the canonical 16-colour member palette is
-- COLOR_THEMES in src/db/queries.js. Everything below is a superset
-- (member palette + the original event colours + legacy profile theme
-- names retained for back-compat) so an event coloured by its first
-- assignee's theme always validates regardless of which palette the
-- assignee was assigned from.

DO $$
BEGIN
  -- ── users.color_theme ──────────────────────────────────────────────
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_color_theme_check'
  ) THEN
    ALTER TABLE users DROP CONSTRAINT users_color_theme_check;
  END IF;

  ALTER TABLE users ADD CONSTRAINT users_color_theme_check
    CHECK (color_theme IN (
      -- original event colours (back-compat for old rows)
      'sage', 'plum', 'coral', 'amber', 'sky', 'rose', 'teal', 'lavender', 'terracotta', 'slate',
      -- 16-colour canonical member palette
      'red', 'burnt-orange', 'gold', 'leaf', 'emerald', 'cobalt', 'indigo', 'purple', 'magenta', 'moss',
      -- legacy profile theme names
      'sunset', 'tangerine', 'ocean', 'steel', 'denim', 'iris', 'grape',
      'blush', 'bubblegum', 'cocoa', 'stone', 'charcoal', 'midnight'
    ));

  -- ── calendar_events.color ──────────────────────────────────────────
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'calendar_events_color_check'
  ) THEN
    ALTER TABLE calendar_events DROP CONSTRAINT calendar_events_color_check;
  END IF;

  ALTER TABLE calendar_events ADD CONSTRAINT calendar_events_color_check
    CHECK (color IN (
      -- original event colours
      'sage', 'plum', 'coral', 'amber', 'sky', 'rose', 'teal', 'lavender', 'terracotta', 'slate',
      -- 16-colour canonical member palette
      'red', 'burnt-orange', 'gold', 'leaf', 'emerald', 'cobalt', 'indigo', 'purple', 'magenta', 'moss',
      -- legacy profile theme names
      'sunset', 'tangerine', 'ocean', 'steel', 'denim', 'iris', 'grape',
      'blush', 'bubblegum', 'cocoa', 'stone', 'charcoal', 'midnight'
    ));
END $$;
