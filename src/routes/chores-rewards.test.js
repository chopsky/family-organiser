/**
 * Route tests for the chores completion → star-earning path and the rewards
 * redeem → star-spending path. DB + auth are mocked; we assert the ledger
 * writes (the bit that must never double-credit or credit the wrong person).
 */
jest.mock('../db/queries');
jest.mock('../db/client', () => ({ supabase: {}, supabaseAdmin: {} }));
jest.mock('../middleware/auth', () => ({
  requireAuth: (req, _res, next) => { req.user = { id: 'me' }; next(); },
  requireHousehold: (req, _res, next) => { req.householdId = 'h1'; next(); },
}));
jest.mock('../services/cache', () => ({ invalidate: jest.fn() }));

const express = require('express');
const request = require('supertest');
const db = require('../db/queries');

function app(routerPath, mount) {
  const a = express();
  a.use(express.json());
  a.use(mount, require(routerPath));
  return a;
}

const DATE = '2026-04-18';
const MEMBERS = [
  { id: 'm', name: 'Mason', member_type: 'dependent' },
  { id: 'g', name: 'Grant', member_type: 'account' },
];
const REWARD_DEF = { id: 'd1', assignee_ids: ['m', 'g'], reward: true, stars: 5 };

beforeEach(() => {
  jest.clearAllMocks();
  db.getHouseholdMembers.mockResolvedValue(MEMBERS);
  db.getChoreDefinitions.mockResolvedValue([REWARD_DEF]);
  db.getStarBalances.mockResolvedValue({ m: 5 });
  db.addChoreCompletion.mockResolvedValue({ inserted: true });
  db.getChoreCompletionsForDate.mockResolvedValue([]);
  db.removeChoreCompletion.mockResolvedValue();
  db.addStarTransaction.mockResolvedValue({ applied: true });
  db.removeStarTransactionByRef.mockResolvedValue();
  // Kids-mode streak plumbing: harmless defaults (streak 0 -> no milestone) so
  // the completion path exercises the award block without awarding anything.
  db.getKidStreak.mockResolvedValue({ current: 0, longest: 0, satisfiedToday: true, atRisk: false, nextMilestone: 7 });
  db.addKidBadge.mockResolvedValue({ inserted: false });
});

