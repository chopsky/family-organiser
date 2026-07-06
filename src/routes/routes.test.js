/**
 * API route integration tests.
 * DB and AI services are mocked - no real database or API calls.
 */

jest.mock('../db/queries');
jest.mock('../db/client', () => {
  // Shared chainable stub returned by both `supabase` and `supabaseAdmin`.
  // The export route in particular reaches into supabaseAdmin directly
  // (because it hits many tables with consistent filters), so we need
  // both clients available on the mock.
  const chain = {
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
  };
  return { supabase: chain, supabaseAdmin: chain };
});
jest.mock('../services/ai');
jest.mock('../services/email', () => ({
  sendVerificationEmail: jest.fn().mockResolvedValue(),
  sendInviteEmail: jest.fn().mockResolvedValue(),
  sendPasswordResetEmail: jest.fn().mockResolvedValue(),
}));
jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('$2b$12$hashedpassword'),
  compare: jest.fn().mockResolvedValue(true),
}));

// Stub global fetch so the password-strength validator's HIBP check is a
// no-op during tests - always reports "not breached". Tests aren't about
// HaveIBeenPwned; the dedicated password-strength test suite covers the
// breach-detection behaviour. Without this, 'password123' in test
// fixtures would trip the real HIBP API (if reachable) and reject the
// request with a 400 - which is correct production behaviour but breaks
// every register/reset route test.
global.fetch = jest.fn().mockResolvedValue({
  ok: true,
  text: async () => '',
});

const request = require('supertest');
const app = require('../app');
const db = require('../db/queries');
const { classify } = require('../services/ai');
const { signToken } = require('../middleware/auth');

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const HOUSEHOLD = { id: 'hh-1', name: 'The Smiths', join_code: 'ABC123', reminder_time: '08:00:00' };
const USER      = { id: 'u-1', name: 'Sarah', role: 'admin', household_id: 'hh-1' };
const MEMBERS   = [USER, { id: 'u-2', name: 'Jake', role: 'member', household_id: 'hh-1' }];
const TOKEN     = signToken({ userId: USER.id, householdId: HOUSEHOLD.id, name: USER.name, role: USER.role });
const AUTH      = { Authorization: `Bearer ${TOKEN}` };

// ─── GET /health ──────────────────────────────────────────────────────────────

describe('GET /health', () => {
  test('returns 200 with status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

// ─── POST /api/auth/join (removed for security) ────────────────────────────────
// The legacy unauthenticated /join endpoint was deleted - it minted a full
// session from just a household join code + a member name (account takeover).
// Joining now goes through the authenticated /auth/attach-to-household flow.

describe('POST /api/auth/join (removed)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('endpoint no longer exists and never mints a session', async () => {
    const res = await request(app).post('/api/auth/join').send({ code: 'ABC123', name: 'Sarah' });
    expect(res.status).toBe(404);
    expect(res.body.token).toBeUndefined();
    expect(db.createUser).not.toHaveBeenCalled();
  });
});

// ─── GET /api/household ───────────────────────────────────────────────────────

describe('GET /api/household', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns household and members for authenticated user', async () => {
    db.getHouseholdById.mockResolvedValue(HOUSEHOLD);
    db.getHouseholdMembers.mockResolvedValue(MEMBERS);

    const res = await request(app).get('/api/household').set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.household.name).toBe('The Smiths');
    expect(res.body.members).toHaveLength(2);
  });

  test('returns 401 without token', async () => {
    const res = await request(app).get('/api/household');
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/shopping ────────────────────────────────────────────────────────

describe('GET /api/shopping', () => {
  const ITEMS = [
    { id: 'i-1', item: 'milk',  category: 'groceries', completed: false },
    { id: 'i-2', item: 'jeans', category: 'clothing',  completed: false },
  ];
  const DEFAULT_LIST = { id: 'list-default', name: 'Default' };

  beforeEach(() => {
    jest.clearAllMocks();
    // Shopping routes auto-resolve the default list when no list_id is given
    db.getDefaultShoppingList.mockResolvedValue(DEFAULT_LIST);
  });

  test('returns shopping list', async () => {
    db.getShoppingList.mockResolvedValue(ITEMS);
    const res = await request(app).get('/api/shopping').set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
  });

  test('filters by category', async () => {
    db.getShoppingList.mockResolvedValue(ITEMS);
    const res = await request(app).get('/api/shopping?category=groceries').set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].category).toBe('groceries');
  });

  test('returns 401 without token', async () => {
    const res = await request(app).get('/api/shopping');
    expect(res.status).toBe(401);
  });
});

// ─── POST /api/shopping ───────────────────────────────────────────────────────

describe('POST /api/shopping', () => {
  const DEFAULT_LIST = { id: 'list-default', name: 'Default' };

  beforeEach(() => {
    jest.clearAllMocks();
    db.getDefaultShoppingList.mockResolvedValue(DEFAULT_LIST);
  });

  test('adds items and returns saved rows', async () => {
    const saved = [{ id: 'i-new', item: 'eggs', category: 'groceries' }];
    db.addShoppingItems.mockResolvedValue(saved);
    db.addShoppingItemsWithDedupe.mockResolvedValue({ created: saved, duplicates: [], updated: [] });

    const res = await request(app)
      .post('/api/shopping')
      .set(AUTH)
      .send({ items: [{ item: 'eggs', category: 'groceries' }] });

    expect(res.status).toBe(201);
    expect(res.body.items[0].item).toBe('eggs');
  });

  test('accepts single-item shorthand', async () => {
    db.addShoppingItems.mockResolvedValue([{ id: 'i-1', item: 'butter' }]);
    db.addShoppingItemsWithDedupe.mockResolvedValue({ created: [{ id: 'i-1', item: 'butter' }], duplicates: [], updated: [] });
    const res = await request(app).post('/api/shopping').set(AUTH).send({ item: 'butter', category: 'groceries' });
    expect(res.status).toBe(201);
  });

  test('returns 400 for invalid category', async () => {
    const res = await request(app).post('/api/shopping').set(AUTH)
      .send({ item: 'thing', category: 'invalid-cat' });
    expect(res.status).toBe(400);
  });

  test('returns 400 when items is missing', async () => {
    const res = await request(app).post('/api/shopping').set(AUTH).send({});
    expect(res.status).toBe(400);
  });
});

// ─── GET /api/tasks ───────────────────────────────────────────────────────────

describe('GET /api/tasks', () => {
  const TASKS = [{ id: 't-1', title: 'Homework', assigned_to_name: 'Jake', due_date: '2026-03-12', completed: false }];

  beforeEach(() => jest.clearAllMocks());

  test('returns tasks due today and overdue by default', async () => {
    db.getTasks.mockResolvedValue(TASKS);
    const res = await request(app).get('/api/tasks').set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.tasks).toHaveLength(1);
  });

  test('calls getAllIncompleteTasks when all=true', async () => {
    db.getAllIncompleteTasks.mockResolvedValue(TASKS);
    const res = await request(app).get('/api/tasks?all=true').set(AUTH);
    expect(res.status).toBe(200);
    expect(db.getAllIncompleteTasks).toHaveBeenCalled();
  });
});

// ─── POST /api/tasks ──────────────────────────────────────────────────────────

describe('POST /api/tasks', () => {
  beforeEach(() => jest.clearAllMocks());

  test('adds tasks and returns saved rows', async () => {
    const saved = [{ id: 't-new', title: 'Buy birthday present', due_date: '2026-03-15' }];
    db.getHouseholdMembers.mockResolvedValue(MEMBERS);
    db.addTasks.mockResolvedValue(saved);

    const res = await request(app).post('/api/tasks').set(AUTH)
      .send({ title: 'Buy birthday present', due_date: '2026-03-15' });

    expect(res.status).toBe(201);
    expect(res.body.tasks[0].title).toBe('Buy birthday present');
  });

  test('returns 400 for invalid recurrence', async () => {
    const res = await request(app).post('/api/tasks').set(AUTH)
      .send({ title: 'Test', recurrence: 'every-other-tuesday' });
    expect(res.status).toBe(400);
  });
});

// ─── POST /api/classify ───────────────────────────────────────────────────────

