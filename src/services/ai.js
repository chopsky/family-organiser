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
async function classify(message, memberNames = [], notes = [], { householdId, userId, sender, calendarEvents = [], timezone, history = [] } = {}) {
  const today = new Date().toISOString().split('T')[0];
  const membersStr = memberNames.length > 0 ? memberNames.join(', ') : 'none specified';
  // Sender is used so the model can resolve "me/I/my" to the actual person.
  // Fall back to a neutral value when unknown — the prompt still works, it just
  // can't resolve first-person pronouns.
  const senderStr = sender || 'Unknown';
  const notesStr = notes.length > 0
    ? notes.map(n => `- ${n.key}: ${n.value}`).join('\n')
    : '(none saved yet)';
  // Cap at 100 events to keep the prompt size reasonable.
  // CRITICAL: format in the user's timezone, not the server's. Railway runs
  // in UTC, so without timeZone: userTz a 2PM BST event (stored as 13:00Z)
  // would be formatted as '13:00' and the AI would tell the user their
  // event is at 1PM. Both date and time need the override because events
  // near midnight can flip dates across timezones too.
  const userTz = timezone || 'UTC';
  const cappedEvents = calendarEvents.slice(0, 100);
  const calendarStr = cappedEvents.length > 0
    ? cappedEvents.map(e => {
        const date = new Date(e.start_time).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: userTz });
        const time = e.all_day ? 'All day' : new Date(e.start_time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: userTz });
        const who = e.assigned_to_name ? ` (${e.assigned_to_name})` : '';
        return `- ${date} ${time}: ${e.title}${who}${e.location ? ` @ ${e.location}` : ''}`;
      }).join('\n') + (calendarEvents.length > 100 ? `\n... and ${calendarEvents.length - 100} more events` : '')
    : '(no upcoming events)';

  const userCity = getCityFromTimezone(timezone);
  const locationStr = userCity
    ? `The family is based in ${userCity}. Give locally relevant suggestions when appropriate.`
    : '';

  const systemPrompt = CLASSIFICATION_SYSTEM
    .replace(/{{DATE}}/g, today)
    .replace(/{{MEMBERS}}/g, membersStr)
    .replace(/{{SENDER}}/g, senderStr)
    .replace(/{{LOCATION}}/g, locationStr)
    .replace(/{{NOTES}}/g, notesStr)
    .replace(/{{CALENDAR_EVENTS}}/g, calendarStr);

  // Build message array: prior turns (if any) + current user message.
  // History is expected to be [{ role, content }, ...] in chronological order.
  // We keep assistant replies as plain text context even though the current
  // turn returns JSON — the system prompt tells the model to treat history as
  // reference only and still reply with the required JSON schema.
  const priorTurns = Array.isArray(history)
    ? history.filter((t) => t && t.role && t.content).slice(-10)
    : [];
  const messages = [
    ...priorTurns.map((t) => ({ role: t.role, content: String(t.content) })),
    { role: 'user', content: message },
  ];

  return withRetry(async () => {
    const { text } = await callWithFailover({
      system: systemPrompt,
      messages,
      useThinking: false,
      // 4096 gives chat responses (recommendations, advice) room to breathe.
      // The JSON schema overhead alone is ~400 tokens, so 2048 was too tight
      // for longer response_message values and caused truncation → JSON parse errors.
      maxTokens: 4096,
      feature: 'classify',
      responseFormat: 'json', // force Gemini into structured-output mode
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
      responseFormat: 'json',
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
      responseFormat: 'json',
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
      responseFormat: 'json',
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
 * Extract the first balanced JSON object or array from anywhere in a string.
 * Respects string literals so braces inside "..." don't throw off the counter.
 * Returns null if no balanced block is found.
 */
function extractJsonBlock(text) {
  let start = -1;
  let openChar = '';
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{' || text[i] === '[') {
      start = i;
      openChar = text[i];
      break;
    }
  }
  if (start === -1) return null;
  const closeChar = openChar === '{' ? '}' : ']';

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (escape) { escape = false; continue; }
    if (inString) {
      if (c === '\\') escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === openChar) depth++;
    else if (c === closeChar) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Safely parse JSON from an AI response.
 * Tries a cascade of strategies to handle common model-output quirks:
 *   1. Raw parse after stripping surrounding markdown fences.
 *   2. Extract the first balanced JSON block from prose.
 *   3. Remove trailing commas (a common Gemini quirk).
 * Throws with the original error if every strategy fails.
 */
function parseJSON(text, context) {
  // Strip surrounding markdown fences if present.
  const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

  const candidates = [stripped];
  const block = extractJsonBlock(stripped);
  if (block && block !== stripped) candidates.push(block);

  // Trailing-comma repair on the extracted block (skip on the raw stripped
  // version — more likely to corrupt a perfectly valid string).
  if (block) {
    const detrailed = block.replace(/,(\s*[}\]])/g, '$1');
    if (detrailed !== block) candidates.push(detrailed);
  }

  let firstErr;
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (err) {
      if (!firstErr) firstErr = err;
    }
  }

  // Everything failed — log the raw output so the Railway logs show exactly
  // what the model returned, and surface the first (most informative) error.
  console.error(`[ai] Failed to parse ${context} JSON:`, firstErr.message);
  console.error(`[ai] Raw length: ${text.length} chars`);
  console.error(`[ai] Raw output (first 2000 chars):\n${text.slice(0, 2000)}`);
  if (text.length > 2000) {
    console.error(`[ai] Raw output (last 500 chars):\n${text.slice(-500)}`);
  }
  throw new Error(`Failed to parse ${context} JSON: ${firstErr.message}`);
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
      responseFormat: 'json',
      householdId,
      userId,
    });
    return parseJSON(text, 'email extraction');
  });
}

module.exports = { classify, scanReceipt, matchReceiptToList, scanImage, extractFromEmail, parseJSON };
