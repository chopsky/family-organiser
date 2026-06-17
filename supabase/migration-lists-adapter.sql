-- Lists page adapter: the redesigned "Lists" surface unifies the existing
-- multi-list shopping system (Groceries + custom lists) with a virtual To-dos
-- list backed by the `tasks` table. The shopping tables already carry most of
-- what Lists needs (named lists, items with aisle_category as the "section").
-- This adds the few list-level fields the rail/new-list flow needs and a
-- `protected` flag so the staple lists can't be deleted.
--
-- (Grocery item emojis are derived client-side from the item name, and To-do
--  assignees come from tasks.assigned_to_ids, so no item-level columns here.)

ALTER TABLE shopping_lists ADD COLUMN IF NOT EXISTS emoji      TEXT;
ALTER TABLE shopping_lists ADD COLUMN IF NOT EXISTS color      TEXT;     -- hex tint for the list tile
ALTER TABLE shopping_lists ADD COLUMN IF NOT EXISTS protected  BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE shopping_lists ADD COLUMN IF NOT EXISTS position   INTEGER NOT NULL DEFAULT 0;