describe('POST /api/classify', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // classify route loads notes + calendar events with .catch() - the automock
    // returns undefined by default, so give them real resolved promises.
    db.getHouseholdNotes.mockResolvedValue([]);
    db.getCalendarEvents.mockResolvedValue([]);
    db.getDefaultShoppingList.mockResolvedValue({ id: 'list-default', name: 'Default' });
  });

  test('classifies text and returns response_message', async () => {
    db.getHouseholdMembers.mockResolvedValue(MEMBERS);
    db.addShoppingItems.mockResolvedValue([{ id: 'i-1', item: 'milk' }]);
    db.addTasks.mockResolvedValue([{ id: 't-1', title: 'Do homework' }]);

    classify.mockResolvedValue({
      intent: 'add',
      shopping_items: [{ item: 'milk', category: 'groceries', action: 'add' }],
      tasks: [{ title: 'Do homework', assigned_to_name: 'Jake', action: 'add', due_date: '2026-03-12', recurrence: 'weekly', priority: 'medium' }],
      response_message: 'Added milk and a homework reminder for Jake.',
    });

    const res = await request(app).post('/api/classify').set(AUTH)
      .send({ text: 'We need milk and remind Jake to do homework weekly' });

    // Response is now sent immediately with just { result }; DB writes happen
    // in the background (fire-and-forget) so there's no `saved` field anymore.
    expect(res.status).toBe(200);
    expect(res.body.result.response_message).toContain('milk');
    expect(res.body.result.intent).toBe('add');
    expect(res.body.result.shopping_items).toHaveLength(1);
    expect(res.body.result.tasks).toHaveLength(1);
  });

  test('returns 400 when text is missing', async () => {
    const res = await request(app).post('/api/classify').set(AUTH).send({});
    expect(res.status).toBe(400);
  });
});

// ─── POST /api/calendar/events (duplicate detection) ─────────────────────────

describe('POST /api/calendar/events', () => {
  const EVENT_PAYLOAD = {
    title: "Yom Ha'atzma'ut Celebration",
    start_time: '2026-07-17T10:00:00Z',
    end_time:   '2026-07-17T11:00:00Z',
  };

  beforeEach(() => jest.clearAllMocks());

  test('returns 409 when a matching event already exists on the same day', async () => {
    db.findSimilarEvent.mockResolvedValue({
      id: 'ev-existing',
      title: "Yom Ha'atzma'ut Celebration",
      start_time: '2026-07-17T09:00:00Z',
      created_by: 'u-2',
      all_day: false,
    });
    db.getHouseholdMembers.mockResolvedValue(MEMBERS);

    const res = await request(app).post('/api/calendar/events').set(AUTH).send(EVENT_PAYLOAD);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('duplicate');
    expect(res.body.existing.id).toBe('ev-existing');
    expect(res.body.message).toContain('Jake'); // creator of the existing event
    expect(db.createCalendarEvent).not.toHaveBeenCalled();
  });

  test('creates the event when force: true, even if a duplicate exists', async () => {
    db.findSimilarEvent.mockResolvedValue({ id: 'ev-existing', title: EVENT_PAYLOAD.title, start_time: EVENT_PAYLOAD.start_time, created_by: 'u-2' });
    db.getHouseholdMembers.mockResolvedValue(MEMBERS);
    db.createCalendarEvent.mockResolvedValue({ id: 'ev-new', ...EVENT_PAYLOAD });

    const res = await request(app).post('/api/calendar/events').set(AUTH).send({ ...EVENT_PAYLOAD, force: true });

    expect(res.status).toBe(201);
    expect(res.body.event.id).toBe('ev-new');
    expect(db.findSimilarEvent).not.toHaveBeenCalled(); // force skips the check
    expect(db.createCalendarEvent).toHaveBeenCalled();
  });

  test('creates the event normally when no duplicate exists', async () => {
    db.findSimilarEvent.mockResolvedValue(null);
    db.getHouseholdMembers.mockResolvedValue(MEMBERS);
    db.createCalendarEvent.mockResolvedValue({ id: 'ev-new', ...EVENT_PAYLOAD });

    const res = await request(app).post('/api/calendar/events').set(AUTH).send(EVENT_PAYLOAD);

    expect(res.status).toBe(201);
    expect(res.body.event.id).toBe('ev-new');
  });
});

// (sync-health route removed alongside two-way calendar sync.)

// ─── GET /api/digest ──────────────────────────────────────────────────────────

describe('GET /api/digest', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns completed, outstanding, upcoming, household, and members', async () => {
    db.getCompletedThisWeek.mockResolvedValue({ tasks: [], shoppingItems: [] });
    db.getTasks.mockResolvedValue([]);
    db.getTasksDueNextWeek.mockResolvedValue([]);
    db.getHouseholdById.mockResolvedValue(HOUSEHOLD);
    db.getHouseholdMembers.mockResolvedValue(MEMBERS);

    const res = await request(app).get('/api/digest').set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('completed');
    expect(res.body).toHaveProperty('outstanding');
    expect(res.body).toHaveProperty('upcoming');
    expect(res.body.household.name).toBe('The Smiths');
  });
});

// ─── PATCH /api/settings ──────────────────────────────────────────────────────

describe('PATCH /api/settings', () => {
  beforeEach(() => jest.clearAllMocks());

  test('admin can update household name', async () => {
    db.updateHouseholdSettings.mockResolvedValue({ ...HOUSEHOLD, name: 'The Joneses' });
    const res = await request(app).patch('/api/settings/settings').set(AUTH).send({ name: 'The Joneses' });
    expect(res.status).toBe(200);
    expect(res.body.household.name).toBe('The Joneses');
  });

  test('any household member can manage settings (collaborative)', async () => {
    const memberToken = signToken({ userId: 'u-2', householdId: 'hh-1', name: 'Jake', role: 'member' });
    const res = await request(app).patch('/api/settings/settings')
      .set({ Authorization: `Bearer ${memberToken}` })
      .send({ name: 'New Name' });
    expect(res.status).not.toBe(403);
  });

  test('returns 400 when no valid fields provided', async () => {
    const res = await request(app).patch('/api/settings/settings').set(AUTH).send({});
    expect(res.status).toBe(400);
  });
});

// ─── PATCH /api/household/profile (personal profiles are private) ───────────

