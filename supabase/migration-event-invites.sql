-- Party invites + RSVP (the organic-growth loop, v1).
--
-- A host shares one unguessable link per event into (typically) a class
-- WhatsApp group; invitee families RSVP on a public page with NO account -
-- name, yes/no, headcounts, dietary notes. The host gets the roster and the
-- allergy rollup; every RSVP confirmation carries a soft Housemait pitch.
-- Design rule: the signup wall sits AFTER the value (spouse invites convert
-- at 43%; cold walls convert near zero), so RSVPs must work account-free.
--
-- Privacy: links are 128-bit random tokens, pages are noindex, the event
-- address is only revealed after an RSVP, and links auto-expire shortly
-- after the event. RSVP rows cascade away with the event.

CREATE TABLE IF NOT EXISTS event_invite_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  expires_at timestamptz,          -- event end + 7 days, set at creation
  revoked_at timestamptz,
  view_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_event_invite_links_event ON event_invite_links(event_id);

CREATE TABLE IF NOT EXISTS event_rsvps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_link_id uuid NOT NULL REFERENCES event_invite_links(id) ON DELETE CASCADE,
  family_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('yes', 'no')),
  kids_count integer NOT NULL DEFAULT 0,
  adults_count integer NOT NULL DEFAULT 0,
  dietary_notes text,
  -- Set when a signed-in Housemait user RSVPs - the phase-2 upgrade hook
  -- (their copy of the event can then sync into their own calendar).
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_event_rsvps_link ON event_rsvps(invite_link_id);

-- Attribution: which acquisition surface produced a signup. 'rsvp' is the
-- first value; ads/organic stay NULL for now. Mirrors signup_promo_code.
ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_source text;
