-- "Anyone" chores (the up-for-grabs column on the Tasks page).
--
-- An anyone-chore has no specific assignee: it sits in its own "Anyone" column
-- and ANY household member can check it off. On check-off the UI asks "Who
-- completed this task?" and the chosen member is credited the completion (one
-- chore_completions row per definition+date) and any stars the chore carries.
--
-- Modelled as a flag on the existing chore_definitions table: an anyone-chore
-- is { anyone = true, assignee_ids = '{}', type = 'chore' }. Completions and the
-- star ledger are unchanged - the completion row's member_id is the attributed
-- completer, which the existing chore_earn star transaction already credits.

ALTER TABLE chore_definitions
  ADD COLUMN IF NOT EXISTS anyone BOOLEAN NOT NULL DEFAULT false;
