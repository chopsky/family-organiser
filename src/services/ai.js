require('dotenv').config();
const { callWithFailover, callClaude, REASONING_TIMEOUT_MS } = require('./ai-client');
const { getCityFromTimezone } = require('./weather');
const { messageMentionsLocation } = require('../utils/location-relevance');
const { formatPreferenceLines } = require('./preferences-format');
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

  // Family preferences - structured AI-consulted facts (allergies, dietary
  // stances, member-specific likes/dislikes, schedule anchors). The shared
  // formatter groups hardest-first and attributes each to its member, and is
  // reused by the chat assistant + recipe generator so all three surfaces
  // honour the same learned data identically. Rows arrive already enriched
  // with member_name (the caller resolves member_id).
  const preferencesStr = formatPreferenceLines(preferences);
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
    ? cappedEvents.map((e, i) => {
        const date = new Date(e.start_time).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: userTz });
        const time = e.all_day ? 'All day' : new Date(e.start_time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: userTz });
        // Leading [N] is the event's reference number - on update_event /
        // delete_event the model returns it as target.target_id so we modify
        // THAT exact event by id instead of fuzzy-matching the title.
        return `[${i + 1}] ${date} ${time}: ${e.title}${formatWho(e)}${e.location ? ` @ ${e.location}` : ''}`;
      }).join('\n') + (calendarEvents.length > 100 ? `\n... and ${calendarEvents.length - 100} more events` : '')
    : '(no upcoming events)';

  // Cap at 50 open tasks - enough for the classifier to match completion
  // signals like "Elementor paid" against "Pay Elementor", without blowing
  // up the prompt for busy households.
  const cappedTasks = tasks.slice(0, 50);
  const tasksStr = cappedTasks.length > 0
    ? cappedTasks.map((t, i) => {
        const due = t.due_date
          ? new Date(`${t.due_date}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: userTz })
          : 'no due date';
        const priority = t.priority && t.priority !== 'medium' ? ` [${t.priority}]` : '';
        // The leading [N] is the task's reference number. When the user
        // completes a task, the model returns that number as task_id and we
        // complete THAT exact task by id - no fuzzy re-matching (which used
        // to tick off every "Call …" task for a single "I called EUSS").
        return `[${i + 1}] "${t.title}"${formatWho(t)} - due ${due}${priority}`;
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
      // classify doubles as the chat/advice responder (the answer lands in
      // response_message). Generating a long recommendation can exceed the 12s
      // chat default, which then times out on BOTH providers (~24s) and fails.
      // The WhatsApp webhook acks Twilio immediately and replies async, so a
      // longer budget is safe. A healthy provider still answers in a few
      // seconds; this only buys headroom for genuinely long generations.
      timeoutMs: 22000,
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
async function scanImage(imageData, mediaType = 'image/jpeg', memberNames = [], { householdId, userId, caption = '' } = {}) {
  const base64 = Buffer.isBuffer(imageData)
    ? imageData.toString('base64')
    : imageData;

  const today = new Date().toISOString().split('T')[0];
  const membersStr = memberNames.length > 0 ? memberNames.join(', ') : 'none specified';
  const systemPrompt = IMAGE_SCAN_SYSTEM
    .replace(/{{DATE}}/g, today)
    .replace(/{{MEMBERS}}/g, membersStr)
    .replace(/{{CAPTION}}/g, (caption || '').trim() || '(none)');

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
      // Generous budget: a termly booking / fixture list can hold 20-40 dated
      // sessions, each a full event object. At 2048 the JSON truncated
      // mid-list and failed to parse ("trouble reading that image").
      maxTokens: 8192,
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
/**
 * Best-effort repair of a TRUNCATED JSON string (the model ran out of output
 * budget mid-value). Keeps everything up to the last fully-closed structure
 * and appends the closers needed to balance the still-open brackets - so a
 * cut-off "events": [ {...}, {...}, {<incomplete> response still yields the
 * complete events. Returns null if there's nothing recoverable.
 */
function repairTruncatedJson(s) {
  let inStr = false, esc = false;
  const stack = [];
  let safeEnd = -1;       // last index (inclusive) that closed a structure
  let safeStack = null;   // bracket stack at safeEnd
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') { stack.pop(); safeEnd = i; safeStack = stack.slice(); }
  }
  if (safeEnd < 0 || !safeStack || safeStack.length === 0) return null;
  let out = s.slice(0, safeEnd + 1);
  for (let i = safeStack.length - 1; i >= 0; i--) out += safeStack[i] === '{' ? '}' : ']';
  return out;
}

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

  // Truncation salvage: recover the complete portion of a cut-off response.
  for (const base of [block || stripped]) {
    const repaired = repairTruncatedJson(base);
    if (repaired) candidates.push(repaired.replace(/,(\s*[}\]])/g, '$1'));
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
      // Generous: a forwarded contacts/birthday list or school newsletter can
      // hold dozens of events; at 4096 the JSON truncated mid-list and failed.
      maxTokens: 8192,
      feature: 'email_extraction',
      responseFormat: 'json',
      householdId,
      userId,
    });
    return parseJSON(text, 'email extraction');
  });
}

/**
 * Run a web search via Claude's native web_search tool. Used by the
 * bot when the user asks something current/external the classifier
 * can't answer from context (opening hours, business addresses, prices,
 * news, etc.). Anthropic handles the actual search server-side - no
 * external API key needed. Cost: ~$0.01 per search.
 *
 * Returns a friendly, concise synthesised answer or null on failure.
 * Address is woven in so "is the dentist open Saturday?" gets local
 * results without the user having to specify a city.
 */
async function runWebSearch(query, { householdId, userId, address, timezone } = {}) {
  if (!query || typeof query !== 'string') return null;
  const localContext = address
    ? `The family's home is at ${address}. Prefer local UK results when relevant - opening hours, businesses, services nearby. Mention rough distance or neighbourhood rather than echoing the full address back to the user.`
    : 'The family is in the UK. Prefer UK results when relevant.';
  const tzContext = timezone ? `Their timezone is ${timezone}.` : '';
  const system = `You are a family assistant looking up real-time information. Use the web_search tool to find current facts, then synthesise a concise, friendly answer in 2-4 sentences. Cite specific facts (opening hours, addresses, prices, distances) - never vague phrases like "varies". If the search returns nothing useful, say so honestly. Use British spelling but plain, widely-understood words - no regional slang, and no em or en dashes (— –); use commas or full stops. ${localContext} ${tzContext}`;
  try {
    const { text } = await callClaude({
      system,
      messages: [{ role: 'user', content: query }],
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      maxTokens: 1024,
      timeoutMs: REASONING_TIMEOUT_MS,
    });
    return text || null;
  } catch (err) {
    console.warn('[web_search] failed:', err.message);
    return null;
  }
}

/**
 * Find the OFFICIAL local-authority web page that publishes school term dates,
 * using Claude's web_search tool. Returns the single best URL (a council's own
 * page, usually *.gov.uk, or a direct PDF) or null. Used by the schools
 * "import from local authority" flow, which then FETCHES that page and extracts
 * the dates from its real text - so the dates come from the council, not the
 * model's memory. Claude-only (web_search is a Claude tool); failures return
 * null and the caller falls back to a helpful "try website/PDF import" message.
 */
async function findOfficialTermDatesUrl({ localAuthority, academicYear } = {}) {
  if (!localAuthority) return null;
  const system = `You locate the OFFICIAL web page where a UK local authority publishes its school term dates. Use the web_search tool to find it. Strongly prefer the council's own domain (usually *.gov.uk); a direct link to the council's term-dates PDF is also fine. Return ONLY a JSON object on a single line: {"url":"<the one best official council URL>"}. Use a URL that actually appeared in the search results - never invent one. If you cannot find an official council term-dates page, return {"url":null}.`;
  try {
    const { text } = await callClaude({
      system,
      messages: [{ role: 'user', content: `Find the official ${localAuthority} council web page that lists school term dates for the ${academicYear} academic year.` }],
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      maxTokens: 1024,
      timeoutMs: REASONING_TIMEOUT_MS,
    });
    const match = (text || '').match(/\{[\s\S]*?\}/);
    if (!match) return null;
    const { url } = JSON.parse(match[0]);
    return typeof url === 'string' && /^https?:\/\//i.test(url) ? url : null;
  } catch (err) {
    console.warn('[la-term-dates] URL resolution failed:', err.message);
    return null;
  }
}

module.exports = { classify, scanReceipt, matchReceiptToList, scanImage, extractFromEmail, parseJSON, buildEmailExtractionContext, runWebSearch, findOfficialTermDatesUrl };
