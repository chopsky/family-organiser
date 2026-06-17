const { Router } = require('express');
const db = require('../db/queries');
const { requireAuth, requireHousehold } = require('../middleware/auth');

const router = Router();

/**
 * GET /api/rewards
 * Everything the Rewards page needs: the catalogue, each member's star balance,
 * and the redemption log (newest first, with the parent `fulfilled` flag).
 */
router.get('/', requireAuth, requireHousehold, async (req, res) => {
  try {
    const [rewards, balances, redemptions] = await Promise.all([
      db.getRewards(req.householdId),
      db.getStarBalances(req.householdId),
      db.getRedemptions(req.householdId),
    ]);
    return res.json({ rewards, balances, redemptions });
  } catch (err) {
    console.error('GET /api/rewards error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/** POST /api/rewards — create a reward (parent-set). */
router.post('/', requireAuth, requireHousehold, async (req, res) => {
  try {
    const { title, emoji, cost, who, position } = req.body || {};
    if (typeof title !== 'string' || !title.trim()) return res.status(400).json({ error: 'title is required' });
    const c = parseInt(cost, 10);
    if (!Number.isInteger(c) || c < 0) return res.status(400).json({ error: 'cost must be a non-negative integer' });
    const created = await db.addReward(req.householdId, { title: title.trim(), emoji: emoji || null, cost: c, who: who || 'any', position }, req.user.id);
    return res.status(201).json({ reward: created });
  } catch (err) {
    console.error('POST /api/rewards error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/** PATCH /api/rewards/:id — edit a reward. */
router.patch('/:id', requireAuth, requireHousehold, async (req, res) => {
  try {
    const updates = {};
    for (const k of ['title', 'emoji', 'who', 'position', 'active']) if (k in (req.body || {})) updates[k] = req.body[k];
    if ('cost' in (req.body || {})) {
      const c = parseInt(req.body.cost, 10);
      if (!Number.isInteger(c) || c < 0) return res.status(400).json({ error: 'cost must be a non-negative integer' });
      updates.cost = c;
    }
    const updated = await db.updateReward(req.params.id, req.householdId, updates);
    if (!updated) return res.status(404).json({ error: 'Reward not found' });
    return res.json({ reward: updated });
  } catch (err) {
    console.error('PATCH /api/rewards/:id error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/** DELETE /api/rewards/:id — soft-hide (the redemption log keeps its snapshot). */
router.delete('/:id', requireAuth, requireHousehold, async (req, res) => {
  try {
    await db.deactivateReward(req.params.id, req.householdId);
    return res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/rewards/:id error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/rewards/:id/redeem — body { member_id }.
 * Spends stars: checks the member can afford it, logs the redemption (with a
 * title/emoji/cost snapshot) and writes a -cost ledger entry. 400 if short.
 */
router.post('/:id/redeem', requireAuth, requireHousehold, async (req, res) => {
  try {
    const memberId = req.body?.member_id;
    if (!memberId) return res.status(400).json({ error: 'member_id is required' });
    const reward = await db.getRewardById(req.params.id, req.householdId);
    if (!reward || reward.active === false) return res.status(404).json({ error: 'Reward not found' });

    const balances = await db.getStarBalances(req.householdId);
    const balance = balances[memberId] || 0;
    if (balance < reward.cost) return res.status(400).json({ error: 'Not enough stars', balance, cost: reward.cost });

    const redemption = await db.addRedemption(req.householdId, {
      reward_id: reward.id, member_id: memberId, title: reward.title, emoji: reward.emoji, cost: reward.cost,
    });
    await db.addStarTransaction({ householdId: req.householdId, memberId, delta: -reward.cost, reason: 'spend', refType: 'redeem', refId: redemption.id });

    return res.status(201).json({ redemption, balance: balance - reward.cost });
  } catch (err) {
    console.error('POST /api/rewards/:id/redeem error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/** PATCH /api/rewards/redemptions/:id — body { fulfilled } parent toggle. */
router.patch('/redemptions/:id', requireAuth, requireHousehold, async (req, res) => {
  try {
    const updated = await db.setRedemptionFulfilled(req.params.id, req.householdId, !!req.body?.fulfilled);
    if (!updated) return res.status(404).json({ error: 'Redemption not found' });
    return res.json({ redemption: updated });
  } catch (err) {
    console.error('PATCH /api/rewards/redemptions/:id error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/** DELETE /api/rewards/redemptions/:id — undo a redemption: refund the stars. */
router.delete('/redemptions/:id', requireAuth, requireHousehold, async (req, res) => {
  try {
    // Refund by removing the spend ledger entry (keyed to the redemption id),
    // then drop the log row. Balance reverts cleanly.
    await db.removeStarTransactionByRef('redeem', req.params.id);
    await db.deleteRedemption(req.params.id, req.householdId);
    const balances = await db.getStarBalances(req.householdId);
    return res.json({ ok: true, balances });
  } catch (err) {
    console.error('DELETE /api/rewards/redemptions/:id error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
