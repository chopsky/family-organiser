/**
 * Startup environment variable validation.
 * Called once at boot — logs warnings for missing optional vars,
 * throws for missing required vars so the process fails fast.
 */

const REQUIRED = [
  { key: 'JWT_SECRET', hint: 'Signs auth tokens — app cannot start without it' },
  { key: 'SUPABASE_URL', hint: 'Supabase project URL' },
  { key: 'SUPABASE_SERVICE_KEY', hint: 'Supabase service_role key (admin access)' },
];

const RECOMMENDED = [
  { key: 'SUPABASE_ANON_KEY', hint: 'Supabase anon key (needed when RLS is enabled)' },
  { key: 'GEMINI_API_KEY', hint: 'Primary AI provider (Gemini Flash)' },
  { key: 'POSTMARK_SERVER_TOKEN', hint: 'Transactional email (invites, verification)' },
  { key: 'POSTMARK_FROM_EMAIL', hint: 'From address for outbound email' },
  { key: 'WEB_URL', hint: 'Frontend URL for CORS and email links' },
  { key: 'API_URL', hint: 'Backend URL for OAuth callbacks and calendar feeds' },
  // Stripe — Phase 3. Recommended (not REQUIRED) so the app still boots
  // without them during local dev / in tests. Checkout and webhook routes
  // will surface their own errors if called while unset.
  { key: 'STRIPE_SECRET_KEY', hint: 'Stripe API secret (test or live) — needed for checkout + portal' },
  { key: 'STRIPE_WEBHOOK_SECRET', hint: 'Stripe webhook signing secret — needed to verify /api/webhooks/stripe' },
  { key: 'STRIPE_PRICE_MONTHLY', hint: 'Stripe Price ID for the £4.99/month plan' },
  { key: 'STRIPE_PRICE_ANNUAL', hint: 'Stripe Price ID for the £49/year plan' },
];

const OPTIONAL = [
  { key: 'ANTHROPIC_API_KEY', hint: 'AI failover provider (Claude)' },
  { key: 'OPENAI_API_KEY', hint: 'AI failover provider (GPT-4o) + transcription' },
  { key: 'GOOGLE_CLIENT_ID', hint: 'Google social login' },
  { key: 'APPLE_CLIENT_ID', hint: 'Apple social login' },
  { key: 'GOOGLE_CALENDAR_CLIENT_ID', hint: 'Google Calendar sync' },
  { key: 'GOOGLE_CALENDAR_CLIENT_SECRET', hint: 'Google Calendar sync' },
  { key: 'MICROSOFT_CLIENT_ID', hint: 'Microsoft Calendar sync' },
  { key: 'MICROSOFT_CLIENT_SECRET', hint: 'Microsoft Calendar sync' },
  { key: 'TWILIO_ACCOUNT_SID', hint: 'WhatsApp bot integration' },
  { key: 'TWILIO_AUTH_TOKEN', hint: 'WhatsApp bot integration' },
  { key: 'TWILIO_MESSAGING_SERVICE_SID', hint: 'WhatsApp messaging service' },
  { key: 'TWILIO_WHATSAPP_NUMBER', hint: 'WhatsApp sender number' },
  { key: 'FRONTEND_URL', hint: 'OAuth redirect URL (falls back to WEB_URL)' },
  { key: 'STRIPE_PUBLISHABLE_KEY', hint: 'Stripe publishable key — only needed if the frontend ever calls Stripe.js directly' },
];

function checkEnv() {
  const missing = [];
  const warnings = [];

  // Required — app cannot function without these
  for (const { key, hint } of REQUIRED) {
    if (!process.env[key]) {
      missing.push(`  ✗ ${key} — ${hint}`);
    }
  }

  // Recommended — app works but with reduced functionality
  for (const { key, hint } of RECOMMENDED) {
    if (!process.env[key]) {
      warnings.push(`  ⚠ ${key} — ${hint}`);
    }
  }

  // Optional — nice-to-have features
  const unsetOptional = OPTIONAL.filter(({ key }) => !process.env[key]);

  // Report
  if (missing.length > 0) {
    console.error('\n╔══════════════════════════════════════════╗');
    console.error('║  MISSING REQUIRED ENVIRONMENT VARIABLES  ║');
    console.error('╚══════════════════════════════════════════╝\n');
    console.error(missing.join('\n'));
    console.error('\nThese should be set in Railway / .env for the app to function correctly.\n');
    // Warn but don't crash — Railway injects env vars at container level
    // and they may appear missing during preload but be available at runtime
  }

  if (warnings.length > 0) {
    console.warn('\n⚠ Missing recommended environment variables:');
    console.warn(warnings.join('\n'));
    console.warn('  → Some features will be unavailable.\n');
  }

  if (unsetOptional.length > 0) {
    console.log(`ℹ ${unsetOptional.length} optional env var(s) not set (${unsetOptional.map(v => v.key).join(', ')})`);
  }

  console.log('✓ Environment check passed\n');
}

module.exports = { checkEnv };
