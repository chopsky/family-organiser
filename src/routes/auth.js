const { Router } = require('express');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const db = require('../db/queries');
const { signToken, requireAuth } = require('../middleware/auth');
const email = require('../services/email');
const publicHolidays = require('../services/publicHolidays');
const cache = require('../services/cache');

const router = Router();

const BCRYPT_ROUNDS = 12;
const REFRESH_TOKEN_DAYS = 7;

// Helper: generate a crypto-random token
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Helper: build the standard auth response (includes refresh token)
async function authResponse(user) {
  const household = user.household_id ? await db.getHouseholdById(user.household_id) : null;
  const token = signToken({
    userId: user.id,
    householdId: user.household_id,
    name: user.name,
    role: user.role,
    isPlatformAdmin: user.is_platform_admin || false,
  });

  // Issue a rotating refresh token (7-day lifetime)
  const refreshToken = generateToken();
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await db.createRefreshToken(user.id, refreshToken, refreshExpiresAt);

  return {
    token,
    refreshToken,
    user: { id: user.id, name: user.name, role: user.role, color_theme: user.color_theme || 'sage', avatar_url: user.avatar_url || null, isPlatformAdmin: user.is_platform_admin || false },
    household: household ? { id: household.id, name: household.name, join_code: household.join_code, reminder_time: household.reminder_time } : null,
  };
}

// ─── POST /api/auth/register ────────────────────────────────────────────────

