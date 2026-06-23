-- Illustrated avatars: a member can pick an illustration from a set instead of
-- uploading a photo. Stored as the set-relative id, e.g. 'set2/n07', and
-- resolved client-side to /avatars/set2/n07.png. Avatar precedence is
-- photo (avatar_url) -> illustration (avatar_id) -> coloured initial, so at
-- most one of avatar_url / avatar_id is ever set (enforced in the API).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS avatar_id TEXT;
