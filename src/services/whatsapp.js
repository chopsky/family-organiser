/**
 * WhatsApp service layer using Twilio.
 *
 * Provides a simple interface for sending WhatsApp messages
 * (both free-form and template-based) and downloading media.
 */

let twilioClient = null;

function getClient() {
  if (twilioClient) return twilioClient;

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    return null;
  }

  const twilio = require('twilio');
  twilioClient = twilio(accountSid, authToken);
  return twilioClient;
}

/**
 * Check whether WhatsApp (Twilio) is configured.
 */
function isConfigured() {
  return !!(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    (process.env.TWILIO_MESSAGING_SERVICE_SID || process.env.TWILIO_WHATSAPP_NUMBER)
  );
}

/**
 * Format a phone number for WhatsApp via Twilio.
 * Ensures the "whatsapp:" prefix is present.
 */
function formatPhone(phone) {
  if (!phone) return null;
  // Strip any existing prefix
  const clean = phone.replace(/^whatsapp:/, '').trim();
  // Ensure + prefix
  const withPlus = clean.startsWith('+') ? clean : `+${clean}`;
  return `whatsapp:${withPlus}`;
}

/**
 * Convert any leaked markdown emphasis in outbound text to WhatsApp's
 * native formatting. The LLM occasionally drifts into markdown-style
 * **bold** and __bold__ (Gemini and Claude both do this on chat-style
 * replies despite the prompt asking for plain text). WhatsApp renders
 * those as literal asterisks/underscores - users see the punctuation,
 * not the emphasis. Single-asterisk *bold* and single-underscore
 * _italic_ are correct WhatsApp syntax and are left alone.
 *
 * Exported so tests can lock the conversions; called by sendMessage
 * just before the Twilio POST so EVERY outbound free-form message
 * benefits, regardless of which handler produced the text.
 */
function normalizeWhatsAppMarkdown(text) {
  if (typeof text !== 'string') return text;
  return text
    // **bold** -> *bold*  (lazy match, single line so we don't span paragraphs)
    .replace(/\*\*([^\n*]+?)\*\*/g, '*$1*')
    // __bold__ -> *bold*  (rarer but Gemini does emit it occasionally)
    .replace(/__([^\n_]+?)__/g, '*$1*');
}

/**
 * Return the bot's own WhatsApp number (E.164, without the 'whatsapp:' prefix
 * and without the + sign - suitable for building a wa.me/<number> deep link).
 * Returns null if not configured.
 */
function getBotNumberForWaLink() {
  const raw = process.env.TWILIO_WHATSAPP_NUMBER;
  if (!raw) return null;
  return raw.replace(/^whatsapp:/, '').replace(/^\+/, '').trim() || null;
}

/**
 * Send a free-form WhatsApp message.
 * Only works within the 24-hour messaging window (after the user has messaged you).
 *
 * @param {string} phone - Recipient phone number (e.g. "+447700900000")
 * @param {string} body  - Message text
 * @returns {Promise<object>} Twilio message SID
 */
// Twilio rejects any single WhatsApp body over 1600 characters
// ("The concatenated message body exceeds the 1600 character limit"). We
// split below that with headroom so a long AI answer (recommendations,
// web-search results, a packed calendar list) goes out as several messages
// instead of failing the whole reply.
const WHATSAPP_MAX_CHARS = 1500;

/**
 * Split text into WhatsApp-sized chunks, breaking on the nicest boundary that
 * fits (paragraph → line → sentence → space → hard cut). Never returns a chunk
 * longer than `limit`. Returns [''] for empty input.
 */
function splitForWhatsApp(text, limit = WHATSAPP_MAX_CHARS) {
  const t = (text == null ? '' : String(text));
  if (t.length <= limit) return [t];
  const chunks = [];
  let rest = t;
  while (rest.length > limit) {
    let cut = -1;
    for (const sep of ['\n\n', '\n', '. ', ' ']) {
      const idx = rest.lastIndexOf(sep, limit);
      if (idx > limit * 0.5) { cut = sep === '. ' ? idx + 1 : idx; break; }
    }
    if (cut <= 0) cut = limit; // no good boundary - hard cut
    const piece = rest.slice(0, cut).trim();
    if (piece) chunks.push(piece);
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

async function sendOneMessage(to, bodyText, msid) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const params = { To: to, Body: bodyText };
  if (msid) {
    params.MessagingServiceSid = msid;
  } else {
    params.From = formatPhone(process.env.TWILIO_WHATSAPP_NUMBER);
  }

  console.log('[WhatsApp] Sending via REST API:', JSON.stringify(params));

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(params).toString(),
    }
  );

  const data = await response.json();
  if (!response.ok) {
    console.error('[WhatsApp] REST API error:', data);
    const err = new Error(data.message || 'Twilio API error');
    err.code = data.code;
    throw err;
  }
  console.log('[WhatsApp] Message sent:', data.sid, data.status);
  return data;
}

