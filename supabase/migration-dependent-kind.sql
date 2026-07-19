-- Dependent kind: children and pets share member_type='dependent', but the
-- app needs to tell them apart. Child detection (useHasChildren, Kids Mode,
-- kid-feature gating, and the WhatsApp capture openers) previously treated
-- EVERY dependent as a child - so a pets-only household "had children" and
-- outbound messaging could ask which school the dog attends.
--
-- 'child' | 'pet'. NULL only on rows created before this migration runs;
-- the backfill below resolves those, and the API sets it on every new row.

ALTER TABLE users ADD COLUMN IF NOT EXISTS dependent_kind text
  CHECK (dependent_kind IN ('child', 'pet'));

-- Backfill pets first, by role text. family_role was a free-text field on
-- the add form ("e.g. Baby, Dog, Toddler"), so match the obvious animal
-- words. Anything unmatched falls through to 'child' below - that mirrors
-- the app's previous behaviour (all dependents were treated as kids), so
-- worst case is the status quo, correctable via the new Family form toggle.
UPDATE users SET dependent_kind = 'pet'
 WHERE member_type = 'dependent'
   AND dependent_kind IS NULL
   AND family_role ~* '\m(pet|dog|cat|puppy|kitten|rabbit|bunny|hamster|guinea ?pig|goldfish|fish|bird|parrot|budgie|tortoise|turtle|gerbil|ferret|pony|horse|lizard|gecko|snake|chicken|hen)\M';

UPDATE users SET dependent_kind = 'child'
 WHERE member_type = 'dependent'
   AND dependent_kind IS NULL;
