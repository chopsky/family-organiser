-- WhatsApp delivery-status tracking.
--
-- We send WhatsApp via Twilio but never captured what happened AFTER the
-- send - a message could be accepted by Twilio then never delivered
-- (recipient blocked the number, changed number, uninstalled WhatsApp) and
-- we'd be blind to it. WhatsApp deliberately gives businesses no "who
-- blocked you" list, so an "undelivered to a linked user" trend is the best
-- available proxy for blocks/churn, and it also surfaces genuinely failed
-- sends we currently can't see.
--
-- One row per outbound Twilio message, keyed by the Twilio SID so the async
-- StatusCallback webhook can find and update it. Deliberately separate from
-- whatsapp_message_log: the SID is only known at the low-level send site,
-- not at the rich caller-side log call, so tracking it here keeps every
-- outbound path (briefs, replies, broadcasts, templates) covered without
-- threading the SID through a dozen callers.

CREATE TABLE IF NOT EXISTS whatsapp_delivery_log (
  twilio_sid text PRIMARY KEY,
  to_phone text,
  message_type text,          -- 'freeform' | 'template'
  status text NOT NULL,       -- Twilio: queued|sending|sent|delivered|read|undelivered|failed
  error_code integer,
  sent_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_wa_delivery_status ON whatsapp_delivery_log(status);
CREATE INDEX IF NOT EXISTS idx_wa_delivery_phone ON whatsapp_delivery_log(to_phone);
CREATE INDEX IF NOT EXISTS idx_wa_delivery_sent_at ON whatsapp_delivery_log(sent_at);
