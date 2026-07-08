-- To-do buckets (Today / This week / Someday): allow genuinely undated tasks.
-- Historically every task was stamped due_date = creation day because the
-- column is NOT NULL; the Lists page's Someday bucket needs real "no date"
-- rows (quick-adds land there, and the edit modal's "Someday" chip clears the
-- date). LLM channels keep defaulting undated adds to today - that behaviour
-- is unchanged.
--
-- Until this runs, the API degrades gracefully: undated adds fall back to
-- the today-default, and clearing a date via PATCH returns a clear error.

alter table tasks alter column due_date drop not null;
