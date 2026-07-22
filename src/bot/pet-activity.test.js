/**
 * Pets aren't children: the WhatsApp school_activity handler must not create an
 * extracurricular for a pet, matching the app's rule. "Add swimming for <pet>"
 * → "no child called <pet>", and addChildActivity is never called.
 */
jest.mock('../db/queries', () => ({
  getCalendarEvents: jest.fn(() => Promise.resolve([])),
  getHouseholdActivities: jest.fn(() => Promise.resolve([])),
  getHouseholdMembers: jest.fn(() => Promise.resolve([])),
  getHouseholdSchools: jest.fn(() => Promise.resolve([])),
  getHouseholdPreferences: jest.fn(() => Promise.resolve([])),
  getHouseholdAllergies: jest.fn(() => Promise.resolve([])),
  getRecentWhatsAppTurns: jest.fn(() => Promise.resolve([])),
  getHouseholdNotes: jest.fn(() => Promise.resolve([])),
  getAllIncompleteTasks: jest.fn(() => Promise.resolve([])),
  getTermDatesBySchoolIds: jest.fn(() => Promise.resolve([])),
  claimPinNudge: jest.fn(() => Promise.resolve(false)),
  // Activity surface
  addChildActivity: jest.fn(() => Promise.resolve({ id: 'a-1' })),
  getChildActivities: jest.fn(() => Promise.resolve([])),
  getUpcomingInviteEvents: jest.fn(() => Promise.resolve([])),
  getEventRsvps: jest.fn(() => Promise.resolve({ hasLink: false, going: 0, declined: 0, kids: 0, adults: 0, dietary: [], rsvps: [] })),
}));
jest.mock('../services/ai', () => ({
  classify: jest.fn(), scanReceipt: jest.fn(), matchReceiptToList: jest.fn(),
  scanImage: jest.fn(), runWebSearch: jest.fn(),
}));
jest.mock('../services/transcribe', () => ({ transcribeVoice: jest.fn() }));
jest.mock('../services/weather', () => ({
  getWeatherReport: jest.fn(), extractLocationFromMessage: jest.fn(), geocodeLocation: jest.fn(),
  composeWeatherAnswer: jest.fn(() => Promise.resolve(null)),
}));
jest.mock('../services/ai-client', () => ({ callWithFailover: jest.fn(), REASONING_TIMEOUT_MS: 90000 }));
jest.mock('../services/push', () => ({ sendToHousehold: jest.fn(() => Promise.resolve()) }));
jest.mock('../services/broadcast', () => ({ toHousehold: jest.fn() }));
jest.mock('./calendar-url', () => ({ detectCalendarFeedUrl: jest.fn(() => null), subscribeCalendarFeed: jest.fn() }));
jest.mock('./bulk-extract', () => ({ looksLikeBulkPaste: jest.fn(() => false), looksLikeSchoolTermDates: jest.fn(() => false), extractAndApply: jest.fn() }));
jest.mock('../services/document-extract', () => ({ extractTextFromDocument: jest.fn() }));
jest.mock('../services/term-date-extract', () => ({
  extractTermDatesPreview: jest.fn(),
  academicYearsForCountry: jest.fn(() => ({ currentAY: '2025-2026', nextAY: '2026-2027' })),
}));
jest.mock('../services/cache', () => ({ invalidate: jest.fn(), get: jest.fn(), set: jest.fn() }));
jest.mock('../services/agent-loop', () => ({ agentEnabled: jest.fn(() => false), agentCalendarAnswer: jest.fn() }));
jest.mock('../services/school-add', () => ({
  searchGiasCandidates: jest.fn(), addConfirmedSchool: jest.fn(), importTermDatesFromUrl: jest.fn(),
  candidateLabel: (c) => c.name,
}));

const handlers = require('./handlers');
const db = require('../db/queries');
const { classify } = require('../services/ai');

const household = {
  id: 'h1',
  timezone: 'Europe/London',
  members: [
    { id: 'k1', name: 'Mia', member_type: 'dependent', dependent_kind: 'child' },
    { id: 'p1', name: 'Luna', member_type: 'dependent', dependent_kind: 'pet' },
  ],
};
const user = { id: 'u1', name: 'Grant' };

beforeEach(() => jest.clearAllMocks());

test('adding an activity for a PET is rejected (no child called Luna)', async () => {
  classify.mockResolvedValue({
    intent: 'school_activity',
    school_activity: { action: 'add', child_name: 'Luna', activity: 'Swimming', day_of_week: 1, time_start: '16:00' },
    response_message: 'Added swimming for Luna.',
  });
  const res = await handlers.handleTextMessage('add swimming for Luna on Mondays at 4pm', user, household);
  expect(db.addChildActivity).not.toHaveBeenCalled();
  expect(res.response).toMatch(/couldn't find a child called "Luna"/i);
});

test('adding an activity for a CHILD still works', async () => {
  classify.mockResolvedValue({
    intent: 'school_activity',
    school_activity: { action: 'add', child_name: 'Mia', activity: 'Swimming', day_of_week: 1, time_start: '16:00' },
    response_message: '🏫 Added swimming to Mia\'s week.',
  });
  const res = await handlers.handleTextMessage('add swimming for Mia on Mondays at 4pm', user, household);
  expect(db.addChildActivity).toHaveBeenCalledWith(expect.objectContaining({ child_id: 'k1', activity: 'Swimming' }));
  expect(res.response).toContain('Mia');
});
