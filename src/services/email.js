const postmark = require('postmark');

const client = process.env.POSTMARK_SERVER_TOKEN
  ? new postmark.ServerClient(process.env.POSTMARK_SERVER_TOKEN)
  : null;

const FROM = process.env.POSTMARK_FROM_EMAIL || 'noreply@housemait.com';
const BASE_URL = process.env.WEB_URL || 'http://localhost:5173';
const API_URL = process.env.API_URL || process.env.WEB_URL || 'http://localhost:3000';

// ── Housemait brand palette (kept in sync with web/src/index.css) ──────────
// Inline-styled emails can't reference CSS custom properties, so the hex
// values are duplicated here. Update both when the brand palette changes.
const BRAND = {
  plum:       '#6B3FA0', // headers, buttons
  plumDark:   '#5A3488', // button hover (unused in email since no hover states)
  plumLight:  '#F3EDFC', // subtle section backgrounds, header subtitle text on plum
  charcoal:   '#2D2A33', // body text
  ink:        '#374151', // paragraph text (kept neutral grey for readability)
  inkMuted:   '#6B6774', // secondary text
  inkLight:   '#9CA3AF', // tertiary text (footer, expiry notes)
  cream:      '#FBF8F3', // page and footer background
  sand:       '#E8E5EC', // hairline separators
  overdueBg:  '#FEE2E2', overdueFg: '#DC2626', // semantic red — kept
  dueTodayBg: '#FEF3C7', dueTodayFg: '#D97706', // semantic amber — kept
};

