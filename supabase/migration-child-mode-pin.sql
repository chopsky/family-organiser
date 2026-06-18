-- Child Mode: a per-device, kid-safe view of the app. Exiting Child Mode /
-- opening Settings requires a PIN. The PIN is stored once per household (bcrypt
-- hash) so a parent can reset it from any full-mode device. The hash is never
-- sent to the client - the API exposes only a derived `child_mode_pin_set`
-- boolean (see src/routes/household.js GET /api/household).
ALTER TABLE households ADD COLUMN IF NOT EXISTS child_mode_pin_hash text;