describe('PATCH /api/household/profile', () => {
  beforeEach(() => jest.clearAllMocks());

  const PROFILE_MEMBERS = [
    { id: 'u-1', name: 'Grant', role: 'admin', member_type: 'adult', household_id: 'hh-1' },
    { id: 'u-2', name: 'Lynn', role: 'member', member_type: 'adult', household_id: 'hh-1' },
    { id: 'k-1', name: 'Logan', role: 'member', member_type: 'dependent', household_id: 'hh-1' },
  ];

  test('a member can edit their own profile', async () => {
    db.updateUser.mockResolvedValue({ id: 'u-2', name: 'Lynne' });
    const lynn = signToken({ userId: 'u-2', householdId: 'hh-1', name: 'Lynn', role: 'member' });
    const res = await request(app).patch('/api/household/profile')
      .set({ Authorization: `Bearer ${lynn}` }).send({ name: 'Lynne' });
    expect(res.status).not.toBe(403);
    expect(db.updateUser).toHaveBeenCalledWith('u-2', expect.objectContaining({ name: 'Lynne' }));
  });

  test('a member CAN edit another account-holder\'s profile identity', async () => {
    db.getHouseholdMembers.mockResolvedValue(PROFILE_MEMBERS);
    db.updateUser.mockResolvedValue({ id: 'u-1', name: 'Grant B' });
    const lynn = signToken({ userId: 'u-2', householdId: 'hh-1', name: 'Lynn', role: 'member' });
    const res = await request(app).patch('/api/household/profile')
      .set({ Authorization: `Bearer ${lynn}` }).send({ user_id: 'u-1', name: 'Grant B', family_role: 'Father' });
    expect(res.status).not.toBe(403);
    expect(db.updateUser).toHaveBeenCalledWith('u-1', expect.objectContaining({ name: 'Grant B', family_role: 'Father' }));
  });

  test('editing another member never changes their personal settings', async () => {
    db.getHouseholdMembers.mockResolvedValue(PROFILE_MEMBERS);
    db.updateUser.mockResolvedValue({ id: 'u-1', name: 'Grant' });
    const lynn = signToken({ userId: 'u-2', householdId: 'hh-1', name: 'Lynn', role: 'member' });
    await request(app).patch('/api/household/profile')
      .set({ Authorization: `Bearer ${lynn}` })
      .send({ user_id: 'u-1', name: 'Grant', reminder_time: '23:00', timezone: 'Pacific/Auckland' });
    const updates = db.updateUser.mock.calls[0][1];
    expect(updates).not.toHaveProperty('reminder_time');
    expect(updates).not.toHaveProperty('timezone');
  });

  test('a member CAN edit a child (dependent) profile', async () => {
    db.getHouseholdMembers.mockResolvedValue(PROFILE_MEMBERS);
    db.updateUser.mockResolvedValue({ id: 'k-1', name: 'Logan B' });
    const lynn = signToken({ userId: 'u-2', householdId: 'hh-1', name: 'Lynn', role: 'member' });
    const res = await request(app).patch('/api/household/profile')
      .set({ Authorization: `Bearer ${lynn}` }).send({ user_id: 'k-1', name: 'Logan B' });
    expect(res.status).not.toBe(403);
    expect(db.updateUser).toHaveBeenCalledWith('k-1', expect.objectContaining({ name: 'Logan B' }));
  });

  test('picking an illustrated avatar stores avatar_id and clears any photo', async () => {
    db.updateUser.mockResolvedValue({ id: 'u-2', avatar_id: 'set2/n07' });
    const lynn = signToken({ userId: 'u-2', householdId: 'hh-1', name: 'Lynn', role: 'member' });
    const res = await request(app).patch('/api/household/profile')
      .set({ Authorization: `Bearer ${lynn}` }).send({ name: 'Lynn', avatar_id: 'set2/n07' });
    expect(res.status).not.toBe(403);
    expect(db.updateUser).toHaveBeenCalledWith('u-2', expect.objectContaining({ avatar_id: 'set2/n07', avatar_url: null }));
  });

  test('clearing the avatar (null) leaves any photo untouched', async () => {
    db.updateUser.mockResolvedValue({ id: 'u-2' });
    const lynn = signToken({ userId: 'u-2', householdId: 'hh-1', name: 'Lynn', role: 'member' });
    await request(app).patch('/api/household/profile')
      .set({ Authorization: `Bearer ${lynn}` }).send({ name: 'Lynn', avatar_id: null });
    const updates = db.updateUser.mock.calls[0][1];
    expect(updates.avatar_id).toBeNull();
    expect(updates).not.toHaveProperty('avatar_url');
  });

  test('rejects a malformed avatar id', async () => {
    const lynn = signToken({ userId: 'u-2', householdId: 'hh-1', name: 'Lynn', role: 'member' });
    const res = await request(app).patch('/api/household/profile')
      .set({ Authorization: `Bearer ${lynn}` }).send({ name: 'Lynn', avatar_id: '../../etc/passwd' });
    expect(res.status).toBe(400);
  });
});

// ─── DELETE /api/household/members/:userId ──────────────────────────────────

describe('DELETE /api/household/members/:userId', () => {
  beforeEach(() => jest.clearAllMocks());

  test('admin can remove a member', async () => {
    db.getHouseholdMembers.mockResolvedValue(MEMBERS);
    db.deleteUser.mockResolvedValue();

    const res = await request(app).delete('/api/household/members/u-2').set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Member removed.');
    expect(db.deleteUser).toHaveBeenCalledWith('u-2', 'hh-1');
  });

  test('any household member can remove a member (collaborative)', async () => {
    db.getHouseholdMembers.mockResolvedValue(MEMBERS);
    db.deleteUser.mockResolvedValue();
    const memberToken = signToken({ userId: 'u-2', householdId: 'hh-1', name: 'Jake', role: 'member' });
    const res = await request(app).delete('/api/household/members/u-1')
      .set({ Authorization: `Bearer ${memberToken}` });
    expect(res.status).not.toBe(403);
  });

  test('admin cannot remove themselves', async () => {
    const res = await request(app).delete('/api/household/members/u-1').set(AUTH);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('cannot remove yourself');
  });

  test('the household owner (created_by) cannot be removed by a co-member', async () => {
    db.getHouseholdById.mockResolvedValue({ ...HOUSEHOLD, created_by: 'u-1' });
    db.getHouseholdMembers.mockResolvedValue(MEMBERS);
    const memberToken = signToken({ userId: 'u-2', householdId: 'hh-1', name: 'Jake', role: 'member' });
    const res = await request(app).delete('/api/household/members/u-1')
      .set({ Authorization: `Bearer ${memberToken}` });
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('owner');
  });

  test('returns 404 for member not in household', async () => {
    db.getHouseholdMembers.mockResolvedValue(MEMBERS);
    const res = await request(app).delete('/api/household/members/u-999').set(AUTH);
    expect(res.status).toBe(404);
  });
});

// ─── POST /api/auth/register ──────────────────────────────────────────────

describe('POST /api/auth/register', () => {
  beforeEach(() => jest.clearAllMocks());

  test('registers new user and returns verification message', async () => {
    db.getUserByEmail.mockResolvedValue(null);
    db.createUserWithEmail.mockResolvedValue({ id: 'u-new', name: 'Alice', role: 'member', household_id: null });
    db.createEmailVerificationToken.mockResolvedValue();

    const res = await request(app).post('/api/auth/register')
      .send({ email: 'alice@test.com', password: 'password123', name: 'Alice' });

    expect(res.status).toBe(201);
    expect(res.body.message).toContain('Check your email');
    expect(db.createUserWithEmail).toHaveBeenCalled();
  });

  test('returns 409 for duplicate email', async () => {
    db.getUserByEmail.mockResolvedValue({ id: 'u-existing', email: 'alice@test.com' });

    const res = await request(app).post('/api/auth/register')
      .send({ email: 'alice@test.com', password: 'password123', name: 'Alice' });

    expect(res.status).toBe(409);
  });

  test('returns 400 when fields are missing', async () => {
    const res = await request(app).post('/api/auth/register').send({ email: 'a@b.com' });
    expect(res.status).toBe(400);
  });

  test('returns 400 for short password', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ email: 'a@b.com', password: 'short', name: 'Bob' });
    expect(res.status).toBe(400);
  });

  test('auto-joins household with valid invite token', async () => {
    db.getUserByEmail.mockResolvedValue(null);
    db.getInviteByToken.mockResolvedValue({ id: 'inv-1', household_id: 'hh-1' });
    db.createUserWithEmail.mockResolvedValue({ id: 'u-new', name: 'Bob', role: 'member', household_id: 'hh-1' });
    db.markInviteAccepted.mockResolvedValue();
    db.getHouseholdById.mockResolvedValue(HOUSEHOLD);

    const res = await request(app).post('/api/auth/register')
      .send({ email: 'bob@test.com', password: 'password123', name: 'Bob', inviteToken: 'valid-token' });

    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.household.name).toBe('The Smiths');
    expect(db.markInviteAccepted).toHaveBeenCalledWith('inv-1');
  });

  test('returns 400 for invalid invite token', async () => {
    db.getUserByEmail.mockResolvedValue(null);
    db.getInviteByToken.mockResolvedValue(null);

    const res = await request(app).post('/api/auth/register')
      .send({ email: 'bob@test.com', password: 'password123', name: 'Bob', inviteToken: 'bad-token' });

    expect(res.status).toBe(400);
  });
});

// ─── POST /api/auth/login ────────────────────────────────────────────────

