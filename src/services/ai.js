require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const {
  CLASSIFICATION_SYSTEM,
  RECEIPT_EXTRACTION_SYSTEM,
  RECEIPT_MATCHING_SYSTEM,
  IMAGE_SCAN_SYSTEM,
} = require('./prompts');

const MODEL = 'claude-sonnet-4-6';

function getClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

/**
 * Parse a text message into structured shopping items and tasks.
 *
 * @param {string} message - Raw message from a family member
 * @param {string[]} memberNames - Names of household members (e.g. ["Sarah", "Jake"])
 * @returns {Promise<{
 *   intent: string,
 *   shopping_items: Array<{item:string, category:string, quantity:string|null, action:string}>,
 *   tasks: Array<{title:string, assigned_to_name:string|null, due_date:string, recurrence:string|null, priority:string, action:string}>,
 *   response_message: string
 * }>}
 */
async function classify(message, memberNames = [], notes = []) {
  const today = new Date().toISOString().split('T')[0];
  const membersStr = memberNames.length > 0 ? memberNames.join(', ') : 'none specified';
  const notesStr = notes.length > 0
    ? notes.map(n => `- ${n.key}: ${n.value}`).join('\n')
    : '(none saved yet)';

  const systemPrompt = CLASSIFICATION_SYSTEM
    .replace(/{{DATE}}/g, today)
    .replace(/{{MEMBERS}}/g, membersStr)
    .replace(/{{NOTES}}/g, notesStr);

  return withRetry(async () => {
    const client = getClient();
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 2048,
      thinking: { type: 'adaptive' },
      system: systemPrompt,
      messages: [{ role: 'user', content: message }],
    });

    const response = await stream.finalMessage();
    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock) throw new Error('No text in classification response');

    return parseJSON(textBlock.text, 'classification');
  });
}

/**
 * Extract items from a receipt image.
 *
 * @param {Buffer|string} imageData - Image as a Buffer or base64 string
 * @param {string} [mediaType='image/jpeg'] - MIME type of the image
 * @returns {Promise<{
 *   store_name: string|null,
 *   date: string|null,
 *   total: string|null,
 *   items: Array<{normalised_name:string, original_text:string, price:string|null}>
 * }>}
 */
async function scanReceipt(imageData, mediaType = 'image/jpeg') {
  const base64 = Buffer.isBuffer(imageData)
    ? imageData.toString('base64')
    : imageData;

  return withRetry(async () => {
    const client = getClient();
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 2048,
      thinking: { type: 'adaptive' },
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
    });

    const response = await stream.finalMessage();
    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock) throw new Error('No text in receipt extraction response');

    return parseJSON(textBlock.text, 'receipt extraction');
  });
}

/**
 * Fuzzy-match receipt items against the current shopping list.
 *
 * @param {Array<{normalised_name:string, original_text:string}>} receiptItems
 * @param {Array<{id:string, item:string}>} shoppingList - Items with their DB ids
 * @returns {Promise<{
 *   matches: Array<{receipt_item:string, list_item_id:string, list_item_name:string, confidence:number}>,
 *   unmatched_receipt_items: string[],
 *   summary: string
 * }>}
 */
async function matchReceiptToList(receiptItems, shoppingList) {
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
    const client = getClient();
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 2048,
      thinking: { type: 'adaptive' },
      system: RECEIPT_MATCHING_SYSTEM,
      messages: [{ role: 'user', content: userMessage }],
    });

    const response = await stream.finalMessage();
    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock) throw new Error('No text in receipt matching response');

    return parseJSON(textBlock.text, 'receipt matching');
  });
}

/**
 * Retry a function up to `maxRetries` times with a delay between attempts.
 * Only retries on transient errors (overloaded, rate limit, network).
 */
async function withRetry(fn, { maxRetries = 2, delayMs = 2000 } = {}) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isTransient =
        err.status === 429 ||
        err.status === 529 ||
        err.error?.type === 'overloaded_error' ||
        err.message?.includes('Overloaded') ||
        err.message?.includes('overloaded') ||
        err.code === 'ECONNRESET' ||
        err.code === 'ETIMEDOUT';

      if (isTransient && attempt < maxRetries) {
        const wait = delayMs * (attempt + 1); // linear backoff
        console.warn(`[ai] Transient error (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${wait}ms:`, err.message || err.error?.message);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw err;
    }
  }
}

/**
 * Safely parse JSON from a Claude response, stripping markdown fences if present.
 */
function parseJSON(text, context) {
  // Strip markdown code fences if present
  const cleaned = text.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Failed to parse ${context} JSON: ${err.message}\nRaw: ${text.slice(0, 300)}`);
  }
}

/**
 * Scan an image to determine if it's a receipt or contains calendar events.
 * For events (invitations, flight confirmations, school newsletters, etc.),
 * extracts structured event data including title, date, time, location, description.
 *
 * @param {Buffer|string} imageData - Image as a Buffer or base64 string
 * @param {string} [mediaType='image/jpeg'] - MIME type of the image
 * @param {string[]} [memberNames=[]] - Household member names for assignment
 * @returns {Promise<{ type: string, events: Array, summary: string }>}
 */
async function scanImage(imageData, mediaType = 'image/jpeg', memberNames = []) {
  const base64 = Buffer.isBuffer(imageData)
    ? imageData.toString('base64')
    : imageData;

  const today = new Date().toISOString().split('T')[0];
  const membersStr = memberNames.length > 0 ? memberNames.join(', ') : 'none specified';
  const systemPrompt = IMAGE_SCAN_SYSTEM
    .replace(/{{DATE}}/g, today)
    .replace(/{{MEMBERS}}/g, membersStr);

  return withRetry(async () => {
    const client = getClient();
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 2048,
      thinking: { type: 'adaptive' },
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
    });

    const response = await stream.finalMessage();
    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock) throw new Error('No text in image scan response');

    return parseJSON(textBlock.text, 'image scan');
  });
}

module.exports = { classify, scanReceipt, matchReceiptToList, scanImage };
