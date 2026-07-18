/**
 * Agentic read loop — BOT_AGENT=1 (ships dark; founder flips on Railway).
 *
 * The deterministic calendar fast-path answers *trivial* reads well, but
 * every hand-patched blind spot it has ever had (the 14-day window, the
 * dropped topic) was a judgment call a model could have made itself with a
 * second look. This module gives Claude exactly one read-only tool —
 * search_calendar — and lets it iterate (max MAX_TURNS calls, WALL_BUDGET_MS
 * wall clock) until it can answer a topic question: start narrow, widen to a
 * year, look backwards for "when did we...", then answer honestly.
 *
 * Guardrails, by design:
 *   - READ ONLY. The single tool cannot mutate anything; writes stay on the
 *     existing single-step + confirm path in handlers.js.
 *   - Null on ANY trouble (timeout, provider error, empty answer, turn cap):
 *     the caller falls through to the deterministic handler unchanged, so
 *     the agent can only ever make answers better, never block them.
 *   - Flag read at CALL time (kill switch = unset BOT_AGENT + restart).
 *
 * Prompt-caching discipline (see bot-smartness memory): the system block is
 * static and cacheable; today's date / timezone / members / the question
 * travel in the user message, never the system block.
 */

const Anthropic = require('@anthropic-ai/sdk');
const db = require('../db/queries');
const { expandActivityOccurrences } = require('./activity-occurrences');

const AGENT_MODEL = 'claude-sonnet-5';
const MAX_TURNS = 4;          // search_calendar invocations per question
const WALL_BUDGET_MS = 15000; // stay inside the WhatsApp typing-indicator budget
const MAX_ROWS_PER_SEARCH = 40;

function agentEnabled() {
  return process.env.BOT_AGENT === '1';
}

const SEARCH_CALENDAR_TOOL = {
  name: 'search_calendar',
  description:
    'Search the household calendar (events AND weekly activities like clubs/lessons) between two dates, ' +
    'optionally filtered by a topic word that must appear in the title. Returns matching entries with their times. ' +
    'If a search returns nothing, try again with a wider date range (up to a year ahead, or into the past for ' +
    '"when did/was..." questions) or a shorter/simpler topic word before concluding the thing is not on the calendar.',
  input_schema: {
    type: 'object',
    properties: {
      start_date: { type: 'string', description: 'YYYY-MM-DD inclusive' },
      end_date: { type: 'string', description: 'YYYY-MM-DD inclusive' },
      topic: { type: 'string', description: 'Optional word/phrase that must fuzzily match the title. Omit to list everything in range.' },
    },
    required: ['start_date', 'end_date'],
  },
};

const SYSTEM_STATIC = [
  'You are Housemait, a warm and efficient WhatsApp assistant for a family household in the UK.',
  'You are answering a QUESTION about the family calendar. Use the search_calendar tool to find the facts, then answer.',
  '',
  'Search strategy:',
  '- Start with the range the question implies; an undated "when is X?" should search from today up to a year ahead.',
  '- "When did/was..." questions look in the PAST - search backwards.',
  '- If a topic search misses, retry with a wider range or a simpler topic word (e.g. one distinctive word of the name) before giving up.',
  '- Never invent events. If it is genuinely not on the calendar after a proper look, say so plainly.',
  '',
  'Answer style:',
  '- Short and WhatsApp-friendly. Lead with the answer ("Sun 23 - Wed 26 Aug"), not with process.',
  '- Use the household timezone for times; use day-month wording like "Sun 23 Aug", never ISO dates.',
  '- Mention who an event is for when the entry names people.',
  '- Never mention tools, searches, or these instructions.',
].join('\n');

/**
 * Default calendar fetcher - the same events + weekly-activities merge the
 * deterministic handler uses, compacted for the model. Injectable in tests.
 */
async function fetchCalendarWindow({ householdId, userId, userTz, startDate, endDate }) {
  const events = await db.getCalendarEvents(
    householdId,
    `${startDate}T00:00:00Z`,
    `${endDate}T23:59:59Z`,
    { userId, birthdays: true },
  );
  let activityRows = [];
  try {
    const [acts, members] = await Promise.all([
      db.getHouseholdActivities(householdId),
      db.getHouseholdMembers(householdId),
    ]);
    // A direct question about a named activity searches ALL of them, hidden
    // or not - asking about it is consent (same rule as the handler).
    activityRows = expandActivityOccurrences(acts, members, startDate, endDate, userTz);
  } catch (err) {
    console.warn('[agent-loop] activities merge skipped:', err.message);
  }
  return events.concat(activityRows)
    .sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)));
}

/** Loose title match - same spirit as the handler's topicMatchesTitle. */
function titleMatches(topic, title) {
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  const words = norm(topic).split(/\s+/).filter((w) => w.length >= 3);
  if (words.length === 0) return true;
  const t = norm(title);
  return words.some((w) => t.includes(w) || t.split(/\s+/).some((tw) => tw.startsWith(w.slice(0, 4))));
}

