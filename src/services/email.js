const postmark = require('postmark');

const client = process.env.POSTMARK_SERVER_TOKEN
  ? new postmark.ServerClient(process.env.POSTMARK_SERVER_TOKEN)
  : null;

const FROM = process.env.POSTMARK_FROM_EMAIL || 'noreply@housemait.com';
const BASE_URL = process.env.WEB_URL || 'http://localhost:5173';

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
  overdueBg:  '#FEE2E2', overdueFg: '#DC2626', // semantic red - kept
  dueTodayBg: '#FEF3C7', dueTodayFg: '#D97706', // semantic amber - kept
};

function emailTemplate(title, body) {
  // Logo is a pre-whitened 2× PNG (64px tall, displayed at 32px) so it looks
  // crisp on retina without a CSS filter hack. SVG would be nicer but Gmail,
  // Outlook desktop, Yahoo, and Outlook.com all strip <img src="*.svg">.
  //
  // `border-radius: 0 0 16px 16px` on the footer is belt-and-braces: the
  // outer container already has `overflow:hidden`, but several clients
  // (notably older Outlook and some webmail) strip `overflow`, leaving square
  // bottom corners. Setting it on the footer directly guarantees the look.
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:${BRAND.cream};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:480px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    <div style="background:${BRAND.plum};padding:24px;text-align:center;border-radius:16px 16px 0 0;">
      <img src="${BASE_URL}/housemait-logo-white@2x.png" alt="Housemait" height="32" style="height:32px;display:inline-block;border:0;" />
    </div>
    <div style="padding:32px 24px;">
      <h2 style="color:${BRAND.charcoal};margin:0 0 16px;font-size:20px;">${title}</h2>
      ${body}
    </div>
    <div style="padding:16px 24px;background:${BRAND.cream};text-align:center;border-radius:0 0 16px 16px;">
      <p style="color:${BRAND.inkLight};font-size:12px;margin:0;">Housemait - shopping lists, tasks &amp; reminders, together.</p>
    </div>
  </div>
</body>
</html>`;
}

function button(text, url) {
  return `<a href="${url}" style="display:inline-block;background:${BRAND.plum};color:#fff;text-decoration:none;padding:12px 32px;border-radius:8px;font-weight:600;font-size:16px;margin:16px 0;">${text}</a>`;
}

async function sendEmail(to, subject, html, options = {}) {
  if (!client) {
    console.warn('Postmark not configured - skipping email to', to);
    return;
  }
  const payload = { From: FROM, To: to, Subject: subject, HtmlBody: html };
  if (options.replyTo) payload.ReplyTo = options.replyTo;
  await client.sendEmail(payload);
}

async function sendVerificationEmail(to, name, token) {
  // Universal Link target: hitting this URL from the iOS app opens
  // Housemait directly (see web/public/.well-known/apple-app-site-association),
  // while web visitors just see the React /verify page. Either way the
  // page POSTs to /api/auth/verify-email-and-login, which verifies the
  // token + issues a session JWT - the user lands inside the app already
  // logged-in. The old API URL (/api/auth/verify-email) is kept around
  // for any in-flight emails sent before this change; new emails point
  // at the frontend route so iOS deep-links work.
  const url = `${BASE_URL}/verify?token=${token}`;
  // Pull just the first name for the preview greeting - looks weird
  // to address someone as "Sarah Smith" in a sample WhatsApp message.
  const firstName = (name || 'there').trim().split(/\s+/)[0] || 'there';
  // The morning-brief preview block below is a static mockup of what the
  // 07:00 WhatsApp digest looks like. The engagement audit found the
  // generic "click here to verify" email was doing zero acquisition work
  // at the email-verification gate (the second-largest drop in the
  // signup → active funnel after the WhatsApp-link step itself). Showing
  // the actual product output the user is opting into - structured,
  // branded, named-after-them - gives them a concrete reason to come back
  // and click the button. Sample content matches the housemait_morning_
  // brief_v2 template's approved sample content so the email and the
  // first real brief feel of-a-piece.
  const html = emailTemplate('Verify your email', `
    <p style="color:${BRAND.ink};line-height:1.6;font-size:16px;margin:0 0 12px;">Hi ${firstName},</p>
    <p style="color:${BRAND.ink};line-height:1.6;font-size:16px;margin:0 0 18px;">
      Tomorrow morning at 07:00, Housemait can send you a calm WhatsApp digest like this:
    </p>

    <div style="background:${BRAND.cream};border-radius:12px;padding:18px 18px 16px;margin:0 0 20px;border:1px solid ${BRAND.sand};">
      <p style="color:${BRAND.charcoal};font-size:14px;line-height:1.5;margin:0 0 12px;">
        <strong>Good morning, ${firstName}!</strong> Here's your Tuesday.
      </p>
      <p style="color:${BRAND.ink};font-size:13px;line-height:1.5;margin:0 0 14px;">
        ☀️ 18°C, sunny in London today
      </p>
      <p style="color:${BRAND.charcoal};font-size:13px;line-height:1.5;margin:0 0 2px;font-weight:600;">
        📅 Today's Schedule:
      </p>
      <p style="color:${BRAND.ink};font-size:13px;line-height:1.5;margin:0 0 14px;">
        14:00 - Dentist · 15:30 - School run (Sarah)
      </p>
      <p style="color:${BRAND.charcoal};font-size:13px;line-height:1.5;margin:0 0 2px;font-weight:600;">
        📋 Reminders:
      </p>
      <p style="color:${BRAND.ink};font-size:13px;line-height:1.5;margin:0 0 14px;">
        Buy birthday card due today
      </p>
      <p style="color:${BRAND.ink};font-size:13px;line-height:1.5;margin:0 0 10px;">
        🛒 5 items on the shopping list
      </p>
      <p style="color:${BRAND.ink};font-size:13px;line-height:1.5;margin:0;">
        💡 Tonight's dinner: Spaghetti bolognese
      </p>
    </div>

    <p style="color:${BRAND.ink};line-height:1.6;font-size:15px;margin:0 0 4px;">
      You can also add tasks, manage shopping lists, scan receipts, and update the family calendar just by messaging the bot.
    </p>

    <div style="text-align:center;">${button('Verify and get started', url)}</div>
    <p style="color:${BRAND.inkLight};font-size:13px;margin:0;">This link expires in 24 hours.</p>
  `);
  await sendEmail(to, `${firstName}, your first Housemait brief is one click away`, html);
}

/**
 * T+24h re-engagement email for users who signed up + verified email
 * but never connected WhatsApp. Engagement audit Tier 2 (G) - recovers
 * a portion of the verified-but-not-activated leakage without changing
 * anything in the product. Sent exactly once per user, gated by the
 * users.whatsapp_followup_sent_at column.
 *
 * The CTA links straight at /onboarding which RequireAuth redirects
 * to the unfinished step 2 (WhatsApp pairing) for users whose
 * onboarded_at is null - so a tap from the email lands them one click
 * away from being linked.
 */
async function sendWhatsAppFollowupEmail(to, name) {
  const firstName = (name || 'there').trim().split(/\s+/)[0] || 'there';
  // Mirror the verification-email preview block so the user is reminded
  // exactly what they're opting into. Keeping the brief mockup identical
  // also means we only have one piece of copy to update when the
  // morning-brief format evolves.
  const url = `${BASE_URL}/onboarding`;
  const html = emailTemplate('Your Housemait is waiting on WhatsApp', `
    <p style="color:${BRAND.ink};line-height:1.6;font-size:16px;margin:0 0 12px;">Hi ${firstName},</p>
    <p style="color:${BRAND.ink};line-height:1.6;font-size:16px;margin:0 0 18px;">
      You signed up for Housemait yesterday but haven't connected WhatsApp yet - which is where the bot actually lives. Once you connect, every morning at 07:00 you'll get a calm digest like this:
    </p>

    <div style="background:${BRAND.cream};border-radius:12px;padding:18px 18px 16px;margin:0 0 20px;border:1px solid ${BRAND.sand};">
      <p style="color:${BRAND.charcoal};font-size:14px;line-height:1.5;margin:0 0 12px;">
        <strong>Good morning, ${firstName}!</strong> Here's your Tuesday.
      </p>
      <p style="color:${BRAND.ink};font-size:13px;line-height:1.5;margin:0 0 14px;">
        ☀️ 18°C, sunny in London today
      </p>
      <p style="color:${BRAND.charcoal};font-size:13px;line-height:1.5;margin:0 0 2px;font-weight:600;">
        📅 Today's Schedule:
      </p>
      <p style="color:${BRAND.ink};font-size:13px;line-height:1.5;margin:0 0 14px;">
        14:00 - Dentist · 15:30 - School run (Sarah)
      </p>
      <p style="color:${BRAND.charcoal};font-size:13px;line-height:1.5;margin:0 0 2px;font-weight:600;">
        📋 Reminders:
      </p>
      <p style="color:${BRAND.ink};font-size:13px;line-height:1.5;margin:0 0 14px;">
        Buy birthday card due today
      </p>
      <p style="color:${BRAND.ink};font-size:13px;line-height:1.5;margin:0 0 10px;">
        🛒 5 items on the shopping list
      </p>
      <p style="color:${BRAND.ink};font-size:13px;line-height:1.5;margin:0;">
        💡 Tonight's dinner: Spaghetti bolognese
      </p>
    </div>

    <p style="color:${BRAND.ink};line-height:1.6;font-size:15px;margin:0 0 4px;">
      It's a 10-second setup - just a phone number and a 6-digit code we'll send via WhatsApp.
    </p>

    <div style="text-align:center;">${button('Connect WhatsApp now', url)}</div>
    <p style="color:${BRAND.inkLight};font-size:12px;margin:16px 0 0;">
      If WhatsApp isn't your thing, no worries - you can still use Housemait directly in the app. We won't email you about this again.
    </p>
  `);
  await sendEmail(to, `${firstName}, your Housemait bot is waiting`, html);
}

/**
 * Confirmation reply for an inbound (forwarded) email after the AI has
 * processed it. Summarises what got done + offers a one-tap UNDO link
 * so users can revert mistakes without contacting support. The link is
 * a single-use token-protected URL - see `inbound_email_log.undo_token`.
 *
 * The `summary` arg is the human-readable body, e.g.:
 *   "Ticked 3 items off your shopping list (milk, bread, eggs)
 *    and added 2 to Previously purchased."
 *
 * Plain-text only because we send to whatever the forwarder's address
 * is - they may be on a strict client (Outlook on iOS, etc.) that
 * mangles HTML, and the link survives plain text fine.
 */
async function sendInboundEmailConfirmation(to, summary, undoUrl, originalSubject) {
  const html = emailTemplate('Housemait processed your email', `
    <p style="color:${BRAND.ink};line-height:1.6;font-size:16px;">Got your forwarded email${originalSubject ? ` (<em>${originalSubject}</em>)` : ''}.</p>
    <p style="color:${BRAND.ink};line-height:1.6;font-size:16px;white-space:pre-line;">${summary}</p>
    <p style="color:${BRAND.ink};line-height:1.6;font-size:14px;">If anything looks wrong, tap below to revert everything:</p>
    <div style="text-align:center;">${button('Undo everything', undoUrl)}</div>
    <p style="color:${BRAND.inkLight};font-size:13px;">The undo link works once - after you tap it, your data is restored to before this email was processed.</p>
  `);
  await sendEmail(to, 'Housemait: processed your forwarded email', html);
}

async function sendInviteEmail(to, inviterName, householdName, token) {
  const url = `${BASE_URL}/signup?invite=${token}`;
  const html = emailTemplate(`You're invited!`, `
    <p style="color:${BRAND.ink};line-height:1.6;font-size:16px;">${inviterName} has invited you to join <strong>${householdName}</strong> on Housemait.</p>
    <p style="color:${BRAND.ink};line-height:1.6;font-size:16px;">Click below to create your account and join the household.</p>
    <div style="text-align:center;">${button('Join household', url)}</div>
    <p style="color:${BRAND.inkLight};font-size:13px;">This invite expires in 7 days.</p>
  `);
  await sendEmail(to, `Join ${householdName} on Housemait`, html);
}

async function sendPasswordResetEmail(to, name, token) {
  const url = `${BASE_URL}/reset-password?token=${token}`;
  const html = emailTemplate('Reset your password', `
    <p style="color:${BRAND.ink};line-height:1.6;font-size:16px;">Hi ${name},</p>
    <p style="color:${BRAND.ink};line-height:1.6;font-size:16px;">We received a request to reset your password. Click the button below to set a new one.</p>
    <div style="text-align:center;">${button('Reset password', url)}</div>
    <p style="color:${BRAND.inkLight};font-size:13px;">This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
  `);
  await sendEmail(to, 'Reset your password for Housemait', html);
}

/**
 * Send an internal admin/operator alert email - for things like "Gemini
 * stopped being called", "scheduler lock failed", etc. Plain styling, goes
 * to ADMIN_ALERT_EMAIL (env var) or falls back to SUPPORT_EMAIL. If neither
 * is set or Postmark isn't configured, sendEmail logs and no-ops; the alert
 * job should treat that as best-effort.
 *
 * @param {string} subject - short imperative subject line
 * @param {string} body    - plain text or simple HTML; rendered inline in
 *                            the email shell. No outbound CTAs.
 */
async function sendAdminAlert(subject, body) {
  const to = process.env.ADMIN_ALERT_EMAIL || process.env.SUPPORT_EMAIL;
  if (!to) {
    console.warn('[admin-alert] No ADMIN_ALERT_EMAIL or SUPPORT_EMAIL configured - skipping:', subject);
    return;
  }
  const html = emailTemplate(subject, `
    <p style="color:${BRAND.ink};line-height:1.6;font-size:15px;">${body}</p>
    <p style="color:${BRAND.inkLight};font-size:12px;margin-top:24px;">This is an automated operator alert. You're receiving it because your address is in <code>ADMIN_ALERT_EMAIL</code> or <code>SUPPORT_EMAIL</code>.</p>
  `);
  await sendEmail(to, `[Housemait alert] ${subject}`, html);
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
  const { completedTasks, completedShopping, outstandingTasks, upcomingTasks } = data;

  // Render the assignee list for a task row: "Lynn", "Lynn & Grant", or
  // "Everyone" for an empty array. Used by every section below.
  function formatAssignees(t) {
    const names = Array.isArray(t.assigned_to_names) ? t.assigned_to_names.filter(Boolean) : [];
    if (names.length === 0) return 'Everyone';
    if (names.length === 1) return names[0];
    return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
  }

  // ── Completed section ─────────────────────────────────────────────────────
  // Per-person tally counts a multi-assignee task once for each named
  // person (matches the jobs/digest.js behaviour).
  const byPerson = {};
  for (const t of completedTasks) {
    const names = Array.isArray(t.assigned_to_names) ? t.assigned_to_names.filter(Boolean) : [];
    if (names.length === 0) {
      byPerson['Everyone'] = (byPerson['Everyone'] || 0) + 1;
    } else {
      for (const n of names) byPerson[n] = (byPerson[n] || 0) + 1;
    }
  }
  const completedRows = Object.entries(byPerson)
    .map(([name, count]) => `<tr><td style="padding:4px 12px 4px 0;color:${BRAND.ink};">${name}</td><td style="padding:4px 0;color:${BRAND.plum};font-weight:600;">${count} task${count !== 1 ? 's' : ''}</td></tr>`)
    .join('');

  // ── Outstanding / carrying over ───────────────────────────────────────────
  const today = new Date().toISOString().split('T')[0];
  const outstandingRows = outstandingTasks.slice(0, 10).map((t) => {
    const who = formatAssignees(t);
    const daysOverdue = Math.max(0, Math.floor((new Date(today) - new Date(t.due_date)) / 86400000));
    // Overdue = red, due today = amber - semantic colours, deliberately not
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
    const who = formatAssignees(t);
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
    <div style="background:${BRAND.plum};padding:32px 24px;text-align:center;border-radius:16px 16px 0 0;">
      <img src="${BASE_URL}/housemait-logo-white@2x.png" alt="Housemait" height="32" style="height:32px;display:inline-block;border:0;margin-bottom:6px;" />
      <p style="color:${BRAND.plumLight};margin:0;font-size:14px;">Weekly Digest for ${householdName}</p>
    </div>

    <div style="padding:32px 24px;">
      <p style="color:${BRAND.ink};line-height:1.6;font-size:16px;margin:0 0 24px;">Hi ${memberName}, here's your week in review:</p>

      <!-- ✅ Completed This Week -->
      <div style="margin-bottom:28px;">
        <div style="display:flex;align-items:center;margin-bottom:12px;">
          <span style="font-size:20px;margin-right:8px;">✅</span>
          <h2 style="color:${BRAND.charcoal};margin:0;font-size:16px;font-weight:700;">Completed This Week</h2>
        </div>
        <div style="background:${BRAND.plumLight};border-radius:12px;padding:16px;">
          <p style="color:${BRAND.plum};font-size:24px;font-weight:700;margin:0 0 4px;">${completedTasks.length} task${completedTasks.length !== 1 ? 's' : ''} + ${completedShopping.length} shopping item${completedShopping.length !== 1 ? 's' : ''}</p>
          ${completedRows ? `<table style="margin-top:8px;font-size:13px;">${completedRows}</table>` : `<p style="color:${BRAND.inkMuted};font-size:13px;margin:4px 0 0;">Nothing completed yet - next week is a fresh start!</p>`}
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
          : `<div style="background:${BRAND.cream};border-radius:12px;padding:16px;text-align:center;"><p style="color:${BRAND.inkMuted};font-size:14px;margin:0;">Nothing scheduled - enjoy the week! ☀️</p></div>`
        }
      </div>

      <!-- CTA -->
      <div style="text-align:center;margin-top:24px;">
        ${button('Open Housemait', BASE_URL)}
      </div>
    </div>

    <!-- Footer -->
    <div style="padding:16px 24px;background:${BRAND.cream};text-align:center;border-radius:0 0 16px 16px;">
      <p style="color:${BRAND.inkLight};font-size:12px;margin:0;">Housemait - shopping lists, tasks &amp; reminders, together.</p>
    </div>
  </div>
</body>
</html>`;

  await sendEmail(to, `Weekly Digest - ${householdName}`, html);
}

