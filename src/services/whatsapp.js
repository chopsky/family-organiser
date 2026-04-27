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
 * Return the bot's own WhatsApp number (E.164, without the 'whatsapp:' prefix
 * and without the + sign — suitable for building a wa.me/<number> deep link).
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
async function sendMessage(phone, body) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) throw new Error('Twilio not configured');

  const to = formatPhone(phone);
  const msid = process.env.TWILIO_MESSAGING_SERVICE_SID;

  const params = { To: to, Body: body };
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
 * Send a WhatsApp message using a pre-approved Twilio Content Template.
 *
 * Unlike sendMessage, this works OUTSIDE the 24-hour customer-service
 * window, which is the whole point: it's how we reach household members
 * who haven't messaged the bot in the last day.
 *
 * Requires a MessagingServiceSid to be configured (Content Templates are
 * owned by a Messaging Service, not a raw From number). If only
 * TWILIO_WHATSAPP_NUMBER is set, we fall back to sendMessage — which will
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
  // Anything else falls back to the old stub behaviour — sendMessage
  // with the second arg as a free-form body. Net effect: the pre-
  // refactor behaviour is restored for legacy callers, and the new
  // Content-Template path still works for callers that pass a real
  // contentSid (currently just whatsapp-templates.js:sendBroadcastToMember).
  const isContentSid = typeof contentSidOrBody === 'string'
    && /^HX[a-f0-9]{32}$/i.test(contentSidOrBody);
  if (!isContentSid) {
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
    // reach out-of-window recipients at all — log loudly and fall back
    // so the caller isn't throwing on every broadcast.
    console.warn('[WhatsApp] sendTemplate called without TWILIO_MESSAGING_SERVICE_SID — falling back to sendMessage (likely 63016)');
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
 * @param {string} phone - Phone number to verify
 * @param {string} code  - 6-digit verification code
 */
async function sendVerificationCode(phone, code) {
  return sendMessage(phone, `Your Housemait verification code is: ${code}\n\nThis code expires in 10 minutes.`);
}

module.exports = {
  isConfigured,
  sendMessage,
  sendTemplate,
  downloadMedia,
  sendVerificationCode,
  formatPhone,
  getBotNumberForWaLink,
  getClient,
};
