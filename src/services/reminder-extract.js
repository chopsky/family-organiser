/**
 * LLM fallback for reminder-lead replies the deterministic parser can't
 * read. A real user replied "Day before" / "The day before !!" to the bot's
 * "how long before should I remind you?" and got the same canned question
 * FOUR times - the regex parser needed a number ("1 day before") and the
 * pending-state loop had no escape. The parser now handles those phrasings
 * directly; this Haiku call is the safety net for everything else
 * ("couple of hours ahead", "just a bit before", "make it the evening
 * prior"), so the bot never re-asks a question a human could answer.
 *
 * Same conventions as intent-router.js: tiny forced-schema Haiku call,
 * 3s cap, telemetry to ai_usage_log, and ALWAYS null on any failure -
 * the caller falls back to its ask-once-then-let-go flow, never an error.
 */

const { callClaude, CLAUDE_HAIKU_MODEL } = require('./ai-client');

const EXTRACT_SCHEMA = {
  type: 'object',
  properties: {
    // Empty array = the reply does not express a reminder lead time.
    offsets: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          time: { type: 'integer', minimum: 1 },
          unit: { type: 'string', enum: ['minutes', 'hours', 'days'] },
        },
        required: ['time', 'unit'],
        additionalProperties: false,
      },
    },
  },
  required: ['offsets'],
  additionalProperties: false,
};

const EXTRACT_SYSTEM = `The user of a family-organiser bot was just asked how long BEFORE an upcoming event they'd like to be reminded. Interpret their reply as reminder lead time(s).

Rules:
- "the day before", "day before", "night before", "evening before" → 1 day
- "the hour before", "an hour or so before" → 1 hour
- "half an hour" → 30 minutes; "a couple of hours" → 2 hours; "a few hours" → 3 hours
- "morning of" / "on the day" / "same day" → 3 hours (a same-day heads-up)
- "a week before" → 7 days
- Multiple leads are allowed ("day before and an hour before" → both).
- If the reply does NOT express any lead time (e.g. "no thanks", "who is coming?", "add milk"), return an empty offsets array. NEVER invent a lead time from an unrelated message.

Call the tool with the offsets.`;

/**
 * @returns {Promise<{offsets: Array<{time:number, unit:string}>} | null>}
 *   offsets [] = reply expresses no lead time; null = call failed (treat as unparsed).
 */
async function extractReminderOffsets(text, { label, householdId, userId } = {}) {
  if (typeof text !== 'string' || !text.trim()) return null;
  try {
    const { text: raw, usage } = await callClaude({
      system: EXTRACT_SYSTEM,
      messages: [{ role: 'user', content: `Event: "${label || 'the event'}"\nUser's reply: "${text.trim()}"` }],
      model: CLAUDE_HAIKU_MODEL,
      maxTokens: 256,
      timeoutMs: 3000,
      responseSchema: EXTRACT_SCHEMA,
    });
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.offsets)) return null;
    logExtract({ householdId, userId, found: parsed.offsets.length, usage });
    return { offsets: parsed.offsets };
  } catch (err) {
    console.warn('[reminder-extract] falling back to deterministic flow:', err.message);
    return null;
  }
}

// Fire-and-forget usage log, mirroring intent-router's logRouterDecision.
function logExtract({ householdId, userId, found, usage }) {
  try {
    const { supabaseAdmin: supabase } = require('../db/client');
    supabase
      .from('ai_usage_log')
      .insert({
        household_id: householdId || null,
        user_id: userId || null,
        provider: 'claude',
        model: CLAUDE_HAIKU_MODEL,
        feature: `reminder-extract:${found > 0 ? 'hit' : 'none'}`,
        input_tokens: usage ? usage.inputTokens : null,
        output_tokens: usage ? usage.outputTokens : null,
        is_failover: false,
      })
      .then(() => {})
      .catch((err) => console.error('[reminder-extract] usage log failed:', err.message));
  } catch { /* telemetry must never throw */ }
}

module.exports = { extractReminderOffsets, EXTRACT_SCHEMA };
