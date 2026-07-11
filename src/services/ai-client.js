/**
 * Unified AI client with automatic failover.
 *
 * Primary: Gemini 2.5 Flash (Google) - fast, smart, great value
 * Fallback 1: Claude (Anthropic) - excellent tone, structured output
 * Fallback 2: GPT-4o (OpenAI) - reliable backup
 */
require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');
const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');
const { supabaseAdmin: supabase } = require('../db/client');

const GEMINI_MODEL = 'gemini-2.5-flash';
// Sonnet 5 runs adaptive thinking by default (the model decides per-message
// how much to reason before answering) - thinking tokens count against
// max_tokens, so callers that expect long outputs need headroom.
const CLAUDE_MODEL = 'claude-sonnet-5';
// Cheap Claude tier (~1/4 the input price of Sonnet). For simple, high-volume
// calls where Sonnet is overkill - e.g. "return one URL" or "copy dates out of
// these search results". callClaude accepts a `model` override to opt in.
const CLAUDE_HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const GPT_MODEL = 'gpt-4o';
const DEFAULT_TIMEOUT_MS = 12000; // abort after 12s for chat
const LONG_TIMEOUT_MS = 30000;   // 30s for complex tasks (imports, scraping)
// Reasoning-mode tasks (Claude with adaptive thinking on a long PDF or
// website body) can legitimately run past 30s — extending headroom so
// the abort doesn't kill an in-flight response just before it finishes.
const REASONING_TIMEOUT_MS = 90000;

function getGeminiClient() {
  return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
}

function getAnthropicClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

function getOpenAIClient() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

/**
 * Detect if an error is transient (worth failing over for).
 */
function isTransient(err) {
  return (
    err.emptyResponse === true ||
    err.status === 429 ||
    err.status === 529 ||
    err.error?.type === 'overloaded_error' ||
    err.message?.includes('overloaded') ||
    err.message?.includes('Overloaded') ||
    err.name === 'AbortError' ||
    err.code === 'ECONNRESET' ||
    err.code === 'ETIMEDOUT' ||
    err.code === 'ECONNABORTED' ||
    err.message?.includes('timeout') ||
    err.message?.includes('Timeout')
  );
}

// A 200 with empty text is not a usable completion — Claude occasionally does
// this on an all-thinking turn or a soft refusal, and it surfaced as "the AI
// replied in a format I couldn't read" (parseJSON('') throws). Throw instead of
// returning "" so callWithFailover's existing try/catch moves to the next
// provider (e.g. Gemini). Tagged emptyResponse so isTransient() routes the
// Claude→GPT path too. Every provider funnels its return through here.
function finalizeResult(text, provider, usage) {
  if (typeof text !== 'string' || text.trim() === '') {
    const err = new Error(`${provider} returned an empty response`);
    err.emptyResponse = true;
    throw err;
  }
  return { text, provider, usage: usage || null };
}

/**
 * Normalise per-provider usage metadata to { inputTokens, outputTokens,
 * cacheReadTokens, cacheWriteTokens }. inputTokens is the TOTAL prompt size
 * (uncached + cache reads + cache writes) so the ai_usage_log column reads as
 * "how big was this request", independent of cache billing discounts.
 */
function normalizeClaudeUsage(u) {
  if (!u) return null;
  const cacheRead = u.cache_read_input_tokens || 0;
  const cacheWrite = u.cache_creation_input_tokens || 0;
  return {
    inputTokens: (u.input_tokens || 0) + cacheRead + cacheWrite,
    outputTokens: u.output_tokens || 0,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
  };
}

function normalizeGeminiUsage(u) {
  if (!u) return null;
  return {
    inputTokens: u.promptTokenCount || 0,
    // Gemini bills "thinking" as output; fold it in so output_tokens is spend-true.
    outputTokens: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0),
    cacheReadTokens: u.cachedContentTokenCount || 0,
    cacheWriteTokens: 0,
  };
}