router.post('/register', async (req, res) => {
  const { email: userEmail, password, name, inviteToken } = req.body;

  if (!userEmail?.trim() || !password || !name?.trim()) {
    return res.status(400).json({ error: 'email, password, and name are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const emailLower = userEmail.trim().toLowerCase();

  try {
    const existing = await db.getUserByEmail(emailLower);
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    // If invite token provided, auto-verify and auto-join
    if (inviteToken) {
      const invite = await db.getInviteByToken(inviteToken);
      if (!invite) {
        return res.status(400).json({ error: 'Invalid or expired invite' });
      }

      const user = await db.createUserWithEmail({
        email: emailLower,
        passwordHash,
        name: invite.name || name.trim(),
        householdId: invite.household_id,
        emailVerified: true,
        role: 'member',
      });

      // Apply pre-filled profile fields from invite
      const profileUpdates = {};
      if (invite.family_role) profileUpdates.family_role = invite.family_role;
      if (invite.birthday) profileUpdates.birthday = invite.birthday;
      if (invite.color_theme) profileUpdates.color_theme = invite.color_theme;
      if (Object.keys(profileUpdates).length > 0) {
        await db.updateUser(user.id, profileUpdates);
      }

      await db.markInviteAccepted(invite.id);
      const updatedUser = Object.keys(profileUpdates).length > 0
        ? await db.updateUser(user.id, {}) // re-fetch isn't needed, merge locally
        : user;
      const response = await authResponse({ ...user, ...profileUpdates });
      return res.status(201).json(response);
    }

    // Normal registration — needs email verification
    const user = await db.createUserWithEmail({
      email: emailLower,
      passwordHash,
      name: name.trim(),
    });

    const token = generateToken();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours
    await db.createEmailVerificationToken(user.id, token, expiresAt);

    try {
      await email.sendVerificationEmail(emailLower, name.trim(), token);
    } catch (emailErr) {
      console.error('Failed to send verification email:', emailErr);
    }

    return res.status(201).json({ message: 'Check your email to verify your account.' });
  } catch (err) {
    console.error('POST /api/auth/register error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/auth/login ───────────────────────────────────────────────────

router.post('/login', async (req, res) => {
  const { email: userEmail, password } = req.body;

  if (!userEmail?.trim() || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  try {
    const user = await db.getUserByEmail(userEmail.trim().toLowerCase());
    if (!user || !user.password_hash) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (!user.email_verified) {
      return res.status(403).json({ error: 'Please verify your email first.' });
    }

    const response = await authResponse(user);
    return res.json(response);
  } catch (err) {
    console.error('POST /api/auth/login error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/auth/verify-email ─────────────────────────────────────────────

router.get('/verify-email', async (req, res) => {
  const { token } = req.query;
  const frontendUrl = process.env.WEB_URL || 'http://localhost:5173';

  if (!token) {
    return res.redirect(`${frontendUrl}/login?error=missing-token`);
  }

  try {
    const record = await db.getEmailVerificationToken(token);
    if (!record) {
      return res.redirect(`${frontendUrl}/login?error=invalid-token`);
    }

    await db.markEmailVerificationTokenUsed(record.id);
    await db.updateUser(record.user_id, { email_verified: true });
    return res.redirect(`${frontendUrl}/login?verified=true`);
  } catch (err) {
    console.error('GET /api/auth/verify-email error:', err);
    return res.redirect(`${frontendUrl}/login?error=server-error`);
  }
});

// ─── POST /api/auth/create-household ────────────────────────────────────────

router.post('/create-household', requireAuth, async (req, res) => {
  const { name, timezone } = req.body;

  if (!name?.trim()) {
    return res.status(400).json({ error: 'Household name is required' });
  }

  if (req.householdId) {
    return res.status(400).json({ error: 'You already belong to a household' });
  }

  try {
    const household = await db.createHousehold(name.trim(), timezone);
    const user = await db.updateUser(req.user.id, { household_id: household.id, role: 'admin' });

    // Seed public holidays in the background (don't block response)
    publicHolidays.seedHolidaysForNewHousehold(household.id, household.timezone, req.user.id)
      .catch((err) => console.error('Failed to seed public holidays:', err));

    const response = await authResponse(user);
    return res.status(201).json(response);
  } catch (err) {
    console.error('POST /api/auth/create-household error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/auth/forgot-password ─────────────────────────────────────────

router.post('/forgot-password', async (req, res) => {
  const { email: userEmail } = req.body;

  // Always return 200 to prevent email enumeration
  if (!userEmail?.trim()) {
    return res.json({ message: 'If that email is registered, a reset link has been sent.' });
  }

  try {
    const user = await db.getUserByEmail(userEmail.trim().toLowerCase());
    if (user) {
      const token = generateToken();
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour
      await db.createPasswordResetToken(user.id, token, expiresAt);
      try {
        await email.sendPasswordResetEmail(user.email, user.name, token);
      } catch (emailErr) {
        console.error('Failed to send reset email:', emailErr);
      }
    }
  } catch (err) {
    console.error('POST /api/auth/forgot-password error:', err);
  }

  return res.json({ message: 'If that email is registered, a reset link has been sent.' });
});

// ─── POST /api/auth/reset-password ──────────────────────────────────────────

router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;

  if (!token || !password) {
    return res.status(400).json({ error: 'token and password are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  try {
    const record = await db.getPasswordResetToken(token);
    if (!record) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await db.updateUser(record.user_id, { password_hash: passwordHash });
    await db.markPasswordResetTokenUsed(record.id);

    // Force logout on all devices by revoking every refresh token
    await db.revokeAllUserRefreshTokens(record.user_id);

    return res.json({ message: 'Password updated. You can now log in.' });
  } catch (err) {
    console.error('POST /api/auth/reset-password error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/auth/me ──────────────────────────────────────────────────────
// Lightweight authenticated check. Used by the frontend's visibility-change
// idle detector to trigger the 401 → refresh flow after long absences.

router.get('/me', requireAuth, (req, res) => {
  return res.json({ id: req.user.id, name: req.user.name, role: req.user.role });
});

// ─── POST /api/auth/refresh ────────────────────────────────────────────────
// Exchange a valid refresh token for a new access token + new refresh token.
// No Bearer auth required (the access token will typically be expired).

router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(400).json({ error: 'refreshToken is required' });
  }

  try {
    const record = await db.getValidRefreshToken(refreshToken);
    if (!record) {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    // Revoke the old token (single-use rotation)
    await db.revokeRefreshToken(record.id);

    // Fetch fresh user data (picks up role/household changes since last login)
    const user = await db.getUserById(record.user_id);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    const response = await authResponse(user);
    return res.json(response);
  } catch (err) {
    console.error('POST /api/auth/refresh error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/auth/logout ─────────────────────────────────────────────────
// Revoke the refresh token server-side so it can't be reused.

router.post('/logout', async (req, res) => {
  const { refreshToken } = req.body;

  try {
    if (refreshToken) {
      const record = await db.getValidRefreshToken(refreshToken);
      if (record) {
        await db.revokeRefreshToken(record.id);
      }
    }
    return res.json({ success: true });
  } catch (err) {
    console.error('POST /api/auth/logout error:', err);
    // Still return 200 — the client should clear local state regardless
    return res.json({ success: true });
  }
});

// ─── POST /api/auth/google ──────────────────────────────────────────────────

router.post('/google', async (req, res) => {
  const { idToken, inviteToken } = req.body;

  if (!idToken) {
    return res.status(400).json({ error: 'idToken is required' });
  }

  try {
    const { OAuth2Client } = require('google-auth-library');
    const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
    const ticket = await client.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const googleEmail = payload.email.toLowerCase();
    const googleName = payload.name || payload.given_name || googleEmail.split('@')[0];

    let user = await db.getUserByEmail(googleEmail);

    if (!user) {
      // Handle invite
      let householdId = null;
      const role = 'member';
      if (inviteToken) {
        const invite = await db.getInviteByToken(inviteToken);
        if (invite) {
          householdId = invite.household_id;
          await db.markInviteAccepted(invite.id);
        }
      }

      user = await db.createUserWithEmail({
        email: googleEmail,
        passwordHash: null,
        name: googleName,
        householdId,
        emailVerified: true,
        role,
      });
    }

    const response = await authResponse(user);
    return res.json(response);
  } catch (err) {
    console.error('POST /api/auth/google error:', err);
    return res.status(401).json({ error: 'Invalid Google token' });
  }
});

// ─── POST /api/auth/apple ───────────────────────────────────────────────────

router.post('/apple', async (req, res) => {
  const { idToken, name: appleName, inviteToken } = req.body;

  if (!idToken) {
    return res.status(400).json({ error: 'idToken is required' });
  }

  try {
    const jwt = require('jsonwebtoken');
    const jwksRsa = require('jwks-rsa');

    // Fetch Apple's public keys
    const jwksClient = jwksRsa({ jwksUri: 'https://appleid.apple.com/auth/keys', cache: true });
    const decoded = jwt.decode(idToken, { complete: true });
    if (!decoded) {
      return res.status(401).json({ error: 'Invalid Apple token' });
    }

    const key = await jwksClient.getSigningKey(decoded.header.kid);
    const payload = jwt.verify(idToken, key.getPublicKey(), {
      algorithms: ['RS256'],
      issuer: 'https://appleid.apple.com',
      audience: process.env.APPLE_CLIENT_ID,
    });

    const appleEmail = payload.email?.toLowerCase();
    if (!appleEmail) {
      return res.status(400).json({ error: 'Email not provided by Apple' });
    }

    let user = await db.getUserByEmail(appleEmail);

    if (!user) {
      const userName = appleName || appleEmail.split('@')[0];
      let householdId = null;
      if (inviteToken) {
        const invite = await db.getInviteByToken(inviteToken);
        if (invite) {
          householdId = invite.household_id;
          await db.markInviteAccepted(invite.id);
        }
      }

      user = await db.createUserWithEmail({
        email: appleEmail,
        passwordHash: null,
        name: userName,
        householdId,
        emailVerified: true,
        role: 'member',
      });
    }

    const response = await authResponse(user);
    return res.json(response);
  } catch (err) {
    console.error('POST /api/auth/apple error:', err);
    return res.status(401).json({ error: 'Invalid Apple token' });
  }
});

// ─── POST /api/auth/whatsapp-send-code ────────────────────────────────────────

router.post('/whatsapp-send-code', requireAuth, async (req, res) => {
  const { phone } = req.body;
  if (!phone?.trim()) {
    return res.status(400).json({ error: 'Phone number is required' });
  }

  // Normalise phone: ensure + prefix
  let normalised = phone.trim();
  if (!normalised.startsWith('+')) normalised = `+${normalised}`;

  try {
    const whatsapp = require('../services/whatsapp');
    if (!whatsapp.isConfigured()) {
      return res.status(503).json({ error: 'WhatsApp is not configured on this server' });
    }

    // Generate 6-digit code
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes

    await db.createWhatsAppVerificationCode(req.user.id, normalised, code, expiresAt);
    await whatsapp.sendVerificationCode(normalised, code);

    return res.json({ success: true, message: 'Verification code sent via WhatsApp' });
  } catch (err) {
    console.error('POST /api/auth/whatsapp-send-code error:', err.message, err.code, err.moreInfo);
    return res.status(500).json({ error: `Failed to send verification code: ${err.message || 'Unknown error'}` });
  }
});

// ─── POST /api/auth/whatsapp-verify-code ──────────────────────────────────────

router.post('/whatsapp-verify-code', requireAuth, async (req, res) => {
  const { code } = req.body;
  if (!code?.trim()) {
    return res.status(400).json({ error: 'Verification code is required' });
  }

  try {
    const record = await db.getWhatsAppVerificationCode(req.user.id, code.trim());
    if (!record) {
      return res.status(400).json({ error: 'Invalid or expired code. Please request a new one.' });
    }

    // Link the phone number
    await db.updateUser(req.user.id, {
      whatsapp_phone: record.phone,
      whatsapp_linked: true,
    });

    await db.markWhatsAppVerificationCodeUsed(record.id);
    if (req.householdId) cache.invalidate(`members:${req.householdId}`);

    return res.json({ success: true, phone: record.phone });
  } catch (err) {
    console.error('POST /api/auth/whatsapp-verify-code error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/auth/whatsapp-disconnect ───────────────────────────────────────

router.post('/whatsapp-disconnect', requireAuth, async (req, res) => {
  try {
    await db.updateUser(req.user.id, {
      whatsapp_phone: null,
      whatsapp_linked: false,
    });
    if (req.householdId) cache.invalidate(`members:${req.householdId}`);
    return res.json({ success: true });
  } catch (err) {
    console.error('POST /api/auth/whatsapp-disconnect error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/auth/join (legacy — kept for backwards compatibility) ────────

router.post('/join', async (req, res) => {
  const { code, name } = req.body;

  if (!code || !name?.trim()) {
    return res.status(400).json({ error: 'code and name are required' });
  }

  try {
    const household = await db.getHouseholdByCode(code.trim().toUpperCase());
    if (!household) {
      return res.status(404).json({ error: 'No household found with that code' });
    }

    const members = await db.getHouseholdMembers(household.id);
    let user = members.find((m) => m.name.toLowerCase() === name.trim().toLowerCase());

    if (!user) {
      user = await db.createUser({
        householdId: household.id,
        name: name.trim(),
        role: members.length === 0 ? 'admin' : 'member',
      });
    }

    // Use authResponse for consistency (includes refresh token)
    const response = await authResponse({ ...user, household_id: household.id });
    return res.json(response);
  } catch (err) {
    console.error('POST /api/auth/join error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