describe('POST /api/auth/login', () => {
  const bcrypt = require('bcrypt');

  beforeEach(() => jest.clearAllMocks());

  test('returns JWT for valid credentials', async () => {
    db.getUserByEmail.mockResolvedValue({
      id: 'u-1', name: 'Sarah', role: 'admin', household_id: 'hh-1',
      password_hash: '$2b$12$hash', email_verified: true,
    });
    bcrypt.compare.mockResolvedValue(true);
    db.getHouseholdById.mockResolvedValue(HOUSEHOLD);

    const res = await request(app).post('/api/auth/login')
      .send({ email: 'sarah@test.com', password: 'password123' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.name).toBe('Sarah');
  });

  test('returns 401 for wrong password', async () => {
    db.getUserByEmail.mockResolvedValue({
      id: 'u-1', name: 'Sarah', password_hash: '$2b$12$hash', email_verified: true,
    });
    bcrypt.compare.mockResolvedValue(false);

    const res = await request(app).post('/api/auth/login')
      .send({ email: 'sarah@test.com', password: 'wrongpassword' });

    expect(res.status).toBe(401);
  });

  test('returns 401 for unknown email', async () => {
    db.getUserByEmail.mockResolvedValue(null);

    const res = await request(app).post('/api/auth/login')
      .send({ email: 'unknown@test.com', password: 'password123' });

    expect(res.status).toBe(401);
  });

  test('returns 403 for unverified email', async () => {
    db.getUserByEmail.mockResolvedValue({
      id: 'u-1', name: 'Sarah', password_hash: '$2b$12$hash', email_verified: false,
    });
    bcrypt.compare.mockResolvedValue(true);

    const res = await request(app).post('/api/auth/login')
      .send({ email: 'sarah@test.com', password: 'password123' });

    expect(res.status).toBe(403);
  });

  test('returns 400 when fields are missing', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'a@b.com' });
    expect(res.status).toBe(400);
  });
});

// ─── GET /api/auth/verify-email ──────────────────────────────────────────

describe('GET /api/auth/verify-email', () => {
  beforeEach(() => jest.clearAllMocks());

  test('redirects to /verified for valid token', async () => {
    db.getEmailVerificationToken.mockResolvedValue({ id: 'evt-1', user_id: 'u-1' });
    db.markEmailVerificationTokenUsed.mockResolvedValue();
    db.updateUser.mockResolvedValue();

    const res = await request(app).get('/api/auth/verify-email?token=valid-token');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/verified');
  });

  test('redirects with error for invalid token', async () => {
    db.getEmailVerificationToken.mockResolvedValue(null);

    const res = await request(app).get('/api/auth/verify-email?token=bad-token');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('error=invalid-token');
  });

  test('redirects with error when token is missing', async () => {
    const res = await request(app).get('/api/auth/verify-email');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('error=missing-token');
  });
});

// ─── POST /api/auth/create-household ─────────────────────────────────────

describe('POST /api/auth/create-household', () => {
  beforeEach(() => jest.clearAllMocks());

  test('creates household and makes user admin', async () => {
    const noHouseholdToken = signToken({ userId: 'u-3', householdId: null, name: 'New User', role: 'member' });
    db.createHousehold.mockResolvedValue({ id: 'hh-new', name: 'New Fam' });
    db.updateUser.mockResolvedValue({ id: 'u-3', name: 'New User', role: 'admin', household_id: 'hh-new' });
    db.getHouseholdById.mockResolvedValue({ id: 'hh-new', name: 'New Fam', join_code: 'XYZ789', reminder_time: '08:00:00' });
    db.seedStarterRecipes.mockResolvedValue({ seeded: 0, skipped: true });

    const res = await request(app).post('/api/auth/create-household')
      .set({ Authorization: `Bearer ${noHouseholdToken}` })
      .send({ name: 'New Fam' });

    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.household.name).toBe('New Fam');
  });

  test('returns 400 if user already has a household', async () => {
    const res = await request(app).post('/api/auth/create-household')
      .set(AUTH).send({ name: 'Another' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('already belong');
  });

  test('returns 400 when name is missing', async () => {
    const noHouseholdToken = signToken({ userId: 'u-3', householdId: null, name: 'New User', role: 'member' });
    const res = await request(app).post('/api/auth/create-household')
      .set({ Authorization: `Bearer ${noHouseholdToken}` })
      .send({});

    expect(res.status).toBe(400);
  });

  test('returns 401 without auth', async () => {
    const res = await request(app).post('/api/auth/create-household').send({ name: 'Test' });
    expect(res.status).toBe(401);
  });
});

// ─── POST /api/auth/forgot-password ──────────────────────────────────────

describe('POST /api/auth/forgot-password', () => {
  beforeEach(() => jest.clearAllMocks());

  test('always returns 200 regardless of email existence', async () => {
    db.getUserByEmail.mockResolvedValue(null);
    const res = await request(app).post('/api/auth/forgot-password')
      .send({ email: 'nonexistent@test.com' });

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('reset link');
  });

  test('sends reset email for existing user', async () => {
    const emailService = require('../services/email');
    db.getUserByEmail.mockResolvedValue({ id: 'u-1', email: 'sarah@test.com', name: 'Sarah' });
    db.createPasswordResetToken.mockResolvedValue();

    const res = await request(app).post('/api/auth/forgot-password')
      .send({ email: 'sarah@test.com' });

    expect(res.status).toBe(200);
    expect(emailService.sendPasswordResetEmail).toHaveBeenCalled();
  });

  test('returns 200 even with empty email', async () => {
    const res = await request(app).post('/api/auth/forgot-password').send({});
    expect(res.status).toBe(200);
  });
});

// ─── POST /api/auth/reset-password ───────────────────────────────────────

describe('POST /api/auth/reset-password', () => {
  beforeEach(() => jest.clearAllMocks());

  test('resets password with valid token', async () => {
    db.getPasswordResetToken.mockResolvedValue({ id: 'prt-1', user_id: 'u-1' });
    db.updateUser.mockResolvedValue();
    db.markPasswordResetTokenUsed.mockResolvedValue();

    const res = await request(app).post('/api/auth/reset-password')
      .send({ token: 'valid-token', password: 'newpassword123' });

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('Password updated');
  });

  test('returns 400 for invalid token', async () => {
    db.getPasswordResetToken.mockResolvedValue(null);

    const res = await request(app).post('/api/auth/reset-password')
      .send({ token: 'bad-token', password: 'newpassword123' });

    expect(res.status).toBe(400);
  });

  test('returns 400 for short password', async () => {
    const res = await request(app).post('/api/auth/reset-password')
      .send({ token: 'valid-token', password: 'short' });

    expect(res.status).toBe(400);
  });

  test('returns 400 when fields are missing', async () => {
    const res = await request(app).post('/api/auth/reset-password').send({});
    expect(res.status).toBe(400);
  });
});

// ─── GET /api/auth/export ────────────────────────────────────────────────

describe('GET /api/auth/export', () => {
  // The export endpoint uses supabaseAdmin directly (rather than a queries.js
  // helper) because it reaches into 15+ tables with consistent filters. We
  // mock the supabase chain so every table read returns an empty set, then
  // verify the response shape and the download-friendly headers.

  const { supabaseAdmin } = require('../db/client');

  beforeEach(() => {
    jest.clearAllMocks();

    // Stub every chained call to resolve to { data: [], error: null } (or
    // `null` for .single()), regardless of which table is being read.
    // Re-chainable: every method returns the same stub, and the terminal
    // awaited value is the data object.
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      gte: jest.fn().mockReturnThis(),
      lte: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
      // For non-.single() queries, the chain is awaited directly - make it
      // thenable so it resolves to { data: [], error: null }.
      then: (resolve) => resolve({ data: [], error: null }),
    };
    supabaseAdmin.from = jest.fn().mockReturnValue(chain);
  });

  test('returns 401 without a bearer token', async () => {
    const res = await request(app).get('/api/auth/export');
    expect(res.status).toBe(401);
  });

  test('responds with JSON + download headers when authenticated', async () => {
    const res = await request(app).get('/api/auth/export').set(AUTH);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.headers['content-disposition']).toMatch(
      /attachment; filename="housemait-export-\d{4}-\d{2}-\d{2}\.json"/
    );
  });

  test('payload has every documented top-level section', async () => {
    // This test is the contract with the frontend / any external data-
    // portability tool reading the export. Adding a new section here is
    // fine, but removing one is a breaking change.
    const res = await request(app).get('/api/auth/export').set(AUTH);
    expect(res.status).toBe(200);
    const body = res.body;
    expect(body).toMatchObject({
      schema_version: '1.0',
      generated_at: expect.any(String),
      notice: expect.any(String),
    });
    for (const key of [
      'data_subject', 'user', 'household', 'members', 'tasks', 'calendar_events',
      'shopping_lists', 'shopping_items', 'household_notes', 'meal_plan',
      'documents', 'document_folders', 'invites', 'schools', 'child_activities',
      'child_school_events', 'term_dates', 'recipes', 'notification_preferences',
      'chat_conversations', 'chat_messages', 'whatsapp_message_log', 'ai_usage_log',
    ]) {
      expect(body).toHaveProperty(key);
    }
  });

  test('strips password_hash from the exported user row', async () => {
    // Regression anchor for the most important redaction: exporting the
    // user's bcrypt hash to a downloadable JSON file would be extremely bad.
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: { id: USER.id, name: USER.name, email: 'grant@example.com', password_hash: '$2b$12$secret-hash' },
        error: null,
      }),
      then: (resolve) => resolve({ data: [], error: null }),
    };
    supabaseAdmin.from = jest.fn().mockReturnValue(chain);

    const res = await request(app).get('/api/auth/export').set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: USER.id, name: USER.name });
    expect(res.body.user).not.toHaveProperty('password_hash');
  });

  test('survives individual table read failures without crashing the whole export', async () => {
    // Defensive behaviour: one broken table (schema drift, RLS quirk)
    // shouldn't 500 the entire download. The endpoint logs the error and
    // returns an empty array for that section.
    const failChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
      then: (resolve) => resolve({ data: null, error: { message: 'boom', code: '42P01' } }),
    };
    supabaseAdmin.from = jest.fn().mockReturnValue(failChain);

    const res = await request(app).get('/api/auth/export').set(AUTH);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.tasks)).toBe(true);
  });
});

