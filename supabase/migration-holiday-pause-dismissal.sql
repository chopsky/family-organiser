-- Holiday-pause card: household-wide dismissal.
--
-- The "Paused for the holidays" keep-running card asks a HOUSEHOLD
-- question (do these clubs continue?), but its dismissal was stored in
-- device localStorage - so every new device, reinstall, and every OTHER
-- member's phone asked the family again after one adult had already
-- answered. This column records the dismissal server-side: the latest
-- term-end date the household has dismissed up to. The card hides when
-- its computed gap key (max end_date) is <= this value - same >=
-- semantics the client already uses, so keeping one activity running
-- (which can shift the max) never resurrects an answered card. A
-- genuinely newer term-end still brings it back, by design.
--
-- Until this migration runs, the write is a silent no-op and the card
-- falls back to per-device behaviour - nothing breaks.

ALTER TABLE households ADD COLUMN IF NOT EXISTS holiday_pause_dismissed_upto date;

NOTIFY pgrst, 'reload schema';
