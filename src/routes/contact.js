const { Router } = require('express');
const email = require('../services/email');

const router = Router();

const SUPPORT_INBOX = process.env.SUPPORT_EMAIL || 'support@housemait.com';
const MAX_FIELD_LEN = 5000;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isLikelyEmail(value) {
  if (typeof value !== 'string') return false;
  // Conservative — same shape as auth.js validation. Full RFC compliance
  // isn't worth the regex complexity for a contact form; Postmark will
  // bounce anything obviously broken when used as Reply-To.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/**
 * POST /api/contact
 *
 * Public contact-form endpoint. Sends an email to the support inbox with the
 * submitter's message and their address as the Reply-To, so support staff can
 * reply directly from their mailbox.
 *
 * Anti-spam: a hidden honeypot field ("website") must be empty. Real users
 * never fill it; bots usually do. Submissions where it's set are silently
 * accepted (returned 200) so spammers don't get a signal that they were
 * filtered, but the email is never sent.
 */
router.post('/', async (req, res) => {
  const { name, email: senderEmail, subject, message, website } = req.body || {};

  // Honeypot: pretend success, drop on the floor.
  if (website) {
    return res.status(200).json({ message: 'Thanks — we\'ll be in touch.' });
  }

  if (!name?.trim() || !senderEmail?.trim() || !message?.trim()) {
    return res.status(400).json({ error: 'Name, email and message are all required.' });
  }
  if (!isLikelyEmail(senderEmail)) {
    return res.status(400).json({ error: 'That email address doesn\'t look right.' });
  }
  if (
    name.length > MAX_FIELD_LEN ||
    senderEmail.length > MAX_FIELD_LEN ||
    (subject && subject.length > MAX_FIELD_LEN) ||
    message.length > MAX_FIELD_LEN
  ) {
    return res.status(400).json({ error: 'One of those fields is too long.' });
  }

  const cleanName = name.trim();
  const cleanEmail = senderEmail.trim();
  const cleanSubject = (subject || '').trim() || 'Contact form submission';
  const cleanMessage = message.trim();

  const html = `
    <h2 style="font-family:system-ui,sans-serif;color:#2D2A33;margin:0 0 16px;">New contact form submission</h2>
    <table style="font-family:system-ui,sans-serif;color:#2D2A33;border-collapse:collapse;font-size:14px;">
      <tr><td style="padding:6px 12px 6px 0;color:#6B6774;">From</td><td style="padding:6px 0;">${escapeHtml(cleanName)} &lt;${escapeHtml(cleanEmail)}&gt;</td></tr>
      <tr><td style="padding:6px 12px 6px 0;color:#6B6774;">Subject</td><td style="padding:6px 0;">${escapeHtml(cleanSubject)}</td></tr>
    </table>
    <p style="font-family:system-ui,sans-serif;color:#6B6774;margin:24px 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:.06em;">Message</p>
    <div style="font-family:system-ui,sans-serif;color:#2D2A33;font-size:15px;line-height:1.55;white-space:pre-wrap;background:#FBF8F3;border:1px solid #E8E5EC;border-radius:12px;padding:16px;">${escapeHtml(cleanMessage)}</div>
  `;

  try {
    await email.sendEmail(
      SUPPORT_INBOX,
      `[Housemait Support] ${cleanSubject}`,
      html,
      { replyTo: `${cleanName} <${cleanEmail}>` }
    );
    return res.status(200).json({ message: 'Thanks — we\'ll be in touch.' });
  } catch (err) {
    console.error('POST /api/contact error:', err);
    return res.status(500).json({ error: 'Something went wrong sending your message. Please email us directly at support@housemait.com.' });
  }
});

module.exports = router;
