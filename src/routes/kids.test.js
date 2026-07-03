/**
 * Route tests for the Kids mode big-days endpoint: the countdown list must
 * assemble school holidays (term dates), member birthdays and parent-pinned
 * events, sorted by date, future-only, with pinned events flagged big.
 */
jest.mock('../db/queries');
jest.mock('../db/client', () => ({ supabase: {}, supabaseAdmin: {} }));
jest.mock('../middleware/auth', () => ({
  requireAuth: (req, _res, next) => { req.user = { id: 'me' }; next(); },
  requireHousehold: (req, _res, next) => { req.householdId = 'h1'; next(); },
}));

const express = require('express');
const request = require('supertest');
const db = require('../db/queries');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/kids', require('./kids'));
  return a;
}

// Dates relative to "today" so the tests don't rot.
const iso = (daysAhead) => {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

beforeEach(() => {
  jest.clearAllMocks();
  db.getHouseholdById.mockResolvedValue({ id: 'h1', timezone: 'Europe/London' });
  db.getHouseholdMembers.mockResolvedValue([]);
  db.getHouseholdSchools.mockResolvedValue([]);
  db.getTermDatesBySchoolIds.mockResolvedValue([]);
  db.getKidsCountdownEvents.mockResolvedValue([]);
});

describe('GET /api/kids/big-days', () => {
  test('merges pinned events, school holidays and birthdays, sorted by date', async () => {
    db.getKidsCountdownEvents.mockResolvedValue([
      { id: 'e1', title: 'Summer holiday!', start_time: `${iso(40)}T00:00:00Z`, all_day: true, kids_emoji: '🏖️' },
    ]);
    db.getHouseholdSchools.mockResolvedValue([{ id: 's1' }]);
    db.getTermDatesBySchoolIds.mockResolvedValue([
      { event_type: 'half_term_start', date: iso(10), label: 'Half term' },
      { event_type: 'term_start', date: iso(12), label: 'Term starts' }, // back-to-school days count too
      { event_type: 'term_end', date: iso(60), label: null },
    ]);
    db.getHouseholdMembers.mockResolvedValue([
      { id: 'k1', name: 'Logan', birthday: `2018-${iso(20).slice(5)}` },
      { id: 'g1', name: 'Grant', birthday: null },
    ]);

    const res = await request(app()).get('/api/kids/big-days');
    expect(res.status).toBe(200);
    const days = res.body.bigDays;
    expect(days.map((d) => d.title)).toEqual(['Half term', 'Term starts', "Logan's birthday", 'Summer holiday!', 'School holidays!']);
    expect(days.map((d) => d.date)).toEqual([iso(10), iso(12), iso(20), iso(40), iso(60)]);
    // Only the parent-pinned event is a hero candidate.
    expect(days.filter((d) => d.big).map((d) => d.title)).toEqual(['Summer holiday!']);
    // The stored kids_emoji override rides along; term_end falls back to its label default.
    expect(days.find((d) => d.title === 'Summer holiday!').emoji).toBe('🏖️');
    expect(days.find((d) => d.title === "Logan's birthday").emoji).toBe('🎂');
  });

  test('past birthdays roll over to next year and stay inside the window', async () => {
    db.getHouseholdMembers.mockResolvedValue([
      { id: 'k1', name: 'Ella', birthday: `2019-${iso(-30).slice(5)}` }, // a month ago → ~11 months away → outside 180d
      { id: 'k2', name: 'Sam', birthday: `2020-${iso(5).slice(5)}` },
    ]);
    const res = await request(app()).get('/api/kids/big-days');
    expect(res.status).toBe(200);
    expect(res.body.bigDays.map((d) => d.title)).toEqual(["Sam's birthday"]);
  });

  test('degrades to an empty list when the sources fail', async () => {
    db.getHouseholdSchools.mockRejectedValue(new Error('db down'));
    db.getKidsCountdownEvents.mockRejectedValue(new Error('db down'));
    const res = await request(app()).get('/api/kids/big-days');
    expect(res.status).toBe(200);
    expect(res.body.bigDays).toEqual([]);
  });
});
