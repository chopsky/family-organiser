/**
 * Unified AI client with automatic failover.
 *
 * Primary: Gemini 2.5 Flash (Google) — fast, smart, great value
 * Fallback 1: Claude (Anthropic) — excellent tone, structured output
 * Fallback 2: GPT-4o (OpenAI) — reliable backup
 */
require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');
const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');

const GEMINI_MODEL = 'gemini-2.5-flash';
const CLAUDE_MODEL = 'claude-sonnet-4-6';
const GPT_MODEL = 'gpt-4o';
const DEFAULT_TIMEOUT_MS = 12000; // abort after 12s for chat
const LONG_TIMEOUT_MS = 30000;   // 30s for complex tasks (imports, scraping)

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
async function callGemini({ system, messages, maxTokens = 2048, timeoutMs }) {
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
    const response = await client.models.generateContent({
      model: GEMINI_MODEL,
      contents,
      config: {
        systemInstruction: system,
        maxOutputTokens: maxTokens,
      },
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
 */
async function callClaude({ system, messages, maxTokens = 2048, timeoutMs, useThinking = false }) {
  const client = getAnthropicClient();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || DEFAULT_TIMEOUT_MS);

  try {
    const params = {
      model: CLAUDE_MODEL,
      max_tokens: maxTokens,
      system,
      messages,
    };

    if (useThinking) {
      params.thinking = { type: 'adaptive' };
    }

    const stream = client.messages.stream(params, { signal: controller.signal });

    const response = await stream.finalMessage();
    clearTimeout(timer);

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock) throw new Error('No text in Claude response');

    return { text: textBlock.text, provider: 'claude' };
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
async function callWithFailover(opts) {
  // Try Gemini first (if API key is set)
  if (process.env.GEMINI_API_KEY) {
    try {
      return await callGemini(opts);
    } catch (err) {
      console.warn(`[ai-failover] Gemini failed (${err.message || err.code}), falling back to Claude`);
    }
  }

  // Try Claude
  try {
    return await callClaude(opts);
  } catch (err) {
    if (isTransient(err) && process.env.OPENAI_API_KEY) {
      console.warn(`[ai-failover] Claude failed (${err.message || err.code}), falling back to GPT-4o`);
      try {
        return await callGPT(opts);
      } catch (gptErr) {
        console.error('[ai-failover] GPT-4o also failed:', gptErr.message);
        throw gptErr;
      }
    }
    throw err;
  }
}

module.exports = {
  callWithFailover,
  callGemini,
  callClaude,
  callGPT,
  isTransient,
  GEMINI_MODEL,
  CLAUDE_MODEL,
  GPT_MODEL,
  LONG_TIMEOUT_MS,
};
