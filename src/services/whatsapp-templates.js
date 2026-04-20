/**
 * WhatsApp template-routing service.
 *
 * WhatsApp Business API (via Twilio or any other provider) enforces Meta's
 * 24-hour customer-service window: you can only send free-form messages to
 * users who have messaged you in the last 24 hours. Outside that window you
 * must use a pre-approved Content Template.
 *
 * This module wraps both paths so callers don't have to think about it:
 *
 *   await sendBroadcast(member, "✅ Grant completed: Book car service")
 *
 * Inside the 24h window → free-form text.
 * Outside → a Content Template whose single body variable is the message.
 *
 * Approval workflow (one-off, per Twilio WhatsApp sender):
 *   1. Create the Content Template in Twilio Console (or via Content API).
 *      See docs/whatsapp-templates.md for the exact body copy we submit.
 *   2. Submit it to Meta for approval. Usually 1-3 business days.
 *   3. Once approved, set the environment variable
 *        TWILIO_TEMPLATE_HOUSEHOLD_UPDATE=HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
 *      on Railway. The service picks it up with no code change.
 *
 * Until the env var is set, out-of-window broadcasts simply no-op (with a
 * warning log) — we do NOT attempt a free-form send that would bounce with
 * Twilio error 63016 and waste a round-trip.
 */

const whatsapp = require('./whatsapp');

// 24 hours in milliseconds.
const WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Return true if we're inside the Meta 24-hour customer-service window for
 * this user — i.e. they've messaged us within the last 24 hours.
 *
 * `member` is the users-table row shape (from db.getHouseholdMembers).
 * A null / missing `whatsapp_last_inbound_at` means the user has never
 * messaged us, so the window is closed.
 *
 * The nowMs parameter exists for tests; production callers omit it.
 */
function isWithin24hWindow(member, nowMs = Date.now()) {
  const ts = member?.whatsapp_last_inbound_at;
  if (!ts) return false;
  const inboundMs = new Date(ts).getTime();
  if (!Number.isFinite(inboundMs)) return false;
  return nowMs - inboundMs < WINDOW_MS;
}

/**
 * Decide how to send a broadcast to a single member: 'freeform', 'template',
 * or 'skip'.
 *
 * Returns a string, not a boolean, so callers can surface the reason in
 * logs / tests / the settings-page warning banner.
 *
 *   'freeform' — member is linked AND inside the 24h window → sendMessage
 *   'template' — member is linked BUT outside the window → sendTemplate
 *   'skip'     — member isn't reachable (not linked, no phone, WA not
 *                configured globally, or template path chosen with no SID
 *                configured yet)
 */
function decideSendPath(member, { templateSid, whatsappConfigured, nowMs } = {}) {
  if (!member?.whatsapp_linked || !member?.whatsapp_phone) return 'skip';
  if (whatsappConfigured === false) return 'skip';
  if (isWithin24hWindow(member, nowMs)) return 'freeform';
  // Window is closed. We need a template — skip if we don't have one yet.
  if (!templateSid) return 'skip';
  return 'template';
}

/**
 * Send a broadcast to a single household member. Chooses free-form or
 * template based on the 24h window state. Fire-and-forget — errors are
 * logged but not thrown to the caller (broadcasts are best-effort).
 *
 * The message is the pre-formatted broadcast line from
 * handlers.buildBroadcastMessage (or the per-route broadcasts in
 * routes/tasks.js, routes/calendar.js, etc). That same string goes into
 * the {{1}} variable of the template.
 */
async function sendBroadcastToMember(member, message, { templateSid = process.env.TWILIO_TEMPLATE_HOUSEHOLD_UPDATE } = {}) {
  const path = decideSendPath(member, {
    templateSid,
    whatsappConfigured: whatsapp.isConfigured(),
  });

  if (path === 'skip') {
    // No-op, but log the reason so the "why didn't Lynn get notified?"
    // question is diagnosable from Railway logs alone.
    if (!member?.whatsapp_linked) return;
    if (!isWithin24hWindow(member) && !templateSid) {
      console.warn(
        `[broadcast] Skipped ${member.name || member.id} — window closed and TWILIO_TEMPLATE_HOUSEHOLD_UPDATE not configured`
      );
    }
    return;
  }

  try {
    if (path === 'freeform') {
      await whatsapp.sendMessage(member.whatsapp_phone, message);
    } else {
      // path === 'template' — single-variable utility template.
      await whatsapp.sendTemplate(member.whatsapp_phone, templateSid, { 1: message });
    }
  } catch (err) {
    // 63016 is the "outside the 24h window" error. If we hit it here we
    // thought we were inside the window — maybe touchWhatsAppInbound got
    // stale data — so log it loudly rather than the generic error path.
    if (err.code === 63016) {
      console.warn(
        `[broadcast] 63016 for ${member.name || member.id} despite window check passing — timestamp may be stale`
      );
    } else {
      console.error(`[broadcast] ${path} failed for ${member.name || member.id}:`, err.message);
    }
  }
}

module.exports = {
  isWithin24hWindow,
  decideSendPath,
  sendBroadcastToMember,
  WINDOW_MS,
};