// ─── DELETE /api/auth/account ────────────────────────────────────────────

describe('DELETE /api/auth/account', () => {
  const bcrypt = require('bcrypt');

  beforeEach(() => {
    jest.clearAllMocks();
    bcrypt.compare.mockResolvedValue(true); // most tests want the password to pass
  });

  test('returns 400 when password is missing', async () => {
    const res = await request(app).delete('/api/auth/account').set(AUTH).send({});
    expect(res.status).toBe(400);
  });

  test('returns 400 when typed-DELETE confirmation is missing', async () => {
    const res = await request(app).delete('/api/auth/account').set(AUTH).send({ password: 'pw' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/DELETE/);
    expect(db.deleteUserAdmin).not.toHaveBeenCalled();
  });

  test('returns 400 when confirmation is the wrong string (case-sensitive)', async () => {
    const res = await request(app).delete('/api/auth/account').set(AUTH).send({ password: 'pw', confirmation: 'delete' });
    expect(res.status).toBe(400);
    expect(db.deleteUserAdmin).not.toHaveBeenCalled();
  });

  test('returns 401 when the password is wrong', async () => {
    db.getUserById.mockResolvedValue({ ...USER, password_hash: '$2b$12$stored' });
    bcrypt.compare.mockResolvedValueOnce(false);

    const res = await request(app).delete('/api/auth/account').set(AUTH).send({ password: 'nope', confirmation: 'DELETE' });
    expect(res.status).toBe(401);
    expect(db.deleteUserAdmin).not.toHaveBeenCalled();
    expect(db.deleteHouseholdCascade).not.toHaveBeenCalled();
  });

  test('returns 403 for platform admins (they can\'t self-delete)', async () => {
    db.getUserById.mockResolvedValue({ ...USER, password_hash: '$2b$12$x', is_platform_admin: true });

    const res = await request(app).delete('/api/auth/account').set(AUTH).send({ password: 'pw', confirmation: 'DELETE' });
    expect(res.status).toBe(403);
    expect(db.deleteUserAdmin).not.toHaveBeenCalled();
  });

  test('deletes the whole household when the user is the sole member', async () => {
    db.getUserById.mockResolvedValue({ ...USER, password_hash: '$2b$12$x' });
    db.getHouseholdById.mockResolvedValue(HOUSEHOLD); // loaded for audit snapshot
    db.getHouseholdMembers.mockResolvedValue([USER]); // just them
    db.deleteHouseholdCascade.mockResolvedValue();

    const res = await request(app).delete('/api/auth/account').set(AUTH).send({ password: 'pw', confirmation: 'DELETE' });
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('household_deleted');
    expect(db.deleteHouseholdCascade).toHaveBeenCalledWith(HOUSEHOLD.id);
    expect(db.deleteUserAdmin).not.toHaveBeenCalled();
  });

  test('deletes the whole household when only dependents (kids) remain', async () => {
    // Dependents are users rows (member_type='dependent'). They must not keep
    // an ownerless household alive, nor be promoted to admin. Deleting the
    // last real account deletes the household, which cascades the kids away.
    db.getUserById.mockResolvedValue({ ...USER, password_hash: '$2b$12$x' });
    db.getHouseholdById.mockResolvedValue(HOUSEHOLD);
    db.getHouseholdMembers.mockResolvedValue([
      { ...USER, member_type: 'account' },
      { id: 'k-1', name: 'Bobby', member_type: 'dependent', role: 'member', household_id: HOUSEHOLD.id, created_at: '2024-01-01' },
      { id: 'k-2', name: 'Bobby', member_type: 'dependent', role: 'member', household_id: HOUSEHOLD.id, created_at: '2024-02-01' },
    ]);
    db.deleteHouseholdCascade.mockResolvedValue();

    const res = await request(app).delete('/api/auth/account').set(AUTH).send({ password: 'pw', confirmation: 'DELETE' });
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('household_deleted');
    expect(db.deleteHouseholdCascade).toHaveBeenCalledWith(HOUSEHOLD.id);
    expect(db.updateUser).not.toHaveBeenCalled(); // never promote a dependent
    expect(db.deleteUserAdmin).not.toHaveBeenCalled();
  });

  test('deletes just the user when other members remain and this user is non-admin', async () => {
    const NON_ADMIN = { ...USER, role: 'member' };
    db.getUserById.mockResolvedValue({ ...NON_ADMIN, password_hash: '$2b$12$x' });
    db.getHouseholdMembers.mockResolvedValue([
      NON_ADMIN,
      { id: 'u-2', name: 'Jake', role: 'admin', household_id: HOUSEHOLD.id, created_at: '2024-01-01' },
    ]);
    db.deleteUserAdmin.mockResolvedValue();

    const res = await request(app).delete('/api/auth/account').set(AUTH).send({ password: 'pw', confirmation: 'DELETE' });
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('user_only');
    expect(db.deleteUserAdmin).toHaveBeenCalledWith(USER.id);
    expect(db.deleteHouseholdCascade).not.toHaveBeenCalled();
    expect(db.updateUser).not.toHaveBeenCalled(); // no promotion needed
  });

  test('promotes the oldest non-admin when the deleter is the only admin', async () => {
    // Orphan-admin guard: if the only admin deletes, another member must
    // become admin so the household stays operable. We pick the oldest
    // non-admin by created_at so the choice is deterministic.
    db.getUserById.mockResolvedValue({ ...USER, password_hash: '$2b$12$x' });
    db.getHouseholdMembers.mockResolvedValue([
      USER, // admin, deleting
      { id: 'u-newer', name: 'Newer', role: 'member', household_id: HOUSEHOLD.id, created_at: '2025-06-01' },
      { id: 'u-older', name: 'Older', role: 'member', household_id: HOUSEHOLD.id, created_at: '2024-01-01' },
    ]);
    db.updateUser.mockResolvedValue();
    db.deleteUserAdmin.mockResolvedValue();

    const res = await request(app).delete('/api/auth/account').set(AUTH).send({ password: 'pw', confirmation: 'DELETE' });
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('user_only');
    expect(db.updateUser).toHaveBeenCalledWith('u-older', { role: 'admin' });
    expect(db.deleteUserAdmin).toHaveBeenCalledWith(USER.id);
  });

  test('does NOT promote anyone when another admin already exists', async () => {
    // Co-admin case: the household keeps working without any role change,
    // so we shouldn't touch anyone else on our way out.
    db.getUserById.mockResolvedValue({ ...USER, password_hash: '$2b$12$x' });
    db.getHouseholdMembers.mockResolvedValue([
      USER,
      { id: 'u-2', name: 'Jake', role: 'admin', household_id: HOUSEHOLD.id, created_at: '2024-01-01' },
      { id: 'u-3', name: 'Lily', role: 'member', household_id: HOUSEHOLD.id, created_at: '2024-02-01' },
    ]);
    db.deleteUserAdmin.mockResolvedValue();

    const res = await request(app).delete('/api/auth/account').set(AUTH).send({ password: 'pw', confirmation: 'DELETE' });
    expect(res.status).toBe(200);
    expect(db.updateUser).not.toHaveBeenCalled();
    expect(db.deleteUserAdmin).toHaveBeenCalledWith(USER.id);
  });

  test('returns 401 without a bearer token', async () => {
    const res = await request(app).delete('/api/auth/account').send({ password: 'pw', confirmation: 'DELETE' });
    expect(res.status).toBe(401);
  });
});

// ─── POST /api/household/invite ──────────────────────────────────────────

describe('POST /api/household/invite', () => {
  beforeEach(() => jest.clearAllMocks());

  test('admin can send invite', async () => {
    db.getHouseholdById.mockResolvedValue(HOUSEHOLD);
    db.createInvite.mockResolvedValue();

    const res = await request(app).post('/api/household/invite').set(AUTH)
      .send({ email: 'newmember@test.com' });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Invite sent.');
    expect(db.createInvite).toHaveBeenCalled();
  });

  test('any household member can invite (collaborative)', async () => {
    const memberToken = signToken({ userId: 'u-2', householdId: 'hh-1', name: 'Jake', role: 'member' });
    const res = await request(app).post('/api/household/invite')
      .set({ Authorization: `Bearer ${memberToken}` })
      .send({ email: 'someone@test.com' });

    expect(res.status).not.toBe(403);
  });

  test('returns 400 when email is missing', async () => {
    const res = await request(app).post('/api/household/invite').set(AUTH).send({});
    expect(res.status).toBe(400);
  });
});

// ─── GET /api/household/invites ──────────────────────────────────────────

describe('GET /api/household/invites', () => {
  beforeEach(() => jest.clearAllMocks());

  test('admin can list pending invites', async () => {
    db.getPendingInvites.mockResolvedValue([
      { id: 'inv-1', email: 'pending@test.com', expires_at: '2026-03-20T00:00:00Z' },
    ]);

    const res = await request(app).get('/api/household/invites').set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.invites).toHaveLength(1);
  });

  test('any household member can list invites (collaborative)', async () => {
    db.getPendingInvites.mockResolvedValue([]);
    const memberToken = signToken({ userId: 'u-2', householdId: 'hh-1', name: 'Jake', role: 'member' });
    const res = await request(app).get('/api/household/invites')
      .set({ Authorization: `Bearer ${memberToken}` });

    expect(res.status).not.toBe(403);
  });
});

