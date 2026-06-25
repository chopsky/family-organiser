const { Router } = require('express');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const db = require('../db/queries');
const { signToken, requireAuth } = require('../middleware/auth');
const { requireTurnstile } = require('../middleware/turnstile');
const email = require('../services/email');
const publicHolidays = require('../services/publicHolidays');
const cache = require('../services/cache');
const stripeService = require('../services/stripe');
const { validatePassword } = require('../utils/password-strength');
const { publicHousehold } = require('../utils/publicHousehold');

const router = Router();

const BCRYPT_ROUNDS = 12;
const REFRESH_TOKEN_DAYS = 7;

// Helper: generate a crypto-random token
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Helper to extract session metadata (user-agent, client IP) from the
 * inbound request. Safe to call with a falsy req - returns an empty
 * object so callers without a request object still work.
 */
// Normalise a campaign promo code captured at signup (uppercase, validated).
// Returns the cleaned code or null. Shared by /register, /google, /apple.
function sanitizePromoCode(raw) {
  return typeof raw === 'string' && /^[A-Za-z0-9_-]{2,40}$/.test(raw.trim())
    ? raw.trim().toUpperCase()
    : null;
}

function sessionMetaFromReq(req) {
  if (!req) return {};
  return {
    userAgent: req.get?.('user-agent') || null,
    // Native app build, e.g. "1.7.0 (22)". Null on web. Lets us tell which
    // app version a user's sessions are on (see getPlatformsByUserIds).
    appVersion: req.get?.('x-app-version') || null,
    // Express populates req.ip by default; falls back to the raw socket
    // if a proxy header isn't configured. `trust proxy` is set in
    // src/app.js so req.ip is already the client's IP on Railway.
    ipAddress: req.ip || req.connection?.remoteAddress || null,
  };
}

// Helper: build the standard auth response (includes refresh token)
// `req` is optional - when provided we record session metadata against
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
    // created_at + whatsapp_linked are surfaced for the trial-week
    // activation experience (web/src/components/WelcomeChecklist.jsx) -
    // the checklist needs to know whether to render at all (within
    // 7 days of signup) and whether to tick "Connect WhatsApp"
    // automatically. Both are cheap reads, both already on the row.
    user: {
      id: user.id,
      name: user.name,
      role: user.role,
      // The user's own email + auth provider are surfaced to the
      // frontend (Settings → Account card uses these to show "Signed
      // in with Google" / "Signed in with email" etc.). Other users'
      // emails stay private - see the comment in /api/household for
      // the strict member-only redaction we apply there.
      email: user.email || null,
      auth_provider: user.auth_provider || null,
      color_theme: user.color_theme || 'sage',
      avatar_url: user.avatar_url || null,
      isPlatformAdmin: user.is_platform_admin || false,
      onboarded_at: user.onboarded_at || null,
      created_at: user.created_at || null,
      whatsapp_linked: !!user.whatsapp_linked,
      // Campaign promo saved at signup - drives the "claim your discount"
      // banner + auto-apply at annual checkout. Null for most users.
      signup_promo_code: user.signup_promo_code || null,
    },
    // Return the (almost) full household row so new columns surface
    // automatically and avatar_url / address / email_alias etc. stay put on
    // every refresh-token rotation. publicHousehold() strips the one field we
    // must NOT leak - child_mode_pin_hash - and adds the derived
    // child_mode_pin_set boolean the UI keys off; without it a fresh login
    // showed "no PIN set" and re-prompted the user to set one.
    household: publicHousehold(household),
  };
}

// ─── POST /api/auth/register ────────────────────────────────────────────────

