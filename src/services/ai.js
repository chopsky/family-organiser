require('dotenv').config();
const { callWithFailover } = require('./ai-client');
const { getCityFromTimezone } = require('./weather');
const { messageMentionsLocation } = require('../utils/location-relevance');
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
async function classify(message, memberNames = [], notes = [], { householdId, userId, sender, calendarEvents = [], tasks = [], timezone, history = [], address = null, schoolTermDates = '', preferences = [] } = {}) {
  // "Today" needs to be computed in the user's timezone, not UTC, or
  // we drift on either side of midnight (a 23:30 BST message gets
  // tagged "tomorrow" by a UTC-only Railway). Also include the weekday
  // name: without it the model has to do mental day-of-week math from
  // the ISO date and gets it wrong - e.g. tagged "next week same day"
  // as Tuesday when today was a Wednesday.
  const tzForToday = timezone || 'UTC';
  const nowDate = new Date();
  const todayYmd = new Intl.DateTimeFormat('en-CA', {
    timeZone: tzForToday, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(nowDate);
  const todayWeekday = new Intl.DateTimeFormat('en-GB', {
    timeZone: tzForToday, weekday: 'long',
  }).format(nowDate);
  const today = `${todayWeekday}, ${todayYmd}`;
  const membersStr = memberNames.length > 0 ? memberNames.join(', ') : 'none specified';
  // Sender is used so the model can resolve "me/I/my" to the actual person.
  // Fall back to a neutral value when unknown - the prompt still works, it just
  // can't resolve first-person pronouns.
  const senderStr = sender || 'Unknown';
  const notesStr = notes.length > 0
    ? notes.map(n => `- ${n.key}: ${n.value}`).join('\n')
    : '(none saved yet)';

  // Family preferences - structured AI-consulted facts (allergies,
  // dietary stances, member-specific likes/dislikes, schedule anchors).
  // Format groups by member so the model can see at a glance what
  // belongs to whom. Allergies and dietary rules render first because
  // they're hard constraints.
  const KEY_PRIORITY = { allergy: 0, dietary: 1, dislike: 2, like: 3, schedule: 4, preference: 5 };
  const sortedPrefs = (preferences || []).slice().sort((a, b) => {
    const ap = KEY_PRIORITY[a.key] ?? 99;
    const bp = KEY_PRIORITY[b.key] ?? 99;
    if (ap !== bp) return ap - bp;
    return (a.value || '').localeCompare(b.value || '');
  });
  // Helper to look up member name from id (uses memberNames + a parallel
  // id list would be cleaner; caller hands us already-resolved member
  // info via the preference rows below if needed).
  function preferenceLine(p) {
    const who = p.member_name || (p.member_id ? '(member)' : 'Everyone');
    const tag = p.key.toUpperCase();
    return `- [${tag}] ${who}: ${p.value}`;
  }
  const preferencesStr = sortedPrefs.length > 0
    ? sortedPrefs.map(preferenceLine).join('\n')
    : '(none saved yet)';
  // Cap at 100 events to keep the prompt size reasonable.
  // CRITICAL: format in the user's timezone, not the server's. Railway runs
  // in UTC, so without timeZone: userTz a 2PM BST event (stored as 13:00Z)
  // would be formatted as '13:00' and the AI would tell the user their
  // event is at 1PM. Both date and time need the override because events
  // near midnight can flip dates across timezones too.
  const userTz = timezone || 'UTC';
  // Format a list of assignee names as " (Lynn & Grant)" / " (Lynn)" /
  // empty. Drops nulls and falls back to empty string for the
  // no-specific-person ("Everyone") case so the AI doesn't see a literal
  // "Everyone" token that could be confused for a member name.
  function formatWho(row) {
    const names = Array.isArray(row.assigned_to_names) ? row.assigned_to_names.filter(Boolean) : [];
    if (names.length === 0) return '';
    if (names.length === 1) return ` (${names[0]})`;
    return ` (${names.slice(0, -1).join(', ')} & ${names[names.length - 1]})`;
  }

  const cappedEvents = calendarEvents.slice(0, 100);
  const calendarStr = cappedEvents.length > 0
    ? cappedEvents.map(e => {
        const date = new Date(e.start_time).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: userTz });
        const time = e.all_day ? 'All day' : new Date(e.start_time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: userTz });
        return `- ${date} ${time}: ${e.title}${formatWho(e)}${e.location ? ` @ ${e.location}` : ''}`;
      }).join('\n') + (calendarEvents.length > 100 ? `\n... and ${calendarEvents.length - 100} more events` : '')
    : '(no upcoming events)';

  // Cap at 50 open tasks - enough for the classifier to match completion
  // signals like "Elementor paid" against "Pay Elementor", without blowing
  // up the prompt for busy households.
  const cappedTasks = tasks.slice(0, 50);
  const tasksStr = cappedTasks.length > 0
    ? cappedTasks.map(t => {
        const due = t.due_date
          ? new Date(`${t.due_date}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: userTz })
          : 'no due date';
        const priority = t.priority && t.priority !== 'medium' ? ` [${t.priority}]` : '';
        return `- "${t.title}"${formatWho(t)} - due ${due}${priority}`;
      }).join('\n') + (tasks.length > 50 ? `\n... and ${tasks.length - 50} more tasks` : '')
    : '(no open tasks)';

  // Location prompt: gated entirely on whether the current message
  // looks location-relevant. If it does and we have a home address,
  // send the full address. If it does but we only have a timezone,
  // send the coarse city. If it doesn't, send NOTHING - there's no
  // reason to share the family's location for "remind me to call the
  // bank" or "mark milk as bought". See utils/location-relevance.js.
  const userCity = getCityFromTimezone(timezone);
  const homeAddress = (address || '').trim();
  const wantsLocation = messageMentionsLocation(message);
  let locationStr = '';
  if (wantsLocation && homeAddress) {
    locationStr = `The family's home address is ${homeAddress}. Use this for proximity-aware recommendations (restaurants, doctors, services nearby). Mention neighbourhoods or rough distance rather than echoing the full street address back. Treat the exact address as confidential.`;
  } else if (wantsLocation && userCity) {
    locationStr = `The family is based in ${userCity}. Give locally relevant suggestions when appropriate.`;
  }

  const systemPrompt = CLASSIFICATION_SYSTEM
    .replace(/{{DATE}}/g, today)
    .replace(/{{MEMBERS}}/g, membersStr)
    .replace(/{{SENDER}}/g, senderStr)
    .replace(/{{LOCATION}}/g, locationStr)
    .replace(/{{NOTES}}/g, notesStr)
    .replace(/{{PREFERENCES}}/g, preferencesStr)
    .replace(/{{CALENDAR_EVENTS}}/g, calendarStr)
    .replace(/{{TASKS}}/g, tasksStr)
    .replace(/{{SCHOOL_TERM_DATES}}/g, schoolTermDates || '(none)');

  // Build message array: prior turns (if any) + current user message.
  // History is expected to be [{ role, content }, ...] in chronological order.
  // We keep assistant replies as plain text context even though the current
  // turn returns JSON - the system prompt tells the model to treat history as
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
 * This handles retries within a single provider attempt - cross-provider failover
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
  // version - more likely to corrupt a perfectly valid string).
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

  // Everything failed - log the raw output so the Railway logs show exactly
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
 * Build the {{CONTEXT}} section of the email-extraction prompt.
 * Context is optional - empty/missing sections degrade gracefully.
 *
 * @param {object} ctx
 * @param {string} [ctx.country]
 * @param {Array<{id: string, item: string}>} [ctx.shoppingList]
 * @param {string[]} [ctx.recentPurchases]
 * @param {string[]} [ctx.recurringTaskTitles]
 * @param {Array<{school_name: string, children?: Array<{name: string}>}>} [ctx.schools]
 */
function buildEmailExtractionContext(ctx = {}) {
  const sections = [];
  sections.push(`Country: ${ctx.country || 'unknown'}`);

  if (Array.isArray(ctx.shoppingList) && ctx.shoppingList.length > 0) {
    sections.push('Current shopping list (use these IDs when matching receipt items):');
    for (const item of ctx.shoppingList) {
      sections.push(`  - id: ${item.id} | "${item.item}"`);
    }
  } else {
    sections.push('Current shopping list: (empty)');
  }

  if (Array.isArray(ctx.recentPurchases) && ctx.recentPurchases.length > 0) {
    const slice = ctx.recentPurchases.slice(0, 30);
    sections.push(`Recently purchased (last 60 days, for normalisation hints): ${slice.join(', ')}`);
  }

  if (Array.isArray(ctx.recurringTaskTitles) && ctx.recurringTaskTitles.length > 0) {
    sections.push('Existing recurring tasks (do NOT duplicate from bill emails):');
    for (const t of ctx.recurringTaskTitles) {
      sections.push(`  - ${t}`);
    }
  }

  if (Array.isArray(ctx.schools) && ctx.schools.length > 0) {
    sections.push('Schools (for school-newsletter attribution):');
    for (const s of ctx.schools) {
      const kids = (s.children || []).map((c) => c.name).filter(Boolean).join(', ');
      sections.push(`  - ${s.school_name}${kids ? ` - children: ${kids}` : ''}`);
    }
  }

  return sections.join('\n');
}

/**
 * Extract structured data from any forwarded email - receipts, flights, school newsletters, appointments, etc.
 *
 * The `context` arg lets the AI make smarter decisions in a single call:
 *   - Match receipt items inline to the household's shopping list
 *     (eliminates a follow-up matchReceiptToList call).
 *   - Normalise product names with household-specific vocabulary.
 *   - Skip duplicate tasks when a recurring task already covers a bill.
 *   - Attribute school events to the right child.
 *
 * Backwards-compatible: callers that pass no context get the
 * vanilla classification/extraction behaviour with country='unknown'
 * and empty arrays - same as before this argument existed.
 */
async function extractFromEmail(emailText, subject, memberNames = [], context = {}, { householdId, userId } = {}) {
  const today = new Date().toISOString().split('T')[0];
  const membersStr = memberNames.length > 0 ? memberNames.join(', ') : 'none specified';
  const contextStr = buildEmailExtractionContext(context);

  const systemPrompt = EMAIL_EXTRACTION_SYSTEM
    .replace(/{{DATE}}/g, today)
    .replace(/{{MEMBERS}}/g, membersStr)
    .replace(/{{CONTEXT}}/g, contextStr);

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

module.exports = { classify, scanReceipt, matchReceiptToList, scanImage, extractFromEmail, parseJSON, buildEmailExtractionContext };
