/**
 * Feedback routes.
 *
 *   POST /api/feedback       - the Settings "Something missing?" box. Auth'd.
 *   GET  /api/feedback/why   - one-tap answer from the day-3 email. Public;
 *                              the signed token in the URL is the credential.
 *
 * Mounted BEFORE the subscription gate on purpose: a household whose trial
 * has expired is exactly who we most want to hear from, and a 402 on the
 * feedback box would be self-defeating.
 *
 * Both paths email the founder immediately (ADMIN_ALERT_EMAIL) and write a
 * user_feedback row for the weekly digest. The email is the guaranteed
 * channel; the row is best-effort while migration-user-feedback.sql is
 * pending.
 */

const { Router } = require('express');
const db = require('../db/queries');
const email = require('../services/email');
const { requireAuth } = require('../middleware/auth');
const { SIGNUP_REASONS, verifyAnswerToken } = require('../services/feedback');

const router = Router();
const MAX_MESSAGE = 2000;
const MAX_CONTEXT = 120;

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function page({ title, body }) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{margin:0;background:#FBF8F3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#2D2A33}
.card{max-width:440px;margin:64px auto;background:#fff;border-radius:16px;padding:32px 28px;box-shadow:0 4px 16px rgba(107,63,160,.08)}
h1{font-size:22px;margin:0 0 12px}p{line-height:1.6;margin:0 0 12px}a{color:#6B3FA0}</style></head>
<body><div class="card"><h1>${esc(title)}</h1>${body}</div></body></html>`;
}

router.post('/', requireAuth, async (req, res) => {
  const message = String(req.body?.message || '').trim();
  const context = String(req.body?.context || '').trim().slice(0, MAX_CONTEXT);
  if (!message) return res.status(400).json({ error: 'Write a line first.' });
  if (message.length > MAX_MESSAGE) return res.status(400).json({ error: 'That is a bit long. Keep it under 2,000 characters.' });

  try {
    const user = await db.getUserById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    const stored = await db.insertUserFeedback({
      user_id: user.id,
      household_id: user.household_id || null,
      kind: 'app',
      message,
      context: context || null,
    });
    await email.sendUserFeedbackAlert({ user, message, context });
    return res.json({ ok: true, stored });
  } catch (err) {
    console.error('POST /api/feedback error:', err);
    return res.status(500).json({ error: 'Could not send that. Please try again.' });
  }
});

router.get('/why', async (req, res) => {
  const { token, a: answer } = req.query;
  let ids;
  try {
    ids = verifyAnswerToken(String(token || ''));
  } catch (err) {
    console.warn('[feedback] answer token rejected:', err.message);
    return res.status(400).type('html').send(page({
      title: 'That link has expired',
      body: '<p>No harm done. If you have a minute, reply to the email instead and tell me in a sentence.</p><p>Grant</p>',
    }));
  }
  if (!SIGNUP_REASONS[answer]) {
    return res.status(400).type('html').send(page({ title: 'That link is not quite right', body: '<p>Reply to the email instead and I will read it.</p>' }));
  }
  try {
    const user = await db.getUserById(ids.userId).catch(() => null);
    await db.insertUserFeedback({
      user_id: ids.userId,
      household_id: ids.householdId,
      kind: 'signup_reason',
      answer,
    });
    await email.sendUserFeedbackAlert({
      user: user || { id: ids.userId, name: 'A user', email: null },
      message: SIGNUP_REASONS[answer],
      context: 'day-3 email: what made you sign up?',
    });
  } catch (err) {
    console.error('GET /api/feedback/why error:', err);
  }
  const home = process.env.WEB_URL || 'https://housemait.com';
  return res.status(200).type('html').send(page({
    title: 'Thanks, that helps',
    body: `<p>You said: <strong>${esc(SIGNUP_REASONS[answer])}</strong>.</p><p>If there is more to it, reply to the email. I read every one.</p><p>Grant</p><p><a href="${esc(home)}">Back to Housemait</a></p>`,
  }));
});

module.exports = router;
