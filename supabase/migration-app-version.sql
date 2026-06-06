-- App-version capture
--
-- The native app knows its own version (App.getInfo()) but never reported it,
-- so we couldn't tell which build a given user was on. The app now sends an
-- `X-App-Version` header on every request; we persist the most recent value at
-- the two natural write points that already record the user-agent:
--   • refresh_tokens  — covers every login/refresh (all platforms)
--   • device_tokens   — native iOS push registration (definitive app version)
--
-- Nullable text, e.g. "1.7.0 (22)". Web sessions leave it null.

ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS app_version text;
ALTER TABLE device_tokens  ADD COLUMN IF NOT EXISTS app_version text;
