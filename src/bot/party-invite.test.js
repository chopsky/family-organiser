/**
 * Party-invite loop, bot side: the create-event offer for gathering-looking
 * titles, the deterministic "yes" → link mint, and the "who's coming?"
 * roster answer. Mirrors the handlers.test.js mock preamble (handlers.js
 * pulls the whole service chain in at import time).
 */
jest.mock('../db/queries', () => ({
  getCalendarEvents: jest.fn(() => Promise.resolve([])),
  getHouseholdActivities: jest.fn(() => Promise.resolve([])),
  getHouseholdMembers: jest.fn(() => Promise.resolve([])),
  getHouseholdSchools: jest.fn(() => Promise.resolve([])),
  getHouseholdPreferences: jest.fn(() => Promise.resolve([])),
  getHouseholdAllergies: jest.fn(() => Promise.resolve([])),
  resolveAssignees: jest.fn(() => ({ ids: [], names: [] })),
  findSimilarEvent: jest.fn(() => Promise.resolve(null)),
  createCalendarEvent: jest.fn((hid, data) => Promise.resolve({ id: 'e-99', ...data })),
  saveEventAssignees: jest.fn(() => Promise.resolve()),
  saveEventReminders: jest.fn(() => Promise.resolve()),
  getRecentWhatsAppTurns: jest.fn(() => Promise.resolve([])),
  getHouseholdNotes: jest.fn(() => Promise.resolve([])),
  getAllIncompleteTasks: jest.fn(() => Promise.resolve([])),
  getTermDatesBySchoolIds: jest.fn(() => Promise.resolve([])),
  claimPinNudge: jest.fn(() => Promise.resolve(false)),
  // Invite-loop surface
  createOrGetEventInviteLink: jest.fn(() => Promise.resolve({ token: 'tok-abc', expires_at: '2026-08-08T15:00:00Z' })),
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

const household = { id: 'h1', timezone: 'Europe/London', members: [] };
const user = { id: 'u1', name: 'Grant' };

beforeEach(() => {
  jest.clearAllMocks();
  db.createOrGetEventInviteLink.mockResolvedValue({ token: 'tok-abc', expires_at: '2026-08-08T15:00:00Z' });
  db.getUpcomingInviteEvents.mockResolvedValue([]);
  db.getEventRsvps.mockResolvedValue({ hasLink: false, going: 0, declined: 0, kids: 0, adults: 0, dietary: [], rsvps: [] });
});

describe('invite offer after a gathering-looking event', () => {
  // NOTE: real party messages classify as intent 'create_event', whose handler
  // branch returns EARLY (before the reconciliation tail). The offer therefore
  // has to be made in that branch too - these tests use 'create_event' to
  // exercise the actual production path (an earlier version only tested the
  // tail via intent 'calendar' and missed the live bug).
  test('creating a party event (create_event) appends the invite offer and arms the pending state', async () => {
    classify.mockResolvedValue({
      intent: 'create_event',
      calendar_event: { title: "Olivia's party", date: '2026-08-01', start_time: '13:00', end_time: '15:00' },
      response_message: 'Added the party to the calendar.',
    });
    const res = await handlers.handleTextMessage("Olivia's party Saturday 1-3pm", user, household);
    expect(res.response).toContain('invite guests');

    // The armed offer: "yes" on the next turn mints the link with NO AI call.
    classify.mockClear();
    const yes = await handlers.handleTextMessage('yes', user, household);
    expect(classify).not.toHaveBeenCalled();
    expect(db.createOrGetEventInviteLink).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'e-99', householdId: 'h1', createdBy: 'u1' }),
    );
    expect(yes.response).toContain('/p/tok-abc');
  });

  test('the invite offer survives a model-authored trailing question (create_event, the reported bug)', async () => {
    // The exact reported case: create_event intent, model signs off with its
    // OWN reminder question. The offer must still appear and replace it.
    classify.mockResolvedValue({
      intent: 'create_event',
      calendar_event: { title: "Mason's birthday party", date: '2026-12-10', all_day: true },
      response_message: "Got it! I've added Mason's Birthday Party. Want me to set a specific time or a reminder ahead of it?",
    });
    const res = await handlers.handleTextMessage("Mason is having his birthday party on 10 December", user, household);
    expect(res.response).toContain('invite guests');
    // The model's own reminder question was stripped so there's one clear ask.
    expect(res.response).not.toMatch(/reminder ahead of it\?/i);

    // ...and "yes" is wired to the invite, not misrouted through the classifier.
    classify.mockClear();
    const yes = await handlers.handleTextMessage('yes', user, household);
    expect(classify).not.toHaveBeenCalled();
    expect(yes.response).toContain('/p/tok-abc');
  });

  test('a party created via a non-create_event intent still offers (the reconciliation-tail path)', async () => {
    classify.mockResolvedValue({
      intent: 'calendar',
      calendar_event: { title: "Olivia's party", date: '2026-08-01', start_time: '13:00' },
      response_message: 'Added the party.',
    });
    const res = await handlers.handleTextMessage("Olivia's party Saturday 1pm", user, household);
    expect(res.response).toContain('invite guests');
  });

  test('a bare "birthday" (no party word) does NOT get the invite offer', async () => {
    classify.mockResolvedValue({
      intent: 'create_event',
      calendar_event: { title: "Mum's birthday", date: '2026-05-05', all_day: true },
      response_message: "Added Mum's birthday.",
    });
    db.createCalendarEvent.mockResolvedValueOnce({ id: 'e-99', title: "Mum's birthday", all_day: true, category: 'birthday' });
    const res = await handlers.handleTextMessage("Mum's birthday 5 May", user, household);
    expect(res.response).not.toContain('invite guests');
  });

  test('a plain event gets the reminder offer, not the invite offer', async () => {
    classify.mockResolvedValue({
      intent: 'create_event',
      calendar_event: { title: 'Dentist', date: '2026-08-01', start_time: '09:00' },
      response_message: 'Added.',
    });
    const res = await handlers.handleTextMessage('Dentist Saturday 9am', user, household);
    expect(res.response).not.toContain('invite guests');
    expect(res.response).toMatch(/reminder/i);
  });

  test('"no" to the offer acknowledges without creating anything', async () => {
    handlers.rememberInviteOffer('u1', { eventId: 'e-1', householdId: 'h1', title: 'BBQ' });
    const res = await handlers.handleTextMessage('no thanks', user, household);
    expect(db.createOrGetEventInviteLink).not.toHaveBeenCalled();
    expect(res.response).toMatch(/no invite link/i);
  });
});