// ─── Subscription lifecycle emails (Phase 7) ────────────────────────────────
// These use Postmark's Template feature (not the inline emailTemplate above)
// so copy can be edited in the Postmark dashboard without a code deploy.
// Template aliases are hardcoded below - they must match the aliases you
// create in the Postmark dashboard for the templates to resolve.

const { unsubscribeUrl } = require('./unsubscribe-token');

const TEMPLATE_ALIASES = {
  welcome:        'housemait-welcome',
  trialDay20:     'housemait-trial-day-20',
  trialDay25:     'housemait-trial-day-25',
  trialDay28:     'housemait-trial-day-28',
  trialExpired:   'housemait-trial-expired',
};

// Message streams - Postmark splits transactional (user-initiated,
// always-delivered) from broadcast (marketing-ish, must honour opt-out
// and carry List-Unsubscribe headers). The `broadcast` stream ID must
// match what you created in the Postmark dashboard.
const STREAM = {
  transactional: 'outbound',   // Postmark's default transactional stream
  broadcast:     'broadcast',  // created manually in the Postmark dashboard
};

/**
 * Format a Date / ISO string as "21 May 2026" in Europe/London. Matches
 * the format the welcome email copy expects and the in-app trial
 * indicators already use.
 */
function formatTrialEndDate(when) {
  if (!when) return '';
  const d = when instanceof Date ? when : new Date(when);
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London',
  }).format(d);
}