describe('POST /api/chores/:id/complete', () => {
  const chores = () => app('./chores', '/api/chores');

  test('a kid completing a reward chore earns its stars exactly once', async () => {
    const res = await request(chores()).post('/api/chores/d1/complete').send({ member_id: 'm', date: DATE, done: true });
    expect(res.status).toBe(200);
    expect(db.addChoreCompletion).toHaveBeenCalledWith('d1', 'm', 'h1', DATE, '');
    expect(db.addStarTransaction).toHaveBeenCalledWith(expect.objectContaining({
      memberId: 'm', delta: 5, reason: 'earn', refType: 'chore_earn', refId: 'd1:m:2026-04-18',
    }));
  });

  test('a repeat tap (already completed) does NOT credit again', async () => {
    db.addChoreCompletion.mockResolvedValue({ inserted: false });
    await request(chores()).post('/api/chores/d1/complete').send({ member_id: 'm', date: DATE, done: true });
    expect(db.addStarTransaction).not.toHaveBeenCalled();
  });

  test('an adult (account holder) completing a reward chore now earns its stars too', async () => {
    const res = await request(chores()).post('/api/chores/d1/complete').send({ member_id: 'g', date: DATE, done: true });
    expect(res.status).toBe(200);
    expect(db.addStarTransaction).toHaveBeenCalledWith(expect.objectContaining({
      memberId: 'g', delta: 5, reason: 'earn', refType: 'chore_earn', refId: 'd1:g:2026-04-18',
    }));
  });

  test('un-completing refunds by removing the earn ledger entry', async () => {
    await request(chores()).post('/api/chores/d1/complete').send({ member_id: 'm', date: DATE, done: false });
    expect(db.removeChoreCompletion).toHaveBeenCalledWith('d1', 'm', DATE, 'h1', '');
    expect(db.removeStarTransactionByRef).toHaveBeenCalledWith('chore_earn', 'd1:m:2026-04-18');
  });

  test('a routine slot is completed independently (slot threaded into the write + ref)', async () => {
    db.getChoreDefinitions.mockResolvedValue([
      { id: 'r1', type: 'routine', whens: ['morning', 'evening'], assignee_ids: ['m'], reward: true, stars: 2 },
    ]);
    await request(chores()).post('/api/chores/r1/complete').send({ member_id: 'm', date: DATE, done: true, slot: 'evening' });
    expect(db.addChoreCompletion).toHaveBeenCalledWith('r1', 'm', 'h1', DATE, 'evening');
    expect(db.addStarTransaction).toHaveBeenCalledWith(expect.objectContaining({
      refType: 'chore_earn', refId: 'r1:m:2026-04-18:evening',
    }));
  });

  test('an unknown/foreign slot falls back to slotless (ignored)', async () => {
    db.getChoreDefinitions.mockResolvedValue([
      { id: 'r1', type: 'routine', whens: ['morning'], assignee_ids: ['m'], reward: false, stars: 0 },
    ]);
    await request(chores()).post('/api/chores/r1/complete').send({ member_id: 'm', date: DATE, done: true, slot: 'evening' });
    expect(db.addChoreCompletion).toHaveBeenCalledWith('r1', 'm', 'h1', DATE, ''); // evening not in whens
  });

  test('completing for a member the task is not assigned to is rejected', async () => {
    db.getChoreDefinitions.mockResolvedValue([{ id: 'd1', assignee_ids: ['g'], reward: false, stars: 0 }]);
    const res = await request(chores()).post('/api/chores/d1/complete').send({ member_id: 'm', date: DATE, done: true });
    expect(res.status).toBe(400);
    expect(db.addChoreCompletion).not.toHaveBeenCalled();
  });

  test('missing date is rejected', async () => {
    const res = await request(chores()).post('/api/chores/d1/complete').send({ member_id: 'm', done: true });
    expect(res.status).toBe(400);
  });

  describe('"Anyone" chores', () => {
    const ANYONE = { id: 'a1', anyone: true, assignee_ids: [], reward: true, stars: 3 };
    beforeEach(() => { db.getChoreDefinitions.mockResolvedValue([ANYONE]); });

    test('any member (even one not assigned) can claim it and is credited', async () => {
      const res = await request(chores()).post('/api/chores/a1/complete').send({ member_id: 'g', date: DATE, done: true });
      expect(res.status).toBe(200);
      expect(db.addChoreCompletion).toHaveBeenCalledWith('a1', 'g', 'h1', DATE, '');
      expect(db.addStarTransaction).toHaveBeenCalledWith(expect.objectContaining({
        memberId: 'g', delta: 3, reason: 'earn', refType: 'chore_earn', refId: 'a1:g:2026-04-18',
      }));
    });

    test('a second claim once already completed is a no-op (no double credit)', async () => {
      db.getChoreCompletionsForDate.mockResolvedValue([{ definition_id: 'a1', member_id: 'm' }]);
      const res = await request(chores()).post('/api/chores/a1/complete').send({ member_id: 'g', date: DATE, done: true });
      expect(res.status).toBe(200);
      expect(db.addChoreCompletion).not.toHaveBeenCalled();
      expect(db.addStarTransaction).not.toHaveBeenCalled();
    });

    test('un-claiming refunds the attributed completer', async () => {
      await request(chores()).post('/api/chores/a1/complete').send({ member_id: 'g', date: DATE, done: false });
      expect(db.removeChoreCompletion).toHaveBeenCalledWith('a1', 'g', DATE, 'h1', '');
      expect(db.removeStarTransactionByRef).toHaveBeenCalledWith('chore_earn', 'a1:g:2026-04-18');
    });
  });

  describe('streak milestones', () => {
    test('reaching a milestone awards the badge + bonus stars, once', async () => {
      db.getKidStreak.mockResolvedValue({ current: 7, longest: 7 });
      db.addKidBadge.mockResolvedValue({ inserted: true });
      const res = await request(chores()).post('/api/chores/d1/complete').send({ member_id: 'm', date: DATE, done: true });
      expect(res.status).toBe(200);
      expect(db.getKidStreak).toHaveBeenCalledWith('h1', 'm', DATE);
      expect(db.addKidBadge).toHaveBeenCalledWith('h1', 'm', 'streak_7', DATE);
      expect(db.addStarTransaction).toHaveBeenCalledWith(expect.objectContaining({
        memberId: 'm', delta: 5, reason: 'earn', refType: 'streak_milestone', refId: 'm:streak_7',
      }));
      expect(res.body.newBadges).toEqual([{ key: 'streak_7', tier: 7, bonus: 5 }]);
    });

    test('an adult completion never computes a kids streak', async () => {
      db.getKidStreak.mockResolvedValue({ current: 7 });
      await request(chores()).post('/api/chores/d1/complete').send({ member_id: 'g', date: DATE, done: true });
      expect(db.getKidStreak).not.toHaveBeenCalled();
      expect(db.addKidBadge).not.toHaveBeenCalled();
    });

    test('an already-earned milestone is not re-credited', async () => {
      db.getKidStreak.mockResolvedValue({ current: 30, longest: 30 });
      db.addKidBadge.mockResolvedValue({ inserted: false }); // already have both tiers
      const res = await request(chores()).post('/api/chores/d1/complete').send({ member_id: 'm', date: DATE, done: true });
      const reasons = db.addStarTransaction.mock.calls.map((c) => c[0].refType);
      expect(reasons).not.toContain('streak_milestone');
      expect(res.body.newBadges).toEqual([]);
    });

    test('un-completing never awards or revokes a streak badge', async () => {
      db.getKidStreak.mockResolvedValue({ current: 7 });
      await request(chores()).post('/api/chores/d1/complete').send({ member_id: 'm', date: DATE, done: false });
      expect(db.getKidStreak).not.toHaveBeenCalled();
      expect(db.addKidBadge).not.toHaveBeenCalled();
    });
  });
});

