-- Cache the geocoded coordinates for a household's typed address, so the
-- morning WhatsApp brief doesn't have to hit the (single, free-tier) Photon
-- geocoder every day. A Photon outage at ~07:00 was silently omitting weather
-- for the whole day even when the address was perfectly valid.
--
-- geo_address stores the address string these coords were derived from: when
-- the household edits their address, geo_address no longer matches and the
-- digest re-geocodes + re-caches automatically (no explicit invalidation).
--
-- Backend is tolerant of these columns being absent (PGRST204): until the
-- migration runs, the digest just geocodes fresh each time (current behaviour).

ALTER TABLE households ADD COLUMN IF NOT EXISTS geo_latitude  double precision;
ALTER TABLE households ADD COLUMN IF NOT EXISTS geo_longitude double precision;
ALTER TABLE households ADD COLUMN IF NOT EXISTS geo_city      text;
ALTER TABLE households ADD COLUMN IF NOT EXISTS geo_address   text;
