jest.mock('../db/queries', () => ({ recordAdminAction: jest.fn().mockResolvedValue() }));

const EventEmitter = require('events');
const db = require('../db/queries');
const { adminAudit, redact } = require('./adminAudit');

function fakeReqRes(overrides = {}) {
  const req = {
    method: 'POST',
    params: {},
    body: {},
    user: { id: 'u-1', name: 'Sarah' },
    ip: '1.2.3.4',
    baseUrl: '/api/admin',
    route: { path: '/users/:id' },
    path: '/users/x',
    ...overrides,
  };
  const res = new EventEmitter();
  res.statusCode = overrides.statusCode || 200;
  return { req, res };
}

describe('redact', () => {
  test('redacts secret-ish keys but keeps auditable ones like code', () => {
    const out = redact({ password: 'p', token: 't', api_key: 'k', authorization: 'a', code: 'WELCOME10', active: true });
    expect(out.password).toBe('[redacted]');
    expect(out.token).toBe('[redacted]');
    expect(out.api_key).toBe('[redacted]');
    expect(out.authorization).toBe('[redacted]');
    expect(out.code).toBe('WELCOME10'); // promo/redeem codes ARE auditable
    expect(out.active).toBe(true);
  });

  test('truncates over-long strings', () => {
    const out = redact({ msg: 'a'.repeat(600) });
    expect(out.msg.length).toBeLessThanOrEqual(501);
    expect(out.msg.endsWith('…')).toBe(true);
  });

  test('bounds recursion on deeply nested payloads', () => {
    let deep = { v: 1 };
    for (let i = 0; i < 12; i++) deep = { nested: deep };
    expect(() => redact(deep)).not.toThrow();
  });
});

describe('adminAudit middleware', () => {
  beforeEach(() => jest.clearAllMocks());

  test('records a successful mutation after the response finishes, with redacted body', async () => {
    const { req, res } = fakeReqRes({ params: { id: 'tgt-1' }, body: { active: true, password: 'secret' } });
    const next = jest.fn();
    adminAudit(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(db.recordAdminAction).not.toHaveBeenCalled(); // not yet - waits for finish

    res.emit('finish');
    await Promise.resolve();

    expect(db.recordAdminAction).toHaveBeenCalledTimes(1);
    const arg = db.recordAdminAction.mock.calls[0][0];
    expect(arg).toMatchObject({
      actor_user_id: 'u-1', actor_name: 'Sarah', method: 'POST',
      path: '/api/admin/users/:id', status_code: 200, target_id: 'tgt-1', ip: '1.2.3.4',
    });
    expect(arg.body.password).toBe('[redacted]');
    expect(arg.body.active).toBe(true);
  });

  test('skips GET requests entirely', () => {
    const { req, res } = fakeReqRes({ method: 'GET' });
    adminAudit(req, res, jest.fn());
    res.emit('finish');
    expect(db.recordAdminAction).not.toHaveBeenCalled();
  });

  test('does not record non-2xx responses', async () => {
    const { req, res } = fakeReqRes({ statusCode: 400 });
    adminAudit(req, res, jest.fn());
    res.emit('finish');
    await Promise.resolve();
    expect(db.recordAdminAction).not.toHaveBeenCalled();
  });

  test('a DB failure while recording never throws into the request', async () => {
    db.recordAdminAction.mockRejectedValueOnce(new Error('table missing'));
    const { req, res } = fakeReqRes();
    expect(() => { adminAudit(req, res, jest.fn()); res.emit('finish'); }).not.toThrow();
    await Promise.resolve();
  });
});