function normalizeGptUsage(u) {
  if (!u) return null;
  return {
    inputTokens: u.prompt_tokens || 0,
    outputTokens: u.completion_tokens || 0,
    cacheReadTokens: u.prompt_tokens_details?.cached_tokens || 0,
    cacheWriteTokens: 0,
  };
}

/**
 * `system` may be a plain string or an array of { text, cache? } blocks —
 * static-and-cacheable content first, per-call dynamic content after.
 * Anthropic gets real cache_control breakpoints; Gemini and OpenAI cache
 * matching prefixes automatically, so for them the blocks just join.
 */
function systemToText(system) {
  return Array.isArray(system) ? system.map((b) => b.text).join('\n\n') : system;
}

function systemToAnthropic(system) {
  if (!Array.isArray(system)) return system;
  return system.map((b) => (
    b.cache
      ? { type: 'text', text: b.text, cache_control: { type: 'ephemeral' } }
      : { type: 'text', text: b.text }
  ));
}

/**
 * Call Gemini 3.1 Pro. Returns { text, provider }.
 * Converts Claude-style messages to Gemini format.
 */
async function callGemini({ system, messages, maxTokens = 2048, timeoutMs, responseFormat, responseSchema, useThinking = true }) {
  const client = getGeminiClient();
  const timeout = timeoutMs || DEFAULT_TIMEOUT_MS;

  // Build Gemini contents from Claude-style messages
  const contents = [];
  for (const msg of messages) {
    const role = msg.role === 'assistant' ? 'model' : 'user';
    if (typeof msg.content === 'string') {
      contents.push({ role, parts: [{ text: msg.content }] });
    } else if (Array.isArray(msg.content)) {
      const parts = msg.content.map((block) => {
        if (block.type === 'text') {
          return { text: block.text };
        } else if (block.type === 'image') {
          return {
            inlineData: {
              mimeType: block.source.media_type,
              data: block.source.data,
            },
          };
        }
        return { text: JSON.stringify(block) };
      });
      contents.push({ role, parts });
    }
  }

  // Use AbortController for timeout
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    // Force JSON output when the caller explicitly asks for it. Without this
    // Gemini occasionally emits conversational prose ("My apologies…",
    // "You would…") on meta or apologetic turns, bypassing the system-prompt
    // instruction and tripping downstream parseJSON. With responseMimeType
    // set, Gemini guarantees valid JSON at the API level.
    const config = {
      systemInstruction: systemToText(system),
      maxOutputTokens: maxTokens,
    };
    if (responseFormat === 'json') {
      config.responseMimeType = 'application/json';
    }
    // Strict structured outputs: a standard JSON Schema the API enforces —
    // the model cannot return JSON that doesn't validate. responseJsonSchema
    // takes precedence over responseMimeType alone (@google/genai 1.46+).
    if (responseSchema) {
      config.responseMimeType = 'application/json';
      config.responseJsonSchema = responseSchema;
    }
    // Gemini 2.5 Flash has thinking ON by default and the thinking
    // budget eats into maxOutputTokens. For mechanical tasks like
    // structured extraction or classification, callers should pass
    // useThinking: false - otherwise the model can burn 5-7k tokens
    // "thinking" and run out before finishing the JSON output. (Seen
    // in the wild on the school year-planner extraction: response
    // truncated mid-array at ~2k chars even with maxTokens=8192.)
    if (useThinking === false) {
      config.thinkingConfig = { thinkingBudget: 0 };
    }

    const response = await client.models.generateContent({
      model: GEMINI_MODEL,
      contents,
      config,
    }, { signal: controller.signal });

    clearTimeout(timer);

    const text = response.text;
    if (!text) throw new Error('No text in Gemini response');

    return finalizeResult(text, 'gemini', normalizeGeminiUsage(response.usageMetadata));
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

/**
 * Call Claude with a timeout. Returns { text, provider }.
 *
 * Optional `tools` accepts Anthropic tool definitions - currently used
 * for the native web_search tool (web_search_20250305). When tools are
 * enabled the model can invoke them server-side; the response still
 * contains a final text block which is what we extract here.
 */
async function callClaude({ system, messages, maxTokens = 2048, timeoutMs, useThinking = false, tools, model, responseSchema }) {
  const client = getAnthropicClient();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || DEFAULT_TIMEOUT_MS);

  try {
    const params = {
      model: model || CLAUDE_MODEL,
      max_tokens: maxTokens,
      system: systemToAnthropic(system),
      messages,
    };

    if (useThinking) {
      params.thinking = { type: 'adaptive' };
    }

    if (Array.isArray(tools) && tools.length > 0) {
      params.tools = tools;
    }

    // Structured output via FORCED TOOL USE: tool_use.input arrives as
    // parsed JSON by API contract, so empty/prose/malformed output is
    // protocol-impossible. (output_config structured outputs could not fit
    // this schema — its grammar compiler caps unions at 16 and optionals at
    // 24 and bans open objects; see classify-schema.js for the live
    // rejections.) Only engaged when the caller passed no other tools —
    // forced tool_choice would block e.g. web_search from running.
    const forcedTool = responseSchema && !(Array.isArray(tools) && tools.length > 0);
    if (forcedTool) {
      params.tools = [{
        name: 'classification',
        description: 'Report the structured classification of the message. ALWAYS include the intent field and the user-facing response_message, plus any extracted actions.',
        input_schema: responseSchema,
      }];
      params.tool_choice = { type: 'tool', name: 'classification' };
    }

    const stream = client.messages.stream(params, { signal: controller.signal });

    const response = await stream.finalMessage();
    clearTimeout(timer);

    const usage = normalizeClaudeUsage(response.usage);

    if (forcedTool) {
      const toolUse = response.content.find((b) => b.type === 'tool_use');
      if (toolUse && toolUse.input && typeof toolUse.input === 'object') {
        // Serialise back to text so the caller's parse path stays the single
        // funnel (parseJSON is now a plain parse of known-good JSON).
        return finalizeResult(JSON.stringify(toolUse.input), 'claude', usage);
      }
      // Defensive: forced tool_choice should make this unreachable, but fall
      // through to text extraction rather than assume.
    }

    // Concatenate ALL text blocks. With tools enabled the model can
    // produce multiple text blocks interleaved with server_tool_use
    // and web_search_tool_result blocks; the visible answer can be
    // split across them. Joining preserves the full synthesis.
    const textBlocks = response.content.filter((b) => b.type === 'text');
    if (textBlocks.length === 0) throw new Error('No text in Claude response');
    const text = textBlocks.map(b => b.text).join('\n').trim();

    return finalizeResult(text, 'claude', usage);
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

/**
 * Call GPT-4o as fallback. Returns { text, provider }.
 * Converts Claude-style messages to OpenAI format.
 */
async function callGPT({ system, messages, maxTokens = 2048, timeoutMs, responseSchema }) {
  const client = getOpenAIClient();
  // Same abort pattern as callClaude/callGemini. Without it a stalled OpenAI
  // connection hung this call forever — the only provider with no timeout.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || DEFAULT_TIMEOUT_MS);

  const gptMessages = [{ role: 'system', content: systemToText(system) }];

  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      gptMessages.push({ role: msg.role, content: msg.content });
    } else if (Array.isArray(msg.content)) {
      const parts = msg.content.map((block) => {
        if (block.type === 'text') {
          return { type: 'text', text: block.text };
        } else if (block.type === 'image') {
          const dataUrl = `data:${block.source.media_type};base64,${block.source.data}`;
          return { type: 'image_url', image_url: { url: dataUrl } };
        }
        return { type: 'text', text: JSON.stringify(block) };
      });
      gptMessages.push({ role: msg.role, content: parts });
    }
  }

  try {
    const gptParams = {
      model: GPT_MODEL,
      max_tokens: maxTokens,
      messages: gptMessages,
    };
    // json_schema guidance with strict:false — OpenAI's strict mode demands
    // the all-required/nullable dialect that Anthropic's union cap forbids
    // (see classify-schema.js header). GPT is the rare double-failover, and
    // parseJSON stays as the belt-and-braces on this path.
    if (responseSchema) {
      gptParams.response_format = {
        type: 'json_schema',
        json_schema: { name: 'classification', schema: responseSchema, strict: false },
      };
    }
    const response = await client.chat.completions.create(gptParams, { signal: controller.signal });

    const text = response.choices?.[0]?.message?.content;
    if (!text) throw new Error('No text in GPT response');

    return finalizeResult(text, 'gpt-4o', normalizeGptUsage(response.usage));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Call AI with automatic failover.
 * Tries Gemini first; if it fails, falls back to Claude, then GPT-4o.
 *
 * @param {object} opts
 * @param {string} opts.system - System prompt
 * @param {Array} opts.messages - Claude-format messages (works for all providers)
 * @param {number} [opts.maxTokens=2048]
 * @returns {Promise<{ text: string, provider: string }>}
 */
/**
 * Fire-and-forget: log AI usage to the ai_usage_log table.
 */
function logAiUsage({ householdId, userId, provider, model, feature, latencyMs, isFailover, error, usage }) {
  // Cache hit/miss detail has no table columns — surface it in the Railway
  // logs so a prompt-caching change is verifiable in prod without a migration.
  if (usage && (usage.cacheReadTokens || usage.cacheWriteTokens)) {
    console.log(`[ai-usage] ${provider} ${feature}: in=${usage.inputTokens} out=${usage.outputTokens} cache_read=${usage.cacheReadTokens} cache_write=${usage.cacheWriteTokens}`);
  }
  supabase
    .from('ai_usage_log')
    .insert({
      household_id: householdId || null,
      user_id: userId || null,
      provider,
      model,
      feature: feature || 'unknown',
      input_tokens: usage ? usage.inputTokens : null,
      output_tokens: usage ? usage.outputTokens : null,
      latency_ms: latencyMs,
      is_failover: isFailover || false,
      error: error || null,
    })
    .then(() => {})
    .catch((err) => console.error('[ai-log] Failed to log usage:', err.message));
}

async function callWithFailover(opts) {
  const { feature, householdId, userId, preferClaude } = opts;
  let attempt = 0;

  // High-stakes, low-volume features (school term-date extraction is the
  // canonical example) can pass preferClaude:true to flip the order:
  // Claude as primary, Gemini as failover. Gemini Flash is great for
  // chat-volume work but its date-reasoning slips show up here (off-by-
  // one weekdays, hallucinated extra rows). The per-call cost difference
  // is pennies; the user-visible cost of a wrong school closure date is
  // a parent showing up on a day school is shut.
  if (preferClaude) {
    const claudeStart = Date.now();
    try {
      const result = await callClaude(opts);
      logAiUsage({ householdId, userId, provider: 'claude', model: CLAUDE_MODEL, feature, latencyMs: Date.now() - claudeStart, isFailover: false, usage: result.usage });
      return result;
    } catch (err) {
      console.warn(`[ai-failover] Claude (primary) failed (${err.message || err.code}), falling back to Gemini`);
      logAiUsage({ householdId, userId, provider: 'claude', model: CLAUDE_MODEL, feature, latencyMs: Date.now() - claudeStart, isFailover: false, error: err.message || String(err.code) });
      attempt++;
    }
    if (process.env.GEMINI_API_KEY) {
      const geminiStart = Date.now();
      try {
        // Gemini Flash's "thinking" budget eats into maxOutputTokens and
        // can truncate JSON for long extractions. We turn it off here
        // even when the caller asked for thinking — that flag is for
        // Claude. Gemini is only here because Claude failed.
        const result = await callGemini({ ...opts, useThinking: false });
        logAiUsage({ householdId, userId, provider: 'gemini', model: GEMINI_MODEL, feature, latencyMs: Date.now() - geminiStart, isFailover: true, usage: result.usage });
        return result;
      } catch (err) {
        console.warn(`[ai-failover] Gemini (fallback) failed (${err.message || err.code}), trying GPT-4o`);
        logAiUsage({ householdId, userId, provider: 'gemini', model: GEMINI_MODEL, feature, latencyMs: Date.now() - geminiStart, isFailover: true, error: err.message || String(err.code) });
      }
    }
    if (process.env.OPENAI_API_KEY) {
      const gptStart = Date.now();
      try {
        const result = await callGPT(opts);
        logAiUsage({ householdId, userId, provider: 'gpt-4o', model: GPT_MODEL, feature, latencyMs: Date.now() - gptStart, isFailover: true, usage: result.usage });
        return result;
      } catch (gptErr) {
        logAiUsage({ householdId, userId, provider: 'gpt-4o', model: GPT_MODEL, feature, latencyMs: Date.now() - gptStart, isFailover: true, error: gptErr.message });
        throw gptErr;
      }
    }
    throw new Error('All AI providers failed');
  }

  // Try Gemini first (if API key is set)
  if (process.env.GEMINI_API_KEY) {
    const geminiStart = Date.now();
    try {
      const result = await callGemini(opts);
      logAiUsage({ householdId, userId, provider: 'gemini', model: GEMINI_MODEL, feature, latencyMs: Date.now() - geminiStart, isFailover: false, usage: result.usage });
      return result;
    } catch (err) {
      console.warn(`[ai-failover] Gemini failed (${err.message || err.code}), falling back to Claude`);
      logAiUsage({ householdId, userId, provider: 'gemini', model: GEMINI_MODEL, feature, latencyMs: Date.now() - geminiStart, isFailover: false, error: err.message || String(err.code) });
      attempt++;
    }
  }

  // Try Claude
  const claudeStart = Date.now();
  try {
    const result = await callClaude(opts);
    logAiUsage({ householdId, userId, provider: 'claude', model: CLAUDE_MODEL, feature, latencyMs: Date.now() - claudeStart, isFailover: attempt > 0, usage: result.usage });
    return result;
  } catch (err) {
    if (isTransient(err) && process.env.OPENAI_API_KEY) {
      console.warn(`[ai-failover] Claude failed (${err.message || err.code}), falling back to GPT-4o`);
      const gptStart = Date.now();
      try {
        const result = await callGPT(opts);
        logAiUsage({ householdId, userId, provider: 'gpt-4o', model: GPT_MODEL, feature, latencyMs: Date.now() - gptStart, isFailover: true, usage: result.usage });
        return result;
      } catch (gptErr) {
        console.error('[ai-failover] GPT-4o also failed:', gptErr.message);
        logAiUsage({ householdId, userId, provider: 'gpt-4o', model: GPT_MODEL, feature, latencyMs: Date.now() - gptStart, isFailover: true, error: gptErr.message });
        throw gptErr;
      }
    }
    logAiUsage({ householdId, userId, provider: 'claude', model: CLAUDE_MODEL, feature, latencyMs: Date.now() - claudeStart, isFailover: attempt > 0, error: err.message });
    throw err;
  }
}

module.exports = {
  callWithFailover,
  callGemini,
  callClaude,
  callGPT,
  REASONING_TIMEOUT_MS,
  isTransient,
  finalizeResult,
  systemToText,
  systemToAnthropic,
  normalizeClaudeUsage,
  normalizeGeminiUsage,
  normalizeGptUsage,
  GEMINI_MODEL,
  CLAUDE_MODEL,
  CLAUDE_HAIKU_MODEL,
  GPT_MODEL,
  LONG_TIMEOUT_MS,
};
