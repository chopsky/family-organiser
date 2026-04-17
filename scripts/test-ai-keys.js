#!/usr/bin/env node
/**
 * Smoke-test both AI provider keys by hitting each one directly
 * (bypassing the failover chain).
 *
 * Run locally:   node scripts/test-ai-keys.js
 * Run on Railway: railway run node scripts/test-ai-keys.js
 *
 * The Railway version uses the production env vars, which is what you want
 * when you've just rotated a key in the Railway dashboard.
 */

require('dotenv').config();
const { callGemini, callClaude } = require('../src/services/ai-client');

const testOpts = {
  system: 'You are a test. Reply with the single word OK.',
  messages: [{ role: 'user', content: 'ping' }],
  maxTokens: 10,
};

async function run() {
  // Gemini
  process.stdout.write('Gemini: ');
  if (!process.env.GEMINI_API_KEY) {
    console.log('⚠️  GEMINI_API_KEY not set');
  } else {
    try {
      const t0 = Date.now();
      const { text } = await callGemini(testOpts);
      console.log(`✅  ${Date.now() - t0}ms — "${text.trim().slice(0, 40)}"`);
    } catch (err) {
      console.log(`❌  ${err.status || ''} ${err.message}`);
    }
  }

  // Claude
  process.stdout.write('Claude: ');
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('⚠️  ANTHROPIC_API_KEY not set');
  } else {
    try {
      const t0 = Date.now();
      const { text } = await callClaude(testOpts);
      console.log(`✅  ${Date.now() - t0}ms — "${text.trim().slice(0, 40)}"`);
    } catch (err) {
      console.log(`❌  ${err.status || ''} ${err.message}`);
    }
  }
}

run().catch((err) => {
  console.error('Script error:', err);
  process.exit(1);
});
