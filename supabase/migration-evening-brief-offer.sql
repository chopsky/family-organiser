-- Evening-brief offer: move it off an in-memory Map and onto the user row.
--
-- The offer ("want a look at tomorrow the night before?") used to live in a
-- process-local Map with a 5-minute TTL, armed the moment someone paired.
-- Two problems: a deploy wiped every pending offer, and five minutes is no
-- time at all to answer a question about tomorrow evening. Nobody ever said
-- yes - evening_brief was true for exactly zero users.
--
-- Now the offer rides the user's FIRST morning brief (they've just read one,
-- so the question is concrete) and its state lives here.
--
--   evening_brief_offer_sent_at      when we asked. Never cleared, so we can
--                                    never ask the same person twice.
--   evening_brief_offer_answered_at  when the offer was consumed - stamped on
--                                    their next inbound message whatever it
--                                    says, so a stray "yes" a day later can't
--                                    be mistaken for the answer.
--
-- Pending == sent_at IS NOT NULL AND answered_at IS NULL AND sent_at within 24h.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS evening_brief_offer_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS evening_brief_offer_answered_at TIMESTAMPTZ;

-- Only ever queried for one user at a time, but the brief job checks it for
-- every WhatsApp recipient each morning.
CREATE INDEX IF NOT EXISTS idx_users_evening_brief_offer
  ON users(evening_brief_offer_sent_at)
  WHERE evening_brief_offer_sent_at IS NOT NULL;
