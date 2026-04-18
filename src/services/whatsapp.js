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
 * Build the "from" params for a Twilio message.
 * Uses direct WhatsApp number (works for replies within 24hr window).
 */
function getFromParams() {
  return { from: formatPhone(process.env.TWILIO_WHATSAPP_NUMBER) };
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
 * Send a template (content template) WhatsApp message.
 * Works outside the 24-hour window — used for notifications, reminders, digests.
 *
 * For Twilio, template messages are sent using Content Templates (content SID)
 * or by simply sending the message if you're in the sandbox.
 *
 * In sandbox mode, free-form messages work fine.
 * In production, you'd use contentSid for approved templates.
 *
 * @param {string} phone         - Recipient phone number
 * @param {string} body          - Message body (used in sandbox mode)
 * @param {string} [contentSid]  - Twilio Content SID for approved template (production)
 * @param {object} [contentVars] - Template variable values
 * @returns {Promise<object>}
 */
async function sendTemplate(phone, body, contentSid, contentVars) {
  // For templates, use sendMessage for now (works within 24hr window)
  // TODO: Add content template support for business-initiated messages
  return sendMessage(phone, body);
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
