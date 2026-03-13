const sgMail = require('@sendgrid/mail');

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

const FROM = process.env.SENDGRID_FROM_EMAIL || 'noreply@curata.app';
const BASE_URL = process.env.WEB_URL || 'http://localhost:5173';
const API_URL = process.env.API_URL || process.env.WEB_URL || 'http://localhost:3000';

function emailTemplate(title, body) {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:480px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    <div style="background:#059669;padding:24px;text-align:center;">
      <h1 style="color:#fff;margin:0;font-size:24px;">Curata</h1>
    </div>
    <div style="padding:32px 24px;">
      <h2 style="color:#111827;margin:0 0 16px;font-size:20px;">${title}</h2>
      ${body}
    </div>
    <div style="padding:16px 24px;background:#f9fafb;text-align:center;">
      <p style="color:#9ca3af;font-size:12px;margin:0;">Curata — shopping lists, tasks & reminders, together.</p>
    </div>
  </div>
</body>
</html>`;
}

function button(text, url) {
  return `<a href="${url}" style="display:inline-block;background:#059669;color:#fff;text-decoration:none;padding:12px 32px;border-radius:8px;font-weight:600;font-size:16px;margin:16px 0;">${text}</a>`;
}

async function sendVerificationEmail(to, name, token) {
  const url = `${API_URL}/api/auth/verify-email?token=${token}`;
  const html = emailTemplate('Verify your email', `
    <p style="color:#374151;line-height:1.6;">Hi ${name},</p>
    <p style="color:#374151;line-height:1.6;">Click the button below to verify your email address and get started with Curata.</p>
    <div style="text-align:center;">${button('Verify email', url)}</div>
    <p style="color:#9ca3af;font-size:13px;">This link expires in 24 hours.</p>
  `);
  await sgMail.send({ to, from: FROM, subject: 'Verify your email for Curata', html });
}

async function sendInviteEmail(to, inviterName, householdName, token) {
  const url = `${BASE_URL}/signup?invite=${token}`;
  const html = emailTemplate(`You're invited!`, `
    <p style="color:#374151;line-height:1.6;">${inviterName} has invited you to join <strong>${householdName}</strong> on Curata.</p>
    <p style="color:#374151;line-height:1.6;">Click below to create your account and join the household.</p>
    <div style="text-align:center;">${button('Join household', url)}</div>
    <p style="color:#9ca3af;font-size:13px;">This invite expires in 7 days.</p>
  `);
  await sgMail.send({ to, from: FROM, subject: `Join ${householdName} on Curata`, html });
}

async function sendPasswordResetEmail(to, name, token) {
  const url = `${BASE_URL}/reset-password?token=${token}`;
  const html = emailTemplate('Reset your password', `
    <p style="color:#374151;line-height:1.6;">Hi ${name},</p>
    <p style="color:#374151;line-height:1.6;">We received a request to reset your password. Click the button below to set a new one.</p>
    <div style="text-align:center;">${button('Reset password', url)}</div>
    <p style="color:#9ca3af;font-size:13px;">This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
  `);
  await sgMail.send({ to, from: FROM, subject: 'Reset your password for Curata', html });
}

module.exports = { sendVerificationEmail, sendInviteEmail, sendPasswordResetEmail };
