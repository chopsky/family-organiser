/**
 * POST/PATCH /api/chores — a one-off must always be stored with a date.
 *
 * Reported by a user on 2026-07-27: tasks he added showed in the week view but
 * never on the daily page. The create form has "One-time" but no date field and
 * never sent `due_date`, so definitions were stored with `due_date: null`;
 * appliesOn compares `due_date === dateStr`, which is false for every date, so
 * they were invisible forever. 11 of 11 one-offs across every household were
 * affected — the option had never worked for anyone.
 *
 * The form now sends a date, but the shipped iOS/Android bundles are a frozen
 * dist and cannot, so the SERVER default is what actually rescues those users.
 * That is what these tests pin.
 */
jest.mock('../db/queries', () => ({
  getHouseholdMembers: jest.fn(async () => [{ id: 'm1' }, { id: 'm2' }]),
  getHouseholdById: jest.fn(async () => ({ timezone: 'Europe/London' })),
  addChoreDefinition: jest.fn(async (_hh, def) => ({ id: 'new', ...def })),
  updateChoreDefinition: jest.fn(async (_id, _hh, def) => ({ id: 'x', ...def })),
}));
jest.mock('../middleware/auth', () => ({
  requireAuth: (req, res, next) => { req.user = { id: 'u1' }; next(); },
  requireHousehold: (req, res, next) => { req.householdId = 'h1'; next(); },
}));
jest.mock('../services/cache', () => ({ invalidate: jest.fn(), invalidatePattern: jest.fn() }));

const express = require('express');
const request = require('supertest');
const db = require('../db/queries');
const router = require('./chores');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/chores', router);
  return a;
}

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });

beforeEach(() => jest.clearAllMocks());

describe('one-off chores always get a date', () => {
  it('defaults due_date to the household today when the client sends none', async () => {
    // Exactly what the shipped mobile bundle posts: no due_date key at all.
    const res = await request(app())
      .post('/api/chores')
      .send({ title: 'Check credit cards', repeat: 'once', assignee_ids: ['m1'] });

    expect(res.status).toBe(201);
    expect(db.addChoreDefinition).toHaveBeenCalled();
    expect(db.addChoreDefinition.mock.calls[0][1].due_date).toBe(today());
    // Never null — a null here is the bug, and it fails silently at read time.
    expect(res.body.task.due_date).not.toBeNull();
  });

  it('honours an explicit date rather than overwriting it with today', async () => {
    await request(app())
      .post('/api/chores')
      .send({ title: 'Book MOT', repeat: 'once', due_date: '2026-08-14', assignee_ids: ['m1'] });

    expect(db.addChoreDefinition.mock.calls[0][1].due_date).toBe('2026-08-14');
  });

  it('keeps the date on edit, so round-tripping a task does not move it', async () => {
    await request(app())
      .patch('/api/chores/x')
      .send({ title: 'Book MOT', repeat: 'once', due_date: '2026-08-14', assignee_ids: ['m1'] });

    expect(db.updateChoreDefinition.mock.calls[0][2].due_date).toBe('2026-08-14');
  });

  it('still clears due_date for repeating tasks', async () => {
    await request(app())
      .post('/api/chores')
      .send({ title: 'Dishwasher', repeat: 'daily', due_date: '2026-08-14', assignee_ids: ['m1'] });

    expect(db.addChoreDefinition.mock.calls[0][1].due_date).toBeNull();
  });

  it('rejects a malformed date instead of quietly falling back to today', async () => {
    const res = await request(app())
      .post('/api/chores')
      .send({ title: 'Nope', repeat: 'once', due_date: '14/08/2026' });

    expect(res.status).toBe(400);
    expect(db.addChoreDefinition).not.toHaveBeenCalled();
  });
});