/**
 * Send a Postmark Template. Thin wrapper around sendEmailWithTemplate
 * so the individual senders stay declarative.
 *
 * @param {Object} args
 * @param {string} args.to              recipient email
 * @param {string} args.templateAlias   Postmark template alias
 * @param {Object} args.model           template variables (Mustachio {{key}})
 * @param {'transactional'|'broadcast'} args.stream
 * @param {string[]} [args.listUnsubscribeHeaders]  headers for broadcast emails
 */
async function sendTemplate({ to, templateAlias, model, stream, listUnsubscribeHeaders }) {
  if (!client) {
    console.warn(`[email] Postmark not configured - skipping "${templateAlias}" to ${to}`);
    return;
  }
  const payload = {
    From: FROM,
    To: to,
    TemplateAlias: templateAlias,
    TemplateModel: model,
    MessageStream: STREAM[stream] || STREAM.transactional,
  };
  if (listUnsubscribeHeaders?.length) {
    payload.Headers = listUnsubscribeHeaders;
  }
  try {
    await client.sendEmailWithTemplate(payload);
  } catch (err) {
    // Postmark errors carry a numeric `code` on the exception.
    // 1101 = template not found (alias mismatch) - log extra-loudly so a
    // dashboard typo surfaces before the cron silently drops every send.
    if (err.code === 1101) {
      console.error(
        `[email] Postmark template "${templateAlias}" not found. ` +
        `Create it in the dashboard with that alias and try again.`
      );
    }
    throw err;
  }
}

