const { Router } = require('express');
const crypto = require('crypto');
const multer = require('multer');
const path = require('path');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const db = require('../db/queries');
const { supabaseAdmin } = require('../db/client');
const { requireAuth, requireAdmin, requireHousehold } = require('../middleware/auth');
const email = require('../services/email');
const cache = require('../services/cache');
const { validateEmailAlias } = require('../utils/email-alias');
const { publicHousehold } = require('../utils/publicHousehold');

const router = Router();

// Child Mode PIN: 4-6 digits, bcrypt-hashed. The verify endpoint is rate-limited
// (an adult unlocking Settings is fine; brute-forcing a 4-digit space is not).
const BCRYPT_ROUNDS = 12;
const PIN_RE = /^\d{4,6}$/;
const childPinVerifyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait a minute and try again.' },
});

// Multer config for avatar uploads (5 MB, images only)
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are accepted'));
    }
    cb(null, true);
  },
});

/**
 * GET /api/household
 * Returns household info + members list.
 */
router.get('/', requireAuth, requireHousehold, async (req, res) => {
  try {
    const cacheKey = `members:${req.householdId}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const [householdRow, members] = await Promise.all([
      db.getHouseholdById(req.householdId),
      db.getHouseholdMembers(req.householdId),
    ]);
    // Never expose the Child Mode PIN hash; surface only a derived boolean.
    const household = publicHousehold(householdRow || {});
    const result = { household, members };
    cache.set(cacheKey, result, 300); // 5 min TTL
    return res.json(result);
  } catch (err) {
    console.error('GET /api/household error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/household/child-mode/pin
 * Set or change the household's Child Mode PIN. Adult (any authenticated
 * household member) only - children never log in.
 * Body: { pin: '4-6 digits' }
 */
router.post('/child-mode/pin', requireAuth, requireHousehold, requireAdmin, async (req, res) => {
  const pin = String(req.body?.pin || '');
  if (!PIN_RE.test(pin)) {
    return res.status(400).json({ error: 'PIN must be 4 to 6 digits.' });
  }
  try {
    const hash = await bcrypt.hash(pin, BCRYPT_ROUNDS);
    await db.setChildModePinHash(req.householdId, hash);
    cache.invalidate(`members:${req.householdId}`);
    return res.json({ ok: true, child_mode_pin_set: true });
  } catch (err) {
    console.error('POST /api/household/child-mode/pin error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/household/child-mode/pin
 * Remove the Child Mode PIN. Adult only.
 */
router.delete('/child-mode/pin', requireAuth, requireHousehold, requireAdmin, async (req, res) => {
  try {
    await db.clearChildModePinHash(req.householdId);
    cache.invalidate(`members:${req.householdId}`);
    return res.json({ ok: true, child_mode_pin_set: false });
  } catch (err) {
    console.error('DELETE /api/household/child-mode/pin error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/household/child-mode/verify-pin
 * Verify a PIN to unlock Settings / exit Child Mode. Any authenticated member
 * on the session; rate-limited against brute force.
 * Body: { pin }
 */
router.post('/child-mode/verify-pin', childPinVerifyLimiter, requireAuth, requireHousehold, async (req, res) => {
  const pin = String(req.body?.pin || '');
  try {
    const hash = await db.getChildModePinHash(req.householdId);
    if (!hash) return res.status(400).json({ error: 'No PIN is set.' });
    const ok = PIN_RE.test(pin) && (await bcrypt.compare(pin, hash));
    return res.status(ok ? 200 : 401).json({ ok });
  } catch (err) {
    console.error('POST /api/household/child-mode/verify-pin error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PATCH /api/settings
 * Update household settings. Admin only.
 *
 * Body: { name?: string, reminder_time?: string, timezone?: string }
 */
router.patch('/settings', requireAuth, requireHousehold, requireAdmin, async (req, res) => {
  const { name, reminder_time, timezone, allergies, trial_emails_enabled, country, address } = req.body;
  const updates = {};

  if (name !== undefined) updates.name = name.trim();
  if (reminder_time !== undefined) updates.reminder_time = reminder_time;
  if (timezone !== undefined) updates.timezone = timezone;
  if (allergies !== undefined) updates.allergies = allergies;
  // trial_emails_enabled - admin-only (matches the rest of this endpoint).
  // The unsubscribe route flips this to false via a signed token; this
  // endpoint lets admins flip it either way from Settings.
  if (trial_emails_enabled !== undefined) updates.trial_emails_enabled = !!trial_emails_enabled;
  // Country - validated against the same allow-list the DB CHECK uses.
  // Silently dropped if invalid (admin Settings dropdown enforces valid
  // values; protects against direct API calls).
  if (country !== undefined) {
    const ALLOWED_COUNTRIES = ['GB', 'IE', 'US', 'CA', 'AU', 'NZ', 'ZA', 'OTHER'];
    if (ALLOWED_COUNTRIES.includes(country)) updates.country = country;
  }
  // Street address - free-text, typically populated via the Photon
  // autocomplete on the edit modal. Trimmed; empty string treated as null.
  if (address !== undefined) {
    const trimmed = (address || '').trim();
    updates.address = trimmed.length ? trimmed.substring(0, 500) : null;
  }

  if (!Object.keys(updates).length) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  try {
    const updated = await db.updateHouseholdSettings(req.householdId, updates);
    return res.json({ household: publicHousehold(updated) });
  } catch (err) {
    console.error('PATCH /api/settings error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PATCH /api/household/profile
 * Update a user's profile. Admins can update any member via optional `user_id` field.
 * Regular members can only update their own profile.
 */
router.patch('/profile', requireAuth, requireHousehold, async (req, res) => {
  const VALID_COLORS = ['red', 'burnt-orange', 'amber', 'gold', 'leaf', 'emerald', 'teal', 'sky', 'cobalt', 'indigo', 'purple', 'magenta', 'rose', 'terracotta', 'moss', 'slate', 'sage', 'plum', 'coral', 'lavender'];
  const { name, family_role, birthday, color_theme, reminder_time, timezone, user_id, school_id, avatar_id } = req.body;

  // Determine target user. Housemait is collaborative — any household member
  // (every authenticated member is a managing adult) may edit another member's
  // PROFILE: name, family role, birthday, colour and school link, whether that
  // member is a child or another account-holder. The target must belong to this
  // household (guards IDOR). Personal notification/locale/location settings stay
  // self-only and are skipped below when editing someone else.
  let targetUserId = req.user.id;
  if (user_id && user_id !== req.user.id) {
    const members = await db.getHouseholdMembers(req.householdId);
    const target = members.find(m => m.id === user_id);
    if (!target) {
      return res.status(404).json({ error: 'Member not found in this household.' });
    }
    targetUserId = user_id;
  }
  const editingOther = targetUserId !== req.user.id;

  const updates = {};

  if (name !== undefined) {
    if (!name.trim()) return res.status(400).json({ error: 'Name cannot be empty.' });
    updates.name = name.trim();
  }
  if (family_role !== undefined) updates.family_role = family_role.trim() || null;
  if (birthday !== undefined) updates.birthday = birthday || null;
  if (color_theme !== undefined) {
    if (!VALID_COLORS.includes(color_theme)) {
      return res.status(400).json({ error: 'Invalid color theme.' });
    }
    updates.color_theme = color_theme;
  }
  // Personal notification/locale/location settings are self-only — never
  // changed for you when another member edits your profile.
  if (reminder_time !== undefined && !editingOther) {
    // Accept HH:MM or null (null = use household default)
    updates.reminder_time = reminder_time || null;
  }
  if (timezone !== undefined && !editingOther) {
    updates.timezone = timezone || null;
  }
  if (req.body.latitude !== undefined && req.body.longitude !== undefined && !editingOther) {
    updates.latitude = req.body.latitude;
    updates.longitude = req.body.longitude;
  }
  if (school_id !== undefined) updates.school_id = school_id || null;

  // Kids-mode profile (chosen by the kid in the Me screen, persisted to the
  // member record so their theme follows them across devices). Separate from
  // color_theme, which drives the parent-facing palette.
  const VALID_KID_COLORS = ['sky', 'coral', 'grape', 'sun', 'mint', 'teal', 'orange', 'berry'];
  if (req.body.kid_color !== undefined) {
    if (req.body.kid_color !== null && !VALID_KID_COLORS.includes(req.body.kid_color)) {
      return res.status(400).json({ error: 'Invalid kid colour.' });
    }
    updates.kid_color = req.body.kid_color;
  }
  if (req.body.kid_avatar !== undefined) {
    const av = req.body.kid_avatar;
    // A single emoji (possibly multi-codepoint) - cap length, no whitespace.
    if (av !== null && (typeof av !== 'string' || av.length === 0 || av.length > 16 || /\s/.test(av))) {
      return res.status(400).json({ error: 'Invalid kid avatar.' });
    }
    updates.kid_avatar = av;
  }

  // Illustrated avatar (e.g. 'set2/n07'). Picking one clears any uploaded photo
  // so the precedence photo -> illustration -> initial keeps at most one set.
  if (avatar_id !== undefined) {
    if (avatar_id && !/^[a-z0-9_-]+\/[a-z0-9_-]+$/i.test(avatar_id)) {
      return res.status(400).json({ error: 'Invalid avatar.' });
    }
    updates.avatar_id = avatar_id || null;
    if (avatar_id) updates.avatar_url = null;
  }

  if (!Object.keys(updates).length) {
    return res.status(400).json({ error: 'No valid fields to update.' });
  }

  try {
    // Capture the old school_id before updating (for orphan cleanup)
    let oldSchoolId = null;
    if (school_id !== undefined) {
      const members = await db.getHouseholdMembers(req.householdId);
      const targetMember = members.find(m => m.id === targetUserId);
      oldSchoolId = targetMember?.school_id || null;
    }

    const updated = await db.updateUser(targetUserId, updates);

    // Clean up orphaned schools - but ONLY when the old school is genuinely
    // empty: no remaining children AND no imported term dates AND no iCal
    // feed. Schools are household-level entities now (managed + removed
    // explicitly in the Schools card), so unlinking the last child must
    // never silently bin a school that still holds imported dates. Mirrors
    // the GET /schools auto-clean rule (schools.js).
    if (oldSchoolId && oldSchoolId !== (school_id || null)) {
      try {
        const [members, schools] = await Promise.all([
          db.getHouseholdMembers(req.householdId),
          db.getHouseholdSchools(req.householdId),
        ]);
        const stillLinked = members.some(m => m.school_id === oldSchoolId);
        const oldSchool = schools.find(s => s.id === oldSchoolId);
        if (!stillLinked && oldSchool && !oldSchool.ical_url && !oldSchool.term_dates_source) {
          await db.deleteHouseholdSchool(oldSchoolId, req.householdId);
          console.log(`[orphan-cleanup] Deleted empty orphaned school ${oldSchoolId}`);
        }
      } catch (cleanupErr) {
        console.error('School orphan cleanup failed (non-fatal):', cleanupErr.message);
      }
    }

    // Birthday calendar events are derived live from the member's birthday
    // field in getCalendarEvents (single source of truth, recurs yearly), so
    // there's nothing to create/sync here when the birthday changes.

    cache.invalidate(`members:${req.householdId}`);
    cache.invalidate(`digest:${req.householdId}`);
    // A school_id change re-parents the child between schools (and may have
    // just orphan-deleted one), so the cached /schools list - which embeds
    // each school's children - is now stale. Drop it.
    cache.invalidate(`schools:${req.householdId}`);
    return res.json({ user: updated });
  } catch (err) {
    console.error('PATCH /api/household/profile error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/household/profile/avatar
 * Upload a profile image. Stored in Supabase Storage (avatars bucket).
 */
router.post('/profile/avatar', requireAuth, requireHousehold, avatarUpload.single('avatar'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No image uploaded. Use field name "avatar".' });
  }

  // Target the member being edited (e.g. a child's profile on the Family page),
  // defaulting to the caller's own profile. Editing another member is fine for
  // any household member, but the target MUST belong to this household (IDOR).
  const targetId = req.body.userId || req.user.id;

  try {
    if (targetId !== req.user.id) {
      const members = await db.getHouseholdMembers(req.householdId);
      if (!members.some((m) => m.id === targetId)) {
        return res.status(404).json({ error: 'Member not found in this household.' });
      }
    }

    const ext = path.extname(req.file.originalname || '.jpg').toLowerCase() || '.jpg';
    const storagePath = `${req.householdId}/${targetId}${ext}`;

    // Upload to Supabase Storage (upsert overwrites previous avatar)
    const userDb = supabaseAdmin;
    const { error: uploadError } = await userDb.storage
      .from('avatars')
      .upload(storagePath, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: true,
      });

    if (uploadError) {
      console.error('Avatar upload error:', uploadError);
      return res.status(500).json({ error: 'Failed to upload image.' });
    }

    // Get public URL
    const { data: urlData } = userDb.storage
      .from('avatars')
      .getPublicUrl(storagePath);

    // Append cache-buster so browsers pick up new image
    const avatarUrl = `${urlData.publicUrl}?t=${Date.now()}`;

    // Save to DB. Uploading a photo clears any chosen illustration so the
    // precedence photo -> illustration -> initial keeps at most one set.
    const updated = await db.updateUser(targetId, { avatar_url: avatarUrl, avatar_id: null });
    cache.invalidate(`members:${req.householdId}`);
    return res.json({ avatar_url: updated.avatar_url, userId: targetId });
  } catch (err) {
    console.error('POST /api/household/profile/avatar error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/household/profile/avatar
 * Remove the current user's profile image.
 */
router.delete('/profile/avatar', requireAuth, requireHousehold, async (req, res) => {
  // Target the edited member, defaulting to self; the target must belong to
  // this household (matches POST /profile/avatar).
  const targetId = req.query.userId || req.user.id;
  try {
    if (targetId !== req.user.id) {
      const members = await db.getHouseholdMembers(req.householdId);
      if (!members.some((m) => m.id === targetId)) {
        return res.status(404).json({ error: 'Member not found in this household.' });
      }
    }

    // Remove only THIS member's avatar file(s). CRITICAL: the v1 storage list()
    // takes `search`, NOT `prefix` - passing `prefix` is silently ignored, so
    // listing the folder and removing the raw result would wipe EVERY avatar in
    // the household (which is why members' photos kept vanishing when anyone
    // removed one). Filter to files actually named `<userId>` / `<userId>.<ext>`
    // before deleting. Best-effort: a missing object is fine.
    const userDb = supabaseAdmin;
    const { data: files } = await userDb.storage.from('avatars').list(req.householdId);
    const mine = (files || []).filter(f => f.name === targetId || f.name.startsWith(`${targetId}.`));
    if (mine.length) {
      await userDb.storage.from('avatars').remove(mine.map(f => `${req.householdId}/${f.name}`));
    }

    // Clear in DB
    await db.updateUser(targetId, { avatar_url: null });
    cache.invalidate(`members:${req.householdId}`);
    return res.json({ avatar_url: null, userId: targetId });
  } catch (err) {
    console.error('DELETE /api/household/profile/avatar error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/household/members/:userId
 * Remove a member from the household. Admin only.
 */
router.delete('/members/:userId', requireAuth, requireHousehold, requireAdmin, async (req, res) => {
  const { userId } = req.params;

  if (userId === req.user.id) {
    return res.status(400).json({ error: 'You cannot remove yourself from the household.' });
  }

  try {
    // The household owner (the person who set it up and holds the
    // subscription) can't be removed by a co-member - that would orphan the
    // billing relationship.
    const household = await db.getHouseholdById(req.householdId);
    if (household?.created_by && household.created_by === userId) {
      return res.status(403).json({ error: 'The household owner can\'t be removed.' });
    }

    // Verify target user belongs to the same household
    const members = await db.getHouseholdMembers(req.householdId);
    const target = members.find((m) => m.id === userId);
    if (!target) {
      return res.status(404).json({ error: 'Member not found in this household.' });
    }

    const removedSchoolId = target.school_id;
    await db.deleteUser(userId, req.householdId);

    // Clean up orphaned school - but ONLY when it's genuinely empty: no
    // remaining children AND no imported term dates AND no iCal feed (same
    // rule as the profile-PATCH path + GET /schools auto-clean). Removing a
    // child must never bin a school that still holds imported dates.
    if (removedSchoolId) {
      try {
        const [remaining, schools] = await Promise.all([
          db.getHouseholdMembers(req.householdId),
          db.getHouseholdSchools(req.householdId),
        ]);
        const stillLinked = remaining.some(m => m.school_id === removedSchoolId);
        const oldSchool = schools.find(s => s.id === removedSchoolId);
        if (!stillLinked && oldSchool && !oldSchool.ical_url && !oldSchool.term_dates_source) {
          await db.deleteHouseholdSchool(removedSchoolId, req.householdId);
          console.log(`[orphan-cleanup] Deleted empty orphaned school ${removedSchoolId} after member removal`);
        }
      } catch (e) {
        console.error('School orphan cleanup failed (non-fatal):', e.message);
      }
    }

    cache.invalidate(`members:${req.householdId}`);
    cache.invalidate(`digest:${req.householdId}`);
    // Removing a member can re-shape (or delete) a school, so the cached
    // /schools list is stale.
    cache.invalidate(`schools:${req.householdId}`);
    return res.json({ message: 'Member removed.' });
  } catch (err) {
    console.error('DELETE /api/household/members error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/household/dependents
 * Add a dependent (infant, pet, etc.) to the household. Admin only.
 */
router.post('/dependents', requireAuth, requireHousehold, requireAdmin, async (req, res) => {
  const { name, family_role, birthday, color_theme, school_id } = req.body;

  if (!name?.trim()) {
    return res.status(400).json({ error: 'Name is required.' });
  }

  try {
    // Fall back to the auto-picker (not 'sage') when the client doesn't
    // send a colour. Matches the rest of the new-member flows so the
    // first dependent is red, the second burnt-orange, etc., instead
    // of every child landing on sage.
    const finalColor = color_theme || await db.pickColorForNewMember(req.householdId);
    const dependent = await db.createDependent(req.householdId, {
      name: name.trim(),
      family_role: family_role?.trim() || null,
      birthday: birthday || null,
      color_theme: finalColor,
      school_id: school_id || null,
    });
    cache.invalidate(`members:${req.householdId}`);
    cache.invalidate(`digest:${req.householdId}`);
    return res.status(201).json({ member: dependent });
  } catch (err) {
    console.error('POST /api/household/dependents error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/household/dependents/:id
 * Remove a dependent from the household. Admin only.
 */
router.delete('/dependents/:id', requireAuth, requireHousehold, requireAdmin, async (req, res) => {
  try {
    await db.deleteDependent(req.params.id, req.householdId);
    cache.invalidate(`members:${req.householdId}`);
    cache.invalidate(`digest:${req.householdId}`);
    cache.invalidate(`schools:${req.householdId}`);
    return res.json({ message: 'Dependent removed.' });
  } catch (err) {
    console.error('DELETE /api/household/dependents error:', err);
    if (err.code === 'NOT_FOUND') return res.status(404).json({ error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/household/invite
 * Send an email invite to join the household. Admin only.
 */
router.post('/invite', requireAuth, requireHousehold, requireAdmin, async (req, res) => {
  const { email: inviteEmail, name: inviteName, family_role, birthday, color_theme, school_id } = req.body;

  if (!inviteEmail?.trim()) {
    return res.status(400).json({ error: 'Email is required' });
  }

  try {
    const household = await db.getHouseholdById(req.householdId);
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

    // school_id, if supplied, must be a household_schools row owned by THIS
    // household - never trust a UUID from the client without a check.
    let safeSchoolId = null;
    if (school_id) {
      const schools = await db.getHouseholdSchools(req.householdId);
      if (schools.find((s) => s.id === school_id)) {
        safeSchoolId = school_id;
      }
    }

    await db.createInvite({
      householdId: req.householdId,
      email: inviteEmail.trim().toLowerCase(),
      token,
      invitedBy: req.user.id,
      expiresAt,
      name: inviteName?.trim() || null,
      family_role: family_role?.trim() || null,
      birthday: birthday || null,
      color_theme: color_theme || null,
      school_id: safeSchoolId,
    });

    try {
      await email.sendInviteEmail(inviteEmail.trim(), req.user.name, household.name, token);
    } catch (emailErr) {
      console.error('Failed to send invite email:', emailErr);
    }

    return res.json({ message: 'Invite sent.' });
  } catch (err) {
    console.error('POST /api/household/invite error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/household/invites
 * List pending invites for the household. Admin only.
 */
router.get('/invites', requireAuth, requireHousehold, requireAdmin, async (req, res) => {
  try {
    const invites = await db.getPendingInvites(req.householdId);
    return res.json({ invites });
  } catch (err) {
    console.error('GET /api/household/invites error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/household/invites/:inviteId
 * Cancel a pending invite. Admin only.
 */
router.delete('/invites/:inviteId', requireAuth, requireHousehold, requireAdmin, async (req, res) => {
  try {
    await db.deleteInvite(req.params.inviteId, req.householdId);
    return res.json({ message: 'Invite cancelled.' });
  } catch (err) {
    console.error('DELETE /api/household/invites error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/household/usage-summary
 *
 * Returns COUNT(*) of the user-generated data we want to show in the
 * "trial ending soon" reminder card on day 26–30:
 *   "You've got X shopping lists, X meals saved, X tasks…"
 *
 * The spec asks for "a single SQL query with COUNTs". Supabase's REST
 * API doesn't support cross-table aggregates in one call - each count
 * is its own HTTP round trip. We fire them in parallel via Promise.all
 * so wall-clock latency is one query's worth, not N. If this ever
 * becomes a bottleneck (unlikely - these are indexed scans over small
 * per-household tables) swap to a plpgsql function + supabase.rpc().
 *
 * Cached 5 minutes - the user doesn't need real-time numbers on a
 * marketing banner, and the endpoint fires on every nav back to
 * Dashboard when trial is in warning window.
 */
router.get('/usage-summary', requireAuth, requireHousehold, async (req, res) => {
  try {
    const cacheKey = `usage:${req.householdId}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const countRows = async (table, extraFilter) => {
      let q = supabaseAdmin
        .from(table)
        .select('*', { count: 'exact', head: true })
        .eq('household_id', req.householdId);
      if (extraFilter) q = extraFilter(q);
      const { count, error } = await q;
      if (error) {
        // Log and return 0 rather than failing the whole summary - a
        // missing-table error on one dimension shouldn't break the card.
        console.warn(`[usage-summary] count(${table}) failed:`, error.message);
        return 0;
      }
      return count ?? 0;
    };

    const [
      shoppingItemCount,
      shoppingListCount,
      taskCount,
      calendarEventCount,
      mealPlanCount,
      recipeCount,
      documentCount,
      memberCount,
    ] = await Promise.all([
      countRows('shopping_items'),
      countRows('shopping_lists'),
      countRows('tasks'),
      // calendar_events is the only table using soft-delete - exclude
      // tombstoned rows so the count matches what the user actually sees.
      countRows('calendar_events', (q) => q.is('deleted_at', null)),
      countRows('meal_plan'),
      countRows('recipes'),
      countRows('documents'),
      countRows('users'),
    ]);

    const payload = {
      shopping_item_count: shoppingItemCount,
      shopping_list_count: shoppingListCount,
      task_count: taskCount,
      calendar_event_count: calendarEventCount,
      meal_plan_count: mealPlanCount,
      recipe_count: recipeCount,
      document_count: documentCount,
      member_count: memberCount,
    };

    cache.set(cacheKey, payload, 300); // 5 min TTL
    return res.json(payload);
  } catch (err) {
    console.error('GET /api/household/usage-summary error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/household/regenerate-email-address
 * Generate a new inbound email token. Admin only.
 */
router.post('/regenerate-email-address', requireAuth, requireHousehold, requireAdmin, async (req, res) => {
  try {
    const newToken = crypto.randomBytes(6).toString('hex');
    const updated = await db.updateHouseholdSettings(req.householdId, {
      inbound_email_token: newToken,
    });
    return res.json({
      inbound_email_token: updated.inbound_email_token,
    });
  } catch (err) {
    console.error('POST /api/household/regenerate-email-address error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Inbound email alias + sender allowlist ─────────────────────────
//
// The alias replaces the hard-to-remember hex token with a memorable
// "<slug>@inbound.housemait.com" address. The sender allowlist gates
// who is allowed to send mail to that address (or to the long token)
// - prevents the inbound channel becoming a spam vector if either
// address leaks. See migration-inbound-email-alias-senders.sql for
// schema notes.

/**
 * GET /api/household/email-alias/availability?alias=<x>
 *
 * Returns { available: boolean, reason?: string }. Used by the
 * Settings UI to show real-time feedback as the admin types a new
 * alias. The household's *own* current alias counts as available
 * so the input doesn't show "already taken" against itself.
 */
router.get('/email-alias/availability', requireAuth, requireHousehold, async (req, res) => {
  try {
    const raw = String(req.query.alias || '');
    const v = validateEmailAlias(raw);
    if (!v.ok) return res.json({ available: false, reason: v.reason });
    const available = await db.isEmailAliasAvailable(v.normalised, req.householdId);
    return res.json({ available, normalised: v.normalised, reason: available ? null : 'That alias is already taken.' });
  } catch (err) {
    console.error('GET /api/household/email-alias/availability error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PATCH /api/household/email-alias
 * Body: { alias: string | null }   (null clears the alias)
 *
 * Admin only. Returns the updated household row so the frontend can
 * refresh its auth context.
 */
router.patch('/email-alias', requireAuth, requireHousehold, requireAdmin, async (req, res) => {
  try {
    const { alias } = req.body || {};
    if (alias === null || alias === '') {
      const updated = await db.setHouseholdEmailAlias(req.householdId, null);
      return res.json({ household: publicHousehold(updated) });
    }
    const v = validateEmailAlias(alias);
    if (!v.ok) return res.status(400).json({ error: v.reason });
    const available = await db.isEmailAliasAvailable(v.normalised, req.householdId);
    if (!available) return res.status(409).json({ error: 'That alias is already taken.' });
    const updated = await db.setHouseholdEmailAlias(req.householdId, v.normalised);
    return res.json({ household: publicHousehold(updated) });
  } catch (err) {
    // 23505 is Postgres unique_violation - race between availability
    // check and update. Surface as 409 same as a direct collision.
    if (err.code === '23505') return res.status(409).json({ error: 'That alias was just claimed by someone else. Try another.' });
    console.error('PATCH /api/household/email-alias error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/household/inbound-senders
 * Returns { senders: [...] }. Any household member can read this.
 */
router.get('/inbound-senders', requireAuth, requireHousehold, async (req, res) => {
  try {
    const senders = await db.getInboundSenders(req.householdId);
    return res.json({ senders });
  } catch (err) {
    console.error('GET /api/household/inbound-senders error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/household/inbound-rejections
 * Recent sender addresses whose forwarded mail was blocked because they're
 * not on the allowlist. Excludes any already added since (race-safe), so
 * the Settings nudge only shows addresses still worth allowing.
 */
router.get('/inbound-rejections', requireAuth, requireHousehold, async (req, res) => {
  try {
    const [rejected, allowed] = await Promise.all([
      db.getRejectedInboundSenders(req.householdId, 5),
      db.getInboundSenders(req.householdId),
    ]);
    const allowedSet = new Set((allowed || []).map((s) => String(s.email || '').toLowerCase()));
    const rejections = (rejected || []).filter((r) => !allowedSet.has(r.email));
    return res.json({ rejections });
  } catch (err) {
    console.error('GET /api/household/inbound-rejections error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/household/inbound-senders
 * Body: { email: string }   Admin only.
 *
 * Lightweight email-format validation here; full DKIM/SPF verification
 * is the responsibility of Postmark on the upstream side. Duplicates
 * (same email already on the household's list) return 409.
 */
router.post('/inbound-senders', requireAuth, requireHousehold, requireAdmin, async (req, res) => {
  try {
    const raw = String(req.body?.email || '').trim();
    if (!raw || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(raw)) {
      return res.status(400).json({ error: 'Please provide a valid email address.' });
    }
    const sender = await db.addInboundSender(req.householdId, raw, req.user.id);
    return res.status(201).json({ sender });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'That email is already on the allowlist.' });
    console.error('POST /api/household/inbound-senders error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/household/inbound-senders/:id
 * Admin only.
 */
router.delete('/inbound-senders/:id', requireAuth, requireHousehold, requireAdmin, async (req, res) => {
  try {
    await db.deleteInboundSender(req.params.id, req.householdId);
    return res.json({ message: 'Sender removed.' });
  } catch (err) {
    console.error('DELETE /api/household/inbound-senders/:id error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/household/avatar
 *
 * Upload a household profile photo. Stored in the same `avatars`
 * Supabase Storage bucket as user avatars, but at a household-scoped
 * path (`<householdId>/household.<ext>`) so it doesn't clash with
 * individual member avatars. Admin only - household identity is a
 * household-level concern, not personal.
 */
router.post('/avatar', requireAuth, requireHousehold, requireAdmin, avatarUpload.single('avatar'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No image uploaded. Use field name "avatar".' });
  }
  try {
    const ext = path.extname(req.file.originalname || '.jpg').toLowerCase() || '.jpg';
    const storagePath = `${req.householdId}/household${ext}`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from('avatars')
      .upload(storagePath, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: true,
      });
    if (uploadError) {
      console.error('Household avatar upload error:', uploadError);
      return res.status(500).json({ error: 'Failed to upload image.' });
    }

    const { data: urlData } = supabaseAdmin.storage.from('avatars').getPublicUrl(storagePath);
    // Cache-buster so browsers pick up the new image immediately.
    const avatarUrl = `${urlData.publicUrl}?t=${Date.now()}`;

    const updated = await db.updateHouseholdSettings(req.householdId, { avatar_url: avatarUrl });
    cache.invalidate(`members:${req.householdId}`);
    return res.json({ avatar_url: updated.avatar_url, household: publicHousehold(updated) });
  } catch (err) {
    console.error('POST /api/household/avatar error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/household/avatar
 *
 * Remove the household profile photo (revert to the front-end's
 * family-placeholder.png fallback). Best-effort: storage delete is
 * non-fatal so a missing object doesn't block the DB clear.
 */
router.delete('/avatar', requireAuth, requireHousehold, requireAdmin, async (req, res) => {
  try {
    // Remove only the household photo file(s) - `household` / `household.<ext>`.
    // The v1 storage list() ignores `prefix` (it takes `search`), so listing the
    // folder and removing the raw result would wipe every MEMBER avatar too.
    // Filter to the household-photo names before deleting.
    const { data: files } = await supabaseAdmin.storage.from('avatars').list(req.householdId);
    const householdFiles = (files || []).filter((f) => f.name === 'household' || f.name.startsWith('household.'));
    if (householdFiles.length) {
      await supabaseAdmin.storage.from('avatars').remove(householdFiles.map((f) => `${req.householdId}/${f.name}`));
    }
    const updated = await db.updateHouseholdSettings(req.householdId, { avatar_url: null });
    cache.invalidate(`members:${req.householdId}`);
    return res.json({ avatar_url: null, household: publicHousehold(updated) });
  } catch (err) {
    console.error('DELETE /api/household/avatar error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/household/address-search?q=<text>
 *
 * Thin proxy to Photon (OSM-based) for street-address autocomplete.
 * Proxied (rather than called direct from the browser) for three
 * reasons: (1) attaches our User-Agent so we don't fingerprint as a
 * random browser, (2) lets us swap providers later without touching
 * the frontend, (3) caches identical queries briefly to reduce upstream
 * load. Free, no API key. Limited to 8 suggestions.
 *
 * Returns: { suggestions: [{ id, label, lat, lon }] }
 */
router.get('/address-search', requireAuth, requireHousehold, async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 3) return res.json({ suggestions: [] });

  // Brief in-memory cache: same query within 60s reuses the same response.
  const cacheKey = `address-search:${q.toLowerCase()}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.json(cached);

  try {
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=8&osm_tag=place&osm_tag=highway`;
    const upstream = await fetch(url, {
      headers: { 'User-Agent': 'Housemait (family-organiser@housemait.com)' },
    });
    if (!upstream.ok) {
      return res.status(502).json({ error: 'Address search unavailable.' });
    }
    const data = await upstream.json();
    const suggestions = (data.features || []).map((f) => {
      const p = f.properties || {};
      // Build a "Street, City, Country"-ish label from whatever Photon returned.
      // Photon's properties vary by result type - name (place name), street,
      // housenumber, city, postcode, country. Format gracefully.
      const lineParts = [];
      if (p.name) lineParts.push(p.housenumber ? `${p.housenumber} ${p.name}` : p.name);
      if (p.street && p.street !== p.name) lineParts.push(p.housenumber ? `${p.housenumber} ${p.street}` : p.street);
      if (p.city || p.town || p.village) lineParts.push(p.city || p.town || p.village);
      if (p.postcode) lineParts.push(p.postcode);
      if (p.country) lineParts.push(p.country);
      const label = lineParts.join(', ');
      const [lon, lat] = f.geometry?.coordinates || [];
      return {
        id: `${p.osm_type || ''}-${p.osm_id || ''}`,
        label: label || p.name || 'Unknown',
        lat: lat ?? null,
        lon: lon ?? null,
      };
    }).filter((s) => s.label && s.label.length > 1);

    const payload = { suggestions };
    cache.set(cacheKey, payload, 60);
    return res.json(payload);
  } catch (err) {
    console.error('GET /api/household/address-search error:', err);
    return res.status(502).json({ error: 'Address search unavailable.' });
  }
});

module.exports = router;
