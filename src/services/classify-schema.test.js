/**
 * classify-schema: the canonical strict JSON Schema for BOT_PIPELINE=v2.
 *
 * Guards three things:
 *  1. The dialect invariants learned from LIVE API rejections (2026-07-10):
 *     Anthropic caps union-typed parameters (type arrays / anyOf) at 16 and
 *     rejects enum+type-array combos — so this schema must contain ZERO
 *     unions, with optionality expressed by omission from `required`.
 *  2. Closed objects: additionalProperties:false everywhere, required ⊆ keys.
 *  3. Lockstep with the prose prompt: the intent enum here must equal the
 *     intent enum in prompts.js — drift means the model can be forced into
 *     an intent the dispatch doesn't handle (or vice versa).
 */

const { CLASSIFY_SCHEMA, INTENTS, anthropicForcedTool, geminiResponseJsonSchema, openaiResponseFormat } = require('./classify-schema');
const { CLASSIFICATION_SYSTEM } = require('./prompts');

// Recursively collect every schema node.
function allNodes(node, out = []) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return out;
  out.push(node);
  if (node.properties) for (const v of Object.values(node.properties)) allNodes(v, out);
  if (node.items) allNodes(node.items, out);
  if (Array.isArray(node.anyOf)) for (const v of node.anyOf) allNodes(v, out);
  return out;
}
const objectNodes = () => allNodes(CLASSIFY_SCHEMA).filter((n) => n.type === 'object');

describe('dialect invariants (live Anthropic constraints)', () => {
  test('ZERO union-typed parameters (Anthropic caps them at 16; we need ~40 optionals)', () => {
    const unions = allNodes(CLASSIFY_SCHEMA).filter(
      (n) => Array.isArray(n.type) || Array.isArray(n.anyOf) || (Array.isArray(n.enum) && n.enum.includes(null))
    );
    expect(unions).toHaveLength(0);
  });

  test('no __optional markers leak into the emitted schema', () => {
    expect(JSON.stringify(CLASSIFY_SCHEMA)).not.toContain('__optional');
  });

  test('every object node closes additionalProperties and required ⊆ keys', () => {
    const nodes = objectNodes();
    expect(nodes.length).toBeGreaterThan(5);
    for (const n of nodes) {
      expect(n.additionalProperties).toBe(false);
      for (const r of n.required) expect(Object.keys(n.properties)).toContain(r);
    }
  });

  test('optionality via omission: intent/response_message required, payloads optional', () => {
    expect(CLASSIFY_SCHEMA.required).toContain('intent');
    expect(CLASSIFY_SCHEMA.required).toContain('response_message');
    expect(CLASSIFY_SCHEMA.required).not.toContain('calendar_event');
    expect(CLASSIFY_SCHEMA.required).not.toContain('target');
    expect(CLASSIFY_SCHEMA.required).not.toContain('query_start');
  });

  test('top level carries every field the dispatch reads', () => {
    for (const key of [
      'intent', 'shopping_items', 'tasks', 'calendar_event', 'target', 'updates',
      'note', 'recipe_request', 'school_activity', 'subscription', 'preferences',
      'web_search_query', 'query_start', 'query_end', 'response_message',
    ]) {
      expect(CLASSIFY_SCHEMA.properties[key]).toBeDefined();
    }
  });
});

describe('lockstep with the prose prompt', () => {
  test('schema intent enum equals the prompt intent enum exactly', () => {
    // The prompt declares the enum on its "intent": line — extract the quoted
    // values so drift in EITHER file fails this test.
    const line = CLASSIFICATION_SYSTEM.split('\n').find((l) => l.trim().startsWith('"intent":'));
    expect(line).toBeDefined();
    const promptIntents = [...line.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).filter((v) => v !== 'intent');
    expect(new Set(INTENTS)).toEqual(new Set(promptIntents));
  });

  test('CLASSIFICATION_SYSTEM stays placeholder-free (prompt-cache invariant)', () => {
    // The static rules block is served from the provider prompt cache, which
    // only hits when the block is byte-identical across calls and households.
    // A {{PLACEHOLDER}} sneaking back in silently kills the cache (and the
    // ~90% input-price discount) without breaking anything functionally —
    // dynamic values belong in CLASSIFICATION_CONTEXT.
    const { CLASSIFICATION_CONTEXT } = require('./prompts');
    expect(CLASSIFICATION_SYSTEM).not.toMatch(/{{[A-Z_]+}}/);
    for (const ph of ['{{DATE}}', '{{MEMBERS}}', '{{SENDER}}', '{{NOTES}}', '{{PREFERENCES}}', '{{CALENDAR_EVENTS}}', '{{TASKS}}', '{{SCHOOL_TERM_DATES}}', '{{EXTRA_CONTEXT}}']) {
      expect(CLASSIFICATION_CONTEXT).toContain(ph);
    }
  });
});

describe('provider adapters', () => {
  test('anthropic: forced-tool wrapper carries the FULL schema (tool_use.input = parsed JSON by contract)', () => {
    const ft = anthropicForcedTool();
    expect(ft.tool_choice).toEqual({ type: 'tool', name: 'classification' });
    expect(ft.tools).toHaveLength(1);
    expect(ft.tools[0].name).toBe('classification');
    expect(ft.tools[0].input_schema).toBe(CLASSIFY_SCHEMA);
  });
  test('gemini: schema passes through verbatim', () => {
    expect(geminiResponseJsonSchema()).toBe(CLASSIFY_SCHEMA);
  });
  test('openai: json_schema wrapper with strict:false (dialect conflict, see header)', () => {
    const rf = openaiResponseFormat();
    expect(rf.type).toBe('json_schema');
    expect(rf.json_schema.strict).toBe(false);
    expect(rf.json_schema.schema).toBe(CLASSIFY_SCHEMA);
  });
});