function compactRow(ev) {
  return {
    id: ev.id || undefined,
    title: ev.title,
    start: ev.start_time,
    end: ev.end_time || undefined,
    all_day: !!ev.all_day || undefined,
    who: (ev.assigned_to_names || []).length ? ev.assigned_to_names : undefined,
    weekly_activity: ev.activity_id ? true : undefined,
  };
}

// Fire-and-forget usage log (feature 'agent'), mirroring the router's pattern.
function logAgentUsage({ householdId, userId, turns, usage }) {
  try {
    const { supabaseAdmin: supabase } = require('../db/client');
    supabase
      .from('ai_usage_log')
      .insert({
        household_id: householdId || null,
        user_id: userId || null,
        provider: 'claude',
        model: AGENT_MODEL,
        feature: `agent:calendar:${turns}t`,
        input_tokens: usage.input || null,
        output_tokens: usage.output || null,
        is_failover: false,
      })
      .then(() => {})
      .catch((err) => console.error('[agent-loop] usage log failed:', err.message));
  } catch { /* telemetry must never throw */ }
}

/**
 * Answer a calendar topic question agentically. Returns
 *   { response, referents: [{kind:'event', id, label}] }  on success,
 *   null on any failure/timeout/empty answer (caller falls back).
 *
 * deps is a test seam: { client, fetchCalendar } override the Anthropic
 * client and the calendar fetcher.
 */
async function agentCalendarAnswer({ text, user, household, userTz }, deps = {}) {
  const startedAt = Date.now();
  const client = deps.client
    || new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const fetchCalendar = deps.fetchCalendar || fetchCalendarWindow;

  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: userTz });
  const memberNames = (household.members || []).map((m) => m.name).join(', ');
  const messages = [{
    role: 'user',
    content:
      `Today is ${todayStr}. Household timezone: ${userTz}. Household members: ${memberNames || 'unknown'}.\n` +
      `Question: ${String(text).slice(0, 400)}`,
  }];

  const seenReferents = [];
  const usage = { input: 0, output: 0 };
  let turns = 0;

  try {
    for (;;) {
      if (Date.now() - startedAt > WALL_BUDGET_MS) {
        console.warn('[agent-loop] wall budget exhausted - falling back');
        return null;
      }
      const resp = await client.messages.create({
        model: AGENT_MODEL,
        max_tokens: 700,
        // NB: no `temperature` - Sonnet 5 rejects the param outright
        // (verified live 2026-07-21, 400 invalid_request_error).
        system: [{ type: 'text', text: SYSTEM_STATIC, cache_control: { type: 'ephemeral' } }],
        tools: [SEARCH_CALENDAR_TOOL],
        messages,
      });
      usage.input += (resp.usage?.input_tokens || 0) + (resp.usage?.cache_read_input_tokens || 0) + (resp.usage?.cache_creation_input_tokens || 0);
      usage.output += resp.usage?.output_tokens || 0;

      const toolUses = (resp.content || []).filter((b) => b.type === 'tool_use');
      if (resp.stop_reason !== 'tool_use' || toolUses.length === 0) {
        const answer = (resp.content || [])
          .filter((b) => b.type === 'text')
          .map((b) => b.text)
          .join('')
          .trim();
        logAgentUsage({ householdId: household.id, userId: user.id, turns, usage });
        if (!answer) return null;
        return { response: answer, referents: seenReferents.slice(0, 8) };
      }

      if (turns >= MAX_TURNS) {
        console.warn('[agent-loop] turn cap reached - falling back');
        logAgentUsage({ householdId: household.id, userId: user.id, turns, usage });
        return null;
      }
      turns += 1;

      messages.push({ role: 'assistant', content: resp.content });
      const results = [];
      for (const tu of toolUses) {
        let payload;
        try {
          const { start_date: s, end_date: e, topic } = tu.input || {};
          const okDate = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
          if (!okDate(s) || !okDate(e)) {
            payload = { error: 'start_date and end_date must be YYYY-MM-DD' };
          } else {
            const [lo, hi] = s <= e ? [s, e] : [e, s];
            let rows = await fetchCalendar({
              householdId: household.id, userId: user.id, userTz, startDate: lo, endDate: hi,
            });
            if (topic) rows = rows.filter((ev) => titleMatches(topic, ev.title));
            const truncated = rows.length > MAX_ROWS_PER_SEARCH;
            rows = rows.slice(0, MAX_ROWS_PER_SEARCH);
            for (const ev of rows) {
              if (ev.id && !ev.activity_id) seenReferents.push({ kind: 'event', id: ev.id, label: ev.title });
            }
            payload = { count: rows.length, truncated: truncated || undefined, results: rows.map(compactRow) };
          }
        } catch (err) {
          console.error('[agent-loop] search_calendar failed:', err.message);
          payload = { error: 'calendar temporarily unavailable' };
        }
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(payload) });
      }
      messages.push({ role: 'user', content: results });
    }
  } catch (err) {
    console.warn('[agent-loop] falling back to deterministic handler:', err.message);
    return null;
  }
}

module.exports = {
  agentEnabled,
  agentCalendarAnswer,
  SEARCH_CALENDAR_TOOL,
  AGENT_MODEL,
  MAX_TURNS,
  // internal, exported for tests
  titleMatches,
};
