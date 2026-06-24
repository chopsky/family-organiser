/**
 * Phase 1 Google Calendar OAuth routes: /connect/google (start) and
 * /connect/google/callback (exchange + store). googleapis, the DB, and auth are
 * mocked. The key assertions: scopes are read-only + offline, identity rides in
 * a signed `state`, and the stored tokens are ENCRYPTED (never plaintext).
 */
const crypto = require('crypto');

// Must be set before the router module loads (GCAL_ENABLED is read at import).
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
process.env.GOOGLE_CALENDAR_ENABLED = 'true';
process.env.GOOGLE_CALENDAR_CLIENT_ID = 'test-cid';
process.env.GOOGLE_CALENDAR_CLIENT_SECRET = 'test-secret';
process.env.CALENDAR_TOKEN_KEY = crypto.randomBytes(32).toString('base64');
process.env.WEB_URL = 'https://app.test';
process.env.API_URL = 'https://api.test';

jest.mock('../db/queries');
jest.mock('../db/client', () => ({ supabase: {}, supabaseAdmin: {} }));
jest.mock('../middleware/auth', () => ({
  requireAuth: (req, _res, next) => { req.user = { id: 'u1' }; req.householdId = 'h1'; next(); },
  requireHousehold: (_req, _res, next) => next(),
}));
// Heavy services calendar.js imports but these routes never call.
jest.mock('../services/r2', () => ({}));
jest.mock('../services/push', () => ({}));
jest.mock('../services/broadcast', () => ({}));
jest.mock('../services/externalFeed', () => ({}));
jest.mock('../services/publicHolidays', () => ({}));
jest.mock('../services/deviceCalendarSync', () => ({}));
jest.mock('../services/cache', () => ({ get: jest.fn(), set: jest.fn(), invalidate: jest.fn(), invalidatePattern: jest.fn() }));
jest.mock('../services/googleCalendar');

const mockGetToken = jest.fn();
jest.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: jest.fn().mockImplementation(() => ({
        generateAuthUrl: (opts) =>
          `https://accounts.google.com/o/oauth2/auth?scope=${encodeURIComponent((opts.scope || []).join(' '))}` +
          `&access_type=${opts.access_type}&prompt=${opts.prompt}&state=${opts.state}`,
        getToken: (...a) => mockGetToken(...a),
      })),
    },
  },
}));

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const db = require('../db/queries');
const googleCal = require('../services/googleCalendar');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/calendar', require('./calendar'));
  return a;
}

beforeEach(() => {
  jest.clearAllMocks();
  // Phase 2 write path defaults to OFF; the write-scope tests opt in. WRITE_SCOPE
  // is a string export the automock drops, so set it explicitly.
  googleCal.WRITE_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';
  googleCal.writesGloballyEnabled.mockReturnValue(false);
});

describe('GET /api/calendar/connect/google', () => {
  test('returns a Google consent URL with read-only + offline + signed state', async () => {
    const res = await request(app()).get('/api/calendar/connect/google');
    expect(res.status).toBe(200);
    expect(res.body.url).toContain('accounts.google.com');
    expect(res.body.url).toContain('calendar.readonly');
    expect(res.body.url).toContain('access_type=offline');
    expect(res.body.url).toContain('prompt=consent');
    // The state is a valid JWT carrying the caller's identity.
    const state = new URL(res.body.url).searchParams.get('state');
    const claims = jwt.verify(state, process.env.JWT_SECRET);
    expect(claims).toMatchObject({ uid: 'u1', hid: 'h1', p: 'gcal' });
  });

  test('requests the app.created write scope when outbound writes are enabled', async () => {
    googleCal.writesGloballyEnabled.mockReturnValue(true);
    const res = await request(app()).get('/api/calendar/connect/google');
    expect(res.body.url).toContain('calendar.readonly');
    expect(res.body.url).toContain('calendar.app.created');
  });
});