describe('POST /api/rewards/:id/redeem', () => {
  const rewards = () => app('./rewards', '/api/rewards');
  beforeEach(() => {
    db.getRewardById.mockResolvedValue({ id: 'r1', title: 'Ice cream', emoji: '🍦', cost: 30, active: true });
    db.addRedemption.mockResolvedValue({ id: 'red1', title: 'Ice cream', cost: 30 });
    db.addStarTransaction.mockResolvedValue({ applied: true });
  });

  test('spends stars when affordable and logs the redemption', async () => {
    db.getStarBalances.mockResolvedValue({ m: 45 });
    const res = await request(rewards()).post('/api/rewards/r1/redeem').send({ member_id: 'm' });
    expect(res.status).toBe(201);
    expect(res.body.balance).toBe(15);
    expect(db.addRedemption).toHaveBeenCalledWith('h1', expect.objectContaining({ reward_id: 'r1', member_id: 'm', cost: 30 }));
    expect(db.addStarTransaction).toHaveBeenCalledWith(expect.objectContaining({ delta: -30, reason: 'spend', refType: 'redeem', refId: 'red1' }));
  });

  test('rejects redemption when the member cannot afford it', async () => {
    db.getStarBalances.mockResolvedValue({ m: 10 });
    const res = await request(rewards()).post('/api/rewards/r1/redeem').send({ member_id: 'm' });
    expect(res.status).toBe(400);
    expect(db.addRedemption).not.toHaveBeenCalled();
    expect(db.addStarTransaction).not.toHaveBeenCalled();
  });
});
