-- Ping routing (channel doctrine: conversation on WhatsApp, pings on
-- push). users.ping_notice_at stamps the ONE WhatsApp heads-up a
-- push-unreachable member gets when their reminders move to push - the
-- conditional UPDATE in markPingNoticeIfUnsent makes it once-ever.
-- Until this runs, the router still pushes and records to the in-app
-- centre; only the WhatsApp heads-up waits (skipping beats repeating).

ALTER TABLE users ADD COLUMN IF NOT EXISTS ping_notice_at timestamptz;

NOTIFY pgrst, 'reload schema';
