/**
 * The PDF/image upload branches must return `actions` in the response.
 * The app only refreshes open pages (and renders EVENT ADDED cards) when
 * `actions` is non-empty - before this, a PDF upload created events the
 * calendar didn't show until a manual reload, which read as a failed
 * save (real 2026-08-14 incident: the assistant then "re-added" the
 * events, creating duplicates).
 */
jest.mock('../db/queries');
jest.mock('../db/client', () => ({ supabase: {}, supabaseAdmin: {} }));
jest.mock('../middleware/auth', () => ({
  requireAuth: (req, _res, next) => { req.user = { id: 'u1' }; next(); },
  requireHousehold: (req, _res, next) => { req.householdId = 'h1'; next(); },
}));
jest.mock('../services/ai', () => ({
  scanImage: jest.fn(), scanReceipt: jest.fn(), matchReceiptToList: jest.fn(), classify: jest.fn(),
}));
jest.mock('../services/ai-client', () => ({ callWithFailover: jest.fn() }));
jest.mock('../services/weather', () => ({
  getWeatherReport: jest.fn().mockResolvedValue(null),
  getCityFromTimezone: jest.fn().mockReturnValue(null),
  extractLocationFromMessage: jest.fn().mockReturnValue(null),
  geocodeLocation: jest.fn().mockResolvedValue(null),
  reverseGeocode: jest.fn().mockResolvedValue(null),
}));
jest.mock('../services/transcribe', () => ({ transcribeVoice: jest.fn() }));
jest.mock('../services/document-extract', () => ({
  extractTextFromDocument: jest.fn(),
  isSupportedDocument: jest.fn(),
  transcribeScannedDocument: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const db = require('../db/queries');
const { classify, scanImage } = require('../services/ai');
const { extractTextFromDocument } = require('../services/document-extract');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/chat', require('./chat'));
  return a;
}

beforeEach(() => {
  jest.clearAllMocks();
  db.getHouseholdMembers.mockResolvedValue([{ id: 'u1', name: 'Grant', color_theme: 'plum' }]);
  db.getHouseholdById.mockResolvedValue({ id: 'h1', name: 'Shapiro', timezone: 'Europe/London' });
  db.createConversation.mockResolvedValue({ id: 'c1' });
  db.saveChatMessage.mockResolvedValue({});
  db.touchConversation.mockResolvedValue({});
  db.saveEventAssignees.mockResolvedValue([]);
  db.addTasks.mockResolvedValue([]);
  db.resolveAssignees.mockImplementation((names, members) => {
    const hit = (members || []).filter((m) => (names || []).some((n) => n.toLowerCase() === m.name.toLowerCase()));
    return { ids: hit.map((m) => m.id), names: hit.map((m) => m.name) };
  });
  let n = 0;
  db.createCalendarEvent.mockImplementation(async () => ({ id: `ev${++n}` }));
});

const pdfBuffer = Buffer.from('%PDF-1.4 fake');

test('PDF upload returns event_created actions for every saved event', async () => {
  extractTextFromDocument.mockResolvedValue({ text: 'School letter text', kind: 'pdf' });
  classify.mockResolvedValue({
    calendar_events: [
      { title: 'Year 3 Autumn Concert', date: '2026-09-17', start_time: '16:30', end_time: '17:30' },
      { title: 'INSET Day - School Closed', date: '2026-09-25', all_day: true },
    ],
    tasks: [{ title: 'Return reply slip' }],
  });

  const res = await request(app())
    .post('/api/chat/image')
    .attach('image', pdfBuffer, { filename: 'letter.pdf', contentType: 'application/pdf' });

  expect(res.status).toBe(200);
  expect(res.body.message).toContain('Added event: Year 3 Autumn Concert');
  const actions = res.body.actions;
  expect(Array.isArray(actions)).toBe(true);
  expect(actions.filter((a) => a.type === 'event_created')).toHaveLength(2);
  expect(actions.find((a) => a.type === 'tasks_added')).toEqual({ type: 'tasks_added', count: 1 });
  const concert = actions.find((a) => a.event?.title === 'Year 3 Autumn Concert');
  // 16:30 BST wall clock -> 15:30 UTC, and the real row id comes back so
  // the card links to a saved event.
  expect(concert.event.start_time).toBe('2026-09-17T15:30:00Z');
  expect(concert.event.id).toBe('ev1');
});

test('PDF with nothing actionable returns no actions field', async () => {
  extractTextFromDocument.mockResolvedValue({ text: 'Just a newsletter', kind: 'pdf' });
  classify.mockResolvedValue({ response_message: 'Nothing to add.' });

  const res = await request(app())
    .post('/api/chat/image')
    .attach('image', pdfBuffer, { filename: 'letter.pdf', contentType: 'application/pdf' });

  expect(res.status).toBe(200);
  expect(res.body.actions).toBeUndefined();
});

test('image scan with events returns event_created actions', async () => {
  scanImage.mockResolvedValue({
    type: 'event',
    events: [{ title: 'Sports Day', date: '2026-09-20', start_time: '10:00', assigned_to_names: ['Grant'] }],
    summary: 'A sports day invite.',
  });

  const res = await request(app())
    .post('/api/chat/image')
    .attach('image', Buffer.from('fakejpg'), { filename: 'invite.jpg', contentType: 'image/jpeg' });

  expect(res.status).toBe(200);
  const actions = res.body.actions;
  expect(actions.filter((a) => a.type === 'event_created')).toHaveLength(1);
  expect(actions[0].event.title).toBe('Sports Day');
  expect(actions[0].event.assigned_to_names).toEqual(['Grant']);
});
