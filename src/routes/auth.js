const { Router } = require('express');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const db = require('../db/queries');
const { signToken, requireAuth } = require('../middleware/auth');
const email = require('../services/email');
const publicHolidays = require('../services/publicHolidays');
const cache = require('../services/cache');
const { validatePassword } = require('../utils/password-strength');

const router = Router();

const BCRYPT_ROUNDS = 12;
const REFRESH_TOKEN_DAYS = 7;

// Helper: generate a crypto-random token
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Helper to extract session metadata (user-agent, client IP) from the
 * inbound request. Safe to call with a falsy req — returns an empty
 * object so callers without a request object still work.
 */
function sessionMetaFromReq(req) {
  if (!req) return {};
  return {
    userAgent: req.get?.('user-agent') || null,
    // Express populates req.ip by default; falls back to the raw socket
    // if a proxy header isn't configured. `trust proxy` is set in
    // src/app.js so req.ip is already the client's IP on Railway.
    ipAddress: req.ip || req.connection?.remoteAddress || null,
  };
}

// Helper: build the standard auth response (includes refresh token)
// `req` is optional — when provided we record session metadata against
// the newly-issued refresh token so Settings → Active sessions can show
// device + IP + last-used for it.
async function authResponse(user, req = null) {
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
  await db.createRefreshToken(user.id, refreshToken, refreshExpiresAt, sessionMetaFromReq(req));

  return {
    token,
    refreshToken,
    user: { id: user.id, name: user.name, role: user.role, color_theme: user.color_theme || 'sage', avatar_url: user.avatar_url || null, isPlatformAdmin: user.is_platform_admin || false, onboarded_at: user.onboarded_at || null },
    household: household ? { id: household.id, name: household.name, join_code: household.join_code, reminder_time: household.reminder_time } : null,
  };
}

// ─── POST /api/auth/register ────────────────────────────────────────────────

router.post('/register', async (req, res) => {
  const { email: userEmail, password, name, inviteToken } = req.body;

  if (!userEmail?.trim() || !password || !name?.trim()) {
    return res.status(400).json({ error: 'email, password, and name are required' });
  }

  const emailLower = userEmail.trim().toLowerCase();

  // Strength gate: minimum length, no personal-info, not in HaveIBeenPwned's
  // breach corpus. See src/utils/password-strength.js for policy + rationale.
  const strength = await validatePassword(password, { email: emailLower, name: name.trim() });
  if (!strength.valid) {
    return res.status(400).json({ error: strength.error });
  }

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
      const response = await authResponse({ ...user, ...profileUpdates }, req);
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

    const response = await authResponse(user, req);
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
    // Redirect to a dedicated confirmation page (not /login) — if the user
    // clicked the verify link in a browser where another session is already
    // active, bouncing via /login would trigger the logged-in redirect to
    // /dashboard and they'd never see the confirmation.
    return res.redirect(`${frontendUrl}/verified`);
  } catch (err) {
    console.error('GET /api/auth/verify-email error:', err);
    return res.redirect(`${frontendUrl}/login?error=server-error`);
  }
});

// ─── POST /api/auth/resend-verification ─────────────────────────────────────

