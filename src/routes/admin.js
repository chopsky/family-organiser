const { Router } = require('express');
const db = require('../db/queries');
const { requireAuth, requirePlatformAdmin } = require('../middleware/auth');

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
    const { search, page = 1, limit = 50 } = req.query;
    const result = await db.getAllUsersAdmin({
      search,
      page: parseInt(page, 10),
      limit: Math.min(parseInt(limit, 10) || 50, 100),
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
    await db.deleteUser(id);
    return res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/admin/users/:id error:', err);
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
    const { search, page = 1, limit = 50 } = req.query;
    const result = await db.getAllHouseholdsAdmin({
      search,
      page: parseInt(page, 10),
      limit: Math.min(parseInt(limit, 10) || 50, 100),
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

// ─── GET /api/admin/calendar-sync ───────────────────────────────────────────

router.get('/calendar-sync', async (req, res) => {
  try {
    const connections = await db.getCalendarSyncHealth();
    return res.json({ connections });
  } catch (err) {
    console.error('GET /api/admin/calendar-sync error:', err);
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

module.exports = router;