describe('buildInviteRosterReply ("who\'s coming?")', () => {
  test('answers with rollups, family names and allergy flags', async () => {
    db.getUpcomingInviteEvents.mockResolvedValue([
      { id: 'e-1', title: "Olivia's 7th Birthday", start_time: '2026-08-01T12:00:00Z', end_time: '2026-08-01T14:00:00Z' },
    ]);
    db.getEventRsvps.mockResolvedValue({
      hasLink: true, going: 2, declined: 1, kids: 3, adults: 3,
      dietary: [{ family: 'The Smiths', note: 'Nut allergy' }],
      rsvps: [
        { family_name: 'The Smiths', status: 'yes' },
        { family_name: 'The Patels', status: 'yes' },
        { family_name: 'The Joneses', status: 'no' },
      ],
    });
    const reply = await handlers.buildInviteRosterReply('h1');
    expect(reply).toContain("Olivia's 7th Birthday");
    expect(reply).toContain('2 going (3 adults, 3 kids)');
    expect(reply).toContain("1 can't make it");
    expect(reply).toContain('The Smiths, The Patels');
    expect(reply).toContain('⚠️ The Smiths: Nut allergy');
  });

  test('returns null when the household has no live invite links (falls through to the LLM)', async () => {
    db.getUpcomingInviteEvents.mockResolvedValue([]);
    expect(await handlers.buildInviteRosterReply('h1')).toBeNull();
  });

  test('handleTextMessage routes an RSVP question deterministically when a roster exists', async () => {
    db.getUpcomingInviteEvents.mockResolvedValue([
      { id: 'e-1', title: 'BBQ', start_time: '2026-08-01T12:00:00Z', end_time: '2026-08-01T14:00:00Z' },
    ]);
    db.getEventRsvps.mockResolvedValue({
      hasLink: true, going: 1, declined: 0, kids: 2, adults: 2, dietary: [],
      rsvps: [{ family_name: 'The Smiths', status: 'yes' }],
    });
    const res = await handlers.handleTextMessage("who's coming?", user, household);
    expect(classify).not.toHaveBeenCalled();
    expect(res.response).toContain('BBQ');
    expect(res.response).toContain('1 going (2 adults, 2 kids)');
  });

  test('an RSVP-shaped question with no invite links classifies normally', async () => {
    classify.mockResolvedValue({ intent: 'general', response_message: 'Not sure!' });
    const res = await handlers.handleTextMessage("who's coming?", user, household);
    expect(classify).toHaveBeenCalled();
    expect(res.response).toContain('Not sure!');
  });
});