router.post('/resend-verification', async (req, res) => {
  const { email: userEmail } = req.body;

  // Always return 200 to prevent email enumeration
  const genericResponse = { message: 'If that email is registered and unverified, a new verification link has been sent.' };

  if (!userEmail?.trim()) {
    return res.json(genericResponse);
  }

  try {
    const user = await db.getUserByEmail(userEmail.trim().toLowerCase());
    // Only send if user exists AND is not already verified
    if (user && !user.email_verified) {
      const token = generateToken();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours
      await db.createEmailVerificationToken(user.id, token, expiresAt);

      try {
        await email.sendVerificationEmail(user.email, user.name, token);
      } catch (emailErr) {
        console.error('Failed to resend verification email:', emailErr);
      }
    }
  } catch (err) {
    console.error('POST /api/auth/resend-verification error:', err);
  }

  return res.json(genericResponse);
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

    const response = await authResponse(user, req);
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

  try {
    const record = await db.getPasswordResetToken(token);
    if (!record) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    // Strength gate — we know the user's email + name from the lookup
    // above, so we pass them in for the personal-info check.
    const owner = await db.getUserById(record.user_id);
    const strength = await validatePassword(password, {
      email: owner?.email,
      name: owner?.name,
    });
    if (!strength.valid) {
      return res.status(400).json({ error: strength.error });
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

// ─── POST /api/auth/mark-onboarded ─────────────────────────────────────────
// Called by the frontend when the user finishes the onboarding wizard.
// Idempotent — if the column is already populated it leaves the original
// timestamp intact. Returns the updated user fields the AuthContext cares
// about so the client can refresh its local copy without another round-trip.

router.post('/mark-onboarded', requireAuth, async (req, res) => {
  try {
    const updated = await db.markUserOnboarded(req.user.id);
    return res.json({
      user: {
        id: updated.id,
        name: updated.name,
        role: updated.role,
        color_theme: updated.color_theme || 'sage',
        avatar_url: updated.avatar_url || null,
        isPlatformAdmin: updated.is_platform_admin || false,
        onboarded_at: updated.onboarded_at || null,
      },
    });
  } catch (err) {
    console.error('POST /api/auth/mark-onboarded error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/auth/export ──────────────────────────────────────────────────
// GDPR Article 20 — right to data portability. Returns a JSON bundle of
// every row Housemait holds about the requester + their household, in a
// structured machine-readable format.
//
// What's included
//   - The user's own row (password_hash and all auth-credential fields
//     redacted — those are session tokens, not personal data).
//   - The household row they belong to.
//   - Other household members: basic fields the user can already see in
//     Family Setup (name, role, colour theme, etc.) — NOT other members'
//     private fields like email or phone.
//   - Every household-scoped table the user has access to via the app:
//     tasks, calendar events, shopping lists + items, notes, meal plan,
//     documents metadata (not the file bytes — those live in R2 and are
//     too big to inline), invites, school dates, child schedules.
//   - The user's own activity logs: chat messages, AI usage, WhatsApp
//     message log.
//
// What's redacted / skipped
//   - password_hash, refresh_tokens, email_verification_tokens,
//     password_reset_tokens, device_tokens, OAuth credentials on
//     calendar_connections — all session/auth material, not personal data.
//   - Other members' email / phone / password_hash — belongs to them.
//
// Rate limiting is already handled by the /api/auth path limiter
// (20 req/hour per IP), which is fine for a download-my-data flow.

router.get('/export', requireAuth, async (req, res) => {
  const { supabaseAdmin } = require('../db/client');
  const userId = req.user.id;
  const householdId = req.householdId;

  // Defensive wrapper: a single failing query shouldn't blow up the whole
  // export. Any table that errors (e.g. doesn't exist in this deployment,
  // or RLS kicks in unexpectedly) gets logged and returns an empty array.
  async function safe(name, promise) {
    try {
      const { data, error } = await promise;
      if (error) throw error;
      return data || [];
    } catch (err) {
      console.error(`[export] ${name} failed:`, err.message || err);
      return [];
    }
  }
  async function safeSingle(name, promise) {
    try {
      const { data, error } = await promise;
      if (error && error.code !== 'PGRST116') throw error;
      return data || null;
    } catch (err) {
      console.error(`[export] ${name} failed:`, err.message || err);
      return null;
    }
  }

  try {
    // ── Requester's own row (redact secrets) ────────────────────────────
    const user = await safeSingle(
      'user',
      supabaseAdmin.from('users').select().eq('id', userId).single()
    );
    if (user) {
      delete user.password_hash;
    }

    // ── Household scope ─────────────────────────────────────────────────
    const [
      household, members, tasks, events, shoppingLists, shoppingItems,
      notes, mealPlan, documents, documentFolders, invites, schools,
      childActivities, childSchoolEvents, termDates,
      recipes, notificationPreferences,
    ] = await Promise.all([
      householdId ? safeSingle('household',
        supabaseAdmin.from('households').select().eq('id', householdId).single()
      ) : null,
      // Members — only fields the requester already sees in Family Setup.
      // Other members' email / phone / password_hash intentionally omitted.
      householdId ? safe('members',
        supabaseAdmin.from('users')
          .select('id, name, role, color_theme, avatar_url, birthday, member_type, family_role, allergies, created_at')
          .eq('household_id', householdId)
      ) : Promise.resolve([]),
      householdId ? safe('tasks', supabaseAdmin.from('tasks').select().eq('household_id', householdId)) : Promise.resolve([]),
      householdId ? safe('events', supabaseAdmin.from('calendar_events').select().eq('household_id', householdId)) : Promise.resolve([]),
      householdId ? safe('shopping_lists', supabaseAdmin.from('shopping_lists').select().eq('household_id', householdId)) : Promise.resolve([]),
      householdId ? safe('shopping_items', supabaseAdmin.from('shopping_items').select().eq('household_id', householdId)) : Promise.resolve([]),
      householdId ? safe('household_notes', supabaseAdmin.from('household_notes').select().eq('household_id', householdId)) : Promise.resolve([]),
      householdId ? safe('meal_plan', supabaseAdmin.from('meal_plan').select().eq('household_id', householdId)) : Promise.resolve([]),
      // Documents: metadata only — the file bytes live in Cloudflare R2.
      householdId ? safe('documents',
        supabaseAdmin.from('documents')
          .select('id, folder_id, name, size_bytes, mime_type, uploaded_by, created_at')
          .eq('household_id', householdId)
      ) : Promise.resolve([]),
      householdId ? safe('document_folders', supabaseAdmin.from('document_folders').select().eq('household_id', householdId)) : Promise.resolve([]),
      householdId ? safe('invites', supabaseAdmin.from('invites').select().eq('household_id', householdId)) : Promise.resolve([]),
      householdId ? safe('schools', supabaseAdmin.from('household_schools').select().eq('household_id', householdId)) : Promise.resolve([]),
      householdId ? safe('child_activities', supabaseAdmin.from('child_weekly_schedule').select('*, users!inner(household_id)').eq('users.household_id', householdId)) : Promise.resolve([]),
      householdId ? safe('child_school_events', supabaseAdmin.from('child_school_events').select('*, users!inner(household_id)').eq('users.household_id', householdId)) : Promise.resolve([]),
      householdId ? safe('term_dates', supabaseAdmin.from('school_term_dates').select('*, household_schools!inner(household_id)').eq('household_schools.household_id', householdId)) : Promise.resolve([]),
      householdId ? safe('recipes', supabaseAdmin.from('recipes').select().eq('household_id', householdId)) : Promise.resolve([]),
      safe('notification_preferences',
        supabaseAdmin.from('notification_preferences').select().eq('user_id', userId)
      ),
    ]);

    // ── User-scoped activity logs ───────────────────────────────────────
    const [chatConversations, chatMessages, whatsappLog, aiUsageLog] = await Promise.all([
      safe('chat_conversations', supabaseAdmin.from('chat_conversations').select().eq('user_id', userId)),
      safe('chat_messages', supabaseAdmin.from('chat_messages').select().eq('user_id', userId)),
      safe('whatsapp_message_log', supabaseAdmin.from('whatsapp_message_log').select().eq('user_id', userId)),
      safe('ai_usage_log', supabaseAdmin.from('ai_usage_log').select().eq('user_id', userId)),
    ]);

    const payload = {
      schema_version: '1.0',
      generated_at: new Date().toISOString(),
      notice:
        'This export contains every row Housemait holds about you and your household. ' +
        'Document file contents are stored in Cloudflare R2 and are available on request — ' +
        'only metadata (name, size, folder, created-at) is inlined here to keep the file ' +
        'readable. Secrets such as password hashes and OAuth tokens are intentionally omitted.',
      data_subject: user ? { id: user.id, name: user.name, email: user.email } : null,
      user,
      household,
      members,
      tasks,
      calendar_events: events,
      shopping_lists: shoppingLists,
      shopping_items: shoppingItems,
      household_notes: notes,
      meal_plan: mealPlan,
      documents,
      document_folders: documentFolders,
      invites,
      schools,
      child_activities: childActivities,
      child_school_events: childSchoolEvents,
      term_dates: termDates,
      recipes,
      notification_preferences: notificationPreferences,
      chat_conversations: chatConversations,
      chat_messages: chatMessages,
      whatsapp_message_log: whatsappLog,
      ai_usage_log: aiUsageLog,
    };

    const filename = `housemait-export-${new Date().toISOString().split('T')[0]}.json`;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.json(payload);
  } catch (err) {
    console.error('GET /api/auth/export error:', err);
    return res.status(500).json({ error: 'Could not generate export.' });
  }
});

// ─── DELETE /api/auth/account ──────────────────────────────────────────────
// Self-service account deletion. Requires the user to re-enter their
// password — the access token alone isn't enough for a destructive action
// like this.
//
// Behaviour based on household membership:
//   - Sole member of the household → delete the household entirely. The DB's
//     ON DELETE CASCADE wipes every task, event, shopping item, list, note,
//     document row, invite, WhatsApp verification code, etc.
//   - One of several members → delete just the user row. Strictly-personal
//     rows (refresh tokens, push device tokens, chat messages, etc.) cascade
//     away; household rows keep their content with added_by / assigned_to /
//     completed_by set to NULL so the audit trail doesn't vanish.
//   - Only admin with other members still present → promote the oldest non-
//     admin first so the household isn't left without an admin.
//
// Guards:
//   - Platform admins can't self-delete. Returns 403; they have to contact
//     support. (Stops us accidentally orphaning the whole platform.)
//   - Wrong password returns 401 without revealing which half failed.
router.delete('/account', requireAuth, async (req, res) => {
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ error: 'Password is required to delete your account.' });
  }

  try {
    const user = await db.getUserById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    if (user.is_platform_admin) {
      return res.status(403).json({
        error: 'Platform admins cannot delete their own account. Contact support.',
      });
    }

    // Verify the password before proceeding. Constant-time compare is
    // handled by bcrypt internally; we don't leak whether the user exists.
    const valid = await bcrypt.compare(password, user.password_hash || '');
    if (!valid) return res.status(401).json({ error: 'Incorrect password.' });

    // Sole member → nuke the household (cascade-deletes everything).
    if (user.household_id) {
      const members = await db.getHouseholdMembers(user.household_id);
      const otherMembers = members.filter((m) => m.id !== user.id);

      if (otherMembers.length === 0) {
        // Defensive pre-cleanup: a historical schema quirk left
        // event_reminders.household_id without ON DELETE CASCADE, so
        // Postgres blocks the household delete when any event reminders
        // exist for it. The migration at
        // supabase/migration-event-reminders-cascade-fix.sql fixes the FK
        // for new installs, but we clean them up explicitly here too so
        // deletion works even on databases that haven't applied the
        // migration yet. Safe to run unconditionally — if the FK is
        // already CASCADE, this just removes the rows slightly earlier.
        try {
          const { supabaseAdmin } = require('../db/client');
          await supabaseAdmin.from('event_reminders').delete().eq('household_id', user.household_id);
        } catch (cleanupErr) {
          console.warn('[delete-account] event_reminders pre-clean failed:', cleanupErr.message || cleanupErr);
          // Don't fail the whole deletion on the pre-clean — the cascade
          // might still work if the FK has already been fixed.
        }

        await db.deleteHouseholdCascade(user.household_id);
        return res.json({ mode: 'household_deleted' });
      }

      // Only admin with other members → promote the oldest non-admin to
      // admin so the household stays operable after we remove this user.
      if (user.role === 'admin') {
        const otherAdmins = otherMembers.filter((m) => m.role === 'admin');
        if (otherAdmins.length === 0) {
          const nextAdmin = [...otherMembers].sort(
            (a, b) => new Date(a.created_at) - new Date(b.created_at)
          )[0];
          await db.updateUser(nextAdmin.id, { role: 'admin' });
        }
      }
    }

    await db.deleteUserAdmin(req.user.id);
    return res.json({ mode: 'user_only' });
  } catch (err) {
    // Log the full Supabase/Postgres error so next time we hit this we can
    // see the actual cause in Railway logs instead of a generic 500.
    // Supabase errors expose .code (Postgres SQLSTATE), .details, .hint,
    // .message — all useful for FK-violation debugging.
    console.error('DELETE /api/auth/account error:', {
      code: err.code,
      message: err.message,
      details: err.details,
      hint: err.hint,
      userId: req.user?.id,
    });
    return res.status(500).json({ error: 'Could not delete account. Please try again.' });
  }
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

    const response = await authResponse(user, req);
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

// ─── Session management ────────────────────────────────────────────────────
// GET  /api/auth/sessions                         list my active sessions
// DELETE /api/auth/sessions/:id                   revoke one by id
// DELETE /api/auth/sessions?except=current        revoke all others (keeps current)
//
// The `/sessions` listing shows the caller which devices have live refresh
// tokens against their account, with user-agent + IP + last-used for each.
// The current session is flagged with isCurrent:true so the UI can style it
// differently and confirm before the user revokes their own browser.

/**
 * Resolve the session ID of the caller's CURRENT refresh token. The client
 * sends its refresh token as a header (X-Refresh-Token) or in the body —
 * the server looks up its ID so the UI can mark the current row. Returns
 * null if no valid refresh token matches (the user's session is access-
 * token-only right now, which happens when they're within the 1h access
 * window since their last refresh).
 */
async function resolveCurrentSessionId(req) {
  const refreshToken = req.get('x-refresh-token') || req.body?.refreshToken;
  if (!refreshToken) return null;
  const record = await db.getValidRefreshToken(refreshToken);
  return record?.id || null;
}

router.get('/sessions', requireAuth, async (req, res) => {
  try {
    const [sessions, currentId] = await Promise.all([
      db.getActiveSessionsForUser(req.user.id),
      resolveCurrentSessionId(req),
    ]);
    const rows = sessions.map((s) => ({
      id: s.id,
      userAgent: s.user_agent,
      ipAddress: s.ip_address,
      createdAt: s.created_at,
      lastUsedAt: s.last_used_at,
      expiresAt: s.expires_at,
      isCurrent: s.id === currentId,
    }));
    return res.json({ sessions: rows });
  } catch (err) {
    console.error('GET /api/auth/sessions error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/sessions/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    // Confirm the session belongs to the caller before revoking. Prevents
    // id-guessing / horizontal privilege escalation — someone with a valid
    // auth token for user A shouldn't be able to revoke user B's sessions.
    const mine = await db.getActiveSessionsForUser(req.user.id);
    if (!mine.some((s) => s.id === id)) {
      return res.status(404).json({ error: 'Session not found.' });
    }
    await db.revokeRefreshToken(id);
    return res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/auth/sessions/:id error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/sessions', requireAuth, async (req, res) => {
  try {
    // The client opts in to preserving the current session via the
    // ?except=current query flag. Without it, every active session
    // (including the caller's) is revoked — which is what you want from
    // a "sign out everywhere" button.
    const keepCurrent = req.query.except === 'current';
    const currentId = keepCurrent ? await resolveCurrentSessionId(req) : null;
    await db.revokeOtherUserRefreshTokens(req.user.id, currentId);
    return res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/auth/sessions error:', err);
    return res.status(500).json({ error: 'Internal server error' });
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

    const response = await authResponse(user, req);
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

    const response = await authResponse(user, req);
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

    // Send a welcome / onboarding message. Fire-and-forget — a WhatsApp
    // hiccup must not break the connect flow since the DB is already updated.
    const whatsapp = require('../services/whatsapp');
    const welcome = [
      `👋 Welcome to Housemait, ${req.user.name}!`,
      '',
      `Here's what you can do — just chat naturally:`,
      '',
      `🛒 "We need milk and eggs" — adds to shopping list`,
      `📋 "Remind me to book car service" — creates a task`,
      `📅 "Dentist on Tuesday at 3pm" — adds to calendar`,
      `🍲 "Recipe for shepherd's pie" — generates a recipe`,
      `🌤 "Will it rain today?" — weather`,
      `❓ Ask me anything about your household`,
      '',
      `📌 *Pin this chat* so it stays at the top — swipe right (iOS) or tap-and-hold (Android), then tap Pin.`,
    ].join('\n');

    whatsapp.sendMessage(record.phone, welcome).catch((err) => {
      console.error('[whatsapp-verify] welcome message failed:', err.message);
    });

    return res.json({
      success: true,
      phone: record.phone,
      bot_number: whatsapp.getBotNumberForWaLink(),
    });
  } catch (err) {
    console.error('POST /api/auth/whatsapp-verify-code error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/auth/whatsapp-bot-info ──────────────────────────────────────────
// Returns the bot's WhatsApp number so the UI can build a wa.me deep link.

router.get('/whatsapp-bot-info', requireAuth, (req, res) => {
  const whatsapp = require('../services/whatsapp');
  return res.json({
    configured: whatsapp.isConfigured(),
    bot_number: whatsapp.getBotNumberForWaLink(),
  });
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
    const response = await authResponse({ ...user, household_id: household.id }, req);
    return res.json(response);
  } catch (err) {
    console.error('POST /api/auth/join error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