/**
 * Build the two List-Unsubscribe headers required for Gmail / Apple
 * Mail one-click unsubscribe. RFC 8058 says both headers together mean
 * "this mail supports List-Unsubscribe-Post=List-Unsubscribe=One-Click",
 * which surfaces the unsubscribe button in Gmail's UI.
 */
function buildListUnsubscribeHeaders(householdId) {
  const url = unsubscribeUrl(householdId);
  return [
    { Name: 'List-Unsubscribe', Value: `<${url}>` },
    { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
  ];
}

/**
 * Translate our internal usage-count keys into the names the Postmark
 * templates reference. Backend-side the internal names are clearer
 * (shopping_item_count) but the template copy reads more naturally
 * with semantic names (items_added, tasks_completed, etc.). Keeping
 * the mapping in this one place avoids leaking template vocabulary
 * into db/queries.js.
 */
function usageToTemplateModel(usage) {
  return {
    items_added:          usage?.shopping_item_count  ?? 0,
    meals_planned:        usage?.meal_plan_count      ?? 0,
    tasks_completed:      usage?.task_count           ?? 0,
    events_added:         usage?.calendar_event_count ?? 0,
    family_members_count: usage?.member_count         ?? 0,
  };
}

// ── Day 1 - Welcome ────────────────────────────────────────────────
// Transactional. Always sends on household creation (ignores the
// trial_emails_enabled flag - the spec carves out welcome + expiry as
// transactional).
async function sendWelcomeEmail({ to, firstName, trialEndsAt }) {
  // The welcome email is transactional - the template doesn't render
  // an unsubscribe link, so we don't compute one. Earlier revisions
  // computed unsubscribeUrl() "for consistency" which created an
  // accidental hard dependency on UNSUBSCRIBE_TOKEN_SECRET - a missing
  // env var there would take out the welcome email even though it
  // never displays the link. Keep the model lean.
  return sendTemplate({
    to,
    templateAlias: TEMPLATE_ALIASES.welcome,
    stream: 'transactional',
    model: {
      first_name: firstName || 'there',
      trial_end_date: formatTrialEndDate(trialEndsAt),
      app_url: BASE_URL,
    },
  });
}

// ── Day 20 - Gentle reminder ───────────────────────────────────────
// Broadcast. Skipped if trial_emails_enabled=false. Carries usage stats
// so the message is "here's what you've built up" not "you're about to
// lose access".
async function sendTrialDay20Email({ to, firstName, trialEndsAt, householdId, usage }) {
  return sendTemplate({
    to,
    templateAlias: TEMPLATE_ALIASES.trialDay20,
    stream: 'broadcast',
    listUnsubscribeHeaders: buildListUnsubscribeHeaders(householdId),
    model: {
      first_name: firstName || 'there',
      trial_end_date: formatTrialEndDate(trialEndsAt),
      days_remaining: 10,
      app_url: BASE_URL,
      subscribe_url: `${BASE_URL}/subscribe`,
      unsubscribe_url: unsubscribeUrl(householdId),
      ...usageToTemplateModel(usage),
    },
  });
}

// ── Day 25 - Stronger nudge ────────────────────────────────────────
async function sendTrialDay25Email({ to, firstName, trialEndsAt, householdId, usage }) {
  return sendTemplate({
    to,
    templateAlias: TEMPLATE_ALIASES.trialDay25,
    stream: 'broadcast',
    listUnsubscribeHeaders: buildListUnsubscribeHeaders(householdId),
    model: {
      first_name: firstName || 'there',
      trial_end_date: formatTrialEndDate(trialEndsAt),
      days_remaining: 5,
      app_url: BASE_URL,
      subscribe_url: `${BASE_URL}/subscribe`,
      unsubscribe_url: unsubscribeUrl(householdId),
      ...usageToTemplateModel(usage),
    },
  });
}

// ── Day 28 - Final push ────────────────────────────────────────────
async function sendTrialDay28Email({ to, firstName, trialEndsAt, householdId, usage }) {
  return sendTemplate({
    to,
    templateAlias: TEMPLATE_ALIASES.trialDay28,
    stream: 'broadcast',
    listUnsubscribeHeaders: buildListUnsubscribeHeaders(householdId),
    model: {
      first_name: firstName || 'there',
      trial_end_date: formatTrialEndDate(trialEndsAt),
      days_remaining: 2,
      app_url: BASE_URL,
      subscribe_url: `${BASE_URL}/subscribe`,
      unsubscribe_url: unsubscribeUrl(householdId),
      ...usageToTemplateModel(usage),
    },
  });
}

// ── Day 30 - Trial expired ─────────────────────────────────────────
// Transactional. Always sends - the spec carves this out as "account-
// related, not promotional". Users who opted out of nudges still need
// to know their trial ended.
async function sendTrialExpiredEmail({ to, firstName, trialEndsAt, householdId: _householdId }) {
  return sendTemplate({
    to,
    templateAlias: TEMPLATE_ALIASES.trialExpired,
    stream: 'transactional',
    model: {
      first_name: firstName || 'there',
      trial_end_date: formatTrialEndDate(trialEndsAt),
      app_url: BASE_URL,
      subscribe_url: `${BASE_URL}/subscribe`,
      // Unsubscribe link deliberately omitted - this email is transactional.
    },
  });
}

/**
 * Send a one-off admin announcement email. Thin wrapper around the
 * generic sendEmail - the announcement body is already a complete HTML
 * string (rendered by the admin compose UI) so we just pass it through.
 * Throws if Postmark returns an error so the caller can mark the row
 * as failed and continue.
 */
async function sendAnnouncementEmail({ to, subject, html }) {
  if (!client) throw new Error('Postmark not configured');
  if (!to) throw new Error('Recipient address required');
  if (!subject) throw new Error('Subject required');
  if (!html) throw new Error('HTML body required');
  await client.sendEmail({
    From: FROM,
    To: to,
    Subject: subject,
    HtmlBody: html,
    // 'broadcast' stream keeps marketing-style announcements out of
    // the transactional reputation pool. Falls back to default when
    // the env var isn't set so a fresh dev environment still works.
    MessageStream: process.env.POSTMARK_BROADCAST_STREAM || 'broadcast',
  });
}

module.exports = {
  sendVerificationEmail,
  sendWhatsAppFollowupEmail,
  sendInviteEmail,
  sendInboundEmailConfirmation,
  sendPasswordResetEmail,
  sendWeeklyDigestEmail,
  sendAdminAlert,
  // Phase 7 - subscription lifecycle
  sendWelcomeEmail,
  sendTrialDay20Email,
  sendTrialDay25Email,
  sendTrialDay28Email,
  sendTrialExpiredEmail,
  // Admin announcement broadcaster
  sendAnnouncementEmail,
  // Exposed for tests
  _internal: { formatTrialEndDate, TEMPLATE_ALIASES, STREAM },
};
