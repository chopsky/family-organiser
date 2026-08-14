/**
 * Router-misroute safety net (2026-08-14, "Dean in London from 1 to 6
 * Sept"): when the READ fast-path hands handleCalendarQuery a topic that
 * matches NOTHING and the original message wasn't phrased as a question,
 * the handler must return null (fall through to the full classify
 * pipeline) instead of answering with a no-match listing. Only the
 * router call site sets the flag - the full pipeline's own calendar
 * queries keep the honest no-match answer.
 */
jest.mock('../db/queries');
jest.mock('../db/client', () => ({ supabase: {}, supabaseAdmin: {} }));
jest.mock('../services/ai', () => ({}));
jest.mock('../services/broadcast', () => ({ toHousehold: jest.fn() }));
jest.mock('../services/reply-voice', () => ({ composeVoicedReply: jest.fn().mockResolvedValue(null) }));
jest.mock('../services/agent-loop', () => ({ agentEnabled: () => false, agentCalendarAnswer: jest.fn() }));

const db = require('../db/queries');
const { handleCalendarQuery, isQuestionForm } = require('./handlers');

const household = { id: 'h1', timezone: 'Europe/London', members: [{ id: 'u1', name: 'Grant' }] };
const user = { id: 'u1', name: 'Grant' };
const actions = { shoppingAdded: [], shoppingCompleted: [], tasksAdded: [], tasksCompleted: [] };
const FLAG = { fallthroughOnTopicMiss: true };

beforeEach(() => {
  jest.clearAllMocks();
  db.getCalendarEvents.mockResolvedValue([]);
  db.getHouseholdActivities.mockResolvedValue([]);
  db.getHouseholdMembers.mockResolvedValue([{ id: 'u1', name: 'Grant' }]);
});

describe('isQuestionForm', () => {
  test.each([
    'when is Dean in London?',
    'What time is masons tennis today',
    'do I have anything tomorrow',
    'anything on for Dean next week',
    'tell me whats on this week',
  ])('question: %s', (t) => expect(isQuestionForm(t)).toBe(true));

  test.each([
    'Dean in London from 1 to 6 Sept',
    'dentist Tuesday 3pm',
    'Logan swimming Friday',
    '',
  ])('statement: %s', (t) => expect(isQuestionForm(t)).toBe(false));
});

describe('handleCalendarQuery fall-through', () => {
  const routed = { query_topic: 'Dean', query_start: '2026-09-01', query_end: '2026-09-06' };

  test('topic miss + statement + flag → null (reroute)', async () => {
    const res = await handleCalendarQuery(routed, household, user, 'Europe/London', actions,
      'Dean in London from 1 to 6 Sept', FLAG);
    expect(res).toBeNull();
  });

  test('topic miss + question + flag → honest no-match answer', async () => {
    const res = await handleCalendarQuery(routed, household, user, 'Europe/London', actions,
      'when is Dean in London?', FLAG);
    expect(res.response).toContain("can't see anything matching");
  });

  test('topic miss + statement WITHOUT flag (full-pipeline path) → honest no-match answer', async () => {
    const res = await handleCalendarQuery(routed, household, user, 'Europe/London', actions,
      'Dean in London from 1 to 6 Sept');
    expect(res.response).toContain("can't see anything matching");
  });

  test('topic MATCH + statement + flag → answers normally', async () => {
    db.getCalendarEvents.mockResolvedValue([{
      id: 'e1', title: 'Dean in London', start_time: '2026-09-01T00:00:00', end_time: '2026-09-06T23:59:59', all_day: true,
    }]);
    const res = await handleCalendarQuery(routed, household, user, 'Europe/London', actions,
      'Dean in London from 1 to 6 Sept', FLAG);
    expect(res).not.toBeNull();
    expect(res.response).toContain('Dean in London');
  });
});
