/**
 * LLM safety net for replies to a pending reminder question. A real user
 * replied "Day before" / "The day before !!" to the bot's "how long before
 * should I remind you?" and got the same canned question FOUR times - the
 * regex parser needed a number and the pending-state loop had no escape.
 *
 * Since 2026-08-23 this is the MANDATORY fallback, not an optional one: when
 * every deterministic parse shrugs at a reply to our own question, this call
 * decides what the reply IS before the message is allowed to leak to full
 * classification. The leak was a recurring class of bug - "Half hour" became
 * a phantom event update (padel transcript), "A week before and also add to
 * that school calendar" errored out entirely. Three verdicts:
 *
 *   answer    - expresses a lead time (and/or, for tasks, a clock time);
 *               may also carry a SECOND request in `remainder`
 *   decline   - "no thanks" / "don't bother": no reminder wanted
 *   unrelated - a new request that ignores our question ("add milk")
 *
 * Same conventions as intent-router.js: tiny forced-schema Haiku call,
 * 3s cap, telemetry to ai_usage_log, and ALWAYS null on any failure -
 * the caller falls back to its deterministic heuristics, never an error.
 */

const { callClaude, CLAUDE_HAIKU_MODEL } = require('./ai-client');

const EXTRACT_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['answer', 'decline', 'unrelated'] },
    // Empty array = the reply expresses no lead time (fine for a task
    // answered with a clock time, or a decline/unrelated verdict).
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
    // 24h "HH:MM" when the reply names a clock time ("9am", "around nine
    // in the morning"), else empty string. Only meaningful for to-dos.
    time_of_day: { type: 'string' },
    // When the reply is an answer PLUS another request ("a week before,
    // and also add milk"), the other request verbatim; else empty string.
    remainder: { type: 'string' },
  },
  required: ['verdict', 'offsets', 'time_of_day', 'remainder'],
  additionalProperties: false,
};

const EXTRACT_SYSTEM = `The user of a family-organiser bot was just asked how long BEFORE an upcoming event or to-do they'd like to be reminded (or what time). Classify their reply.

verdict:
- "answer": the reply expresses a reminder lead time and/or a clock time. Examples: "half hour", "2 hours", "the night before", "a week ahead", "morning of", "9am", "at that time is fine" (= accept whatever was proposed: empty offsets, empty time).
- "decline": the reply turns the reminder down. Examples: "no thanks", "nah all good", "don't bother", "no need".
- "unrelated": the reply ignores the question and asks for something else entirely. Examples: "add milk to the list", "what's on tomorrow?".

offsets (lead times, when verdict is "answer"):
- "the day before", "day before", "night before", "evening before" → 1 day
- "the hour before", "an hour or so before" → 1 hour
- "half an hour" / "half hour" → 30 minutes; "a couple of hours" → 2 hours; "a few hours" → 3 hours
- "morning of" / "on the day" / "same day" → 3 hours (a same-day heads-up)
- "a week before" → 7 days; "two weeks" → 14 days
- Multiple leads are allowed ("day before and an hour before" → both).
- NEVER invent a lead time the reply doesn't express.

time_of_day: 24h "HH:MM" when the reply names a clock time ("9am" → "09:00", "around nine in the morning" → "09:00", "3.30pm" → "15:30"); else "".

remainder: if the reply is an answer AND ALSO carries a separate request ("a week before, and also add it to the school calendar" → remainder "add it to the school calendar"), that request verbatim; else "".

Call the tool with the classification.`;

/**
 * @returns {Promise<{verdict: 'answer'|'decline'|'unrelated', offsets: Array<{time:number, unit:string}>, timeOfDay: string|null, remainder: string} | null>}
 *   null = call failed; the caller falls back to deterministic heuristics.
 */
async function extractReminderOffsets(text, { label, itemType, householdId, userId } = {}) {
  if (typeof text !== 'string' || !text.trim()) return null;
  try {
    const { text: raw, usage } = await callClaude({
      system: EXTRACT_SYSTEM,
      messages: [{
        role: 'user',
        content: `${itemType === 'task' ? 'To-do' : 'Event'}: "${label || 'the item'}"\nUser's reply: "${text.trim()}"`,
      }],
      model: CLAUDE_HAIKU_MODEL,
      maxTokens: 300,
      timeoutMs: 3000,
      responseSchema: EXTRACT_SCHEMA,
    });
    const parsed = JSON.parse(raw);
    if (!['answer', 'decline', 'unrelated'].includes(parsed.verdict) || !Array.isArray(parsed.offsets)) return null;
    logExtract({ householdId, userId, verdict: parsed.verdict, found: parsed.offsets.length, usage });
    return {
      verdict: parsed.verdict,
      offsets: parsed.offsets,
      timeOfDay: /^\d{2}:\d{2}$/.test(parsed.time_of_day) ? parsed.time_of_day : null,
      remainder: typeof parsed.remainder === 'string' ? parsed.remainder.trim() : '',
    };
  } catch (err) {
    console.warn('[reminder-extract] falling back to deterministic flow:', err.message);
    return null;
  }
}

// Fire-and-forget usage log, mirroring intent-router's logRouterDecision.
function logExtract({ householdId, userId, verdict, found, usage }) {
  try {
    const { supabaseAdmin: supabase } = require('../db/client');
    supabase
      .from('ai_usage_log')
      .insert({
        household_id: householdId || null,
        user_id: userId || null,
        provider: 'claude',
        model: CLAUDE_HAIKU_MODEL,
        feature: `reminder-extract:${verdict}${verdict === 'answer' && found === 0 ? ':empty' : ''}`,
        input_tokens: usage ? usage.inputTokens : null,
        output_tokens: usage ? usage.outputTokens : null,
        is_failover: false,
      })
      .then(() => {})
      .catch((err) => console.error('[reminder-extract] usage log failed:', err.message));
  } catch { /* telemetry must never throw */ }
}

module.exports = { extractReminderOffsets, EXTRACT_SCHEMA };