router.post('/register', requireTurnstile, async (req, res) => {
  const { email: userEmail, password, name, inviteToken, promoCode } = req.body;

  if (!userEmail?.trim() || !password || !name?.trim()) {
    return res.status(400).json({ error: 'email, password, and name are required' });
  }

  const emailLower = userEmail.trim().toLowerCase();

  // Campaign promo captured from a tagged signup link (e.g. /signup?promo=...).
  // Stored on the account so it can be surfaced + auto-applied at the annual
  // checkout later. Only meaningful for a new household owner (the invite
  // branch below creates a member who joins someone else's billing).
  const signupPromoCode = sanitizePromoCode(promoCode);

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

    // Invite auto-attach. Two paths feed the same branch:
    //   1. Explicit `inviteToken` from the URL (?invite=...) - the user
    //      clicked the link in the admin's invite email.
    //   2. Implicit email match - the admin invited this exact email
    //      address, but the user signed up via the App Store / direct
    //      signup form without clicking the link. We look up a pending
    //      invite by email and treat it the same way. This is the
    //      safety net that stops family members from each creating a
    //      separate household when one was already waiting for them.
    let invite = null;
    if (inviteToken) {
      invite = await db.getInviteByToken(inviteToken);
      if (!invite) {
        return res.status(400).json({ error: 'Invalid or expired invite' });
      }
    } else {
      invite = await db.getInviteByEmail(emailLower);
      if (invite) {
        console.log(`[auth/register] Auto-attaching ${emailLower} to household ${invite.household_id} via pending invite ${invite.id}`);
      }
    }

    if (invite) {
      const user = await db.createUserWithEmail({
        email: emailLower,
        passwordHash,
        name: invite.name || name.trim(),
        householdId: invite.household_id,
        emailVerified: true,
        role: 'member',
        authProvider: 'email',
      });

      // Apply pre-filled profile fields from invite. Colour theme:
      // honour the inviter's pick if they set one, otherwise auto-
      // assign the first colour not yet used by anyone in the household
      // so every member gets a distinct avatar without admin effort.
      const profileUpdates = {};
      if (invite.family_role) profileUpdates.family_role = invite.family_role;
      if (invite.birthday) profileUpdates.birthday = invite.birthday;
      profileUpdates.color_theme = invite.color_theme || await db.pickColorForNewMember(invite.household_id);
      if (invite.school_id) profileUpdates.school_id = invite.school_id;
      await db.updateUser(user.id, profileUpdates);

      await db.markInviteAccepted(invite.id);
      const response = await authResponse({ ...user, ...profileUpdates }, req);
      return res.status(201).json(response);
    }

    // Normal registration - needs email verification
    const user = await db.createUserWithEmail({
      email: emailLower,
      passwordHash,
      name: name.trim(),
      authProvider: 'email',
      signupPromoCode,
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

router.post('/login', requireTurnstile, async (req, res) => {
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

    // Re-stamp auth_provider so the Settings card always reflects the
    // latest credential the user actually used. A Google-signup user
    // who later sets a password will now show "Signed in with email"
    // after their first password login.
    if (user.auth_provider !== 'email') {
      try { await db.updateUser(user.id, { auth_provider: 'email' }); user.auth_provider = 'email'; } catch {}
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
    // Redirect to a dedicated confirmation page (not /login) - if the user
    // clicked the verify link in a browser where another session is already
    // active, bouncing via /login would trigger the logged-in redirect to
    // /dashboard and they'd never see the confirmation.
    return res.redirect(`${frontendUrl}/verified`);
  } catch (err) {
    console.error('GET /api/auth/verify-email error:', err);
    return res.redirect(`${frontendUrl}/login?error=server-error`);
  }
});

// ─── POST /api/auth/verify-email-and-login ──────────────────────────────────
//
// Called by the in-app /verify React route when the user taps the verify
// link from their email. The link itself is now a Universal Link
// (https://housemait.com/verify?token=…) so on iOS it opens the
// Housemait app directly; on web it just renders /verify in the browser.
// Either way, the React /verify page POSTs the token here, we verify +
// flip email_verified, and issue a JWT so the user lands back inside the
// app already logged-in. They continue straight into the onboarding
// wizard with no manual log-in step.
//
// Same single-use token rules as the GET endpoint above. If the user
// already verified via the browser GET (e.g. they tapped the link on
// desktop), the token is consumed so this POST returns 'invalid' - the
// client then prompts them to log in normally.
router.post('/verify-email-and-login', async (req, res) => {
  const { token } = req.body || {};
  if (!token) {
    return res.status(400).json({ error: 'Verification token required.' });
  }
  try {
    const record = await db.getEmailVerificationToken(token);
    if (!record) {
      return res.status(400).json({ error: 'Invalid or expired link. Please log in instead.' });
    }
    await db.markEmailVerificationTokenUsed(record.id);
    await db.updateUser(record.user_id, { email_verified: true });

    const user = await db.getUserById(record.user_id);
    if (!user) {
      return res.status(500).json({ error: 'User not found after verification.' });
    }
    const response = await authResponse(user, req);
    return res.json(response);
  } catch (err) {
    console.error('POST /api/auth/verify-email-and-login error:', err);
    return res.status(500).json({ error: 'Verification failed. Please try logging in.' });
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
  const { name, timezone, country } = req.body;

  if (!name?.trim()) {
    return res.status(400).json({ error: 'Household name is required' });
  }

  if (req.householdId) {
    return res.status(400).json({ error: 'You already belong to a household' });
  }

  // Validate country against the same allow-list the DB CHECK constraint
  // uses. If the client sends something unrecognised, fall through to DB
  // default 'GB' rather than rejecting - being lenient on creation matters
  // more than rejecting an odd value (the user can fix it in Settings).
  const ALLOWED_COUNTRIES = ['GB', 'IE', 'US', 'CA', 'AU', 'NZ', 'ZA', 'OTHER'];
  const safeCountry = ALLOWED_COUNTRIES.includes(country) ? country : undefined;

  try {
    const household = await db.createHousehold(name.trim(), timezone, safeCountry);
    // Brand-new household has no members yet, so pickColorForNewMember
    // returns the first colour in the canonical list (red). Subsequent
    // members will fall through to the next unused colour.
    const color_theme = await db.pickColorForNewMember(household.id);
    const user = await db.updateUser(req.user.id, { household_id: household.id, role: 'admin', color_theme });

    // Seed public holidays in the background (don't block response)
    publicHolidays.seedHolidaysForNewHousehold(household.id, household.timezone, req.user.id, household.country)
      .catch((err) => console.error('Failed to seed public holidays:', err));

    // Send the welcome email - fire-and-forget. Dedupes via
    // sent_emails.(household_id, email_type) so if the user somehow
    // triggers this twice (double-click, rollback + retry) only one
    // welcome lands. Household creation = day 1 of the trial by
    // definition (trial_started_at defaults to NOW() in the schema).
    (async () => {
      try {
        const firstName = (user.name || '').trim().split(/\s+/)[0];
        const claimed = await db.markEmailSentIfNew(household.id, 'welcome');
        if (!claimed) return;
        await email.sendWelcomeEmail({
          to: user.email,
          firstName,
          trialEndsAt: household.trial_ends_at,
          householdId: household.id,
        });
      } catch (err) {
        // Never block household creation on an email blip. Log
        // loudly so we notice if this starts failing systematically.
        console.error('[welcome-email] failed to send for household', household.id, err.message);
      }
    })();

    const response = await authResponse(user, req);
    return res.status(201).json(response);
  } catch (err) {
    console.error('POST /api/auth/create-household error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/auth/attach-to-household ─────────────────────────────────────
//
// Join an existing household by code, from the /setup screen. Used by the
// "Join an existing household" tab on SetupHousehold.jsx - the user has
// already signed up (so we have a verified account + auth token) but
// hasn't been assigned to a household yet. This is distinct from the
// legacy /api/auth/join endpoint a few hundred lines below, which is
// unauthenticated and creates a user on the fly; this endpoint is
// authenticated and only attaches the already-existing caller.
//
// Refuses if the caller already belongs to a household (to keep
// "switch households" a separate explicit feature, not an accidental
// side-effect of someone re-entering their setup screen). Code is
// matched case-insensitively against households.join_code.

router.post('/attach-to-household', requireAuth, async (req, res) => {
  const { code } = req.body || {};

  if (!code?.trim()) {
    return res.status(400).json({ error: 'Join code is required' });
  }

  if (req.householdId) {
    return res.status(400).json({ error: 'You already belong to a household' });
  }

  try {
    const household = await db.getHouseholdByCode(code.trim().toUpperCase());
    if (!household) {
      return res.status(404).json({ error: "That code didn't match a household. Double-check with the admin who shared it." });
    }

    // Assign as a regular member (admin is reserved for the household
    // creator + anyone the admin promotes from the Family page). Pick
    // the first colour not yet used by existing members so the new
    // joiner gets a distinct avatar without admin effort - mirrors
    // the invite-accept and create-household flows.
    const color_theme = await db.pickColorForNewMember(household.id);
    const user = await db.updateUser(req.user.id, {
      household_id: household.id,
      role: 'member',
      color_theme,
    });

    const response = await authResponse(user, req);
    return res.status(200).json(response);
  } catch (err) {
    console.error('POST /api/auth/attach-to-household error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/auth/forgot-password ─────────────────────────────────────────

router.post('/forgot-password', requireTurnstile, async (req, res) => {
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

    // Strength gate - we know the user's email + name from the lookup
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

router.get('/me', requireAuth, async (req, res) => {
  // Returns the user's own profile fields including email + auth
  // provider so the Settings → Account card has what it needs to
  // show "Signed in with Google" / "Signed in with Apple" / their
  // email address. We do one fresh DB read here rather than relying
  // on JWT claims so the response reflects any provider re-stamp
  // that happened on the user's latest sign-in.
  try {
    const fresh = await db.getUserById(req.user.id);
    if (!fresh) return res.status(404).json({ error: 'User not found' });
    return res.json({
      id: fresh.id,
      name: fresh.name,
      role: fresh.role,
      email: fresh.email || null,
      auth_provider: fresh.auth_provider || null,
      signup_promo_code: fresh.signup_promo_code || null,
      // Always include onboarded_at (null or timestamp) so the web client can
      // refresh it on boot. Completing onboarding on one device used to leave
      // other devices stuck redirecting into the flow, because their cached
      // user kept onboarded_at = null forever.
      onboarded_at: fresh.onboarded_at || null,
    });
  } catch (err) {
    console.error('GET /api/auth/me error:', err);
    return res.json({ id: req.user.id, name: req.user.name, role: req.user.role });
  }
});

// ─── POST /api/auth/mark-onboarded ─────────────────────────────────────────
// Called by the frontend when the user finishes the onboarding wizard.
// Idempotent - if the column is already populated it leaves the original
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
// GDPR Article 20 - right to data portability. Returns a JSON bundle of
// every row Housemait holds about the requester + their household, in a
// structured machine-readable format.
//
// What's included
//   - The user's own row (password_hash and all auth-credential fields
//     redacted - those are session tokens, not personal data).
//   - The household row they belong to.
//   - Other household members: basic fields the user can already see in
//     Family Setup (name, role, colour theme, etc.) - NOT other members'
//     private fields like email or phone.
//   - Every household-scoped table the user has access to via the app:
//     tasks, calendar events, shopping lists + items, notes, meal plan,
//     documents metadata (not the file bytes - those live in R2 and are
//     too big to inline), invites, school dates, child schedules.
//   - The user's own activity logs: chat messages, AI usage, WhatsApp
//     message log.
//
// What's redacted / skipped
//   - password_hash, refresh_tokens, email_verification_tokens,
//     password_reset_tokens, device_tokens, OAuth credentials on
//     calendar_connections - all session/auth material, not personal data.
//   - Other members' email / phone / password_hash - belongs to them.
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
      // Members - only fields the requester already sees in Family Setup.
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
      // Documents: metadata only - the file bytes live in Cloudflare R2.
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
        'Document file contents are stored in Cloudflare R2 and are available on request - ' +
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
// password - the access token alone isn't enough for a destructive action
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
  const { password, confirmation } = req.body;
  if (!password) {
    return res.status(400).json({ error: 'Password is required to delete your account.' });
  }
  // Phase 8 / spec §9: belt-and-braces typed-word confirmation on top of
  // the password re-entry. The frontend can still show its own modal
  // affordance, but the backend also insists on the literal word
  // "DELETE" so a hijacked session or a replay of a stolen auth token
  // can't quietly wipe an account without the explicit string.
  if (confirmation !== 'DELETE') {
    return res.status(400).json({
      error: 'Type DELETE (in capitals) to confirm account deletion.',
    });
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

    // Load the household row once so we can both (a) decide the deletion
    // mode and (b) snapshot Stripe state for the audit log before the
    // row is gone.
    let household = null;
    let members = [];
    let otherMembers = [];
    if (user.household_id) {
      household = await db.getHouseholdById(user.household_id);
      members = await db.getHouseholdMembers(user.household_id);
      otherMembers = members.filter((m) => m.id !== user.id);
    }
    // Dependents are users rows (member_type='dependent') but not real
    // account-holders. The household only "empties" when the last account
    // leaves; its dependents should then be cascaded away with it, not left to
    // keep an ownerless household alive.
    const otherAccounts = otherMembers.filter((m) => m.member_type !== 'dependent');
    const willDeleteHousehold = !!household && otherAccounts.length === 0;
    const deletionMode = willDeleteHousehold ? 'household_deleted' : 'user_only';

    // ── Stripe: cancel the subscription BEFORE we nuke the row ──
    // Only relevant when the whole household is going away. When it's
    // user_only the household (and its Stripe customer) survives, so we
    // leave the subscription alone. Failure to cancel is non-fatal -
    // the deletion proceeds and we record stripe_cancelled=false in
    // the audit row so support can remediate if needed.
    let stripeCancelled = false;
    if (willDeleteHousehold && household?.stripe_subscription_id) {
      try {
        const stripe = stripeService.getStripe();
        await stripe.subscriptions.cancel(household.stripe_subscription_id);
        stripeCancelled = true;
      } catch (err) {
        // Common 404 here means the subscription was already cancelled
        // in the Stripe dashboard - treat as success.
        if (err?.code === 'resource_missing') {
          stripeCancelled = true;
        } else {
          console.error(
            '[delete-account] Stripe subscription cancel failed for household',
            household.id,
            '- proceeding with deletion:',
            err.message
          );
        }
      }
    }

    // ── Audit log: write BEFORE the deletion so the row survives ──
    // Intentionally best-effort. If the audit write fails we log loudly
    // but don't block the deletion - GDPR's right-to-erasure beats our
    // internal logging. Support can cross-reference Railway logs if the
    // audit row is missing.
    try {
      const { supabaseAdmin } = require('../db/client');
      await supabaseAdmin.from('deletion_audit_log').insert({
        user_id: user.id,
        user_email: user.email || null,
        household_id: household?.id || null,
        household_name: household?.name || null,
        deletion_mode: deletionMode,
        stripe_customer_id:     household?.stripe_customer_id || null,
        stripe_subscription_id: household?.stripe_subscription_id || null,
        stripe_cancelled:       stripeCancelled,
        ip_address: req.ip || null,
        user_agent: req.headers['user-agent'] || null,
      });
    } catch (err) {
      console.error('[delete-account] audit log insert failed - continuing with deletion:', err.message);
    }

    // ── Actual deletion ──
    if (willDeleteHousehold) {
      // Defensive pre-cleanup: a historical schema quirk left
      // event_reminders.household_id without ON DELETE CASCADE, so
      // Postgres blocks the household delete when any event reminders
      // exist for it. The migration at
      // supabase/migration-event-reminders-cascade-fix.sql fixes the FK
      // for new installs, but we clean them up explicitly here too so
      // deletion works even on databases that haven't applied the
      // migration yet. Safe to run unconditionally - if the FK is
      // already CASCADE, this just removes the rows slightly earlier.
      try {
        const { supabaseAdmin } = require('../db/client');
        await supabaseAdmin.from('event_reminders').delete().eq('household_id', user.household_id);
      } catch (cleanupErr) {
        console.warn('[delete-account] event_reminders pre-clean failed:', cleanupErr.message || cleanupErr);
      }

      await db.deleteHouseholdCascade(user.household_id);
      return res.json({ mode: 'household_deleted', stripe_cancelled: stripeCancelled });
    }

    // Only admin with other accounts → promote the oldest non-admin account
    // to admin so the household stays operable after we remove this user.
    // Pick from real accounts only: a dependent (kid) must never become admin,
    // and reaching here guarantees at least one other account exists (else
    // willDeleteHousehold would have been true).
    if (user.household_id && user.role === 'admin') {
      const otherAdmins = otherAccounts.filter((m) => m.role === 'admin');
      if (otherAdmins.length === 0 && otherAccounts.length > 0) {
        const nextAdmin = [...otherAccounts].sort(
          (a, b) => new Date(a.created_at) - new Date(b.created_at)
        )[0];
        await db.updateUser(nextAdmin.id, { role: 'admin' });
      }
    }

    await db.deleteUserAdmin(req.user.id);
    return res.json({ mode: 'user_only' });
  } catch (err) {
    // Log the full Supabase/Postgres error so next time we hit this we can
    // see the actual cause in Railway logs instead of a generic 500.
    // Supabase errors expose .code (Postgres SQLSTATE), .details, .hint,
    // .message - all useful for FK-violation debugging.
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
    // Still return 200 - the client should clear local state regardless
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
 * sends its refresh token as a header (X-Refresh-Token) or in the body -
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
    // id-guessing / horizontal privilege escalation - someone with a valid
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
    // (including the caller's) is revoked - which is what you want from
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
  const { idToken, code, inviteToken, promoCode } = req.body;
  const signupPromoCode = sanitizePromoCode(promoCode);

  if (!idToken && !code) {
    return res.status(400).json({ error: 'idToken or code is required' });
  }

  try {
    const { OAuth2Client } = require('google-auth-library');
    const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
    // Accept tokens issued by EITHER the web client OR the iOS native client.
    // Google issues different idTokens for each (different `aud` claim) - same
    // user, same email, but the audience differs. Passing an array tells the
    // verifier to accept any of these. The token's signature must still be
    // valid Google-signed, so allowing two audiences doesn't open an attack
    // surface - it just lets the same backend handle both surfaces.
    const validAudiences = [process.env.GOOGLE_CLIENT_ID];
    if (process.env.GOOGLE_IOS_CLIENT_ID) {
      validAudiences.push(process.env.GOOGLE_IOS_CLIENT_ID);
    }

    // The web app uses a custom "Continue with Google" button wired to
    // Google's OAuth popup (authorization-code) flow, so it sends a one-time
    // `code` rather than an idToken. Exchange it for tokens server-side, then
    // verify the returned id_token exactly like the iOS idToken path below.
    // redirect_uri 'postmessage' is the value Google's JS code client
    // (ux_mode: 'popup') binds the code to.
    let verificationToken = idToken;
    if (code) {
      if (!process.env.GOOGLE_CLIENT_SECRET) {
        console.error('POST /api/auth/google: GOOGLE_CLIENT_SECRET is not set; cannot exchange auth code.');
        return res.status(500).json({ error: 'Google sign-in is not configured.' });
      }
      const exchangeClient = new OAuth2Client(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        'postmessage',
      );
      const { tokens } = await exchangeClient.getToken(code);
      verificationToken = tokens.id_token;
      if (!verificationToken) {
        return res.status(401).json({ error: 'Google sign-in failed.' });
      }
    }

    const ticket = await client.verifyIdToken({
      idToken: verificationToken,
      audience: validAudiences,
    });
    const payload = ticket.getPayload();
    const googleEmail = payload.email.toLowerCase();
    const googleName = payload.name || payload.given_name || googleEmail.split('@')[0];

    let user = await db.getUserByEmail(googleEmail);

    if (!user) {
      // Handle invite - hold the invite reference so we can copy its pre-fill
      // fields onto the new user after createUserWithEmail returns. Mirrors
      // the email/password flow above (~line 122-130). Without this, family
      // role / birthday / colour theme / school_id set by the inviter are
      // silently dropped on SSO sign-up.
      let householdId = null;
      let acceptedInvite = null;
      const role = 'member';
      // Same two paths as /register above: explicit invite token OR
      // pending-invite-by-email fallback. Without the fallback, a
      // family member who taps "Continue with Google" from the App
      // Store - without ever clicking the admin's email invite -
      // creates a duplicate household.
      let invite = null;
      if (inviteToken) {
        invite = await db.getInviteByToken(inviteToken);
      } else {
        invite = await db.getInviteByEmail(googleEmail);
        if (invite) {
          console.log(`[auth/google] Auto-attaching ${googleEmail} to household ${invite.household_id} via pending invite ${invite.id}`);
        }
      }
      if (invite) {
        householdId = invite.household_id;
        acceptedInvite = invite;
        await db.markInviteAccepted(invite.id);
      }

      user = await db.createUserWithEmail({
        email: googleEmail,
        passwordHash: null,
        name: googleName,
        householdId,
        emailVerified: true,
        role,
        authProvider: 'google',
        // Only the household owner (no invite) carries the campaign promo.
        signupPromoCode: acceptedInvite ? null : signupPromoCode,
      });

      if (acceptedInvite) {
        const profileUpdates = {};
        if (acceptedInvite.family_role) profileUpdates.family_role = acceptedInvite.family_role;
        if (acceptedInvite.birthday) profileUpdates.birthday = acceptedInvite.birthday;
        profileUpdates.color_theme = acceptedInvite.color_theme || await db.pickColorForNewMember(acceptedInvite.household_id);
        if (acceptedInvite.school_id) profileUpdates.school_id = acceptedInvite.school_id;
        await db.updateUser(user.id, profileUpdates);
        user = { ...user, ...profileUpdates };
      }
    } else if (user.auth_provider !== 'google') {
      // Existing user signing in via Google - stamp the latest method
      // so Settings reflects the credential they actually used. A user
      // who originally signed up with email and now signs in with
      // Google sees "Signed in with Google" after this.
      try { await db.updateUser(user.id, { auth_provider: 'google' }); user.auth_provider = 'google'; } catch {}
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
  const { idToken, name: appleName, inviteToken, promoCode } = req.body;
  const signupPromoCode = sanitizePromoCode(promoCode);

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

    // Accept tokens from EITHER the web Services ID OR the iOS bundle ID.
    // Apple Sign-In on web uses a Services ID (something like
    // 'com.housemait.app.signin'), whereas iOS native uses the app's bundle
    // ID directly via the com.apple.developer.applesignin entitlement -
    // Apple signs each token with the corresponding `aud` claim. Same as
    // the Google flow, allowing two audiences doesn't open an attack
    // surface because the signature is still verified against Apple's
    // public keys.
    //
    // APPLE_NATIVE_BUNDLE_ID defaults to 'com.housemait.app' - same value
    // hardcoded in capacitor.config.json's appId. Override via env if you
    // ever ship a second bundle (TestFlight-only build, dev variant, etc.).
    const validAudiences = [];
    if (process.env.APPLE_CLIENT_ID) validAudiences.push(process.env.APPLE_CLIENT_ID);
    validAudiences.push(process.env.APPLE_NATIVE_BUNDLE_ID || 'com.housemait.app');
    const key = await jwksClient.getSigningKey(decoded.header.kid);
    const payload = jwt.verify(idToken, key.getPublicKey(), {
      algorithms: ['RS256'],
      issuer: 'https://appleid.apple.com',
      audience: validAudiences,
    });

    const appleEmail = payload.email?.toLowerCase();
    if (!appleEmail) {
      return res.status(400).json({ error: 'Email not provided by Apple' });
    }

    let user = await db.getUserByEmail(appleEmail);

    if (!user) {
      const userName = appleName || appleEmail.split('@')[0];
      // Hold the invite reference so we can copy its pre-fill fields onto the
      // new user. Mirrors the email/password and Google blocks above.
      let householdId = null;
      let acceptedInvite = null;
      // Two paths feed the same attach branch: explicit token from the
      // invite-link URL, or pending-invite-by-email fallback so a
      // family member who taps "Continue with Apple" from the App
      // Store - without clicking the admin's email invite - doesn't
      // accidentally create a duplicate household.
      let invite = null;
      if (inviteToken) {
        invite = await db.getInviteByToken(inviteToken);
      } else {
        invite = await db.getInviteByEmail(appleEmail);
        if (invite) {
          console.log(`[auth/apple] Auto-attaching ${appleEmail} to household ${invite.household_id} via pending invite ${invite.id}`);
        }
      }
      if (invite) {
        householdId = invite.household_id;
        acceptedInvite = invite;
        await db.markInviteAccepted(invite.id);
      }

      user = await db.createUserWithEmail({
        email: appleEmail,
        passwordHash: null,
        name: userName,
        householdId,
        emailVerified: true,
        role: 'member',
        authProvider: 'apple',
        // Only the household owner (no invite) carries the campaign promo.
        signupPromoCode: acceptedInvite ? null : signupPromoCode,
      });

      if (acceptedInvite) {
        const profileUpdates = {};
        if (acceptedInvite.family_role) profileUpdates.family_role = acceptedInvite.family_role;
        if (acceptedInvite.birthday) profileUpdates.birthday = acceptedInvite.birthday;
        profileUpdates.color_theme = acceptedInvite.color_theme || await db.pickColorForNewMember(acceptedInvite.household_id);
        if (acceptedInvite.school_id) profileUpdates.school_id = acceptedInvite.school_id;
        await db.updateUser(user.id, profileUpdates);
        user = { ...user, ...profileUpdates };
      }
    } else if (user.auth_provider !== 'apple') {
      // Existing user signing in via Apple - re-stamp to reflect the
      // latest credential used. See the Google block above for the
      // rationale.
      try { await db.updateUser(user.id, { auth_provider: 'apple' }); user.auth_provider = 'apple'; } catch {}
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

  // Look up household country so we can expand a national-format number
  // (e.g. SA "0833586883") into proper E.164 (+27833586883). Without
  // this the route used to just prepend '+' and Twilio rejected the
  // result with code 21211. See utils/phone-normalise.js for rules.
  let countryCode = 'GB';
  try {
    if (req.householdId) {
      const hh = await db.getHouseholdById(req.householdId);
      if (hh?.country) countryCode = hh.country;
    }
  } catch { /* fall back to GB default */ }

  const { normaliseWhatsAppPhone } = require('../utils/phone-normalise');
  const normalised = normaliseWhatsAppPhone(phone, countryCode);
  if (!normalised || normalised.length < 8) {
    return res.status(400).json({ error: 'Please enter a valid phone number including country code (e.g. +27 83 358 6883).' });
  }

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
    // Twilio code 21211 = "not a valid phone number". Rewrap as a
    // friendly client error rather than the raw Twilio string.
    if (err.code === 21211) {
      return res.status(400).json({ error: 'That phone number does not look valid. Please use international format including country code (e.g. +27 83 358 6883).' });
    }
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

    // LAST-WRITE-WINS: a phone number identifies exactly one Housemait
    // account (the inbound webhook routes purely by number). Linking here
    // must displace any other account holding this number - two linked
    // rows would make the bot treat BOTH households as strangers.
    const displaced = await db.unlinkWhatsAppNumberFromOthers(record.phone, req.user.id);
    for (const d of displaced) {
      if (d.household_id) cache.invalidate(`members:${d.household_id}`);
    }

    // Link the phone number. whatsapp_linked_at lets the morning-digest
    // job calculate "days since linked" so it can surface a rotating
    // tip footer for the first ~14 days.
    await db.updateUser(req.user.id, {
      whatsapp_phone: record.phone,
      whatsapp_linked: true,
      whatsapp_linked_at: new Date().toISOString(),
    });

    await db.markWhatsAppVerificationCodeUsed(record.id);
    if (req.householdId) cache.invalidate(`members:${req.householdId}`);

    // Send a welcome / onboarding message. Fire-and-forget - a WhatsApp
    // hiccup must not break the connect flow since the DB is already updated.
    //
    // The welcome stays deliberately tight (only the headline use cases
    // + a "more to come" line). Feature discovery is dripped via a
    // "💡 Did you know…" footer on the morning digest for the first 14
    // days - see src/utils/whatsapp-tips.js + src/jobs/reminders.js.
    const whatsapp = require('../services/whatsapp');
    const welcomeLines = [
      `👋 Hey ${req.user.name} - Housemait here.`,
      '',
      `I'm your family's calm second brain. Just message me like a friend:`,
      '',
      `  🛒 "We need milk and eggs"`,
      `  📋 "Remind me to book the dentist"`,
      `  📅 "Sofia football Saturday 10am"`,
      '',
      `I can also help with recipes, weather, school dates, receipts, and lots more - but no rush. I'll show you new tricks over the next few days.`,
      '',
      `Reply /help any time. 📌 Pin this chat (swipe right on iOS, tap-and-hold on Android) so I don't get lost.`,
    ];
    if (displaced.length > 0) {
      welcomeLines.push('', `ℹ️ This number was connected to a different Housemait account before - that link has been replaced, and messages from this number now reach this household.`);
    }
    const welcome = welcomeLines.join('\n');

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
  // otp_available signals to WhatsAppPairing.jsx whether the OTP flow
  // (single 6-digit code entry) is usable, or whether to fall back to
  // the pull-push pairing UX. OTP requires an approved Twilio
  // Authentication Content Template - SID lives in
  // TWILIO_TEMPLATE_VERIFICATION_CODE. When unset, sendVerificationCode
  // falls back to freeform which only works inside the 24h window, so
  // first-time connects would silently fail. Gating UI on this flag
  // keeps the experience honest.
  return res.json({
    configured: whatsapp.isConfigured(),
    bot_number: whatsapp.getBotNumberForWaLink(),
    otp_available: !!(process.env.TWILIO_TEMPLATE_VERIFICATION_CODE
      && /^HX[a-f0-9]{32}$/i.test(process.env.TWILIO_TEMPLATE_VERIFICATION_CODE)),
  });
});

// ─── Pull-push pairing flow ──────────────────────────────────────────────────
// /whatsapp-init-pairing: app asks the server for a short code, server
// stashes it with the user_id and 10-min TTL. UI then asks the user to
// open WhatsApp and message the bot with that code - the inbound
// webhook (src/routes/whatsapp.js) consumes it and links the phone.
// /whatsapp-pairing-status: the app polls this while the user is in
// WhatsApp; when the code's row has been marked used we know the
// webhook fired and the link is complete.
//
// Why this exists: the old /whatsapp-send-code flow needed a Twilio
// Authentication-category Content Template (Meta-approved), which
// requires Business Verification - out of reach for sole traders
// without a registered company. Pull-push doesn't need any template.

// Alphabet excludes 0/O/1/I/L/U to reduce mis-typing on a phone
// keypad. 6 chars gives ~1 in a billion collision odds within the
// 10-minute TTL - fine.
const PAIRING_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
function generatePairingCode(len = 6) {
  let out = '';
  for (let i = 0; i < len; i++) {
    out += PAIRING_ALPHABET[Math.floor(Math.random() * PAIRING_ALPHABET.length)];
  }
  return out;
}

router.post('/whatsapp-init-pairing', requireAuth, async (req, res) => {
  try {
    const whatsapp = require('../services/whatsapp');
    if (!whatsapp.isConfigured()) {
      return res.status(503).json({ error: 'WhatsApp is not configured on this server' });
    }
    const code = generatePairingCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await db.createWhatsAppPairingCode(req.user.id, code, expiresAt);
    const botNumber = whatsapp.getBotNumberForWaLink();
    const message = `CONNECT ${code}`;
    const deepLink = botNumber
      ? `https://wa.me/${botNumber}?text=${encodeURIComponent(message)}`
      : null;
    return res.json({
      code,
      message,
      bot_number: botNumber,
      deep_link: deepLink,
      expires_at: expiresAt,
    });
  } catch (err) {
    console.error('POST /api/auth/whatsapp-init-pairing error:', err);
    return res.status(500).json({ error: 'Failed to start WhatsApp pairing.' });
  }
});

router.get('/whatsapp-pairing-status', requireAuth, async (req, res) => {
  const { code } = req.query;
  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'code query param is required' });
  }
  try {
    const row = await db.getPairingCodeStatus(req.user.id, code.trim());
    if (!row) return res.json({ linked: false });
    return res.json({
      linked: !!row.used && !!row.phone,
      phone: row.phone || null,
      expired: new Date(row.expires_at) < new Date(),
    });
  } catch (err) {
    console.error('GET /api/auth/whatsapp-pairing-status error:', err);
    return res.status(500).json({ error: 'Failed to check pairing status.' });
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

// NOTE: the legacy unauthenticated `POST /api/auth/join` endpoint was removed
// (security). It minted a full session from just a household join code + a
// member name, with no password/email check - a complete account/household
// takeover. Joining a household now goes through the authenticated
// `POST /api/auth/attach-to-household` flow (see SetupHousehold.jsx), which
// requires a logged-in user and links the caller's own account.

module.exports = router;
