#!/usr/bin/env node
/**
 * preview-email.js - render any transactional email to an HTML file
 * for browser preview, without actually sending anything.
 *
 * Works by monkey-patching the `postmark` package BEFORE
 * src/services/email.js requires it: we substitute a stub ServerClient
 * whose sendEmail method captures the payload in-memory instead of
 * hitting Postmark's API. From email.js's perspective Postmark is
 * configured and working, so every code path runs exactly as it would
 * in production - the result you see in the browser is byte-identical
 * to what real users get.
 *
 * Usage:
 *   node scripts/preview-email.js                # default: WhatsApp followup
 *   node scripts/preview-email.js followup       # WhatsApp T+24h re-engagement
 *   node scripts/preview-email.js verify         # email verification
 *
 * Writes /tmp/email-preview-<type>.html and (on macOS) opens it in the
 * default browser. On other platforms just prints the path.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const Module = require('module');

// ── Sample fixtures ────────────────────────────────────────────────
// Kept here so the script can run with zero env / DB / network deps.
const SAMPLES = {
  name: 'Grant Shapiro',
  email: 'preview@housemait.com',
  verificationToken: 'preview-token-no-side-effects',
};

// ── Stub Postmark BEFORE requiring email.js ────────────────────────
let captured = null;
const originalRequire = Module.prototype.require;
Module.prototype.require = function patchedRequire(name) {
  if (name === 'postmark') {
    return {
      ServerClient: class {
        async sendEmail(payload) {
          captured = payload;
        }
      },
    };
  }
  return originalRequire.apply(this, arguments);
};

// Make email.js think Postmark is configured. The token value never
// reaches Postmark - it's only checked for truthiness inside email.js.
process.env.POSTMARK_SERVER_TOKEN = process.env.POSTMARK_SERVER_TOKEN || 'preview-stub';
// WEB_URL is baked into the verify link + footer.
process.env.WEB_URL = process.env.WEB_URL || 'https://housemait.com';

const email = require(path.resolve(__dirname, '..', 'src', 'services', 'email'));

const RENDERERS = {
  followup: () => email.sendWhatsAppFollowupEmail(SAMPLES.email, SAMPLES.name),
  verify:   () => email.sendVerificationEmail(SAMPLES.email, SAMPLES.name, SAMPLES.verificationToken),
};

(async () => {
  const type = (process.argv[2] || 'followup').toLowerCase();
  const render = RENDERERS[type];
  if (!render) {
    console.error(`Unknown email type "${type}". Available: ${Object.keys(RENDERERS).join(', ')}`);
    process.exit(1);
  }

  await render();

  if (!captured) {
    console.error('No email captured - the renderer may have errored silently.');
    process.exit(1);
  }

  const outPath = path.join('/tmp', `email-preview-${type}.html`);
  fs.writeFileSync(outPath, captured.HtmlBody);

  console.log('');
  console.log(`Subject:  ${captured.Subject}`);
  console.log(`From:     ${captured.From}`);
  console.log(`To:       ${captured.To}`);
  console.log(`Wrote:    ${outPath}`);
  console.log('');

  // Best-effort browser open on macOS. On Linux/Windows just print the
  // path - opening behaviour varies enough that I'd rather not surprise
  // the user with a weird default.
  if (process.platform === 'darwin') {
    spawn('open', [outPath], { stdio: 'ignore', detached: true }).unref();
    console.log('(opened in your default browser)');
  } else {
    console.log('Open it in a browser to view.');
  }
})().catch((err) => {
  console.error('Preview failed:', err.message);
  process.exit(1);
});