describe('GET /api/calendar/connect/google/callback', () => {
  const validState = () => jwt.sign({ uid: 'u1', hid: 'h1', p: 'gcal' }, process.env.JWT_SECRET);

  test('exchanges the code and stores ENCRYPTED tokens, then redirects connected', async () => {
    mockGetToken.mockResolvedValue({
      tokens: {
        access_token: 'ya29.at',
        refresh_token: '1//rt-secret',
        expiry_date: Date.now() + 3600_000,
        scope: 'https://www.googleapis.com/auth/calendar.readonly',
        id_token: jwt.sign({ email: 'parent@home.com' }, 'irrelevant'),
      },
    });
    db.upsertCalendarConnection.mockResolvedValue({ id: 'c1' });

    const res = await request(app()).get(`/api/calendar/connect/google/callback?code=abc&state=${validState()}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://app.test/settings?section=calendars&google=connected');

    const arg = db.upsertCalendarConnection.mock.calls[0][0];
    expect(arg).toMatchObject({ userId: 'u1', householdId: 'h1', googleEmail: 'parent@home.com', status: 'ok' });
    // Stored token must be ciphertext (iv.tag.ct), never the plaintext.
    expect(arg.refreshTokenEnc).not.toBe('1//rt-secret');
    expect(String(arg.refreshTokenEnc).split('.')).toHaveLength(3);
  });

  test('no refresh token → status needs_reconnect', async () => {
    mockGetToken.mockResolvedValue({
      tokens: { access_token: 'ya29.at', expiry_date: Date.now() + 3600_000, scope: 'x' },
    });
    db.upsertCalendarConnection.mockResolvedValue({ id: 'c1' });
    const res = await request(app()).get(`/api/calendar/connect/google/callback?code=abc&state=${validState()}`);
    expect(res.headers.location).toContain('google=connected');
    const arg = db.upsertCalendarConnection.mock.calls[0][0];
    expect(arg.status).toBe('needs_reconnect');
    expect(arg.refreshTokenEnc).toBeNull();
  });

  test('a forged / bad state is rejected and stores nothing', async () => {
    const res = await request(app()).get('/api/calendar/connect/google/callback?code=abc&state=not-a-jwt');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('google=error');
    expect(res.headers.location).toContain('reason=bad_state');
    expect(db.upsertCalendarConnection).not.toHaveBeenCalled();
  });

  test('Google returning an error param redirects with that reason', async () => {
    const res = await request(app()).get('/api/calendar/connect/google/callback?error=access_denied');
    expect(res.headers.location).toContain('google=error');
    expect(res.headers.location).toContain('access_denied');
    expect(db.upsertCalendarConnection).not.toHaveBeenCalled();
  });

  test('with writes enabled + write scope granted, creates the Housemait calendar', async () => {
    googleCal.writesGloballyEnabled.mockReturnValue(true);
    googleCal.ensureAppCalendar.mockResolvedValue('housemait-cal-id');
    mockGetToken.mockResolvedValue({
      tokens: {
        access_token: 'ya29.at',
        refresh_token: '1//rt',
        scope: 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.app.created',
        id_token: jwt.sign({ email: 'p@home.com' }, 'x'),
      },
    });
    db.upsertCalendarConnection.mockResolvedValue({ id: 'c1' });

    const res = await request(app()).get(`/api/calendar/connect/google/callback?code=abc&state=${validState()}`);
    expect(res.headers.location).toContain('google=connected');
    expect(googleCal.ensureAppCalendar).toHaveBeenCalled();
    expect(db.setConnectionAppCalendar).toHaveBeenCalledWith('c1', 'housemait-cal-id');
    expect(db.setConnectionWritesEnabled).toHaveBeenCalledWith('c1', true);
  });

  test('without the write scope granted, no Housemait calendar is created', async () => {
    googleCal.writesGloballyEnabled.mockReturnValue(true);
    mockGetToken.mockResolvedValue({
      tokens: { access_token: 'ya29.at', refresh_token: '1//rt', scope: 'https://www.googleapis.com/auth/calendar.readonly' },
    });
    db.upsertCalendarConnection.mockResolvedValue({ id: 'c1' });

    await request(app()).get(`/api/calendar/connect/google/callback?code=abc&state=${validState()}`);
    expect(googleCal.ensureAppCalendar).not.toHaveBeenCalled();
    expect(db.setConnectionAppCalendar).not.toHaveBeenCalled();
  });
});

describe('GET /api/calendar/google/calendars', () => {
  test('409 needsConnect when there is no connection', async () => {
    db.getCalendarConnectionByUser.mockResolvedValue(null);
    const res = await request(app()).get('/api/calendar/google/calendars');
    expect(res.status).toBe(409);
    expect(res.body.needsConnect).toBe(true);
  });

  test('returns calendars flagged with their current selection', async () => {
    db.getCalendarConnectionByUser.mockResolvedValue({ id: 'c1', refresh_token: 'enc', status: 'ok', google_email: 'p@h.com' });
    googleCal.listCalendars.mockResolvedValue([
      { id: 'cal-A', summary: 'Work', primary: false },
      { id: 'cal-B', summary: 'Family', primary: true },
    ]);
    db.getGoogleFeedsByConnection.mockResolvedValue([{ google_calendar_id: 'cal-B' }]);
    const res = await request(app()).get('/api/calendar/google/calendars');
    expect(res.status).toBe(200);
    expect(res.body.calendars.find((c) => c.id === 'cal-B').selected).toBe(true);
    expect(res.body.calendars.find((c) => c.id === 'cal-A').selected).toBe(false);
  });

  test('a revoked token marks the connection needs_reconnect and 409s', async () => {
    db.getCalendarConnectionByUser.mockResolvedValue({ id: 'c1', refresh_token: 'enc', status: 'ok' });
    db.markCalendarConnectionStatus.mockResolvedValue();
    googleCal.listCalendars.mockRejectedValue(new Error('invalid_grant'));
    const res = await request(app()).get('/api/calendar/google/calendars');
    expect(res.status).toBe(409);
    expect(db.markCalendarConnectionStatus).toHaveBeenCalledWith('c1', 'needs_reconnect');
  });
});

describe('POST /api/calendar/google/select', () => {
  test('adds newly-selected calendars and removes deselected ones', async () => {
    db.getCalendarConnectionByUser.mockResolvedValue({ id: 'c1' });
    db.getGoogleFeedsByConnection.mockResolvedValue([
      { id: 'feed-old', google_calendar_id: 'cal-OLD' },
      { id: 'feed-keep', google_calendar_id: 'cal-KEEP' },
    ]);
    db.addGoogleCalendarFeed.mockResolvedValue({ id: 'feed-new', google_calendar_id: 'cal-NEW' });
    db.deleteExternalFeed.mockResolvedValue();
    googleCal.refreshGoogleFeed.mockResolvedValue({ created: 3 });

    const res = await request(app())
      .post('/api/calendar/google/select')
      .send({ calendars: [{ id: 'cal-KEEP', summary: 'Family' }, { id: 'cal-NEW', summary: 'School' }] });

    expect(res.status).toBe(200);
    expect(db.addGoogleCalendarFeed).toHaveBeenCalledTimes(1);
    expect(db.addGoogleCalendarFeed.mock.calls[0][0]).toMatchObject({ googleCalendarId: 'cal-NEW', connectionId: 'c1' });
    expect(db.deleteExternalFeed).toHaveBeenCalledWith('feed-old', 'h1'); // cal-OLD deselected
    expect(db.deleteExternalFeed).not.toHaveBeenCalledWith('feed-keep', 'h1');
    // Newly-added calendar is synced immediately (not left for the cron).
    expect(googleCal.refreshGoogleFeed).toHaveBeenCalledTimes(1);
    expect(googleCal.refreshGoogleFeed).toHaveBeenCalledWith({ id: 'feed-new', google_calendar_id: 'cal-NEW' }, { id: 'c1' });
  });
});

describe('GET /api/calendar/external-feeds', () => {
  test('hides google feeds (managed by the Google card, not this list)', async () => {
    db.getExternalFeedsByHousehold.mockResolvedValue([
      { id: 'a', source: 'ical', feed_url: 'https://x/cal.ics' },
      { id: 'b', source: 'google', feed_url: 'google://c1/cal-1' },
      { id: 'c', source: 'device', feed_url: 'device://phone/cal' },
    ]);
    const res = await request(app()).get('/api/calendar/external-feeds');
    expect(res.status).toBe(200);
    expect(res.body.feeds.map((f) => f.id)).toEqual(['a', 'c']); // no google
  });
});

describe('POST /api/calendar/external-feeds/:id/refresh (google)', () => {
  test('routes a google feed to the Google pull, never the iCal fetcher', async () => {
    db.getExternalFeedById.mockResolvedValue({
      id: 'F1', household_id: 'h1', source: 'google', connection_id: 'c1', google_calendar_id: 'cal-1',
    });
    db.getCalendarConnectionById.mockResolvedValue({ id: 'c1', refresh_token: 'enc' });
    googleCal.refreshGoogleFeed.mockResolvedValue({ created: 2 });
    const res = await request(app()).post('/api/calendar/external-feeds/F1/refresh');
    expect(res.status).toBe(200);
    expect(googleCal.refreshGoogleFeed).toHaveBeenCalled();
  });

  test('a google feed whose connection lost its token asks for reconnect', async () => {
    db.getExternalFeedById.mockResolvedValue({ id: 'F1', household_id: 'h1', source: 'google', connection_id: 'c1' });
    db.getCalendarConnectionById.mockResolvedValue({ id: 'c1', refresh_token: null });
    const res = await request(app()).post('/api/calendar/external-feeds/F1/refresh');
    expect(res.status).toBe(409);
    expect(googleCal.refreshGoogleFeed).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/calendar/external-feeds/:id/owner', () => {
  test('attributes a feed to a household member (colour + re-stamp events)', async () => {
    db.getExternalFeedById.mockResolvedValue({ id: 'F1', household_id: 'h1' });
    db.getUserById.mockResolvedValue({ id: 'm1', household_id: 'h1', color_theme: 'cobalt', name: 'Dad' });
    db.setExternalFeedOwner.mockResolvedValue({ id: 'F1', owner_member_id: 'm1', color: 'cobalt' });
    db.restampFeedEventsAttribution.mockResolvedValue();
    const res = await request(app()).patch('/api/calendar/external-feeds/F1/owner').send({ owner_member_id: 'm1' });
    expect(res.status).toBe(200);
    expect(db.setExternalFeedOwner).toHaveBeenCalledWith('F1', 'h1', 'm1', 'cobalt');
    expect(db.restampFeedEventsAttribution).toHaveBeenCalledWith('F1', 'h1', { color: 'cobalt', assignedIds: ['m1'], assignedNames: ['Dad'] });
  });

  test('"Shared" (null owner) → neutral colour, no assignee, no member lookup', async () => {
    db.getExternalFeedById.mockResolvedValue({ id: 'F1', household_id: 'h1' });
    db.setExternalFeedOwner.mockResolvedValue({ id: 'F1', owner_member_id: null, color: 'slate' });
    db.restampFeedEventsAttribution.mockResolvedValue();
    const res = await request(app()).patch('/api/calendar/external-feeds/F1/owner').send({ owner_member_id: null });
    expect(res.status).toBe(200);
    expect(db.setExternalFeedOwner).toHaveBeenCalledWith('F1', 'h1', null, 'slate');
    expect(db.restampFeedEventsAttribution).toHaveBeenCalledWith('F1', 'h1', { color: 'slate', assignedIds: [], assignedNames: [] });
  });

  test('rejects a member from another household', async () => {
    db.getExternalFeedById.mockResolvedValue({ id: 'F1', household_id: 'h1' });
    db.getUserById.mockResolvedValue({ id: 'm9', household_id: 'OTHER', color_theme: 'red', name: 'X' });
    const res = await request(app()).patch('/api/calendar/external-feeds/F1/owner').send({ owner_member_id: 'm9' });
    expect(res.status).toBe(400);
    expect(db.setExternalFeedOwner).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/calendar/google/disconnect', () => {
  test('revokes + deletes the connection', async () => {
    const revoke = jest.fn().mockResolvedValue();
    db.getCalendarConnectionByUser.mockResolvedValue({ id: 'c1', refresh_token: 'enc' });
    googleCal.oauthClientForConnection.mockReturnValue({ revokeCredentials: revoke });
    db.deleteCalendarConnection.mockResolvedValue();
    const res = await request(app()).delete('/api/calendar/google/disconnect');
    expect(res.status).toBe(200);
    expect(revoke).toHaveBeenCalled();
    expect(db.deleteCalendarConnection).toHaveBeenCalledWith('c1');
  });

  test('deletes the Housemait app calendar before revoking when one exists', async () => {
    const revoke = jest.fn().mockResolvedValue();
    db.getCalendarConnectionByUser.mockResolvedValue({ id: 'c1', refresh_token: 'enc', app_calendar_id: 'housemait-cal' });
    googleCal.oauthClientForConnection.mockReturnValue({ revokeCredentials: revoke });
    googleCal.deleteAppCalendar.mockResolvedValue({ ok: true });
    db.deleteCalendarConnection.mockResolvedValue();
    const res = await request(app()).delete('/api/calendar/google/disconnect');
    expect(res.status).toBe(200);
    expect(googleCal.deleteAppCalendar).toHaveBeenCalledWith(expect.objectContaining({ app_calendar_id: 'housemait-cal' }));
    expect(db.deleteCalendarConnection).toHaveBeenCalledWith('c1');
  });
});
