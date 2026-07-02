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

/**
 * Call Gemini 3.1 Pro. Returns { text, provider }.
 * Converts Claude-style messages to Gemini format.
 */
async function callGemini({ system, messages, maxTokens = 2048, timeoutMs, responseFormat, useThinking = true }) {
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
      systemInstruction: system,
      maxOutputTokens: maxTokens,
    };
    if (responseFormat === 'json') {
      config.responseMimeType = 'application/json';
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

    return { text, provider: 'gemini' };
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
async function callClaude({ system, messages, maxTokens = 2048, timeoutMs, useThinking = false, tools, model }) {
  const client = getAnthropicClient();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || DEFAULT_TIMEOUT_MS);

  try {
    const params = {
      model: model || CLAUDE_MODEL,
      max_tokens: maxTokens,
      system,
      messages,
    };

    if (useThinking) {
      params.thinking = { type: 'adaptive' };
    }

    if (Array.isArray(tools) && tools.length > 0) {
      params.tools = tools;
    }

    const stream = client.messages.stream(params, { signal: controller.signal });

    const response = await stream.finalMessage();
    clearTimeout(timer);

    // Concatenate ALL text blocks. With tools enabled the model can
    // produce multiple text blocks interleaved with server_tool_use
    // and web_search_tool_result blocks; the visible answer can be
    // split across them. Joining preserves the full synthesis.
    const textBlocks = response.content.filter((b) => b.type === 'text');
    if (textBlocks.length === 0) throw new Error('No text in Claude response');
    const text = textBlocks.map(b => b.text).join('\n').trim();

    return { text, provider: 'claude' };
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

/**
 * Call GPT-4o as fallback. Returns { text, provider }.
 * Converts Claude-style messages to OpenAI format.
 */
async function callGPT({ system, messages, maxTokens = 2048 }) {
  const client = getOpenAIClient();

  const gptMessages = [{ role: 'system', content: system }];

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

  const response = await client.chat.completions.create({
    model: GPT_MODEL,
    max_tokens: maxTokens,
    messages: gptMessages,
  });

  const text = response.choices?.[0]?.message?.content;
  if (!text) throw new Error('No text in GPT response');

  return { text, provider: 'gpt-4o' };
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
function logAiUsage({ householdId, userId, provider, model, feature, latencyMs, isFailover, error }) {
  supabase
    .from('ai_usage_log')
    .insert({
      household_id: householdId || null,
      user_id: userId || null,
      provider,
      model,
      feature: feature || 'unknown',
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
      logAiUsage({ householdId, userId, provider: 'claude', model: CLAUDE_MODEL, feature, latencyMs: Date.now() - claudeStart, isFailover: false });
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
        logAiUsage({ householdId, userId, provider: 'gemini', model: GEMINI_MODEL, feature, latencyMs: Date.now() - geminiStart, isFailover: true });
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
        logAiUsage({ householdId, userId, provider: 'gpt-4o', model: GPT_MODEL, feature, latencyMs: Date.now() - gptStart, isFailover: true });
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
      logAiUsage({ householdId, userId, provider: 'gemini', model: GEMINI_MODEL, feature, latencyMs: Date.now() - geminiStart, isFailover: false });
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
    logAiUsage({ householdId, userId, provider: 'claude', model: CLAUDE_MODEL, feature, latencyMs: Date.now() - claudeStart, isFailover: attempt > 0 });
    return result;
  } catch (err) {
    if (isTransient(err) && process.env.OPENAI_API_KEY) {
      console.warn(`[ai-failover] Claude failed (${err.message || err.code}), falling back to GPT-4o`);
      const gptStart = Date.now();
      try {
        const result = await callGPT(opts);
        logAiUsage({ householdId, userId, provider: 'gpt-4o', model: GPT_MODEL, feature, latencyMs: Date.now() - gptStart, isFailover: true });
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
  GEMINI_MODEL,
  CLAUDE_MODEL,
  CLAUDE_HAIKU_MODEL,
  GPT_MODEL,
  LONG_TIMEOUT_MS,
};
