/**
 * Conflict = the same person, double-booked. These tests pin the rule and
 * its deliberate exclusions: no all-day/holiday/birthday conflicts, no
 * unassigned "household-wide" conflicts, synced-copy twins deduped, and
 * identity resolved from all three assignee shapes.
 */
const {
  detectConflicts,
  conflictLineForEvent,
  briefConflictLines,
} = require('./conflicts');

jest.mock('../db/queries', () => ({
  getHouseholdMembers: jest.fn(),
  getHouseholdById: jest.fn(),
  getCalendarEvents: jest.fn(),
  getChildActivities: jest.fn(),
}));
const db = require('../db/queries');

const MEMBERS = [
  { id: 'm-sarah', name: 'Sarah', member_type: 'adult' },
  { id: 'm-leo', name: 'Leo', member_type: 'dependent' },
];

const ev = (over = {}) => ({
  id: over.id || Math.random().toString(36).slice(2),
  title: 'Event',
  start_time: '2026-09-02T15:00:00Z',
  end_time: '2026-09-02T16:00:00Z',
  all_day: false,
  ...over,
});

describe('detectConflicts', () => {
  test('same member, overlapping windows -> one pair with the shared name', () => {
    const pairs = detectConflicts([
      ev({ id: 'a', title: 'Dentist', assigned_to_names: ['Sarah'] }),
      ev({ id: 'b', title: 'School pickup', start_time: '2026-09-02T15:30:00Z', end_time: '2026-09-02T16:30:00Z', assigned_to_ids: ['m-sarah'] }),
    ], MEMBERS);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].memberNames).toEqual(['Sarah']);
  });

  test('different members overlapping is NOT a conflict', () => {
    const pairs = detectConflicts([
      ev({ id: 'a', assigned_to_names: ['Sarah'] }),
      ev({ id: 'b', assigned_to_names: ['Leo'] }),
    ], MEMBERS);
    expect(pairs).toHaveLength(0);
  });

  test('unassigned (household-wide) items never conflict', () => {
    const pairs = detectConflicts([
      ev({ id: 'a' }),
      ev({ id: 'b', assigned_to_names: ['Sarah'] }),
    ], MEMBERS);
    expect(pairs).toHaveLength(0);
  });

  test('all-day, holidays and birthdays are excluded', () => {
    const pairs = detectConflicts([
      ev({ id: 'a', all_day: true, assigned_to_names: ['Sarah'] }),
      ev({ id: 'b', category: 'public_holiday', assigned_to_names: ['Sarah'] }),
      ev({ id: 'c', category: 'birthday', assigned_to_names: ['Sarah'] }),
      ev({ id: 'd', assigned_to_names: ['Sarah'] }),
    ], MEMBERS);
    expect(pairs).toHaveLength(0);
  });

  test('back-to-back is not an overlap; missing end assumes 60 minutes', () => {
    expect(detectConflicts([
      ev({ id: 'a', assigned_to_names: ['Sarah'] }),
      ev({ id: 'b', start_time: '2026-09-02T16:00:00Z', end_time: '2026-09-02T17:00:00Z', assigned_to_names: ['Sarah'] }),
    ], MEMBERS)).toHaveLength(0);
    expect(detectConflicts([
      ev({ id: 'a', end_time: null, assigned_to_names: ['Sarah'] }),
      ev({ id: 'b', start_time: '2026-09-02T15:30:00Z', end_time: '2026-09-02T17:00:00Z', assigned_to_names: ['Sarah'] }),
    ], MEMBERS)).toHaveLength(1);
  });

  test('a native row and its synced twin (same title+start) do not self-conflict', () => {
    const pairs = detectConflicts([
      ev({ id: 'native', title: 'Work meeting', assigned_to_names: ['Sarah'] }),
      ev({ id: 'synced', title: 'Work meeting', external_feed_id: 'feed1', assigned_to_ids: ['m-sarah'] }),
    ], MEMBERS);
    expect(pairs).toHaveLength(0);
  });

  test('assignees[] join-row shape resolves identity too', () => {
    const pairs = detectConflicts([
      ev({ id: 'a', assignees: [{ member_id: 'm-leo', member_name: 'Leo' }] }),
      ev({ id: 'b', title: 'Party', start_time: '2026-09-02T15:30:00Z', end_time: '2026-09-02T17:00:00Z', assigned_to_names: ['Leo'] }),
    ], MEMBERS);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].memberNames).toEqual(['Leo']);
  });
});

describe('conflictLineForEvent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.getHouseholdMembers.mockResolvedValue(MEMBERS);
    db.getHouseholdById.mockResolvedValue({ id: 'h1', timezone: 'Europe/London' });
    db.getChildActivities.mockResolvedValue([]);
  });

  test('names the other event with its time range', async () => {
    const mine = ev({ id: 'new', title: 'Dentist', assigned_to_names: ['Leo'] });
    db.getCalendarEvents.mockResolvedValue([
      mine,
      ev({ id: 'other', title: 'Football', start_time: '2026-09-02T15:30:00Z', end_time: '2026-09-02T16:30:00Z', assigned_to_names: ['Leo'] }),
    ]);
    const line = await conflictLineForEvent('h1', mine);
    expect(line).toContain('Football');
    expect(line).toContain('Leo is');
    expect(line).toMatch(/⚠️/);
  });

  test('null when clear, all-day, or the probe fails', async () => {
    db.getCalendarEvents.mockResolvedValue([ev({ id: 'new', assigned_to_names: ['Leo'] })]);
    expect(await conflictLineForEvent('h1', ev({ id: 'new', assigned_to_names: ['Leo'] }))).toBeNull();
    expect(await conflictLineForEvent('h1', ev({ all_day: true }))).toBeNull();
    db.getCalendarEvents.mockRejectedValue(new Error('db down'));
    expect(await conflictLineForEvent('h1', ev({ id: 'x', assigned_to_names: ['Leo'] }))).toBeNull();
  });
});

describe('briefConflictLines', () => {
  test('caps at two lines plus a +N tail', () => {
    const mk = (i) => ({
      a: { title: `A${i}` }, b: { title: `B${i}` },
      memberNames: ['Sarah'], overlapStartMs: Date.UTC(2026, 8, 2, 14 + i),
    });
    const lines = briefConflictLines([mk(0), mk(1), mk(2), mk(3)], 'Europe/London');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('Sarah double-booked');
    expect(lines[2]).toBe('⚠️ +2 more clashes today');
    expect(briefConflictLines([], 'Europe/London')).toEqual([]);
  });
});
