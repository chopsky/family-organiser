/**
 * PATCH /api/household/profile permission matrix (2026-07-20):
 * personal profiles are private - self-edit for everyone, dependents
 * editable by any adult, other ACCOUNT profiles only by the household
 * admin. The API previously allowed any member to edit any member (looser
 * than the Family-page UI); teen accounts made that untenable.
 */
let mockUser;

jest.mock('../db/queries');
jest.mock('../db/client', () => ({ supabaseAdmin: {} }));
jest.mock('../middleware/auth', () => ({
  requireAuth: (req, _res, next) => { req.user = mockUser; next(); },
  requireHousehold: (req, _res, next) => { req.householdId = 'h1'; next(); },
  requireAdmin: (_req, _res, next) => next(),
}));
jest.mock('../services/email', () => ({}));
jest.mock('../services/cache', () => ({ invalidate: jest.fn() }));

const express = require('express');
const request = require('supertest');
const db = require('../db/queries');
const router = require('./household');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/household', router);
  return app;
}

const MEMBERS = [
  { id: 'admin1', name: 'Grant', member_type: 'account', role: 'admin' },
  { id: 'adult1', name: 'Lynn', member_type: 'account', role: 'member' },
  { id: 'teen1', name: 'Ella', member_type: 'account', role: 'member' },
  { id: 'kid1', name: 'Sofia', member_type: 'dependent', dependent_kind: 'child' },
];

beforeEach(() => {
  jest.clearAllMocks();
  db.getHouseholdMembers.mockResolvedValue(MEMBERS);
  db.updateUser.mockImplementation((id, updates) => Promise.resolve({ id, ...updates }));
});

test('a non-admin member cannot edit another account-holder\'s profile', async () => {
  mockUser = { id: 'teen1', name: 'Ella', role: 'member' };
  const res = await request(makeApp())
    .patch('/api/household/profile')
    .send({ user_id: 'adult1', name: 'Hacked' });
  expect(res.status).toBe(403);
  expect(db.updateUser).not.toHaveBeenCalled();
});

test('any member can edit a dependent\'s profile (both parents manage the kids)', async () => {
  mockUser = { id: 'adult1', name: 'Lynn', role: 'member' };
  const res = await request(makeApp())
    .patch('/api/household/profile')
    .send({ user_id: 'kid1', name: 'Sofia Rose' });
  expect(res.status).toBe(200);
  expect(db.updateUser).toHaveBeenCalledWith('kid1', expect.objectContaining({ name: 'Sofia Rose' }));
});

test('the household admin can edit another account-holder\'s profile', async () => {
  mockUser = { id: 'admin1', name: 'Grant', role: 'admin' };
  const res = await request(makeApp())
    .patch('/api/household/profile')
    .send({ user_id: 'adult1', family_role: 'Mother' });
  expect(res.status).toBe(200);
  expect(db.updateUser).toHaveBeenCalledWith('adult1', expect.objectContaining({ family_role: 'Mother' }));
});

test('everyone can still edit their own profile', async () => {
  mockUser = { id: 'teen1', name: 'Ella', role: 'member' };
  const res = await request(makeApp())
    .patch('/api/household/profile')
    .send({ name: 'Ella S' });
  expect(res.status).toBe(200);
  expect(db.updateUser).toHaveBeenCalledWith('teen1', expect.objectContaining({ name: 'Ella S' }));
});

// ─── Parental controls + destructive membership changes (Nori-parity) ───────
describe('admin-only protections', () => {
  test('a non-admin member cannot change the Child Mode PIN', async () => {
    mockUser = { id: 'teen1', name: 'Ella', role: 'member' };
    const res = await request(makeApp())
      .post('/api/household/child-mode/pin')
      .send({ pin: '1234' });
    expect(res.status).toBe(403);
  });

  test('a non-admin member cannot remove the Child Mode PIN', async () => {
    mockUser = { id: 'teen1', name: 'Ella', role: 'member' };
    const res = await request(makeApp()).delete('/api/household/child-mode/pin');
    expect(res.status).toBe(403);
  });

  test('the admin can set the Child Mode PIN', async () => {
    mockUser = { id: 'admin1', name: 'Grant', role: 'admin' };
    db.setChildModePinHash.mockResolvedValue();
    const res = await request(makeApp())
      .post('/api/household/child-mode/pin')
      .send({ pin: '1234' });
    expect(res.status).toBe(200);
  });

  test('a non-admin member cannot remove another member', async () => {
    mockUser = { id: 'teen1', name: 'Ella', role: 'member' };
    const res = await request(makeApp()).delete('/api/household/members/adult1');
    expect(res.status).toBe(403);
    expect(db.deleteUser).not.toHaveBeenCalled();
  });
});
