-- Gratitude-moment review ask: the WhatsApp bot may append a store-review
-- link ONCE PER USER EVER when a user sends pure gratitude. This column is
-- the lifetime stamp, claimed with an atomic conditional UPDATE
-- (markReviewAskIfUnsent) so concurrent turns and deploys can't double-ask.
-- Until this migration runs, the claim throws and the ask is silently
-- skipped - nothing breaks, nobody is asked.

ALTER TABLE users ADD COLUMN IF NOT EXISTS review_ask_sent_at timestamptz;

NOTIFY pgrst, 'reload schema';