function emailTemplate(title, body) {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:${BRAND.cream};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:480px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    <div style="background:${BRAND.plum};padding:24px;text-align:center;">
      <h1 style="color:#fff;margin:0;font-size:24px;letter-spacing:-0.01em;">Housemait</h1>
    </div>
    <div style="padding:32px 24px;">
      <h2 style="color:${BRAND.charcoal};margin:0 0 16px;font-size:20px;">${title}</h2>
      ${body}
    </div>
    <div style="padding:16px 24px;background:${BRAND.cream};text-align:center;">
      <p style="color:${BRAND.inkLight};font-size:12px;margin:0;">Housemait — shopping lists, tasks &amp; reminders, together.</p>
    </div>
  </div>
</body>
</html>`;
}

function button(text, url) {
  return `<a href="${url}" style="display:inline-block;background:${BRAND.plum};color:#fff;text-decoration:none;padding:12px 32px;border-radius:8px;font-weight:600;font-size:16px;margin:16px 0;">${text}</a>`;
}

async function sendEmail(to, subject, html) {
  if (!client) {
    console.warn('Postmark not configured — skipping email to', to);
    return;
  }
  await client.sendEmail({ From: FROM, To: to, Subject: subject, HtmlBody: html });
}

async function sendVerificationEmail(to, name, token) {
  const url = `${API_URL}/api/auth/verify-email?token=${token}`;
  const html = emailTemplate('Verify your email', `
    <p style="color:${BRAND.ink};line-height:1.6;">Hi ${name},</p>
    <p style="color:${BRAND.ink};line-height:1.6;">Click the button below to verify your email address and get started with Housemait.</p>
    <div style="text-align:center;">${button('Verify email', url)}</div>
    <p style="color:${BRAND.inkLight};font-size:13px;">This link expires in 24 hours.</p>
  `);
  await sendEmail(to, 'Verify your email for Housemait', html);
}

async function sendInviteEmail(to, inviterName, householdName, token) {
  const url = `${BASE_URL}/signup?invite=${token}`;
  const html = emailTemplate(`You're invited!`, `
    <p style="color:${BRAND.ink};line-height:1.6;">${inviterName} has invited you to join <strong>${householdName}</strong> on Housemait.</p>
    <p style="color:${BRAND.ink};line-height:1.6;">Click below to create your account and join the household.</p>
    <div style="text-align:center;">${button('Join household', url)}</div>
    <p style="color:${BRAND.inkLight};font-size:13px;">This invite expires in 7 days.</p>
  `);
  await sendEmail(to, `Join ${householdName} on Housemait`, html);
}

async function sendPasswordResetEmail(to, name, token) {
  const url = `${BASE_URL}/reset-password?token=${token}`;
  const html = emailTemplate('Reset your password', `
    <p style="color:${BRAND.ink};line-height:1.6;">Hi ${name},</p>
    <p style="color:${BRAND.ink};line-height:1.6;">We received a request to reset your password. Click the button below to set a new one.</p>
    <div style="text-align:center;">${button('Reset password', url)}</div>
    <p style="color:${BRAND.inkLight};font-size:13px;">This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
  `);
  await sendEmail(to, 'Reset your password for Housemait', html);
}

/**
 * Build and send the weekly digest email.
 *
 * @param {string} to - Recipient email
 * @param {string} memberName - Recipient's first name
 * @param {string} householdName
 * @param {object} data - { completedTasks, completedShopping, outstandingTasks, upcomingTasks, members }
 */
async function sendWeeklyDigestEmail(to, memberName, householdName, data) {
  const { completedTasks, completedShopping, outstandingTasks, upcomingTasks, members } = data;

  // ── Completed section ─────────────────────────────────────────────────────
  const byPerson = {};
  for (const t of completedTasks) {
    const key = t.assigned_to_name || 'Everyone';
    byPerson[key] = (byPerson[key] || 0) + 1;
  }
  const completedRows = Object.entries(byPerson)
    .map(([name, count]) => `<tr><td style="padding:4px 12px 4px 0;color:${BRAND.ink};">${name}</td><td style="padding:4px 0;color:${BRAND.plum};font-weight:600;">${count} task${count !== 1 ? 's' : ''}</td></tr>`)
    .join('');

  // ── Outstanding / carrying over ───────────────────────────────────────────
  const today = new Date().toISOString().split('T')[0];
  const outstandingRows = outstandingTasks.slice(0, 10).map((t) => {
    const who = t.assigned_to_name || 'Everyone';
    const daysOverdue = Math.max(0, Math.floor((new Date(today) - new Date(t.due_date)) / 86400000));
    // Overdue = red, due today = amber — semantic colours, deliberately not
    // brand plum. Users should recognise urgency regardless of brand.
    const badge = daysOverdue > 0
      ? `<span style="background:${BRAND.overdueBg};color:${BRAND.overdueFg};padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;">${daysOverdue}d overdue</span>`
      : `<span style="background:${BRAND.dueTodayBg};color:${BRAND.dueTodayFg};padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;">due today</span>`;
    return `<tr>
      <td style="padding:8px 12px 8px 0;color:${BRAND.ink};border-bottom:1px solid ${BRAND.sand};">${t.title}</td>
      <td style="padding:8px 8px 8px 0;color:${BRAND.inkMuted};border-bottom:1px solid ${BRAND.sand};font-size:13px;">${who}</td>
      <td style="padding:8px 0;border-bottom:1px solid ${BRAND.sand};text-align:right;">${badge}</td>
    </tr>`;
  }).join('');

  // ── Upcoming next week ────────────────────────────────────────────────────
  const upcomingRows = upcomingTasks.slice(0, 8).map((t) => {
    const who = t.assigned_to_name || 'Everyone';
    const dayName = new Date(t.due_date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    const rec = t.recurrence ? ` <span style="color:${BRAND.inkLight};font-size:11px;">(${t.recurrence})</span>` : '';
    return `<tr>
      <td style="padding:6px 12px 6px 0;color:${BRAND.ink};border-bottom:1px solid ${BRAND.sand};">${t.title}${rec}</td>
      <td style="padding:6px 8px 6px 0;color:${BRAND.inkMuted};border-bottom:1px solid ${BRAND.sand};font-size:13px;">${who}</td>
      <td style="padding:6px 0;border-bottom:1px solid ${BRAND.sand};color:${BRAND.inkMuted};font-size:13px;text-align:right;">${dayName}</td>
    </tr>`;
  }).join('');

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:${BRAND.cream};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">

    <!-- Header -->
    <div style="background:${BRAND.plum};padding:32px 24px;text-align:center;">
      <h1 style="color:#fff;margin:0 0 4px;font-size:24px;letter-spacing:-0.01em;">Housemait</h1>
      <p style="color:${BRAND.plumLight};margin:0;font-size:14px;">Weekly Digest for ${householdName}</p>
    </div>

    <div style="padding:32px 24px;">
      <p style="color:${BRAND.ink};line-height:1.6;margin:0 0 24px;">Hi ${memberName}, here's your week in review:</p>

      <!-- ✅ Completed This Week -->
      <div style="margin-bottom:28px;">
        <div style="display:flex;align-items:center;margin-bottom:12px;">
          <span style="font-size:20px;margin-right:8px;">✅</span>
          <h2 style="color:${BRAND.charcoal};margin:0;font-size:16px;font-weight:700;">Completed This Week</h2>
        </div>
        <div style="background:${BRAND.plumLight};border-radius:12px;padding:16px;">
          <p style="color:${BRAND.plum};font-size:24px;font-weight:700;margin:0 0 4px;">${completedTasks.length} task${completedTasks.length !== 1 ? 's' : ''} + ${completedShopping.length} shopping item${completedShopping.length !== 1 ? 's' : ''}</p>
          ${completedRows ? `<table style="margin-top:8px;font-size:13px;">${completedRows}</table>` : `<p style="color:${BRAND.inkMuted};font-size:13px;margin:4px 0 0;">Nothing completed yet — next week is a fresh start!</p>`}
        </div>
      </div>

      <!-- ⏳ Carrying Over -->
      <div style="margin-bottom:28px;">
        <div style="display:flex;align-items:center;margin-bottom:12px;">
          <span style="font-size:20px;margin-right:8px;">⏳</span>
          <h2 style="color:${BRAND.charcoal};margin:0;font-size:16px;font-weight:700;">Carrying Over</h2>
          <span style="background:${BRAND.overdueBg};color:${BRAND.overdueFg};padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600;margin-left:8px;">${outstandingTasks.length}</span>
        </div>
        ${outstandingTasks.length
          ? `<table style="width:100%;font-size:14px;">${outstandingRows}</table>${outstandingTasks.length > 10 ? `<p style="color:${BRAND.inkLight};font-size:13px;margin:8px 0 0;">… and ${outstandingTasks.length - 10} more</p>` : ''}`
          : `<div style="background:${BRAND.plumLight};border-radius:12px;padding:16px;text-align:center;"><p style="color:${BRAND.plum};font-size:14px;margin:0;">All caught up! 🎉</p></div>`
        }
      </div>

      <!-- 📅 Coming Up Next Week -->
      <div style="margin-bottom:28px;">
        <div style="display:flex;align-items:center;margin-bottom:12px;">
          <span style="font-size:20px;margin-right:8px;">📅</span>
          <h2 style="color:${BRAND.charcoal};margin:0;font-size:16px;font-weight:700;">Coming Up Next Week</h2>
        </div>
        ${upcomingTasks.length
          ? `<table style="width:100%;font-size:14px;">${upcomingRows}</table>${upcomingTasks.length > 8 ? `<p style="color:${BRAND.inkLight};font-size:13px;margin:8px 0 0;">… and ${upcomingTasks.length - 8} more</p>` : ''}`
          : `<div style="background:${BRAND.cream};border-radius:12px;padding:16px;text-align:center;"><p style="color:${BRAND.inkMuted};font-size:14px;margin:0;">Nothing scheduled — enjoy the week! ☀️</p></div>`
        }
      </div>

      <!-- CTA -->
      <div style="text-align:center;margin-top:24px;">
        ${button('Open Housemait', BASE_URL)}
      </div>
    </div>

    <!-- Footer -->
    <div style="padding:16px 24px;background:${BRAND.cream};text-align:center;">
      <p style="color:${BRAND.inkLight};font-size:12px;margin:0;">Housemait — shopping lists, tasks &amp; reminders, together.</p>
    </div>
  </div>
</body>
</html>`;

  await sendEmail(to, `Weekly Digest — ${householdName}`, html);
}

module.exports = { sendVerificationEmail, sendInviteEmail, sendPasswordResetEmail, sendWeeklyDigestEmail };
