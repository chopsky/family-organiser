const { Router } = require('express');
const db = require('../db/queries');
const { requireAuth, requirePlatformAdmin } = require('../middleware/auth');
const { sendDailyReminders } = require('../jobs/reminders');
const { invalidateHouseholdWeatherCache } = require('../services/digest-weather');

const router = Router();

// All admin routes require platform admin access
router.use(requireAuth, requirePlatformAdmin);

// ─── GET /api/admin/stats ───────────────────────────────────────────────────

router.get('/stats', async (req, res) => {
  try {
    const stats = await db.getPlatformStats();
    return res.json(stats);
  } catch (err) {
    console.error('GET /api/admin/stats error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/admin/users ───────────────────────────────────────────────────

router.get('/users', async (req, res) => {
  try {
    const { search, page = 1, limit = 50, sort, sortDir } = req.query;
    const result = await db.getAllUsersAdmin({
      search,
      page: parseInt(page, 10),
      limit: Math.min(parseInt(limit, 10) || 50, 100),
      sort,
      sortDir,
    });
    return res.json(result);
  } catch (err) {
    console.error('GET /api/admin/users error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/admin/users/:id ───────────────────────────────────────────────

router.get('/users/:id', async (req, res) => {
  try {
    const user = await db.getUserByIdAdmin(req.params.id);
    return res.json(user);
  } catch (err) {
    if (err.code === 'PGRST116') {
      return res.status(404).json({ error: 'User not found' });
    }
    console.error('GET /api/admin/users/:id error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PATCH /api/admin/users/:id ─────────────────────────────────────────────

router.patch('/users/:id', async (req, res) => {
  const { id } = req.params;
  const { is_platform_admin, disabled } = req.body;

  if (id === req.user.id) {
    return res.status(400).json({ error: 'Cannot modify your own account' });
  }

  try {
    let user;
    if (typeof is_platform_admin === 'boolean') {
      user = await db.setUserPlatformAdmin(id, is_platform_admin);
    }
    if (typeof disabled === 'boolean') {
      user = disabled ? await db.disableUser(id) : await db.enableUser(id);
    }
    if (!user) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }
    return res.json(user);
  } catch (err) {
    if (err.code === 'PGRST116') {
      return res.status(404).json({ error: 'User not found' });
    }
    console.error('PATCH /api/admin/users/:id error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DELETE /api/admin/users/:id ────────────────────────────────────────────

router.delete('/users/:id', async (req, res) => {
  const { id } = req.params;

  if (id === req.user.id) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }
  if (req.query.confirm !== 'true') {
    return res.status(400).json({ error: 'Add ?confirm=true to confirm deletion' });
  }

  try {
    // Look up user's household before deleting
    const user = await db.getUserByIdAdmin(id);
    const householdId = user?.household_id;

    await db.deleteUserAdmin(id);

    // If user was in a household, check if it's now empty
    let householdDeleted = false;
    if (householdId) {
      const remaining = await db.getHouseholdMembers(householdId);
      if (remaining.length === 0) {
        await db.deleteHouseholdCascade(householdId);
        householdDeleted = true;
      }
    }

    return res.json({ success: true, householdDeleted });
  } catch (err) {
    console.error('DELETE /api/admin/users/:id error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/admin/users/:id/force-logout ─────────────────────────────────
//
// Revokes every refresh token for the target user. Their currently-held
// JWT access token still works until it expires (1h, see
// JWT_EXPIRES_IN in src/middleware/auth.js) - we can't invalidate
// JWTs mid-flight without a token revocation list, which the app
// doesn't have. So the practical effect is: within the next hour,
// the app's silent refresh fails, frontend redirects to login, user
// logs in, gets a fresh authResponse with current household state.
//
// Use cases:
//   - After a data-fix (household merge, etc.) that invalidates the
//     user's cached household_id in localStorage.
//   - Revoking access on a departed admin / lost device.
//   - Forcing re-auth after a security incident.
//
// Refuses to operate on the caller's own account - the platform admin
// using this tool always loses access to *another* user's sessions,
// never their own.

router.post('/users/:id/force-logout', async (req, res) => {
  const { id } = req.params;
  if (id === req.user.id) {
    return res.status(400).json({ error: 'Use the normal Log out button for your own account.' });
  }
  try {
    const target = await db.getUserByIdAdmin(id);
    if (!target) return res.status(404).json({ error: 'User not found' });

    // keepTokenId = null means revoke every session.
    await db.revokeOtherUserRefreshTokens(id, null);

    console.log(`[admin/force-logout] Platform admin ${req.user.id} revoked all sessions for user ${id} (${target.email || target.name})`);

    return res.json({
      success: true,
      message: `Sessions revoked. ${target.name || 'The user'} will be redirected to login within the next hour, or instantly if they log out manually.`,
    });
  } catch (err) {
    console.error('POST /api/admin/users/:id/force-logout error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/admin/users/:id/usage ─────────────────────────────────────────

router.get('/users/:id/usage', async (req, res) => {
  try {
    const days = parseInt(req.query.days, 10) || 30;
    const usage = await db.getUserUsageStats(req.params.id, { days });
    return res.json(usage);
  } catch (err) {
    console.error('GET /api/admin/users/:id/usage error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/admin/households ──────────────────────────────────────────────

router.get('/households', async (req, res) => {
  try {
    const { search, page = 1, limit = 50, sort, sortDir, plan, activity } = req.query;
    const result = await db.getAllHouseholdsAdmin({
      search,
      page: parseInt(page, 10),
      limit: Math.min(parseInt(limit, 10) || 50, 100),
      sort,
      sortDir,
      plan,
      activity,
    });
    return res.json(result);
  } catch (err) {
    console.error('GET /api/admin/households error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/admin/households/:id ──────────────────────────────────────────

router.get('/households/:id', async (req, res) => {
  try {
    const household = await db.getHouseholdDetailAdmin(req.params.id);
    return res.json(household);
  } catch (err) {
    if (err.code === 'PGRST116') {
      return res.status(404).json({ error: 'Household not found' });
    }
    console.error('GET /api/admin/households/:id error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/admin/households/:id/ai-usage ─────────────────────────────────

router.get('/households/:id/ai-usage', async (req, res) => {
  try {
    const days = parseInt(req.query.days, 10) || 30;
    const usage = await db.getHouseholdAiUsage(req.params.id, { days });
    return res.json(usage);
  } catch (err) {
    console.error('GET /api/admin/households/:id/ai-usage error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/admin/calendar-sync ───────────────────────────────────────────
// Inbound iCal subscriptions and outbound feed tokens across every household.

router.get('/calendar-sync', async (req, res) => {
  try {
    const result = await db.getCalendarSyncHealthAdmin();
    return res.json(result);
  } catch (err) {
    console.error('GET /api/admin/calendar-sync error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PATCH /api/admin/households/:id/subscription ──────────────────────────

router.patch('/households/:id/subscription', async (req, res) => {
  const { is_internal, trial_ends_at } = req.body || {};

  // Reject anything outside the whitelist
  const extraKeys = Object.keys(req.body || {}).filter(
    (k) => k !== 'is_internal' && k !== 'trial_ends_at'
  );
  if (extraKeys.length > 0) {
    return res.status(400).json({ error: `Unsupported fields: ${extraKeys.join(', ')}` });
  }

  try {
    const household = await db.updateHouseholdSubscriptionAdmin(req.params.id, {
      is_internal,
      trial_ends_at,
    });
    return res.json(household);
  } catch (err) {
    if (err.code === 'NO_FIELDS') {
      return res.status(400).json({ error: 'No valid subscription fields provided' });
    }
    if (err.code === 'PGRST116') {
      return res.status(404).json({ error: 'Household not found' });
    }
    console.error('PATCH /api/admin/households/:id/subscription error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/admin/ai-usage ─────────────────────────────────────────────────

router.get('/ai-usage', async (req, res) => {
  try {
    const days = parseInt(req.query.days, 10) || 30;
    const [stats, timeline, topHouseholds, topUsers] = await Promise.all([
      db.getAiUsageStats({ days }),
      db.getAiUsageTimeline({ days }),
      db.getAiUsageTopHouseholds({ days }),
      db.getAiUsageTopUsers({ days }),
    ]);
    return res.json({ stats, timeline, topHouseholds, topUsers });
  } catch (err) {
    console.error('GET /api/admin/ai-usage error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/admin/whatsapp-stats ──────────────────────────────────────────

router.get('/whatsapp-stats', async (req, res) => {
  try {
    const days = parseInt(req.query.days, 10) || 30;
    const [stats, timeline] = await Promise.all([
      db.getWhatsAppStats({ days }),
      db.getWhatsAppTimeline({ days }),
    ]);
    return res.json({ stats, timeline });
  } catch (err) {
    console.error('GET /api/admin/whatsapp-stats error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/admin/analytics ───────────────────────────────────────────────

router.get('/analytics', async (req, res) => {
  try {
    const days = parseInt(req.query.days, 10) || 30;
    const analytics = await db.getAnalytics({ days });
    return res.json(analytics);
  } catch (err) {
    console.error('GET /api/admin/analytics error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/admin/inbound-emails ──────────────────────────────────────────
//
// Recent forwarded-email processing log. Powers the AdminInboundEmails
// page - lets us see what each inbound email did (or failed at) without
// digging into Railway logs. Includes the AI's classification + the
// list of action IDs so we can spot failure patterns.
router.get('/inbound-emails', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const rows = await db.getRecentInboundEmailsAdmin({ limit });
    return res.json({ emails: rows });
  } catch (err) {
    console.error('GET /api/admin/inbound-emails error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Announcements (admin email broadcaster) ────────────────────────────
//
// Three endpoints:
//   GET  /api/admin/announcements         - list recent (latest 50)
//   GET  /api/admin/announcements/preview - count audience without committing
//   POST /api/admin/announcements         - create draft + resolve recipients
//   POST /api/admin/announcements/:id/send - actually send (idempotent;
//                                            skips already-sent recipients)
//
// Send loop is synchronous within the HTTP request - fine for the
// hundreds-of-users scale Housemait is at today. Throttle to ~10
// concurrent so Postmark's rate limits never bite.

const VALID_AUDIENCES = new Set(['all_verified', 'ios_users', 'admins_only', 'platform_admin']);

router.get('/announcements', async (req, res) => {
  try {
    const items = await db.listAnnouncements({ limit: 50 });
    return res.json({ announcements: items });
  } catch (err) {
    console.error('GET /api/admin/announcements error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/announcements/preview', async (req, res) => {
  const { audience } = req.query;
  if (!VALID_AUDIENCES.has(audience)) {
    return res.status(400).json({ error: 'Invalid audience' });
  }
  try {
    const recipients = await db.resolveAnnouncementAudience(audience);
    return res.json({
      count: recipients.length,
      sample: recipients.slice(0, 5).map(r => ({ name: r.name, email: r.email })),
    });
  } catch (err) {
    console.error('GET /api/admin/announcements/preview error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/announcements', async (req, res) => {
  const { subject, html, audience } = req.body || {};
  if (!subject?.trim()) return res.status(400).json({ error: 'subject is required' });
  if (!html?.trim()) return res.status(400).json({ error: 'html is required' });
  if (!VALID_AUDIENCES.has(audience)) return res.status(400).json({ error: 'Invalid audience' });
  try {
    const announcement = await db.createAnnouncement({
      subject: subject.trim(),
      html: html.trim(),
      audience,
      createdBy: req.user.id,
    });
    return res.status(201).json({ announcement });
  } catch (err) {
    console.error('POST /api/admin/announcements error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/announcements/:id/send', async (req, res) => {
  const { id } = req.params;
  try {
    const announcement = await db.getAnnouncementById(id);
    if (!announcement) return res.status(404).json({ error: 'Announcement not found' });
    if (announcement.sent_completed_at) {
      return res.json({
        announcement,
        message: 'Already fully sent',
        sentCount: announcement.success_count,
        failedCount: announcement.failure_count,
      });
    }

    await db.markAnnouncementSendStarted(id);

    const pending = await db.getPendingRecipients(id);
    if (pending.length === 0) {
      await db.markAnnouncementSendCompleted(id, {
        successCount: announcement.success_count,
        failureCount: announcement.failure_count,
      });
      return res.json({
        announcement: { ...announcement, sent_completed_at: new Date().toISOString() },
        message: 'No pending recipients',
        sentCount: 0,
        failedCount: 0,
      });
    }

    const { sendAnnouncementEmail } = require('../services/email');
    let success = announcement.success_count || 0;
    let failure = announcement.failure_count || 0;

    // Send sequentially with a small delay between batches - Postmark's
    // free tier allows 10 req/sec which is plenty, but a tight loop
    // can still trigger soft-rate-limits. Batches of 10 with a brief
    // pause keep us well clear.
    const BATCH = 10;
    for (let i = 0; i < pending.length; i += BATCH) {
      const chunk = pending.slice(i, i + BATCH);
      await Promise.all(chunk.map(async (recipient) => {
        try {
          await sendAnnouncementEmail({
            to: recipient.email,
            subject: announcement.subject,
            html: announcement.html,
          });
          await db.markRecipientSent(recipient.id);
          success += 1;
        } catch (err) {
          console.error(`[announcements] send failed for ${recipient.email}:`, err.message);
          await db.markRecipientFailed(recipient.id, err.message);
          failure += 1;
        }
      }));
      // Tiny pause between batches.
      if (i + BATCH < pending.length) await new Promise(r => setTimeout(r, 200));
    }

    await db.markAnnouncementSendCompleted(id, { successCount: success, failureCount: failure });

    return res.json({
      announcement: { ...announcement, sent_completed_at: new Date().toISOString() },
      sentCount: success,
      failedCount: failure,
      processed: pending.length,
    });
  } catch (err) {
    console.error('POST /api/admin/announcements/:id/send error:', err);
    return res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
});

// ─── POST /api/admin/tools/trigger-morning-brief ────────────────────────────
//
// Manually fire the daily WhatsApp digest for the calling platform admin,
// bypassing the per-member per-day lock that the cron uses to dedupe sends.
// Built for fix-verification: when a digest-weather / dinner / school-activity
// change ships and the operator wants to confirm it works without waiting
// until 07:00 tomorrow. Also clears the digest-weather negative cache for
// the household so a transient upstream blip earlier in the day doesn't
// poison the manual re-trigger.
//
// Strictly platform-admin only (the whole admin router is already gated)
// and strictly self-targeted - admin's own user_id / household, never an
// arbitrary user, to keep blast radius zero.

router.post('/tools/trigger-morning-brief', async (req, res) => {
  try {
    const member = await db.getUserByIdAdmin(req.user.id);
    if (!member) return res.status(404).json({ error: 'Caller not found' });
    if (!member.household_id) return res.status(400).json({ error: 'Caller has no household' });
    if (!member.whatsapp_linked || !member.whatsapp_phone) {
      return res.status(400).json({
        error: 'Your WhatsApp is not linked. Link it from Settings → Notifications first.',
      });
    }

    invalidateHouseholdWeatherCache(member.household_id);
    await sendDailyReminders(member.household_id, member);

    return res.json({ ok: true, sentTo: member.whatsapp_phone });
  } catch (err) {
    console.error('POST /api/admin/tools/trigger-morning-brief error:', err);
    return res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
});

module.exports = router;