// ─── PATCH /api/household/profile - orphaned-school cleanup guard ───────────────
// When a child's school link changes, the route auto-removes the OLD school only
// if it's genuinely empty: no remaining children AND no imported term dates AND
// no iCal feed. Schools are household-level entities now, so unlinking the last
// child must never silently bin a school that still holds imported dates.
describe('PATCH /api/household/profile orphan-school cleanup', () => {
  beforeEach(() => jest.clearAllMocks());

  const CHILD = { id: 'c-1', name: 'Oliver', member_type: 'dependent', household_id: 'hh-1', school_id: 'S1' };
  // Membership AFTER the school_id change - no member links S1 any more, so S1
  // is now childless and a naive cleanup would delete it.
  const MEMBERS_AFTER = [USER, { ...CHILD, school_id: 'S2' }];

  function armMembers() {
    db.getHouseholdMembers
      .mockResolvedValueOnce([USER, CHILD]) // targetUserId resolution (editing a dependent)
      .mockResolvedValueOnce([USER, CHILD]) // oldSchoolId capture
      .mockResolvedValue(MEMBERS_AFTER);    // cleanup re-fetch (+ any extra calls)
    db.updateUser.mockResolvedValue({ ...CHILD, school_id: 'S2' });
  }

  test('does NOT delete the old school when it still has imported term dates', async () => {
    armMembers();
    db.getHouseholdSchools.mockResolvedValue([
      { id: 'S1', school_name: 'Oakwood', ical_url: null, term_dates_source: 'whatsapp_import' },
    ]);

    const res = await request(app)
      .patch('/api/household/profile')
      .set(AUTH)
      .send({ user_id: 'c-1', school_id: 'S2' });

    expect(res.status).toBe(200);
    expect(db.deleteHouseholdSchool).not.toHaveBeenCalled();
  });

  test('does NOT delete the old school when it has an iCal feed', async () => {
    armMembers();
    db.getHouseholdSchools.mockResolvedValue([
      { id: 'S1', school_name: 'Oakwood', ical_url: 'https://school/cal.ics', term_dates_source: null },
    ]);

    const res = await request(app)
      .patch('/api/household/profile')
      .set(AUTH)
      .send({ user_id: 'c-1', school_id: 'S2' });

    expect(res.status).toBe(200);
    expect(db.deleteHouseholdSchool).not.toHaveBeenCalled();
  });

  test('DOES delete a genuinely-empty orphaned school (no children, no dates, no iCal)', async () => {
    armMembers();
    db.getHouseholdSchools.mockResolvedValue([
      { id: 'S1', school_name: 'Oakwood', ical_url: null, term_dates_source: null },
    ]);

    const res = await request(app)
      .patch('/api/household/profile')
      .set(AUTH)
      .send({ user_id: 'c-1', school_id: 'S2' });

    expect(res.status).toBe(200);
    expect(db.deleteHouseholdSchool).toHaveBeenCalledWith('S1', 'hh-1');
  });
});

// ─── GET /api/schools/activities (household-wide) ───────────────────────────────
// Powers the Activities card. Must return EVERY child's activities scoped to the
// household, including school-less children (so it can't be derived from
// GET /schools, which is school-centric). The bare /activities path must not be
// shadowed by /activities/:childId.
describe('GET /api/schools/activities (household-wide)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns all household activities, scoped by householdId', async () => {
    db.getHouseholdActivities.mockResolvedValue([
      { id: 'a1', child_id: 'c-1', day_of_week: 1, activity: 'Swimming' },
      { id: 'a2', child_id: 'c-2', day_of_week: 3, activity: 'Football' },
    ]);

    const res = await request(app).get('/api/schools/activities').set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.activities).toHaveLength(2);
    expect(db.getHouseholdActivities).toHaveBeenCalledWith('hh-1');
    // Bare path must NOT fall through to the per-child handler.
    expect(db.getChildActivities).not.toHaveBeenCalled();
  });

  test('requires authentication', async () => {
    const res = await request(app).get('/api/schools/activities');
    expect(res.status).toBe(401);
  });
});

// ─── Activity skips ("skip just this day") ──────────────────────────────────────
// One (activity, date) row hides a single occurrence of a weekly activity
// everywhere it's expanded, without touching the series. The routes must be
// household-scoped (no skipping another household's activity) and validate the
// date shape, since it lands in a DATE column and in ICS/calendar filters.
describe('activity skips', () => {
  const ACTIVITY = { id: 'act-1', child_id: 'u-2', day_of_week: 0, activity: 'Wraparound Care' };

  beforeEach(() => {
    jest.clearAllMocks();
    db.getChildActivityById.mockResolvedValue(ACTIVITY);
    db.getHouseholdMembers.mockResolvedValue(MEMBERS);
  });

  test('POST creates a skip for one date', async () => {
    const res = await request(app)
      .post('/api/schools/activities/act-1/skips')
      .set(AUTH)
      .send({ date: '2026-07-06' });
    expect(res.status).toBe(201);
    expect(db.addActivitySkip).toHaveBeenCalledWith('act-1', 'hh-1', '2026-07-06', 'u-1');
  });

  test('POST rejects a malformed date', async () => {
    const res = await request(app)
      .post('/api/schools/activities/act-1/skips')
      .set(AUTH)
      .send({ date: 'today' });
    expect(res.status).toBe(400);
    expect(db.addActivitySkip).not.toHaveBeenCalled();
  });

  test('POST 404s for an activity outside the household', async () => {
    // Child u-99 is not in MEMBERS, so childInHousehold fails.
    db.getChildActivityById.mockResolvedValue({ ...ACTIVITY, child_id: 'u-99' });
    const res = await request(app)
      .post('/api/schools/activities/act-1/skips')
      .set(AUTH)
      .send({ date: '2026-07-06' });
    expect(res.status).toBe(404);
    expect(db.addActivitySkip).not.toHaveBeenCalled();
  });

  test('DELETE removes a skip (un-skip)', async () => {
    const res = await request(app)
      .delete('/api/schools/activities/act-1/skips/2026-07-06')
      .set(AUTH);
    expect(res.status).toBe(200);
    expect(db.removeActivitySkip).toHaveBeenCalledWith('act-1', '2026-07-06');
  });
});

