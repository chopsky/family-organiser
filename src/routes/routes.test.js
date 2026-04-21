/**
 * API route integration tests.
 * DB and AI services are mocked — no real database or API calls.
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
// no-op during tests — always reports "not breached". Tests aren't about
// HaveIBeenPwned; the dedicated password-strength test suite covers the
// breach-detection behaviour. Without this, 'password123' in test
// fixtures would trip the real HIBP API (if reachable) and reject the
// request with a 400 — which is correct production behaviour but breaks
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

// ─── POST /api/auth/join ──────────────────────────────────────────────────────

describe('POST /api/auth/join', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns token and user when joining with valid code', async () => {
    db.getHouseholdByCode.mockResolvedValue(HOUSEHOLD);
    db.getHouseholdMembers.mockResolvedValue(MEMBERS);
    // authResponse() now resolves the household + issues a refresh token
    db.getHouseholdById.mockResolvedValue(HOUSEHOLD);
    db.createRefreshToken.mockResolvedValue({ id: 'rt-1' });

    const res = await request(app).post('/api/auth/join').send({ code: 'ABC123', name: 'Sarah' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.refreshToken).toBeTruthy();
    expect(res.body.household.name).toBe('The Smiths');
    expect(res.body.user.name).toBe('Sarah');
  });

  test('creates a new user if name not in household', async () => {
    db.getHouseholdByCode.mockResolvedValue(HOUSEHOLD);
    db.getHouseholdMembers.mockResolvedValue([]);
    db.createUser.mockResolvedValue({ id: 'u-new', name: 'Grandma', role: 'admin', household_id: 'hh-1' });
    db.getHouseholdById.mockResolvedValue(HOUSEHOLD);
    db.createRefreshToken.mockResolvedValue({ id: 'rt-1' });

    const res = await request(app).post('/api/auth/join').send({ code: 'ABC123', name: 'Grandma' });

    expect(res.status).toBe(200);
    expect(db.createUser).toHaveBeenCalled();
    expect(res.body.user.name).toBe('Grandma');
  });

  test('returns 404 for unknown code', async () => {
    db.getHouseholdByCode.mockResolvedValue(null);
    const res = await request(app).post('/api/auth/join').send({ code: 'XXXXXX', name: 'Sarah' });
    expect(res.status).toBe(404);
  });

  test('returns 400 when name is missing', async () => {
    const res = await request(app).post('/api/auth/join').send({ code: 'ABC123' });
    expect(res.status).toBe(400);
  });

  test('returns 400 when code is missing', async () => {
    const res = await request(app).post('/api/auth/join').send({ name: 'Sarah' });
    expect(res.status).toBe(400);
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

    const res = await request(app)
      .post('/api/shopping')
      .set(AUTH)
      .send({ items: [{ item: 'eggs', category: 'groceries' }] });

    expect(res.status).toBe(201);
    expect(res.body.items[0].item).toBe('eggs');
  });

  test('accepts single-item shorthand', async () => {
    db.addShoppingItems.mockResolvedValue([{ id: 'i-1', item: 'butter' }]);
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
    // classify route loads notes + calendar events with .catch() — the automock
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

// ─── GET /api/calendar/sync-health ───────────────────────────────────────────

describe('GET /api/calendar/sync-health', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns empty list when all subs are healthy', async () => {
    db.getFailingSubscriptionsByHousehold.mockResolvedValue([]);
    const res = await request(app).get('/api/calendar/sync-health').set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.failing).toEqual([]);
  });

  test('returns failing subscription details for the UI banner', async () => {
    db.getFailingSubscriptionsByHousehold.mockResolvedValue([{
      id: 'sub-1',
      display_name: 'Work',
      last_synced_at: '2026-04-12T20:52:55.688Z',
      last_attempted_at: '2026-04-16T16:00:00.000Z',
      last_sync_error: 'Unauthorized',
      consecutive_failures: 47,
      sync_enabled: false,
      provider: 'apple',
      account: 'grant12321@aol.com',
    }]);
    const res = await request(app).get('/api/calendar/sync-health').set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.failing).toHaveLength(1);
    expect(res.body.failing[0]).toMatchObject({
      provider: 'apple',
      display_name: 'Work',
      sync_enabled: false,
    });
  });
});

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

  test('non-admin gets 403', async () => {
    const memberToken = signToken({ userId: 'u-2', householdId: 'hh-1', name: 'Jake', role: 'member' });
    const res = await request(app).patch('/api/settings/settings')
      .set({ Authorization: `Bearer ${memberToken}` })
      .send({ name: 'New Name' });
    expect(res.status).toBe(403);
  });

  test('returns 400 when no valid fields provided', async () => {
    const res = await request(app).patch('/api/settings/settings').set(AUTH).send({});
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

  test('non-admin gets 403', async () => {
    const memberToken = signToken({ userId: 'u-2', householdId: 'hh-1', name: 'Jake', role: 'member' });
    const res = await request(app).delete('/api/household/members/u-1')
      .set({ Authorization: `Bearer ${memberToken}` });
    expect(res.status).toBe(403);
  });

  test('admin cannot remove themselves', async () => {
    const res = await request(app).delete('/api/household/members/u-1').set(AUTH);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('cannot remove yourself');
  });

  test('returns 404 for member not in household', async () => {
    db.getHouseholdMembers.mockResolvedValue(MEMBERS);
    const res = await request(app).delete('/api/household/members/u-999').set(AUTH);
    expect(res.status).toBe(404);
  });
});

// ─── POST /api/auth/register ──────────────────────────────────────────────

describe('POST /api/auth/register', () => {
  const bcrypt = require('bcrypt');

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

  test('redirects to login with verified=true for valid token', async () => {
    db.getEmailVerificationToken.mockResolvedValue({ id: 'evt-1', user_id: 'u-1' });
    db.markEmailVerificationTokenUsed.mockResolvedValue();
    db.updateUser.mockResolvedValue();

    const res = await request(app).get('/api/auth/verify-email?token=valid-token');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('verified=true');
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
      // For non-.single() queries, the chain is awaited directly — make it
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

  test('returns 401 when the password is wrong', async () => {
    db.getUserById.mockResolvedValue({ ...USER, password_hash: '$2b$12$stored' });
    bcrypt.compare.mockResolvedValueOnce(false);

    const res = await request(app).delete('/api/auth/account').set(AUTH).send({ password: 'nope' });
    expect(res.status).toBe(401);
    expect(db.deleteUserAdmin).not.toHaveBeenCalled();
    expect(db.deleteHouseholdCascade).not.toHaveBeenCalled();
  });

  test('returns 403 for platform admins (they can\'t self-delete)', async () => {
    db.getUserById.mockResolvedValue({ ...USER, password_hash: '$2b$12$x', is_platform_admin: true });

    const res = await request(app).delete('/api/auth/account').set(AUTH).send({ password: 'pw' });
    expect(res.status).toBe(403);
    expect(db.deleteUserAdmin).not.toHaveBeenCalled();
  });

  test('deletes the whole household when the user is the sole member', async () => {
    db.getUserById.mockResolvedValue({ ...USER, password_hash: '$2b$12$x' });
    db.getHouseholdMembers.mockResolvedValue([USER]); // just them
    db.deleteHouseholdCascade.mockResolvedValue();

    const res = await request(app).delete('/api/auth/account').set(AUTH).send({ password: 'pw' });
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('household_deleted');
    expect(db.deleteHouseholdCascade).toHaveBeenCalledWith(HOUSEHOLD.id);
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

    const res = await request(app).delete('/api/auth/account').set(AUTH).send({ password: 'pw' });
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

    const res = await request(app).delete('/api/auth/account').set(AUTH).send({ password: 'pw' });
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

    const res = await request(app).delete('/api/auth/account').set(AUTH).send({ password: 'pw' });
    expect(res.status).toBe(200);
    expect(db.updateUser).not.toHaveBeenCalled();
    expect(db.deleteUserAdmin).toHaveBeenCalledWith(USER.id);
  });

  test('returns 401 without a bearer token', async () => {
    const res = await request(app).delete('/api/auth/account').send({ password: 'pw' });
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

  test('non-admin gets 403', async () => {
    const memberToken = signToken({ userId: 'u-2', householdId: 'hh-1', name: 'Jake', role: 'member' });
    const res = await request(app).post('/api/household/invite')
      .set({ Authorization: `Bearer ${memberToken}` })
      .send({ email: 'someone@test.com' });

    expect(res.status).toBe(403);
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

  test('non-admin gets 403', async () => {
    const memberToken = signToken({ userId: 'u-2', householdId: 'hh-1', name: 'Jake', role: 'member' });
    const res = await request(app).get('/api/household/invites')
      .set({ Authorization: `Bearer ${memberToken}` });

    expect(res.status).toBe(403);
  });
});
