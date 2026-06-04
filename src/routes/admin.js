const { Router } = require('express');
const db = require('../db/queries');
const { requireAuth, requirePlatformAdmin } = require('../middleware/auth');
const { sendDailyReminders, chooseDailyBriefChannel } = require('../jobs/reminders');
const { invalidateHouseholdWeatherCache } = require('../services/digest-weather');
const push = require('../services/push');

const router = Router();

// All admin routes require platform admin access
router.use(requireAuth, requirePlatformAdmin);

// ─── GET /api/admin/stats ───────────────────────────────────────────────────

router.get('/stats', async (req, res) => {
  try {
    const [stats, revenue] = await Promise.all([
      db.getPlatformStats(),
      db.getRevenueStats(),
    ]);
    return res.json({ ...stats, revenue });
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

// ─── GET /api/admin/households/:id/activity ─────────────────────────────────
// Per-household product activity timeline (tasks/shopping/calendar/etc.)

router.get('/households/:id/activity', async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days, 10) || 30, 90);
    const activity = await db.getHouseholdActivity(req.params.id, { days });
    return res.json(activity);
  } catch (err) {
    console.error('GET /api/admin/households/:id/activity error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/admin/users/:id/feature-spread ────────────────────────────────
// Lifetime "which features has this user ever touched" (Calendar / Lists /
// Tasks / Chat / Documents / Meals) with per-feature counts.

router.get('/users/:id/feature-spread', async (req, res) => {
  try {
    const spread = await db.getUserFeatureSpread(req.params.id);
    return res.json(spread);
  } catch (err) {
    console.error('GET /api/admin/users/:id/feature-spread error:', err);
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

// Pause or resume a household's trial clock. Body: { paused: boolean }.
// Pausing freezes the trial (the gate keeps access, never expires); resuming
// adds the paused time back onto trial_ends_at so no days are lost.
router.post('/households/:id/trial-pause', async (req, res) => {
  try {
    const paused = !!(req.body && req.body.paused);
    const household = await db.pauseOrResumeTrial(req.params.id, paused);
    return res.json(household);
  } catch (err) {
    if (err.code === 'PGRST116') return res.status(404).json({ error: 'Household not found' });
    console.error('POST /api/admin/households/:id/trial-pause error:', err);
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
    const cohortWeeks = Math.min(parseInt(req.query.cohortWeeks, 10) || 12, 26);
    const [analytics, retention] = await Promise.all([
      db.getAnalytics({ days }),
      db.getRetentionCohorts({ weeks: cohortWeeks }),
    ]);
    return res.json({ ...analytics, retention });
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

    // Mirror the cron's channel choice so we can tell the admin where to
    // look: push (app installed) beats WhatsApp. Requires at least one
    // channel to exist.
    const deviceTokens = await db.getActiveDeviceTokens(member.id).catch(() => []);
    const hasDevices = Array.isArray(deviceTokens) && deviceTokens.length > 0;
    const whatsappLinked = !!(member.whatsapp_linked && member.whatsapp_phone);
    const channel = chooseDailyBriefChannel({ hasDevices, whatsappLinked, briefDisabled: false });
    if (!channel) {
      return res.status(400).json({
        error: 'You have no app device and no WhatsApp linked. Install the Housemait app (or link WhatsApp in Settings → Notifications) to preview your brief.',
      });
    }

    invalidateHouseholdWeatherCache(member.household_id);
    // ignoreOptOut: this is an explicit self-preview, so fire even if the
    // admin has their own Morning briefing toggle switched off.
    await sendDailyReminders(member.household_id, member, { ignoreOptOut: true });

    const where = channel === 'push'
      ? `a push notification to your ${deviceTokens.length} device${deviceTokens.length === 1 ? '' : 's'} - check your phone`
      : `WhatsApp (${member.whatsapp_phone})`;
    return res.json({ ok: true, channel, where });
  } catch (err) {
    console.error('POST /api/admin/tools/trigger-morning-brief error:', err);
    return res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
});

// ─── GET /api/admin/tools/my-devices ───────────────────────────────────────
//
// Push diagnostic: list the calling admin's registered device tokens (active
// and inactive) with timestamps, so we can tell whether the current device
// actually registered for push (a recent updated_at) versus a pile of stale
// ghosts from past installs/rebuilds. Tokens are masked - we only need the
// first/last few chars to correlate with APNs logs, never the full token.

router.get('/tools/my-devices', async (req, res) => {
  try {
    const rows = await db.getDeviceTokensForUserAdmin(req.user.id);
    const devices = rows.map((r) => ({
      id: r.id,
      tokenMasked: r.token ? `${r.token.slice(0, 8)}…${r.token.slice(-4)}` : null,
      // Full token included so the admin can paste their OWN device token into
      // Apple's Push Notifications Console for a backend-bypass test. Device
      // tokens aren't credentials (you still need the provider key to send),
      // and this is the caller's own data behind the admin gate.
      token: r.token,
      platform: r.platform,
      active: r.active,
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));
    return res.json({
      activeCount: devices.filter((d) => d.active).length,
      totalCount: devices.length,
      devices,
    });
  } catch (err) {
    console.error('GET /api/admin/tools/my-devices error:', err);
    return res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
});

// ─── POST /api/admin/tools/push-selftest ───────────────────────────────────
//
// Send a test alert to each of the calling admin's ACTIVE device tokens and
// report the per-token outcome - including which APNs environment delivered
// it. This is the ground truth for "APNs says sent but I see no banner":
// it shows whether the live (recently-updated) token actually succeeds, and
// on sandbox vs production. Uses the diagnostic sender, which never prunes.

router.post('/tools/push-selftest', async (req, res) => {
  try {
    if (!push.isConfigured()) {
      return res.json({ configured: false, results: [] });
    }
    // Test ALL tokens (active AND inactive) so a recently-pruned live token
    // is included - that's often the real device. Diagnostic never prunes.
    const tokens = await db.getDeviceTokensForUserAdmin(req.user.id);
    const payload = {
      aps: {
        alert: {
          title: 'Housemait push test',
          body: 'If you can see this, push notifications are working ✅',
        },
        sound: 'default',
      },
      type: 'push_selftest',
    };
    const results = await Promise.all((tokens || []).map(async (t) => {
      const r = await push.deliverDiagnostic(t.token, payload);
      return {
        tokenMasked: t.token ? `${t.token.slice(0, 8)}…${t.token.slice(-4)}` : null,
        updated_at: t.updated_at,
        active: t.active,
        success: !!r.success,
        env: r.env || null,
        status: r.status || null,
        reason: r.reason || null,
        // Per-environment attempt trail: e.g. production ✗ BadDeviceToken → sandbox ✓
        attempts: r.attempts || [],
      };
    }));
    // Surface which environment the server tries first, so we can confirm
    // APN_PRODUCTION is actually taking effect.
    const primaryEnv = results.find((x) => x.attempts.length)?.attempts[0]?.env || null;
    return res.json({ configured: true, count: results.length, primaryEnv, apns: push.getConfigInfo(), results });
  } catch (err) {
    console.error('POST /api/admin/tools/push-selftest error:', err);
    return res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
});

// ─── GET /api/admin/tools/ai-runtime ──────────────────────────────────────
//
// Diagnostic for AI-provider env-var visibility. Returns which keys the
// running Node process can actually see in its process.env. Never exposes
// the key VALUE - only presence, length, and first-4 chars (enough to
// rule out a wrong-key paste, but not enough to leak a working credential).
//
// Built to triage the "Gemini key may be unset" health alert: that cron
// infers Gemini absence from BEHAVIOUR (no Gemini provider rows in
// ai_usage_log), but doesn't read env directly. This endpoint reads env
// directly so we can prove whether the Railway UI value is reaching the
// container or not.
//
// Platform-admin gated (whole router is). Safe to leave in place
// long-term - it's the canonical "is my AI config right" probe.

// ─── GET /api/admin/tools/ai-selftest ─────────────────────────────────────
//
// Drives a real callWithFailover call with a tiny prompt and reports
// exactly what happened: which provider answered, the latency, and the
// env-var state observed at the moment of the call. Builds on the
// ai-runtime probe by closing the timing gap - the runtime probe shows
// what env looks like NOW; this shows what env looked like at the
// moment the AI client made its routing decision.
//
// Used to triage the case where: env var probe shows GEMINI_API_KEY
// present, but ai_usage_log shows 100% Claude-primary (is_failover=false).
// If the env is genuinely visible at AI-call time, callWithFailover
// will route to Gemini. If something is mutating process.env between
// HTTP handler and AI call, this endpoint surfaces that delta directly.

router.get('/tools/ai-selftest', async (req, res) => {
  const envSnapshot = {
    GEMINI_API_KEY: !!process.env.GEMINI_API_KEY,
    GEMINI_API_KEY_length: process.env.GEMINI_API_KEY?.length || 0,
    ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
    OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
    pid: process.pid,
  };
  const { callWithFailover } = require('../services/ai-client');
  const t0 = Date.now();
  try {
    const result = await callWithFailover({
      system: 'You answer in exactly one word.',
      messages: [{ role: 'user', content: 'Reply with the word PONG.' }],
      maxTokens: 8,
      feature: 'admin_selftest',
      householdId: null,
      userId: req.user.id,
    });
    return res.json({
      ok: true,
      envAtCallTime: envSnapshot,
      provider: result.provider,
      text: result.text,
      totalLatencyMs: Date.now() - t0,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      envAtCallTime: envSnapshot,
      error: err.message,
      errorCode: err.code,
      errorStatus: err.status,
      totalLatencyMs: Date.now() - t0,
    });
  }
});

router.get('/tools/ai-runtime', (req, res) => {
  const probe = (name) => {
    const v = process.env[name];
    if (v == null) return { present: false, length: 0, starts: null };
    return {
      present: v.length > 0,
      length: v.length,
      starts: v.slice(0, 4),
      hasTrailingWhitespace: /\s$/.test(v),
      hasLeadingWhitespace: /^\s/.test(v),
    };
  };
  return res.json({
    pid: process.pid,
    nodeEnv: process.env.NODE_ENV || null,
    GEMINI_API_KEY: probe('GEMINI_API_KEY'),
    ANTHROPIC_API_KEY: probe('ANTHROPIC_API_KEY'),
    OPENAI_API_KEY: probe('OPENAI_API_KEY'),
    // All env keys starting with AI-relevant prefixes - catches a typo'd
    // variant like GEMINI_KEY / GOOGLE_GEMINI_API_KEY that's technically
    // set but isn't the name the code reads.
    aiRelatedKeys: Object.keys(process.env)
      .filter(k => /GEMINI|ANTHROPIC|OPENAI|CLAUDE|GPT|GOOGLE_AI/i.test(k))
      .sort(),
  });
});

// ─── Discount codes (Stripe coupons + promotion codes) ──────────────────────────
//
// Customer-facing % discount codes for web checkout. The customer types the
// code on the Stripe-hosted checkout page (allow_promotion_codes is on). For
// iOS the operator mirrors the same string as an Apple Offer Code in App
// Store Connect - the two systems don't share codes, only the human string.
const stripeService = require('../services/stripe');

router.get('/promo-codes', async (req, res) => {
  try {
    return res.json({ codes: await stripeService.listDiscountCodes({ limit: 100 }) });
  } catch (err) {
    console.error('GET /api/admin/promo-codes error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// Create a discount code. Body: { code, percent_off, duration?,
// duration_in_months?, applies_to?, max_redemptions?, expires_at? }.
router.post('/promo-codes', async (req, res) => {
  try {
    const { code, percent_off, duration, duration_in_months, applies_to, max_redemptions, expires_at } = req.body || {};
    const trimmed = String(code || '').trim();
    if (!/^[A-Za-z0-9_-]{3,40}$/.test(trimmed)) {
      return res.status(400).json({ error: 'Code must be 3-40 characters: letters, numbers, dashes or underscores.' });
    }
    const pct = Math.round(Number(percent_off));
    if (!Number.isFinite(pct) || pct < 1 || pct > 100) {
      return res.status(400).json({ error: 'Percent off must be a whole number from 1 to 100.' });
    }
    const dur = ['once', 'repeating', 'forever'].includes(duration) ? duration : 'once';
    if (dur === 'repeating' && !(Number(duration_in_months) > 0)) {
      return res.status(400).json({ error: 'Repeating discounts need a number of months.' });
    }
    const result = await stripeService.createDiscountCode({
      code: trimmed,
      percentOff: pct,
      duration: dur,
      durationInMonths: dur === 'repeating' ? Math.floor(Number(duration_in_months)) : null,
      appliesTo: ['annual', 'monthly'].includes(applies_to) ? applies_to : 'any',
      maxRedemptions: (max_redemptions === undefined || max_redemptions === null || max_redemptions === '')
        ? null
        : Math.max(1, Math.floor(Number(max_redemptions))),
      expiresAt: expires_at || null,
    });
    return res.status(201).json(result);
  } catch (err) {
    if (err.code === 'resource_already_exists' || /already exists/i.test(err.message || '')) {
      return res.status(409).json({ error: 'That code already exists in Stripe.' });
    }
    console.error('POST /api/admin/promo-codes error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// Enable/disable a promotion code (Stripe's kill switch; codes aren't deleted).
router.patch('/promo-codes/:id', async (req, res) => {
  try {
    const active = !!(req.body && req.body.active);
    await stripeService.setDiscountCodeActive(req.params.id, active);
    return res.json({ ok: true, active });
  } catch (err) {
    console.error('PATCH /api/admin/promo-codes/:id error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

module.exports = router;