// ─── GET /api/schools must not delete brand-new schools ─────────────────────────
// A school just added via "Add a school" has no children, no term dates and no
// iCal feed yet. GET is a pure read - it must return it (so the add-then-import
// flow works), never auto-delete it on the way out. Uses a dedicated household
// id so the route's schools: cache can't collide with other tests.
describe('GET /api/schools does not auto-delete a brand-new school', () => {
  const HH = 'hh-schools-read';
  const READ_AUTH = { Authorization: `Bearer ${signToken({ userId: 'u-1', householdId: HH, name: 'Sarah', role: 'admin' })}` };
  beforeEach(() => jest.clearAllMocks());

  test('a childless school with no dates/iCal is returned, not deleted', async () => {
    db.getHouseholdSchools.mockResolvedValue([
      { id: 'S-new', school_name: 'The Sunshine Academy', school_urn: null, ical_url: null, term_dates_source: null },
    ]);
    db.getHouseholdMembers.mockResolvedValue([{ id: 'u-1', household_id: HH }]); // no child links S-new
    db.getTermDatesBySchoolIds.mockResolvedValue([]);
    db.getActivitiesByChildIds.mockResolvedValue([]);

    const res = await request(app).get('/api/schools').set(READ_AUTH);

    expect(res.status).toBe(200);
    expect(res.body.schools).toHaveLength(1);
    expect(res.body.schools[0].id).toBe('S-new');
    expect(db.deleteHouseholdSchool).not.toHaveBeenCalled();
  });
});

// ─── JWT algorithm pinning ──────────────────────────────────────────────────────
// Tokens are always minted HS256. The auth middleware pins algorithms:['HS256']
// so a token forged with any other algorithm (the alg-confusion / alg:none class)
// is rejected even though it's signed with the same secret string.
describe('JWT algorithm pinning', () => {
  beforeEach(() => jest.clearAllMocks());

  test('rejects a token signed with a non-HS256 algorithm', async () => {
    const jwt = require('jsonwebtoken');
    const forged = jwt.sign(
      { userId: 'u-1', householdId: 'hh-1', name: 'Sarah', role: 'admin' },
      process.env.JWT_SECRET,
      { algorithm: 'HS512' },
    );
    const res = await request(app).get('/api/household').set({ Authorization: `Bearer ${forged}` });
    expect(res.status).toBe(401);
  });

  test('still accepts a normally-signed HS256 token (control)', async () => {
    db.getHouseholdById.mockResolvedValue(HOUSEHOLD);
    db.getHouseholdMembers.mockResolvedValue(MEMBERS);
    const res = await request(app).get('/api/household').set(AUTH);
    expect(res.status).toBe(200);
  });
});

// ─── GET /api/admin/audit-log ────────────────────────────────────────────────────
describe('GET /api/admin/audit-log', () => {
  const PLATFORM_AUTH = {
    Authorization: `Bearer ${signToken({ userId: 'u-1', householdId: 'hh-1', name: 'Sarah', role: 'admin', isPlatformAdmin: true })}`,
  };
  beforeEach(() => jest.clearAllMocks());

  test('returns the paginated log for a platform admin', async () => {
    db.getAdminAuditLog.mockResolvedValue({
      entries: [{ id: 'a1', method: 'POST', path: '/api/admin/users/:id', status_code: 200 }],
      total: 1,
    });
    const res = await request(app).get('/api/admin/audit-log').set(PLATFORM_AUTH);
    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(1);
    expect(res.body.total).toBe(1);
  });

  test('forbids a non-platform-admin', async () => {
    const res = await request(app).get('/api/admin/audit-log').set(AUTH);
    expect(res.status).toBe(403);
  });
});

// ─── POST /api/calendar/device-sync ─────────────────────────────────────────────
// EventKit device sync: auth'd members upload window snapshots of selected
// device calendars. The service must drop Housemait-prefixed UIDs (echo
// guard) and report per-calendar results.
describe('POST /api/calendar/device-sync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.findDeviceCalendarLink.mockResolvedValue({
      id: 'L1', household_id: 'hh-1', color: 'sky', device_owner_user_id: 'u-1',
      display_name: 'Family', last_sync_hash: null,
    });
    db.findHouseholdUidsUnderOtherFeeds.mockResolvedValue([]);
    db.replaceFeedEventsInWindow.mockResolvedValue();
    db.updateDeviceCalendarLink.mockResolvedValue();
  });

  const BODY = {
    calendars: [{
      deviceCalendarId: 'DC1', name: 'Family', hash: 'h1',
      windowStart: '2026-05-13T00:00:00Z', windowEnd: '2029-06-12T00:00:00Z',
      events: [
        { uid: 'u-real', title: 'Swim', start: '2026-06-15T09:00:00Z', end: '2026-06-15T10:00:00Z' },
        { uid: 'housemait-evt-x@housemait.com', title: 'Echo', start: '2026-06-16T09:00:00Z' },
      ],
    }],
  };

  test('requires auth', async () => {
    const res = await request(app).post('/api/calendar/device-sync').send(BODY);
    expect(res.status).toBe(401);
  });

  test('applies real events and drops Housemait echoes', async () => {
    const res = await request(app).post('/api/calendar/device-sync').set(AUTH).send(BODY);
    expect(res.status).toBe(200);
    expect(res.body.results[0]).toMatchObject({ ok: true, applied: 1, echoDropped: 1 });
    const rows = db.replaceFeedEventsInWindow.mock.calls[0][3];
    expect(rows.map((r) => r.external_uid)).toEqual(['u-real']);
  });

  test('rejects an empty body and >10 calendars', async () => {
    expect((await request(app).post('/api/calendar/device-sync').set(AUTH).send({})).status).toBe(400);
    const many = { calendars: Array.from({ length: 11 }, (_, i) => ({ deviceCalendarId: `c${i}` })) };
    expect((await request(app).post('/api/calendar/device-sync').set(AUTH).send(many)).status).toBe(400);
  });
});

// ─── Synced events are read-only via the API ────────────────────────────────────
// A PATCH or DELETE on a feed/device-sourced event would "succeed" and then be
// silently reverted by the next sync - the API must refuse instead.
describe('synced calendar events are read-only', () => {
  beforeEach(() => jest.clearAllMocks());

  test('PATCH on a synced event is refused with 409', async () => {
    db.getCalendarEventById.mockResolvedValue({ id: 'e1', external_feed_id: 'F1', start_time: 'x', end_time: 'y' });
    const res = await request(app).patch('/api/calendar/events/e1').set(AUTH).send({ title: 'New title' });
    expect(res.status).toBe(409);
    expect(db.updateCalendarEvent).not.toHaveBeenCalled();
  });

  test('DELETE on a synced event is refused with 409', async () => {
    db.getCalendarEventById.mockResolvedValue({ id: 'e1', external_feed_id: 'F1' });
    const res = await request(app).delete('/api/calendar/events/e1').set(AUTH);
    expect(res.status).toBe(409);
    expect(db.deleteCalendarEvent).not.toHaveBeenCalled();
  });

  test('native events still update normally', async () => {
    db.getCalendarEventById.mockResolvedValue({ id: 'e2', external_feed_id: null, start_time: '2026-06-15T09:00:00Z', end_time: '2026-06-15T10:00:00Z' });
    db.updateCalendarEvent.mockResolvedValue({ id: 'e2', title: 'Renamed', start_time: '2026-06-15T09:00:00Z' });
    const res = await request(app).patch('/api/calendar/events/e2').set(AUTH).send({ title: 'Renamed' });
    expect(res.status).toBe(200);
    expect(db.updateCalendarEvent).toHaveBeenCalled();
  });

  test('restore refuses synced/missing rows with 404 (query matches only user-deleted events)', async () => {
    db.restoreCalendarEvent.mockResolvedValue(null);
    const res = await request(app).post('/api/calendar/e1/restore').set(AUTH);
    expect(res.status).toBe(404);
  });

  test('restore returns the row for a genuine user deletion', async () => {
    db.restoreCalendarEvent.mockResolvedValue({ id: 'e9', title: 'Picnic' });
    const res = await request(app).post('/api/calendar/e9/restore').set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.event).toMatchObject({ id: 'e9' });
  });
});

