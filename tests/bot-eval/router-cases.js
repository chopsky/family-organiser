/**
 * READ fast-path router golden set (BOT_ROUTER=1, Phase 2).
 *
 * Two halves, run live against Haiku via tests/bot-eval/run-router.js:
 *   - MUST FAST-PATH: pure view requests in everyday phrasings.
 *   - MUST FALL THROUGH (expect: null): anything with a mutation, a mixed
 *     ask, advice, or ambiguity — the conservative contract. A wrong
 *     fast-path here would swallow a real action, so these are the cases
 *     that matter most.
 *
 * `expect` is a route string, or null for fall-through. An optional
 * `check(routed)` runs extra assertions on a fast-pathed result and returns
 * an error string or null (e.g. query_topic must carry the asked-about
 * thing - the real-world "What time is masons tennis today" failure got a
 * whole-day dump because the topic was discarded at routing).
 */

module.exports = [
  // ── must fast-path ──
  { message: 'Whats on my to do list?', expect: 'query_tasks' },
  { message: 'show me the tasks', expect: 'query_tasks' },
  { message: 'what do we still need to do this week?', expect: 'query_tasks' },
  { message: "what's on the shopping list?", expect: 'query_list' },
  { message: 'what do we need to buy?', expect: 'query_list' },
  { message: 'show the list', expect: 'query_list' },
  { message: "what's on this week?", expect: 'query_calendar' },
  { message: 'do I have anything tomorrow?', expect: 'query_calendar' },
  { message: "when is Mason's tennis?", expect: 'query_calendar',
    check: (r) => (/tennis/i.test(r.query_topic || '') ? null : `query_topic missing: ${JSON.stringify(r)}`) },
  { message: 'What time is masons tennis today', expect: 'query_calendar',
    check: (r) => (/tennis/i.test(r.query_topic || '') ? null : `query_topic missing: ${JSON.stringify(r)}`) },
  { message: 'what time is the dentist appointment?', expect: 'query_calendar',
    check: (r) => (/dentist/i.test(r.query_topic || '') ? null : `query_topic missing: ${JSON.stringify(r)}`) },
  { message: 'what subscriptions do we have?', expect: 'subscription_list' },

  // ── must fall through (null) ──
  { message: "what's on my list? also add eggs", expect: null },
  { message: 'add milk and show the shopping list', expect: null },
  { message: "tick off the MOT and show me what's left", expect: null },
  { message: 'remind me to call the dentist', expect: null },
  { message: 'move the dentist to 4pm', expect: null },
  { message: 'cancel swimming on Friday', expect: null },
  { message: "what should we have for dinner tonight?", expect: null },
  { message: 'we pay £9.99 a month for Netflix', expect: null },
  { message: 'thanks!', expect: null },
  { message: "Lynn is allergic to nuts", expect: null },
];
