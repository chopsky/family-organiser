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
    <p style="color:${BRAND.ink};line-height:1.6;font-size:16px;">Hi ${name},</p>
    <p style="color:${BRAND.ink};line-height:1.6;font-size:16px;">Click the button below to verify your email address and get started with Housemait.</p>
    <div style="text-align:center;">${button('Verify email', url)}</div>
    <p style="color:${BRAND.inkLight};font-size:13px;">This link expires in 24 hours.</p>
  `);
  await sendEmail(to, 'Verify your email for Housemait', html);
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
    <div style="padding:16px 24px;background:${BRAND.cream};text-align:center;border-radius:0 0 16px 16px;">
      <p style="color:${BRAND.inkLight};font-size:12px;margin:0;">Housemait — shopping lists, tasks &amp; reminders, together.</p>
    </div>
  </div>
</body>
</html>`;

  await sendEmail(to, `Weekly Digest — ${householdName}`, html);
}

// ─── Subscription lifecycle emails (Phase 7) ────────────────────────────────
// These use Postmark's Template feature (not the inline emailTemplate above)
// so copy can be edited in the Postmark dashboard without a code deploy.
// Template aliases are hardcoded below — they must match the aliases you
// create in the Postmark dashboard for the templates to resolve.

const { unsubscribeUrl } = require('./unsubscribe-token');

const TEMPLATE_ALIASES = {
  welcome:        'housemait-welcome',
  trialDay20:     'housemait-trial-day-20',
  trialDay25:     'housemait-trial-day-25',
  trialDay28:     'housemait-trial-day-28',
  trialExpired:   'housemait-trial-expired',
};

// Message streams — Postmark splits transactional (user-initiated,
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
    console.warn(`[email] Postmark not configured — skipping "${templateAlias}" to ${to}`);
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
    // 1101 = template not found (alias mismatch) — log extra-loudly so a
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

// ── Day 1 — Welcome ────────────────────────────────────────────────
// Transactional. Always sends on household creation (ignores the
// trial_emails_enabled flag — the spec carves out welcome + expiry as
// transactional).
async function sendWelcomeEmail({ to, firstName, trialEndsAt }) {
  // The welcome email is transactional — the template doesn't render
  // an unsubscribe link, so we don't compute one. Earlier revisions
  // computed unsubscribeUrl() "for consistency" which created an
  // accidental hard dependency on UNSUBSCRIBE_TOKEN_SECRET — a missing
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

// ── Day 20 — Gentle reminder ───────────────────────────────────────
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
      shopping_item_count: usage?.shopping_item_count ?? 0,
      meal_plan_count:     usage?.meal_plan_count     ?? 0,
      task_count:          usage?.task_count          ?? 0,
      calendar_event_count: usage?.calendar_event_count ?? 0,
      member_count:        usage?.member_count        ?? 0,
    },
  });
}

// ── Day 25 — Stronger nudge ────────────────────────────────────────
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
      shopping_item_count: usage?.shopping_item_count ?? 0,
      meal_plan_count:     usage?.meal_plan_count     ?? 0,
      task_count:          usage?.task_count          ?? 0,
      calendar_event_count: usage?.calendar_event_count ?? 0,
      member_count:        usage?.member_count        ?? 0,
    },
  });
}

// ── Day 28 — Final push ────────────────────────────────────────────
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
      shopping_item_count: usage?.shopping_item_count ?? 0,
      meal_plan_count:     usage?.meal_plan_count     ?? 0,
      task_count:          usage?.task_count          ?? 0,
      calendar_event_count: usage?.calendar_event_count ?? 0,
      member_count:        usage?.member_count        ?? 0,
    },
  });
}

// ── Day 30 — Trial expired ─────────────────────────────────────────
// Transactional. Always sends — the spec carves this out as "account-
// related, not promotional". Users who opted out of nudges still need
// to know their trial ended.
async function sendTrialExpiredEmail({ to, firstName, trialEndsAt, householdId }) {
  return sendTemplate({
    to,
    templateAlias: TEMPLATE_ALIASES.trialExpired,
    stream: 'transactional',
    model: {
      first_name: firstName || 'there',
      trial_end_date: formatTrialEndDate(trialEndsAt),
      app_url: BASE_URL,
      subscribe_url: `${BASE_URL}/subscribe`,
      // Unsubscribe link deliberately omitted — this email is transactional.
    },
  });
}

module.exports = {
  sendVerificationEmail,
  sendInviteEmail,
  sendPasswordResetEmail,
  sendWeeklyDigestEmail,
  // Phase 7 — subscription lifecycle
  sendWelcomeEmail,
  sendTrialDay20Email,
  sendTrialDay25Email,
  sendTrialDay28Email,
  sendTrialExpiredEmail,
  // Exposed for tests
  _internal: { formatTrialEndDate, TEMPLATE_ALIASES, STREAM },
};
