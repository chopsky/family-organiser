/**
 * API route integration tests.
 * DB and AI services are mocked — no real database or API calls.
 */

jest.mock('../db/queries');
jest.mock('../db/client', () => ({
  supabase: {
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
  },
}));
jest.mock('../services/ai');

const request = require('supertest');
const app = require('../app');
const db = require('../db/queries');
const { classify } = require('../services/ai');
const { signToken } = require('../middleware/auth');

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const HOUSEHOLD = { id: 'hh-1', name: 'The Smiths', join_code: 'ABC123', reminder_time: '08:00:00' };
const USER      = { id: 'u-1', name: 'Sarah', role: 'admin', household_id: 'hh-1', telegram_chat_id: null };
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

    const res = await request(app).post('/api/auth/join').send({ code: 'ABC123', name: 'Sarah' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.household.name).toBe('The Smiths');
    expect(res.body.user.name).toBe('Sarah');
  });

  test('creates a new user if name not in household', async () => {
    db.getHouseholdByCode.mockResolvedValue(HOUSEHOLD);
    db.getHouseholdMembers.mockResolvedValue([]);
    db.createUser.mockResolvedValue({ id: 'u-new', name: 'Grandma', role: 'admin', household_id: 'hh-1' });

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

  beforeEach(() => jest.clearAllMocks());

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
  beforeEach(() => jest.clearAllMocks());

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
  beforeEach(() => jest.clearAllMocks());

  test('classifies text, saves results, and returns response_message', async () => {
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

    expect(res.status).toBe(200);
    expect(res.body.result.response_message).toContain('milk');
    expect(res.body.saved.shopping).toHaveLength(1);
    expect(res.body.saved.tasks).toHaveLength(1);
  });

  test('returns 400 when text is missing', async () => {
    const res = await request(app).post('/api/classify').set(AUTH).send({});
    expect(res.status).toBe(400);
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
