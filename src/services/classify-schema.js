/**
 * Canonical JSON Schema for the classify() output — the single source of
 * truth the BOT_PIPELINE=v2 pipeline enforces at the API layer, so the model
 * CANNOT return malformed JSON (the failure class behind "the AI replied in
 * a format I couldn't read").
 *
 * DIALECT (learned against the live APIs, 2026-07-10 — every constraint below
 * was a rejected request, not a docs guess):
 *   - Optionality is expressed by OMISSION (field absent from `required`),
 *     NOT by null-unions: Anthropic rejects `enum` combined with a type
 *     array ("Enum value 'daily' does not match declared type
 *     ['string','null']"). This schema contains ZERO unions.
 *   - additionalProperties: false on every object.
 *   - Handlers already treat absent and null identically (`r.tasks || []`,
 *     truthiness checks), so omission is behaviour-compatible with the v1
 *     prose contract's `| null`.
 *
 * Providers (each takes the FULL schema, different mechanisms):
 *   - Anthropic (primary): FORCED TOOL USE, not output_config. The
 *     structured-outputs grammar compiler rejected this shape three ways
 *     (>16 union params; >24 optional params — we have ~40; open objects
 *     banned, so a slim "envelope" variant is impossible too). Non-strict
 *     tool input_schema has none of those limits, and tool_use.input
 *     arrives as PARSED JSON by API contract — empty/prose/malformed
 *     output is protocol-impossible, which is the entire production
 *     failure class. Schema conformance is model-best-effort (same as v1;
 *     the eval suite is the conformance gate).
 *   - Gemini: config.responseJsonSchema = schema (standard JSON Schema,
 *     API-enforced).
 *   - OpenAI: json_schema with strict:FALSE — strict mode demands the
 *     all-required/nullable dialect this schema deliberately avoids, and
 *     GPT is the rare double-failover; non-strict schema guidance + the
 *     parseJSON belt-and-braces is the right trade there.
 *
 * The FIELD SEMANTICS (when to set what) stay in the prose prompt
 * (src/services/prompts.js) — this file only pins the SHAPE. Keep the two in
 * sync: a field added here must be described there, and vice versa. The
 * lockstep jest test compares the intent enums.
 */

// ── tiny schema helpers ──────────────────────────────────────────────────────
const str = { type: 'string' };
const num = { type: 'number' };
const int = { type: 'integer' };
const bool = { type: 'boolean' };
const en = (values) => ({ type: 'string', enum: values });
const arr = (items) => ({ type: 'array', items });
const strArr = arr(str);
// Mark a property optional: it is kept in `properties` but left out of
// `required`, so the model simply omits it when it doesn't apply.
const opt = (schema) => ({ ...schema, __optional: true });
// Object node: every non-opt() property is required; additionalProperties
// closed. (The __optional marker is stripped and never reaches the API.)
const obj = (properties) => {
  const props = {};
  const required = [];
  for (const [key, value] of Object.entries(properties)) {
    const { __optional, ...rest } = value;
    props[key] = rest;
    if (!__optional) required.push(key);
  }
  return { type: 'object', properties: props, required, additionalProperties: false };
};

// ── shared enums (mirror prompts.js exactly) ─────────────────────────────────
const INTENTS = [
  'add', 'remove', 'query_list', 'query_tasks', 'query_calendar', 'mixed',
  'note_save', 'note_recall', 'subscription_add', 'subscription_remove',
  'subscription_list', 'create_event', 'update_event', 'delete_event',
  'update_task', 'delete_task', 'update_shopping_item', 'delete_shopping_item',
  'recipe', 'recipe_followup', 'weather', 'school_activity', 'school_event',
  'web_search', 'chat',
];
const SHOPPING_CATEGORIES = [
  'Dairy & Eggs', 'Produce', 'Meat & Seafood', 'Pantry & Grains', 'Bakery',
  'Frozen Foods', 'Beverages', 'Household & Cleaning', 'Personal Care', 'Other',
];
const RECURRENCES = ['daily', 'weekly', 'biweekly', 'monthly', 'yearly'];
const PRIORITIES = ['low', 'medium', 'high'];
const NOTIFICATIONS = ['at_time', '5_min', '15_min', '30_min', '1_hour', '2_hours', '1_day', '2_days'];
const CURRENCIES = ['GBP', 'USD', 'EUR', 'ZAR', 'CAD', 'AUD', 'NZD'];

const reminders = arr(obj({ time: num, unit: en(['minutes', 'hours', 'days']) }));

