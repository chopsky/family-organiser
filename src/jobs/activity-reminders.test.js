/**
 * Activity reminder sweep. Fixed instant: 2026-09-01T17:00Z = Tuesday
 * 18:00 in Europe/London (BST) - the fire minute for an 18:30 activity.
 * Contract: 30-min lead in household-local time, skips/overrides honoured,
 * pickup person targeted, term-windowed suppression only when school is
 * out, per-occurrence lock, 5-minute late window.
 */
jest.mock('../db/queries', () => ({
  getAllActivitiesWithChild: jest.fn(),
  getAllHouseholds: jest.fn(),
  getHouseholdMembers: jest.fn(),
  getHouseholdSchools: jest.fn(),
  acquireSchedulerLock: jest.fn(),
}));
jest.mock('../services/ping-router', () => ({ deliverPing: jest.fn() }));
jest.mock('../utils/school-terms', () => ({
  activityActiveOn: (a, ymd) => !(a.start_date && ymd < a.start_date) && !(a.end_date && ymd > a.end_date),
  resolveTermSchoolForChild: jest.fn(() => null),
  isSchoolInSession: jest.fn(async () => true),
}));

const db = require('../db/queries');
const { deliverPing } = require('../services/ping-router');
const schoolTerms = require('../utils/school-terms');
const { runActivityReminderCheck } = require('./activity-reminders');

const NOW = new Date('2026-09-01T17:00:00Z'); // Tue 18:00 Europe/London
const HH = { id: 'h1', timezone: 'Europe/London' };
const MEMBERS = [
  { id: 'mum', name: 'Sarah', member_type: 'adult' },
  { id: 'dad', name: 'Grant', member_type: 'adult' },
  { id: 'kid', name: 'Mason', member_type: 'dependent' },
];

const swim = (over = {}) => ({
  id: 'act1',
  activity: 'Swimming',
  child_id: 'kid',
  child: { id: 'kid', name: 'Mason', household_id: 'h1' },
  day_of_week: 1, // Tuesday (Mon=0)
  time_start: '18:30',
  reminder_text: 'bring goggles',
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  db.getAllHouseholds.mockResolvedValue([HH]);
  db.getHouseholdMembers.mockResolvedValue(MEMBERS);
  db.getHouseholdSchools.mockResolvedValue([]);
  db.acquireSchedulerLock.mockResolvedValue(true);
  schoolTerms.isSchoolInSession.mockResolvedValue(true);
  schoolTerms.resolveTermSchoolForChild.mockReturnValue(null);
});

test('fires 30 minutes before, to every adult, with time and kit note', async () => {
  db.getAllActivitiesWithChild.mockResolvedValue([swim()]);
  await runActivityReminderCheck(NOW);
  expect(deliverPing).toHaveBeenCalledTimes(2);
  const [, payload] = deliverPing.mock.calls[0];
  expect(payload.title).toBe('Reminder: Mason - Swimming');
  expect(payload.body).toBe('Starts in 30 minutes (18:30) - bring goggles');
  expect(payload.category).toBe('calendar_reminders');
});

test('pickup person set -> only they are pinged', async () => {
  db.getAllActivitiesWithChild.mockResolvedValue([swim({ pickup_member_id: 'dad' })]);
  await runActivityReminderCheck(NOW);
  expect(deliverPing).toHaveBeenCalledTimes(1);
  expect(deliverPing.mock.calls[0][0].id).toBe('dad');
});

test('wrong weekday, skipped date, or outside the fire window -> silent', async () => {
  db.getAllActivitiesWithChild.mockResolvedValue([
    swim({ id: 'a', day_of_week: 2 }),
    swim({ id: 'b', skips: ['2026-09-01'] }),
    swim({ id: 'c', time_start: '19:30' }), // fire minute 19:00, not now
    swim({ id: 'd', time_start: '18:20' }), // fired at 17:50, window closed
  ]);
  await runActivityReminderCheck(NOW);
  expect(deliverPing).not.toHaveBeenCalled();
});

test('a per-date override moves the fire time with it', async () => {
  db.getAllActivitiesWithChild.mockResolvedValue([
    swim({ overrides: { '2026-09-01': { time_start: '19:30' } } }),
  ]);
  await runActivityReminderCheck(NOW);
  expect(deliverPing).not.toHaveBeenCalled(); // fires at 19:00 now, not 18:00
  await runActivityReminderCheck(new Date('2026-09-01T18:00:00Z')); // 19:00 local
  expect(deliverPing).toHaveBeenCalledTimes(2);
});

test('late tick inside the 5-minute window still fires; lock stops replicas', async () => {
  db.getAllActivitiesWithChild.mockResolvedValue([swim()]);
  await runActivityReminderCheck(new Date('2026-09-01T17:03:00Z')); // 18:03 local
  expect(deliverPing).toHaveBeenCalledTimes(2);
  deliverPing.mockClear();
  db.acquireSchedulerLock.mockResolvedValue(false);
  await runActivityReminderCheck(NOW);
  expect(deliverPing).not.toHaveBeenCalled();
});

test('term-windowed activity is suppressed out of session; ongoing one still fires', async () => {
  schoolTerms.resolveTermSchoolForChild.mockReturnValue('school1');
  schoolTerms.isSchoolInSession.mockResolvedValue(false);
  db.getAllActivitiesWithChild.mockResolvedValue([
    swim({ id: 'termed', start_date: '2026-08-01', end_date: '2026-12-18' }),
    swim({ id: 'ongoing' }),
  ]);
  await runActivityReminderCheck(NOW);
  // Only the ongoing activity pings (2 adults); the termed one is out of session.
  expect(deliverPing).toHaveBeenCalledTimes(2);
  expect(deliverPing.mock.calls.every(([, p]) => p.data.activityId === 'ongoing')).toBe(true);
});
