/**
 * The assistant meter: 10 flat AI uses/month (every request counts one),
 * the chain exception, tz-anchored month reset, fail-open on every DB
 * wobble. Bursts were tried and removed - flat counting explains itself.
 */
jest.mock('../db/client', () => ({ supabase: {}, supabaseAdmin: {} }));

const meter = require('./assistant-meter');

const LAPSED = { id: 'h1', subscription_status: 'expired', timezone: 'Europe/London' };

function fakeDb(rows, { insertError = null, selectError = null } = {}) {
  const inserts = [];
  const db = {
    inserts,
    from: () => ({
      select: () => ({
        eq: () => ({
          gte: () => ({
            order: () => ({
              limit: () => Promise.resolve(selectError ? { data: null, error: selectError } : { data: rows, error: null }),
            }),
          }),
        }),
      }),
      insert: (row) => { inserts.push(row); return Promise.resolve({ error: insertError }); },
    }),
  };
  return db;
}

beforeEach(() => { process.env.FREE_APP_MODE = '1'; });
afterEach(() => { delete process.env.FREE_APP_MODE; });

describe('who is metered', () => {
  test('only lapsed households, only while the flag is on', () => {
    expect(meter.isMeteredHousehold(LAPSED)).toBe(true);
    expect(meter.isMeteredHousehold({ ...LAPSED, subscription_status: 'cancelled' })).toBe(true);
    expect(meter.isMeteredHousehold({ ...LAPSED, subscription_status: 'trialing' })).toBe(false);
    expect(meter.isMeteredHousehold({ ...LAPSED, subscription_status: 'active' })).toBe(false);
    expect(meter.isMeteredHousehold({ ...LAPSED, is_internal: true })).toBe(false);
    expect(meter.isMeteredHousehold({ ...LAPSED, complimentary_until: '2099-01-01T00:00:00Z' })).toBe(false);
    delete process.env.FREE_APP_MODE;
    expect(meter.isMeteredHousehold(LAPSED)).toBe(false);
  });
});

describe('month anchor is the household timezone, not UTC', () => {
  test('London (BST): the month starts an hour before UTC midnight', () => {
    const now = new Date('2026-08-26T12:00:00Z');
    expect(meter.monthStartUtc('Europe/London', now).toISOString()).toBe('2026-07-31T23:00:00.000Z');
  });
  test('New York: the month starts four hours after UTC midnight', () => {
    const now = new Date('2026-08-26T12:00:00Z');
    expect(meter.monthStartUtc('America/New_York', now).toISOString()).toBe('2026-08-01T04:00:00.000Z');
  });
  test('reset label names the 1st of next month', () => {
    expect(meter.resetDateLabel('Europe/London', new Date('2026-08-26T12:00:00Z'))).toBe('1 September');
  });
});

describe('uses', () => {
  const now = new Date('2026-08-26T12:00:00Z');

  test('every request charges one use - even seconds after the last', async () => {
    const db = fakeDb([{ started_at: '2026-08-26T11:59:30Z' }]); // 30s ago
    const r = await meter.chargeUse(LAPSED, { now, db });
    expect(r.charged).toBe(true);
    expect(r.used).toBe(2);
    expect(db.inserts).toHaveLength(1);
  });

  test('chain exception: answering the bot never charges', async () => {
    const db = fakeDb([{ started_at: '2026-08-26T11:00:00Z' }]);
    const r = await meter.chargeUse(LAPSED, { now, db, isChainReply: true });
    expect(r.charged).toBe(false);
    expect(db.inserts).toHaveLength(0);
  });

  test('unmetered households never charge', async () => {
    const db = fakeDb([]);
    const r = await meter.chargeUse({ ...LAPSED, subscription_status: 'trialing' }, { now, db });
    expect(r.charged).toBe(false);
    expect(db.inserts).toHaveLength(0);
  });

  test('exhaustion at 10', async () => {
    const ten = Array.from({ length: 10 }, (_, i) => ({ started_at: `2026-08-${10 + i}T09:00:00Z` }));
    const s = await meter.meterStatus(LAPSED, { now, db: fakeDb(ten) });
    expect(s.exhausted).toBe(true);
    const nine = ten.slice(1);
    const s2 = await meter.meterStatus(LAPSED, { now, db: fakeDb(nine) });
    expect(s2.exhausted).toBe(false);
  });
});

describe('fail-open doctrine', () => {
  const now = new Date('2026-08-26T12:00:00Z');
  test('a select error means unmetered for this turn, never a crash', async () => {
    const s = await meter.meterStatus(LAPSED, { now, db: fakeDb(null, { selectError: new Error('relation missing') }) });
    expect(s.metered).toBe(false);
    expect(s.failedOpen).toBe(true);
  });
  test('an insert error reports uncharged and moves on', async () => {
    const db = fakeDb([], { insertError: new Error('nope') });
    const r = await meter.chargeUse(LAPSED, { now, db });
    expect(r.charged).toBe(false);
  });
});

describe('copy', () => {
  test('counter line: full tank at 1, silent mid-tank, countdown 7-9, quiet at 10 (announcement handles it)', () => {
    expect(meter.counterLine(1, '1 September')).toMatch(/1 of 10.*reset on 1 September/);
    for (const n of [2, 4, 6]) expect(meter.counterLine(n, '1 September')).toBeNull();
    expect(meter.counterLine(7, '1 September')).toMatch(/7 of 10/);
    expect(meter.counterLine(9, '1 September')).toMatch(/9 of 10/);
    expect(meter.counterLine(10, '1 September')).toBeNull();
  });
  test('no em dashes anywhere in user-facing meter copy', () => {
    const all = [
      meter.counterLine(1, '1 September'), meter.counterLine(8, '1 September'),
      meter.limitAnnouncement('1 September'), meter.limitReplyFull('1 September'),
      meter.limitReplyShort('1 September'), meter.dealAnnouncement('1 September'),
      meter.quotaAnswer({ metered: true, used: 3, limit: 10, resetLabel: '1 September' }),
    ].join(' ');
    expect(all).not.toMatch(/[—–]/);
  });
  test('quota questions detected deterministically, answers are exact', () => {
    expect(meter.isQuotaQuestion('How many actions do I have left?')).toBe(true);
    expect(meter.isQuotaQuestion('how many free requests left this month')).toBe(true);
    expect(meter.isQuotaQuestion("what's my limit?")).toBe(true);
    expect(meter.isQuotaQuestion('add milk to the list')).toBe(false);
    expect(meter.quotaAnswer({ metered: true, used: 7, limit: 10, resetLabel: '1 September' }))
      .toMatch(/7 of your 10.*3 left.*1 September/);
    expect(meter.quotaAnswer({ metered: false })).toMatch(/No limits/);
  });
});
