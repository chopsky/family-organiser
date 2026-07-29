-- Home-screen setup nudges: per-user, per-task dismissals.
--
-- The nudge component derives COMPLETION from real state (a second adult in
-- the household, WhatsApp linked, a calendar connected, notification
-- permission granted) - none of which needs storing. The only thing that
-- needs persisting is the user saying "not this one, ever": a one-person
-- household has nobody to invite, and the × has to stick.
--
-- Per USER, not per device. Every existing nudge in the app dismisses into
-- localStorage keyed by user id, which means dismissing on your phone leaves
-- it sitting there on your laptop. This column is the fix.
--
-- Values are task ids: 'invite' | 'wa' | 'cal' | 'rem'. Never cleared - a
-- dismissal is permanent for this surface. If the user later completes a
-- dismissed task elsewhere it simply counts as done; the tile was already
-- gone either way.
--
-- Read path is free: /api/digest returns household members via `select()`,
-- so this column arrives with the row the dashboard already fetches.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS setup_nudges_dismissed TEXT[] NOT NULL DEFAULT '{}';
