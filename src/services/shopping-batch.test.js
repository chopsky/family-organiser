/**
 * One summary per shop. Contract: N check-offs inside the quiet window
 * produce exactly ONE broadcast with the count, sample names and the
 * remaining figure; emptying the list flushes immediately; an un-check
 * retracts its item; nothing sends for an empty buffer.
 */
jest.useFakeTimers();

jest.mock('./broadcast', () => ({ toHousehold: jest.fn() }));
jest.mock('../db/queries', () => ({
  countOpenShoppingItems: jest.fn(),
  getHouseholdMembers: jest.fn(),
}));

const broadcast = require('./broadcast');
const db = require('../db/queries');
const batch = require('./shopping-batch');

const HH = 'h1';
const MEMBERS = [{ id: 'u1' }, { id: 'u2' }];

function tick(name, sender = { id: 'u1', name: 'Sarah' }) {
  batch.noteCheckOff({ householdId: HH, senderId: sender.id, senderName: sender.name, itemName: name, listId: 'l1' });
}

describe('shopping check-off batching', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    batch._reset();
    db.countOpenShoppingItems.mockResolvedValue(3);
    db.getHouseholdMembers.mockResolvedValue(MEMBERS);
  });

  test('twelve ticks -> one summary with count, samples and remaining', async () => {
    for (let i = 1; i <= 12; i++) tick(`item ${i}`);
    await Promise.resolve(); // let the empty-list probes settle (remaining=3)
    expect(broadcast.toHousehold).not.toHaveBeenCalled();

    jest.advanceTimersByTime(batch.QUIET_MS + 10);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

    expect(broadcast.toHousehold).toHaveBeenCalledTimes(1);
    const [sender, members, message] = broadcast.toHousehold.mock.calls[0];
    expect(sender).toBe('u1');
    expect(members).toBe(MEMBERS);
    expect(message).toContain('Sarah checked off 12 items');
    expect(message).toContain('item 1, item 2, item 3 +9 more');
    expect(message).toContain('3 left on the list');
  });

  test('emptying the list flushes immediately with the done flourish', async () => {
    db.countOpenShoppingItems.mockResolvedValue(0);
    tick('milk');
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(broadcast.toHousehold).toHaveBeenCalledTimes(1);
    expect(broadcast.toHousehold.mock.calls[0][2]).toContain('list done');
    // and the window timer must not double-send later
    jest.advanceTimersByTime(batch.QUIET_MS + 10);
    await Promise.resolve(); await Promise.resolve();
    expect(broadcast.toHousehold).toHaveBeenCalledTimes(1);
  });

  test('an un-check retracts; a fully retracted buffer sends nothing', async () => {
    tick('milk');
    await Promise.resolve();
    batch.retractCheckOff(HH, 'milk');
    jest.advanceTimersByTime(batch.QUIET_MS + 10);
    await Promise.resolve(); await Promise.resolve();
    expect(broadcast.toHousehold).not.toHaveBeenCalled();
  });

  test('two shoppers are both named', async () => {
    tick('milk', { id: 'u1', name: 'Sarah' });
    tick('eggs', { id: 'u2', name: 'James' });
    await Promise.resolve();
    jest.advanceTimersByTime(batch.QUIET_MS + 10);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(broadcast.toHousehold).toHaveBeenCalledTimes(1);
    expect(broadcast.toHousehold.mock.calls[0][2]).toContain('Sarah & James');
  });
});
