/**
 * READ fast-path router (BOT_ROUTER=1) — Phase 2 of the bot pipeline plan.
 *
 * "What's on my to-do list?" does not need a 930-line mega-prompt, 8k
 * max_tokens and adaptive thinking (~7s): once the INTENT is known, the
 * existing deterministic handlers answer pure reads straight from the DB
 * with zero LLM prose. This router is a tiny forced-tool call on Claude
 * Haiku 4.5 (~sub-second) that decides ONLY whether the message is a pure
 * read — anything else returns 'other' and falls through to the full
 * classify pipeline unchanged.
 *
 * Deliberately conservative: a missed fast-path costs one cheap wasted
 * call; a wrong fast-path would swallow a mutation. The prompt orders the
 * router to return 'other' whenever the message contains ANYTHING beyond
 * asking to view. It never mutates anything itself.
 *
 * Failure semantics: any error, timeout (3s cap) or unexpected shape →
 * null (fall through). The router must never be the reason a message
 * fails.
 */

const { callClaude, CLAUDE_HAIKU_MODEL } = require('./ai-client');

const ROUTES = ['query_tasks', 'query_list', 'query_calendar', 'subscription_list', 'other'];

const ROUTER_SCHEMA = {
  type: 'object',
  properties: {
    route: { type: 'string', enum: ROUTES },
    // Only for query_calendar, only when the message names a timeframe the
    // router can resolve confidently; the handler defaults to today+14d.
    query_start: { type: 'string' },
    query_end: { type: 'string' },
  },
  required: ['route'],
  additionalProperties: false,
};

const ROUTER_SYSTEM = `You route messages for a family-organiser bot. Decide if the message is a PURE READ — the user ONLY wants to view existing data — and pick exactly one route:

- "query_tasks": view the to-do/task list ("what's on my to do list?", "show tasks")
- "query_list": view the shopping list ("what's on the shopping list?", "what do we need to buy?")
- "query_calendar": view calendar/schedule ("what's on this week?", "when is the dentist?", "do I have anything tomorrow?"). If the message names a timeframe, also set query_start and query_end (YYYY-MM-DD, resolved against today's date given below).
- "subscription_list": view tracked subscriptions ("what subscriptions do we have?")
- "other": EVERYTHING else.

Return "other" whenever you are not certain, and ALWAYS when the message:
- adds, removes, completes, changes, cancels, books or reminds ("add milk and show the list" → other)
- asks a question that needs knowledge or advice rather than stored data
- mixes a read with anything else
- is conversational, a greeting, or a follow-up to an earlier request

Call the route tool with your decision.`;

/**
 * @returns {Promise<{route: string, query_start?: string, query_end?: string} | null>}
 *   null = fall through to the full pipeline (route 'other', any error, bad shape).
 */
async function routeReadIntent(text, { timezone = 'Europe/London', householdId, userId } = {}) {
  if (process.env.BOT_ROUTER !== '1') return null;
  try {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: timezone });
    const { text: raw, usage } = await callClaude({
      system: `${ROUTER_SYSTEM}\n\nToday's date: ${today} (timezone ${timezone}).`,
      messages: [{ role: 'user', content: text }],
      model: CLAUDE_HAIKU_MODEL,
      maxTokens: 256,
      timeoutMs: 3000, // the fast path must never make the slow path slower
      responseSchema: ROUTER_SCHEMA,
    });
    const parsed = JSON.parse(raw);
    if (!ROUTES.includes(parsed.route) || parsed.route === 'other') return null;
    // Telemetry so the Bot-health strip covers router behaviour.
    logRouterDecision({ householdId, userId, route: parsed.route, usage });
    return parsed;
  } catch (err) {
    // Timeout / provider error / parse surprise — never block the message.
    console.warn('[intent-router] falling through to full pipeline:', err.message);
    return null;
  }
}

// Fire-and-forget usage log (feature 'router'), mirroring logAiUsage's
// pattern without exporting it from ai-client.
function logRouterDecision({ householdId, userId, route, usage }) {
  try {
    const { supabaseAdmin: supabase } = require('../db/client');
    supabase
      .from('ai_usage_log')
      .insert({
        household_id: householdId || null,
        user_id: userId || null,
        provider: 'claude',
        model: CLAUDE_HAIKU_MODEL,
        feature: `router:${route}`,
        input_tokens: usage ? usage.inputTokens : null,
        output_tokens: usage ? usage.outputTokens : null,
        is_failover: false,
      })
      .then(() => {})
      .catch((err) => console.error('[intent-router] usage log failed:', err.message));
  } catch { /* telemetry must never throw */ }
}

module.exports = { routeReadIntent, ROUTER_SCHEMA, ROUTES };
