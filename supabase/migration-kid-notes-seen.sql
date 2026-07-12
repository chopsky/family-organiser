-- Kids' notes: per-parent "seen" tracking.
--
-- Opening a note now permanently retires its banner for that parent (the
-- reaction is optional delight, not the toll for dismissing the popup - see
-- KidNoteAlert.jsx). seen_by mirrors the reactions shape: a jsonb map of
-- { user_id: ISO timestamp }, so it follows the parent across devices.
--
-- Until this runs, the code degrades gracefully: marking seen no-ops
-- (PGRST204) and the banner falls back to the old session-snooze behaviour.

ALTER TABLE kid_notes ADD COLUMN IF NOT EXISTS seen_by JSONB NOT NULL DEFAULT '{}';
