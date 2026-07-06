-- Kids' daily notes: once a day a child can draw/write a note for their
-- parents from Kids Mode. One row per (child, day); re-sending the same
-- day replaces it. Parents react with an emoji (reactions = { userId:
-- emoji }), which is shown back to the child - that closing of the loop
-- is the feature. Rows are never auto-deleted: the archive doubles as a
-- keepsake ("notes from Olivia, age 7").
-- Server-only: RLS on, no policies.

CREATE TABLE IF NOT EXISTS kid_notes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  child_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note_date     DATE NOT NULL,
  image_path    TEXT,             -- R2 storage key of the drawing (PNG)
  text_note     TEXT,             -- optional typed message
  reactions     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE (child_id, note_date)
);

CREATE INDEX IF NOT EXISTS idx_kid_notes_household_date ON kid_notes (household_id, note_date DESC);

ALTER TABLE kid_notes ENABLE ROW LEVEL SECURITY;