// One calendar event — used both as the single `calendar_event` and as the
// items of `calendar_events` (multi-event messages, Phase 3).
const calendarEventShape = () => obj({
  title: str,
  date: str,
  // Multi-day events ("camping from 5-10 Sept"): last day of the range.
  // Null/absent = single-day. Without this field the model could only
  // NARRATE the range while storing one day (real 2026-07-23 transcript).
  end_date: opt(str),
  all_day: bool,
  start_time: opt(str),
  end_time: opt(str),
  assigned_to_names: opt(strArr),
  location: opt(str),
  description: opt(str),
  reminders: opt(reminders),
  force: opt(bool),
});

// ── the classify output schema ───────────────────────────────────────────────
const CLASSIFY_SCHEMA = obj({
  intent: en(INTENTS),
  response_message: str,
  shopping_items: arr(obj({
    item: str,
    category: en(SHOPPING_CATEGORIES),
    quantity: opt(str),
    action: en(['add', 'remove']),
  })),
  tasks: arr(obj({
    title: str,
    action: en(['add', 'complete']),
    task_id: opt(int),
    assigned_to_names: opt(strArr),
    due_date: opt(str),
    due_time: opt(str),
    recurrence: opt(en(RECURRENCES)),
    priority: opt(en(PRIORITIES)),
    notification: opt(en(NOTIFICATIONS)),
  })),
  calendar_event: opt(calendarEventShape()),
  // Multi-event messages ("swimming Tue 4pm and dentist Thu 9am"): ALL the
  // events go here; calendar_event stays for the single-event case.
  calendar_events: opt(arr(calendarEventShape())),
  target: opt(obj({
    title: str,
    target_id: opt(int),
    context: opt(str),
    assigned_to_name: opt(str),
  })),
  updates: opt(obj({
    title: opt(str),
    date: opt(str),
    start_date: opt(str),
    end_date: opt(str),
    start_time: opt(str),
    end_time: opt(str),
    all_day: opt(bool),
    assigned_to_names: opt(strArr),
    location: opt(str),
    description: opt(str),
    due_date: opt(str),
    priority: opt(en(PRIORITIES)),
    recurrence: opt(en(RECURRENCES)),
    reminders: opt(reminders),
    notification: opt(en(NOTIFICATIONS)),
    quantity: opt(str),
    item: opt(str),
  })),
  note: opt(obj({
    key: str,
    action: en(['save', 'delete']),
    value: opt(str),
  })),
  recipe_request: opt(obj({
    description: str,
    dietary: opt(str),
    servings: opt(int),
  })),
  school_activity: opt(obj({
    child_name: str,
    activity: str,
    day_of_week: int,
    action: en(['add', 'remove', 'skip', 'change']),
    time_start: opt(str),
    time_end: opt(str),
    skip_date: opt(str),
    pickup_name: opt(str),
  })),
  subscription: opt(obj({
    name: str,
    action: en(['add', 'remove', 'list']),
    amount: opt(num),
    currency: opt(en(CURRENCIES)),
    recurrence: opt(en(['monthly', 'yearly'])),
    renewal_day_of_month: opt(int),
    renewal_month: opt(int),
    target_name: opt(str),
  })),
  preferences: opt(arr(obj({
    key: en(['allergy', 'dietary', 'dislike', 'like', 'schedule', 'preference']),
    value: str,
    member_name: opt(str),
  }))),
  web_search_query: opt(str),
  query_start: opt(str),
  query_end: opt(str),
  // query_calendar only: the specific event/activity asked about ("tennis"),
  // so the handler can filter to it and answer honestly on no match.
  query_topic: opt(str),
});

// ── per-provider adapters ────────────────────────────────────────────────────
// Anthropic: a forced tool. tool_use.input is parsed JSON by API contract —
// see the provider notes in the header for why this beats output_config here.
function anthropicForcedTool(schema = CLASSIFY_SCHEMA, name = 'classification') {
  return {
    tools: [{
      name,
      description: 'Report the structured classification of the message: the intent, any extracted actions, and the user-facing response_message.',
      input_schema: schema,
    }],
    tool_choice: { type: 'tool', name },
  };
}

function geminiResponseJsonSchema(schema = CLASSIFY_SCHEMA) {
  return schema; // responseJsonSchema accepts standard JSON Schema verbatim
}

function openaiResponseFormat(schema = CLASSIFY_SCHEMA, name = 'classification') {
  // strict:false on purpose — see the dialect note in the header.
  return { type: 'json_schema', json_schema: { name, schema, strict: false } };
}

module.exports = {
  CLASSIFY_SCHEMA,
  INTENTS,
  anthropicForcedTool,
  geminiResponseJsonSchema,
  openaiResponseFormat,
};
