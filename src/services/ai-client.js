/**
 * Unified AI client with automatic failover from Claude to GPT-4o.
 *
 * Primary: Claude (Anthropic) — better tone, extended thinking
 * Fallback: GPT-4o (OpenAI) — used when Claude is down or slow
 */
require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');

const CLAUDE_MODEL = 'claude-sonnet-4-6';
const GPT_MODEL = 'gpt-4o';
const DEFAULT_TIMEOUT_MS = 8000; // abort Claude after 8s for chat
const LONG_TIMEOUT_MS = 30000;   // 30s for complex tasks (imports, scraping)

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
 * Call Claude with a timeout. Returns { text, provider }.
 */
async function callClaude({ system, messages, maxTokens = 2048, timeoutMs }) {
  const client = getAnthropicClient();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || DEFAULT_TIMEOUT_MS);

  try {
    const stream = client.messages.stream(
      {
        model: CLAUDE_MODEL,
        max_tokens: maxTokens,
        thinking: { type: 'adaptive' },
        system,
        messages,
      },
      { signal: controller.signal }
    );

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

  // Build OpenAI-style messages
  const gptMessages = [{ role: 'system', content: system }];

  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      gptMessages.push({ role: msg.role, content: msg.content });
    } else if (Array.isArray(msg.content)) {
      // Convert Claude content blocks to OpenAI format
      const parts = msg.content.map((block) => {
        if (block.type === 'text') {
          return { type: 'text', text: block.text };
        } else if (block.type === 'image') {
          // Claude: { type: 'base64', media_type, data }
          // OpenAI: { type: 'image_url', image_url: { url: 'data:mime;base64,...' } }
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
 * Tries Claude first; if it fails with a transient error or times out, falls back to GPT-4o.
 *
 * @param {object} opts
 * @param {string} opts.system - System prompt
 * @param {Array} opts.messages - Claude-format messages (works for both providers)
 * @param {number} [opts.maxTokens=2048]
 * @returns {Promise<{ text: string, provider: string }>}
 */
async function callWithFailover(opts) {
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
  callClaude,
  callGPT,
  isTransient,
  CLAUDE_MODEL,
  GPT_MODEL,
  LONG_TIMEOUT_MS,
};