/**
 * Show the WhatsApp "typing…" indicator while the bot works on a reply.
 *
 * Twilio's v3 Typing Indicators resource (Public Beta) - referenced by the
 * INBOUND message's SID (the MessageSid Twilio posts to our webhook). The
 * indicator displays for up to 25 seconds or until our reply is delivered,
 * whichever comes first, and also marks the referenced message as read
 * (blue ticks). The twilio npm SDK doesn't wrap /v3/Indicators, so this
 * hits the endpoint directly, same as sendOneMessage does for /Messages.
 *
 * Fire-and-forget by design: the indicator is cosmetic, so any failure is
 * logged and swallowed - it must never delay or block the actual reply.
 */
async function sendTypingIndicator(inboundMessageSid) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken || !inboundMessageSid) return false;

  try {
    const response = await fetch('https://messaging.twilio.com/v3/Indicators/Typing.json', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ channel: 'WHATSAPP', messageId: inboundMessageSid }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.warn(`[WhatsApp] typing indicator failed (${response.status}): ${text.slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[WhatsApp] typing indicator error:', err.message);
    return false;
  }
}

async function sendMessage(phone, body) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) throw new Error('Twilio not configured');

  const to = formatPhone(phone);
  const msid = process.env.TWILIO_MESSAGING_SERVICE_SID;

  // Normalise leaked markdown (**bold** / __bold__) into WhatsApp's native
  // *bold* before sending - centralised here so every caller benefits.
  const normalisedBody = normalizeWhatsAppMarkdown(body);

  // Split anything over the 1600-char Twilio limit into ordered messages.
  const parts = splitForWhatsApp(normalisedBody);
  let last;
  for (let i = 0; i < parts.length; i++) {
    last = await sendOneMessage(to, parts[i], msid);
    // Small gap between parts so WhatsApp keeps them in order.
    if (i < parts.length - 1) await new Promise((r) => setTimeout(r, 400));
  }
  return last;
}

/**
 * Send a WhatsApp message using a pre-approved Twilio Content Template.
 *
 * Unlike sendMessage, this works OUTSIDE the 24-hour customer-service
 * window, which is the whole point: it's how we reach household members
 * who haven't messaged the bot in the last day.
 *
 * Requires a MessagingServiceSid to be configured (Content Templates are
 * owned by a Messaging Service, not a raw From number). If only
 * TWILIO_WHATSAPP_NUMBER is set, we fall back to sendMessage - which will
 * fail with 63016 outside the window, but that's no worse than before.
 *
 * @param {string} phone        - Recipient phone number (e.g. "+447700900000")
 * @param {string} contentSid   - Twilio Content SID (HX...) for the approved template
 * @param {object} contentVars  - Variable map, e.g. { "1": "Grant added task: ..." }
 * @returns {Promise<object>}   - Parsed Twilio response
 */
async function sendTemplate(phone, contentSidOrBody, contentVars = {}) {
  // ── Backward compatibility ──────────────────────────────────────────
  // Before the Content Template work, sendTemplate was a stub: it took
  // (phone, body) and silently called sendMessage under the hood. Six
  // cron jobs still use that old signature (daily reminder, weekly
  // digest, overdue nudge, event reminders, school prep, evening prep).
  // When the signature changed, those callers started passing the
  // reminder text as a "contentSid" which Twilio rejected with
  // "Invalid Parameter" / "A text message body or media urls must be
  // specified." for months.
  //
  // Detect a real Content SID by its shape (always "HX" + 32 hex chars).
  // Anything else falls back to the old stub behaviour - sendMessage
  // with the second arg as a free-form body. Net effect: the pre-
  // refactor behaviour is restored for legacy callers, and the new
  // Content-Template path still works for callers that pass a real
  // contentSid (currently just whatsapp-templates.js:sendBroadcastToMember).
  const isContentSid = typeof contentSidOrBody === 'string'
    && /^HX[a-f0-9]{32}$/i.test(contentSidOrBody);
  if (!isContentSid) {
    // Log loudly when the SID arg fails the format check, so a stale /
    // whitespace-padded / wrong-shape env var doesn't silently degrade
    // the send to freeform with no diagnostic trail (which is exactly
    // what bit us when TWILIO_TEMPLATE_DAILY_REMINDER was rotated to a
    // value with a trailing newline). Only log when the arg actually
    // LOOKS like an attempted SID (starts with HX) - legacy callers
    // pass the message body as the second arg deliberately and we
    // don't want to noise-flood for those.
    if (typeof contentSidOrBody === 'string' && contentSidOrBody.startsWith('HX')) {
      console.warn(`[WhatsApp] sendTemplate: '${contentSidOrBody}' (length ${contentSidOrBody.length}) does not match HX + 32 hex chars - falling back to freeform sendMessage. Check the env var for whitespace / wrong format.`);
    }
    return sendMessage(phone, contentSidOrBody);
  }
  const contentSid = contentSidOrBody;

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) throw new Error('Twilio not configured');
  if (!contentSid) throw new Error('sendTemplate requires contentSid');

  const msid = process.env.TWILIO_MESSAGING_SERVICE_SID;
  if (!msid) {
    // Content Templates need a Messaging Service. Without one we can't
    // reach out-of-window recipients at all - log loudly and fall back
    // so the caller isn't throwing on every broadcast.
    console.warn('[WhatsApp] sendTemplate called without TWILIO_MESSAGING_SERVICE_SID - falling back to sendMessage (likely 63016)');
    // Reconstitute an approximate body from {{1}} for the fallback.
    return sendMessage(phone, contentVars['1'] || contentVars[1] || '');
  }

  const to = formatPhone(phone);
  const params = {
    To: to,
    MessagingServiceSid: msid,
    ContentSid: contentSid,
    ContentVariables: JSON.stringify(contentVars),
  };

  console.log('[WhatsApp] Sending template via REST API:', JSON.stringify({ To: to, ContentSid: contentSid, vars: Object.keys(contentVars) }));

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(params).toString(),
    }
  );

  const data = await response.json();

  if (!response.ok) {
    console.error('[WhatsApp] Template REST API error:', data);
    const err = new Error(data.message || 'Twilio API error');
    err.code = data.code;
    throw err;
  }

  console.log('[WhatsApp] Template sent:', data.sid, data.status);
  return data;
}

/**
 * Download media from a Twilio media URL.
 * Used for voice notes and photos sent via WhatsApp.
 *
 * @param {string} mediaUrl - Full media URL from Twilio webhook
 * @returns {Promise<Buffer>}
 */
async function downloadMedia(mediaUrl) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  const response = await fetch(mediaUrl, {
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
    },
  });

  if (!response.ok) {
    throw new Error(`Media download failed: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Send a WhatsApp verification code to a phone number.
 *
 * First-time WhatsApp connect happens BEFORE the user has ever messaged
 * the bot, so the 24-hour customer-service window isn't open and
 * sendMessage's freeform path will be rejected by Twilio with code 63016.
 * To deliver the code outside that window we need a pre-approved Content
 * Template (Authentication category) - the SID lives in
 * TWILIO_TEMPLATE_VERIFICATION_CODE.
 *
 * Behaviour:
 *   • If TWILIO_TEMPLATE_VERIFICATION_CODE is set to a valid Content SID,
 *     send via sendTemplate (works regardless of the messaging window).
 *   • Otherwise fall back to the freeform path. Logs a warning so the
 *     misconfiguration is visible. The fallback only succeeds if the
 *     user has messaged the bot in the last 24h - useful for re-verify
 *     flows but useless for first-time connects.
 *
 * @param {string} phone - Phone number to verify
 * @param {string} code  - 6-digit verification code
 */
async function sendVerificationCode(phone, code) {
  const templateSid = process.env.TWILIO_TEMPLATE_VERIFICATION_CODE;
  const isValidSid = typeof templateSid === 'string' && /^HX[a-f0-9]{32}$/i.test(templateSid);

  if (isValidSid) {
    return sendTemplate(phone, templateSid, { 1: code });
  }

  console.warn(
    '[WhatsApp] TWILIO_TEMPLATE_VERIFICATION_CODE not set - falling back to freeform send. ' +
    'First-time WhatsApp connects will fail with Twilio 63016 until an Authentication-category ' +
    'Content Template is approved and its SID is configured.'
  );
  return sendMessage(phone, `Your Housemait verification code is: ${code}\n\nThis code expires in 10 minutes.`);
}

module.exports = {
  isConfigured,
  sendMessage,
  sendTemplate,
  sendTypingIndicator,
  downloadMedia,
  sendVerificationCode,
  formatPhone,
  getBotNumberForWaLink,
  getClient,
  normalizeWhatsAppMarkdown,
  splitForWhatsApp,
};
