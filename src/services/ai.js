require('dotenv').config();
const { callWithFailover } = require('./ai-client');
const { getCityFromTimezone } = require('./weather');
const {
  CLASSIFICATION_SYSTEM,
  RECEIPT_EXTRACTION_SYSTEM,
  RECEIPT_MATCHING_SYSTEM,
  IMAGE_SCAN_SYSTEM,
  EMAIL_EXTRACTION_SYSTEM,
} = require('./prompts');

/**
 * Parse a text message into structured shopping items and tasks.
 */
async function classify(message, memberNames = [], notes = [], { householdId, userId, calendarEvents = [], timezone } = {}) {
  const today = new Date().toISOString().split('T')[0];
  const membersStr = memberNames.length > 0 ? memberNames.join(', ') : 'none specified';
  const notesStr = notes.length > 0
    ? notes.map(n => `- ${n.key}: ${n.value}`).join('\n')
    : '(none saved yet)';
  const calendarStr = calendarEvents.length > 0
    ? calendarEvents.map(e => {
        const date = new Date(e.start_time).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
        const time = e.all_day ? 'All day' : new Date(e.start_time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        const who = e.assigned_to_name ? ` (${e.assigned_to_name})` : '';
        return `- ${date} ${time}: ${e.title}${who}${e.location ? ` @ ${e.location}` : ''}`;
      }).join('\n')
    : '(no upcoming events)';

  const userCity = getCityFromTimezone(timezone);
  const locationStr = userCity
    ? `The family is based in ${userCity}. Give locally relevant suggestions when appropriate.`
    : '';

  const systemPrompt = CLASSIFICATION_SYSTEM
    .replace(/{{DATE}}/g, today)
    .replace(/{{MEMBERS}}/g, membersStr)
    .replace(/{{LOCATION}}/g, locationStr)
    .replace(/{{NOTES}}/g, notesStr)
    .replace(/{{CALENDAR_EVENTS}}/g, calendarStr);

  return withRetry(async () => {
    const { text } = await callWithFailover({
      system: systemPrompt,
      messages: [{ role: 'user', content: message }],
      useThinking: false,
      maxTokens: 2048,
      feature: 'classify',
      householdId,
      userId,
    });
    return parseJSON(text, 'classification');
  });
}

/**
 * Extract items from a receipt image.
 */
async function scanReceipt(imageData, mediaType = 'image/jpeg', { householdId, userId } = {}) {
  const base64 = Buffer.isBuffer(imageData)
    ? imageData.toString('base64')
    : imageData;

  return withRetry(async () => {
    const { text } = await callWithFailover({
      system: RECEIPT_EXTRACTION_SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: base64 },
            },
            { type: 'text', text: 'Please extract all items from this receipt.' },
          ],
        },
      ],
      useThinking: false,
      maxTokens: 2048,
      feature: 'receipt_scan',
      householdId,
      userId,
    });
    return parseJSON(text, 'receipt extraction');
  });
}

/**
 * Fuzzy-match receipt items against the current shopping list.
 */
async function matchReceiptToList(receiptItems, shoppingList, { householdId, userId } = {}) {
  if (!receiptItems.length || !shoppingList.length) {
    return { matches: [], unmatched_receipt_items: receiptItems.map((i) => i.normalised_name), summary: 'Nothing to match.' };
  }

  const receiptStr = receiptItems
    .map((i, n) => `${n + 1}. "${i.normalised_name}" (original: "${i.original_text}")`)
    .join('\n');

  const listStr = shoppingList
    .map((i) => `- id: ${i.id}, item: "${i.item}"`)
    .join('\n');

  const userMessage = `RECEIPT ITEMS:\n${receiptStr}\n\nSHOPPING LIST:\n${listStr}`;

  return withRetry(async () => {
    const { text } = await callWithFailover({
      system: RECEIPT_MATCHING_SYSTEM,
      messages: [{ role: 'user', content: userMessage }],
      useThinking: false,
      maxTokens: 1024,
      feature: 'receipt_match',
      householdId,
      userId,
    });
    return parseJSON(text, 'receipt matching');
  });
}

/**
 * Scan an image to determine if it's a receipt or contains calendar events.
 */
async function scanImage(imageData, mediaType = 'image/jpeg', memberNames = [], { householdId, userId } = {}) {
  const base64 = Buffer.isBuffer(imageData)
    ? imageData.toString('base64')
    : imageData;

  const today = new Date().toISOString().split('T')[0];
  const membersStr = memberNames.length > 0 ? memberNames.join(', ') : 'none specified';
  const systemPrompt = IMAGE_SCAN_SYSTEM
    .replace(/{{DATE}}/g, today)
    .replace(/{{MEMBERS}}/g, membersStr);

  return withRetry(async () => {
    const { text } = await callWithFailover({
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: base64 },
            },
            { type: 'text', text: 'Analyse this image. Is it a receipt or does it contain event/date information? Extract all relevant details.' },
          ],
        },
      ],
      useThinking: false,
      maxTokens: 2048,
      feature: 'image_scan',
      householdId,
      userId,
    });
    return parseJSON(text, 'image scan');
  });
}

/**
 * Retry a function up to `maxRetries` times with a delay between attempts.
 * This handles retries within a single provider attempt — cross-provider failover
 * is handled by callWithFailover in ai-client.js.
 */
async function withRetry(fn, { maxRetries = 1, delayMs = 2000 } = {}) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt < maxRetries) {
        const wait = delayMs * (attempt + 1);
        console.warn(`[ai] Retry ${attempt + 1}/${maxRetries}:`, err.message || err.error?.message);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw err;
    }
  }
}

/**
 * Safely parse JSON from an AI response, stripping markdown fences if present.
 */
function parseJSON(text, context) {
  const cleaned = text.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Failed to parse ${context} JSON: ${err.message}\nRaw: ${text.slice(0, 300)}`);
  }
}

/**
 * Extract structured data from any forwarded email — receipts, flights, school newsletters, appointments, etc.
 */
async function extractFromEmail(emailText, subject, memberNames = [], { householdId, userId } = {}) {
  const today = new Date().toISOString().split('T')[0];
  const membersStr = memberNames.length > 0 ? memberNames.join(', ') : 'none specified';

  const systemPrompt = EMAIL_EXTRACTION_SYSTEM
    .replace(/{{DATE}}/g, today)
    .replace(/{{MEMBERS}}/g, membersStr);

  const userMessage = subject
    ? `Email subject: ${subject}\n\n${emailText}`
    : emailText;

  return withRetry(async () => {
    const { text } = await callWithFailover({
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
      useThinking: false,
      maxTokens: 4096,
      feature: 'email_extraction',
      householdId,
      userId,
    });
    return parseJSON(text, 'email extraction');
  });
}

module.exports = { classify, scanReceipt, matchReceiptToList, scanImage, extractFromEmail };
