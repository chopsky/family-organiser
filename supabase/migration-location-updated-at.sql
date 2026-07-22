-- Track when a member last shared their device location, so the WhatsApp
-- morning brief can prefer a FRESH shared location over a typed home address
-- and avoid showing last week's holiday weather.
--
-- users.latitude/longitude already exist (migration-geolocation.sql). The app
-- now persists them on each weather-widget fetch; this column stamps that write
-- so the digest can judge freshness (<=48h = "fresh").
--
-- Backend is tolerant of this column being absent (PGRST204): until it's added,
-- shared coords are treated as stale (used only as a last resort before
-- omitting weather), and the typed home address still wins.

ALTER TABLE users ADD COLUMN IF NOT EXISTS location_updated_at timestamptz;
