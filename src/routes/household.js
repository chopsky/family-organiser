const { Router } = require('express');
const crypto = require('crypto');
const multer = require('multer');
const path = require('path');
const db = require('../db/queries');
const { supabase } = require('../db/client');
const { requireAuth, requireAdmin, requireHousehold } = require('../middleware/auth');
const email = require('../services/email');
const cache = require('../services/cache');

const router = Router();

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

    const [household, members] = await Promise.all([
      db.getHouseholdById(req.householdId),
      db.getHouseholdMembers(req.householdId),
    ]);
    const result = { household, members };
    cache.set(cacheKey, result, 300); // 5 min TTL
    return res.json(result);
  } catch (err) {
    console.error('GET /api/household error:', err);
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
  const { name, reminder_time, timezone } = req.body;
  const updates = {};

  if (name !== undefined) updates.name = name.trim();
  if (reminder_time !== undefined) updates.reminder_time = reminder_time;
  if (timezone !== undefined) updates.timezone = timezone;

  if (!Object.keys(updates).length) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  try {
    const updated = await db.updateHouseholdSettings(req.householdId, updates);
    return res.json({ household: updated });
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
  const { name, family_role, birthday, color_theme, reminder_time, timezone, user_id, school_id, year_group } = req.body;

  // Determine target user — admins can edit others, members only themselves
  let targetUserId = req.user.id;
  if (user_id && user_id !== req.user.id) {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can edit other members.' });
    }
    // Verify target belongs to same household
    const members = await db.getHouseholdMembers(req.householdId);
    if (!members.find(m => m.id === user_id)) {
      return res.status(404).json({ error: 'Member not found in this household.' });
    }
    targetUserId = user_id;
  }

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
  if (reminder_time !== undefined) {
    // Accept HH:MM or null (null = use household default)
    updates.reminder_time = reminder_time || null;
  }
  if (timezone !== undefined) {
    updates.timezone = timezone || null;
  }
  if (req.body.latitude !== undefined && req.body.longitude !== undefined) {
    updates.latitude = req.body.latitude;
    updates.longitude = req.body.longitude;
  }
  if (school_id !== undefined) updates.school_id = school_id || null;
  if (year_group !== undefined) updates.year_group = year_group || null;

  if (!Object.keys(updates).length) {
    return res.status(400).json({ error: 'No valid fields to update.' });
  }

  try {
    // Only fetch full user if birthday is being updated (expensive query)
    let fullUser = null;
    if (birthday !== undefined) {
      fullUser = (await db.getHouseholdMembers(req.householdId)).find(m => m.id === targetUserId);
    }

    // Capture the old school_id before updating (for orphan cleanup)
    let oldSchoolId = null;
    if (school_id !== undefined) {
      const members = await db.getHouseholdMembers(req.householdId);
      const targetMember = members.find(m => m.id === targetUserId);
      oldSchoolId = targetMember?.school_id || null;
    }

    const updated = await db.updateUser(targetUserId, updates);

    // Clean up orphaned schools — if this was the last child at the old school, delete it
    if (oldSchoolId && oldSchoolId !== (school_id || null)) {
      try {
        const members = await db.getHouseholdMembers(req.householdId);
        const stillLinked = members.some(m => m.school_id === oldSchoolId);
        if (!stillLinked) {
          await db.deleteHouseholdSchool(oldSchoolId, req.householdId);
          console.log(`[orphan-cleanup] Deleted orphaned school ${oldSchoolId} — no children remaining`);
        }
      } catch (cleanupErr) {
        console.error('School orphan cleanup failed (non-fatal):', cleanupErr.message);
      }
    }

    // Handle birthday calendar event — only when birthday field is explicitly sent and changed
    if (birthday !== undefined && fullUser) {
      try {
        const currentBirthday = fullUser.birthday || null;
        const newBirthday = birthday || null;
        const currentStr = currentBirthday ? new Date(currentBirthday).toISOString().split('T')[0] : '';
        const newStr = newBirthday ? new Date(newBirthday).toISOString().split('T')[0] : '';

        if (newStr !== currentStr) {
          // Remove any existing birthday events for this user
          const allEvents = await db.getCalendarEvents(req.householdId, '1900-01-01', '2100-12-31');
          const existingBirthdays = allEvents.filter(
            (e) => e.category === 'birthday' && e.source_user_id === targetUserId
          );
          for (const ev of existingBirthdays) {
            await db.deleteCalendarEvent(ev.id, req.householdId);
          }

          // Create new birthday event if a birthday was provided
          if (newBirthday) {
            const displayName = updates.name || fullUser.name || req.user.name;
            const birthdayDate = new Date(newBirthday);
            const thisYear = new Date().getFullYear();
            const eventDate = new Date(thisYear, birthdayDate.getMonth(), birthdayDate.getDate());
            const startTime = `${eventDate.toISOString().split('T')[0]}T00:00:00Z`;

            await db.createCalendarEventFromSync(
              req.householdId,
              {
                title: `${displayName}'s Birthday 🎂`,
                description: null,
                start_time: startTime,
                end_time: startTime,
                all_day: true,
              },
              targetUserId,
              null,
              'birthday',
              'family'
            );
          }
        }
      } catch (birthdayErr) {
        console.error('Birthday event update failed (non-fatal):', birthdayErr.message);
      }
    }

    cache.invalidate(`members:${req.householdId}`);
    cache.invalidate(`digest:${req.householdId}`);
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

  try {
    const ext = path.extname(req.file.originalname || '.jpg').toLowerCase() || '.jpg';
    const storagePath = `${req.householdId}/${req.user.id}${ext}`;

    // Upload to Supabase Storage (upsert overwrites previous avatar)
    const { error: uploadError } = await supabase.storage
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
    const { data: urlData } = supabase.storage
      .from('avatars')
      .getPublicUrl(storagePath);

    // Append cache-buster so browsers pick up new image
    const avatarUrl = `${urlData.publicUrl}?t=${Date.now()}`;

    // Save to DB
    const updated = await db.updateUser(req.user.id, { avatar_url: avatarUrl });
    cache.invalidate(`members:${req.householdId}`);
    return res.json({ avatar_url: updated.avatar_url });
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
  try {
    // Try to remove files from storage (best effort — may not exist or may have different ext)
    const prefix = `${req.householdId}/${req.user.id}`;
    const { data: files } = await supabase.storage.from('avatars').list(req.householdId, {
      prefix: req.user.id,
    });
    if (files?.length) {
      await supabase.storage.from('avatars').remove(files.map(f => `${req.householdId}/${f.name}`));
    }

    // Clear in DB
    const updated = await db.updateUser(req.user.id, { avatar_url: null });
    cache.invalidate(`members:${req.householdId}`);
    return res.json({ avatar_url: null });
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
    // Verify target user belongs to the same household
    const members = await db.getHouseholdMembers(req.householdId);
    const target = members.find((m) => m.id === userId);
    if (!target) {
      return res.status(404).json({ error: 'Member not found in this household.' });
    }

    const removedSchoolId = target.school_id;
    await db.deleteUser(userId, req.householdId);

    // Clean up orphaned school if this was the last child linked to it
    if (removedSchoolId) {
      try {
        const remaining = await db.getHouseholdMembers(req.householdId);
        const stillLinked = remaining.some(m => m.school_id === removedSchoolId);
        if (!stillLinked) {
          await db.deleteHouseholdSchool(removedSchoolId, req.householdId);
          console.log(`[orphan-cleanup] Deleted orphaned school ${removedSchoolId} after member removal`);
        }
      } catch (e) {
        console.error('School orphan cleanup failed (non-fatal):', e.message);
      }
    }

    cache.invalidate(`members:${req.householdId}`);
    cache.invalidate(`digest:${req.householdId}`);
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
  const { name, family_role, birthday, color_theme, school_id, year_group } = req.body;

  if (!name?.trim()) {
    return res.status(400).json({ error: 'Name is required.' });
  }

  try {
    const dependent = await db.createDependent(req.householdId, {
      name: name.trim(),
      family_role: family_role?.trim() || null,
      birthday: birthday || null,
      color_theme: color_theme || 'sage',
      school_id: school_id || null,
      year_group: year_group || null,
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
    return res.json({ message: 'Dependent removed.' });
  } catch (err) {
    console.error('DELETE /api/household/dependents error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/household/invite
 * Send an email invite to join the household. Admin only.
 */
router.post('/invite', requireAuth, requireHousehold, requireAdmin, async (req, res) => {
  const { email: inviteEmail, name: inviteName, family_role, birthday, color_theme } = req.body;

  if (!inviteEmail?.trim()) {
    return res.status(400).json({ error: 'Email is required' });
  }

  try {
    const household = await db.getHouseholdById(req.householdId);
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

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
 * POST /api/household/regenerate-receipt-email
 * Generate a new inbound email token for receipt forwarding. Admin only.
 */
router.post('/regenerate-receipt-email', requireAuth, requireHousehold, requireAdmin, async (req, res) => {
  try {
    const newToken = crypto.randomBytes(6).toString('hex');
    const updated = await db.updateHouseholdSettings(req.householdId, {
      inbound_email_token: newToken,
    });
    return res.json({
      inbound_email_token: updated.inbound_email_token,
      receipt_email: `receipts-${updated.inbound_email_token}@inbound.housemait.com`,
    });
  } catch (err) {
    console.error('POST /api/household/regenerate-receipt-email error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
