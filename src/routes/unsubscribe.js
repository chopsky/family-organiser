/**
 * Unsubscribe endpoint — Phase 7.
 *
 * Handles two things:
 *   1. One-click clicks from the footer link in broadcast emails.
 *   2. Gmail / Apple Mail one-click-unsubscribe POSTs, triggered by the
 *      List-Unsubscribe / List-Unsubscribe-Post headers the emails
 *      carry (RFC 8058). The email client sends a plain POST to the
 *      same URL with `List-Unsubscribe=One-Click` in the body.
 *
 * Both shapes land on the same route. GET shows a friendly HTML page;
 * POST returns a bare 200 (Gmail doesn't render a response to the user).
 *
 * No bearer auth — the URL itself IS the credential (JWT signed with
 * UNSUBSCRIBE_TOKEN_SECRET, 90-day expiry). The app-level
 * subscriptionStatus gate already excludes /api/webhooks but NOT
 * /api/unsubscribe — we need to mount this router BEFORE the gate in
 * app.js so expired households (who would naturally be the ones
 * clicking an unsubscribe link) can still reach it on a POST from a
 * mail client.
 */

const { Router } = require('express');
const db = require('../db/queries');
const { verifyToken } = require('../services/unsubscribe-token');

const router = Router();

// Confirmation HTML served on GET. Deliberately minimal + no JS so it
// renders in "view in browser" and old email clients.
function confirmationPage({ success, householdName }) {
  const inner = success
    ? `
        <h1 style="color:#2D2A33;margin:0 0 12px;font-size:22px;font-family:'Instrument Serif',Lora,Georgia,serif;font-weight:600;letter-spacing:-0.02em;">You've unsubscribed</h1>
        <p style="color:#374151;line-height:1.6;font-size:16px;margin:0 0 8px;">
          We won't send ${householdName ? `<strong>${householdName}</strong>` : 'your household'} any more trial reminder emails.
        </p>
        <p style="color:#6B6774;line-height:1.6;font-size:14px;margin:0 0 20px;">
          You'll still get important account emails (like your trial ending notice) — those aren't optional.
          To turn reminders back on later, open Settings in Housemait and flip the
          <em>"Trial reminder emails"</em> toggle.
        </p>
        <a href="${process.env.WEB_URL || 'https://www.housemait.com'}" style="display:inline-block;background:#6B3FA0;color:#fff;text-decoration:none;padding:12px 28px;border-radius:12px;font-weight:600;font-size:14px;">Back to Housemait</a>`
    : `
        <h1 style="color:#2D2A33;margin:0 0 12px;font-size:22px;font-family:'Instrument Serif',Lora,Georgia,serif;font-weight:600;letter-spacing:-0.02em;">Link expired or invalid</h1>
        <p style="color:#374151;line-height:1.6;font-size:16px;margin:0 0 20px;">
          This unsubscribe link doesn't look right. It may have expired
          (links are valid for 90 days), or been copied incorrectly.
        </p>
        <p style="color:#6B6774;line-height:1.6;font-size:14px;margin:0 0 20px;">
          You can turn off trial reminder emails from Settings in Housemait at any time.
        </p>
        <a href="${process.env.WEB_URL || 'https://www.housemait.com'}/settings" style="display:inline-block;background:#6B3FA0;color:#fff;text-decoration:none;padding:12px 28px;border-radius:12px;font-weight:600;font-size:14px;">Open Settings</a>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${success ? 'Unsubscribed' : 'Link invalid'} · Housemait</title></head>
<body style="margin:0;padding:0;background:#FBF8F3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:480px;margin:60px auto;background:#fff;border-radius:16px;padding:32px 28px;box-shadow:0 2px 8px rgba(107,63,160,0.06);text-align:center;">
    <img src="${process.env.WEB_URL || 'https://www.housemait.com'}/housemait-logomark.png" alt="Housemait" height="40" style="margin-bottom:20px;border-radius:8px;">
    ${inner}
  </div>
</body></html>`;
}

async function processUnsubscribe(token) {
  const householdId = verifyToken(token); // throws on bad/expired/wrong-audience token
  const updated = await db.setTrialEmailsEnabled(householdId, false);
  return updated;
}

/**
 * GET /api/unsubscribe?token=...
 * Renders an HTML confirmation page.
 */
router.get('/', async (req, res) => {
  const token = req.query.token;
  if (!token) {
    return res.status(400).type('html').send(confirmationPage({ success: false }));
  }
  try {
    await processUnsubscribe(token);
    return res.status(200).type('html').send(confirmationPage({ success: true }));
  } catch (err) {
    console.warn('[unsubscribe] token rejected:', err.message);
    return res.status(400).type('html').send(confirmationPage({ success: false }));
  }
});

/**
 * POST /api/unsubscribe?token=...
 * Spec-compliant endpoint for RFC 8058 one-click unsubscribe (Gmail,
 * Apple Mail). Returns 200 with no body on success — the email client
 * doesn't render a response.
 */
router.post('/', async (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(400).json({ error: 'token required' });
  try {
    await processUnsubscribe(token);
    return res.status(200).end();
  } catch (err) {
    console.warn('[unsubscribe] POST token rejected:', err.message);
    return res.status(400).json({ error: 'invalid or expired token' });
  }
});

module.exports = router;