// ─── POST /external-feeds rejects page-URLs with copy-this-instead guidance ────
// People paste the provider's web page instead of the iCal address; without
// this the row was created and failed every pull forever.
describe('add external feed - wrong-paste detection', () => {
  beforeEach(() => jest.clearAllMocks());

  test('Google Calendar settings-page URL is rejected before any row is created', async () => {
    const res = await request(app).post('/api/calendar/external-feeds').set(AUTH)
      .send({ feed_url: 'https://calendar.google.com/calendar/u/0/r/settings/calendar/YWJj', display_name: 'Work' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Secret address in iCal format/);
    expect(db.createExternalFeed).not.toHaveBeenCalled();
  });

  test('iCloud website URL is rejected with the Public Calendar steps', async () => {
    const res = await request(app).post('/api/calendar/external-feeds').set(AUTH)
      .send({ feed_url: 'https://www.icloud.com/calendar/', display_name: 'Home' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Public Calendar/);
    expect(db.createExternalFeed).not.toHaveBeenCalled();
  });

  test('a valid feed is created and returns immediately - the pull runs in the background', async () => {
    const externalFeed = require('../services/externalFeed');
    // Never-resolving pull: proves the route returns without awaiting it, and
    // keeps the background then/catch from logging after the test finishes.
    const pull = jest.spyOn(externalFeed, 'refreshFeed').mockReturnValue(new Promise(() => {}));
    db.createExternalFeed.mockResolvedValue({
      id: 'feed-1', household_id: 'hh-1', display_name: 'Family',
      feed_url: 'https://p161-caldav.icloud.com/published/2/abc.ics',
    });

    const res = await request(app).post('/api/calendar/external-feeds').set(AUTH)
      .send({ feed_url: 'webcal://p161-caldav.icloud.com/published/2/abc.ics', display_name: 'Family' });

    expect(res.status).toBe(201);
    expect(res.body.feed).toMatchObject({ id: 'feed-1' });
    expect(res.body.refresh).toBeUndefined(); // no synchronous pull stats anymore
    expect(db.createExternalFeed).toHaveBeenCalledTimes(1);
    expect(pull).toHaveBeenCalledTimes(1);    // initial pull kicked off in the background
    pull.mockRestore();
  });
});

// ─── GET /calendar/month orders native events before synced copies ──────────────
// The calendar client dedupes by title+date and keeps the first event it sees,
// so a native event must come before a read-only synced copy - otherwise an
// event the user deleted at the source (but which still lingers in our copy)
// hides their own re-created event.
describe('GET /calendar/month native-before-synced ordering', () => {
  beforeEach(() => jest.clearAllMocks());

  test('a native event is returned before a synced copy at the same title+date', async () => {
    db.getCalendarEvents.mockResolvedValue([
      { id: 's1', title: 'Flicky', start_time: '2099-01-05T12:00:00Z', external_feed_id: 'feed-1', category: 'event' },
      { id: 'n1', title: 'Flicky', start_time: '2099-01-05T12:00:00Z', external_feed_id: null, category: 'event' },
    ]);
    db.getTasksByDateRange.mockResolvedValue([]);
    db.getEventAssigneesBatch.mockResolvedValue([]);
    db.getEventRemindersBatch.mockResolvedValue([]);

    // 2099-01 dodges any cal-month cache entry other tests may have seeded.
    const res = await request(app).get('/api/calendar/month?month=2099-01').set(AUTH);
    expect(res.status).toBe(200);
    const ids = res.body.events.map((e) => e.id);
    expect(ids.indexOf('n1')).toBeLessThan(ids.indexOf('s1'));
  });
});

// ─── GET /api/calendar/feed/:token.ics - stable UIDs ────────────────────────────
// Without explicit ids, ical-generator mints RANDOM UIDs per request, so
// subscribers' calendar apps saw the whole feed deleted + recreated on every
// refresh. UIDs must be row-id-based and identical across renders.
describe('outbound calendar feed emits stable UIDs', () => {
  beforeEach(() => jest.clearAllMocks());

  function armFeed() {
    db.getFeedTokenData.mockResolvedValue({ household_id: 'hh-1' });
    db.getHouseholdById.mockResolvedValue(HOUSEHOLD);
    db.getAllEventsForFeed.mockResolvedValue({
      events: [{ id: 'e1', title: 'Swimming', start_time: '2026-06-12T09:00:00Z', end_time: '2026-06-12T10:00:00Z', all_day: false }],
      tasks: [{ id: 't1', title: 'Garden bin', due_date: '2026-06-13', completed: false }],
    });
  }
  const uidsOf = (ics) => ics.split(/\r?\n/).filter((l) => l.startsWith('UID:')).sort();

  test('UIDs are row-id-based and identical across two renders', async () => {
    armFeed();
    const first = await request(app).get('/api/calendar/feed/tok123.ics');
    armFeed();
    const second = await request(app).get('/api/calendar/feed/tok123.ics');

    expect(first.status).toBe(200);
    const uids1 = uidsOf(first.text);
    expect(uids1).toContain('UID:housemait-evt-e1@housemait.com');
    expect(uids1).toContain('UID:housemait-task-t1@housemait.com');
    expect(uidsOf(second.text)).toEqual(uids1);
  });

  // Weekly extracurriculars flagged show_on_calendar are materialised into
  // per-occurrence VEVENTs (child name in the summary, stable UIDs), inside
  // the activity's term window; unflagged activities stay out of the feed.
  test('flagged activities appear as per-occurrence VEVENTs, unflagged do not', async () => {
    armFeed();
    const todayDow = (new Date().getDay() + 6) % 7; // 0=Monday
    const iso = (daysAhead) => {
      const d = new Date();
      d.setDate(d.getDate() + daysAhead);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    db.getHouseholdActivities.mockResolvedValue([
      // Ongoing (no term window): one occurrence per week across the whole
      // 98-day render window = exactly 14 VEVENTs.
      { id: 'a1', child_id: 'kid1', activity: 'Dance', day_of_week: todayDow, time_start: '17:30:00', time_end: '18:00:00', show_on_calendar: true },
      // Term-limited to [today, today+13]: exactly 2 occurrences.
      { id: 'a2', child_id: 'kid1', activity: 'Football', day_of_week: todayDow, time_start: '10:00:00', start_date: iso(0), end_date: iso(13), show_on_calendar: true },
      // Unticked "show on the family calendar": excluded entirely.
      { id: 'a3', child_id: 'kid1', activity: 'Chess', day_of_week: todayDow, time_start: '16:00:00', show_on_calendar: false },
    ]);
    db.getHouseholdMembers.mockResolvedValue([{ id: 'kid1', name: 'Olivia', member_type: 'dependent' }]);

    const res = await request(app).get('/api/calendar/feed/tok123.ics');
    expect(res.status).toBe(200);
    const uids = uidsOf(res.text);
    expect(uids.filter((u) => u.startsWith('UID:housemait-act-a1-'))).toHaveLength(14);
    expect(uids.filter((u) => u.startsWith('UID:housemait-act-a2-'))).toHaveLength(2);
    expect(uids.some((u) => u.startsWith('UID:housemait-act-a3-'))).toBe(false);
    expect(res.text).toContain('Olivia - Dance');
    // Re-render must emit identical occurrence UIDs (stable-UID contract).
    armFeed();
    db.getHouseholdActivities.mockResolvedValue([
      { id: 'a1', child_id: 'kid1', activity: 'Dance', day_of_week: todayDow, time_start: '17:30:00', time_end: '18:00:00', show_on_calendar: true },
    ]);
    db.getHouseholdMembers.mockResolvedValue([{ id: 'kid1', name: 'Olivia', member_type: 'dependent' }]);
    const again = await request(app).get('/api/calendar/feed/tok123.ics');
    expect(uidsOf(again.text).filter((u) => u.startsWith('UID:housemait-act-a1-')))
      .toEqual(uids.filter((u) => u.startsWith('UID:housemait-act-a1-')));
  });
});
