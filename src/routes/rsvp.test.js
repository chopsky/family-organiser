/**
 * Public RSVP routes (/api/rsvp/:token). The contract that matters most:
 * the GET payload NEVER contains the event address - it's only returned by
 * a yes-RSVP - and dead links answer 404/410 without leaking anything.
 */
jest.mock('../db/queries', () => ({
  getEventInviteByToken: jest.fn(),
  upsertEventRsvp: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const db = require('../db/queries');
const router = require('./rsvp');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/rsvp', router);
  return a;
}

const LIVE_INVITE = {
  linkId: 'l1',
  householdId: 'h1',
  hostFirstName: 'Sarah',
  event: {
    id: 'e1',
    title: "Olivia's 7th Birthday",
    start_time: '2026-08-01T13:00:00Z',
    end_time: '2026-08-01T15:00:00Z',
    all_day: false,
    hasLocation: true,
  },
  location: '12 Oak Lane, Guildford',
};

beforeEach(() => {
  jest.clearAllMocks();
  db.getEventInviteByToken.mockResolvedValue(LIVE_INVITE);
  db.upsertEventRsvp.mockResolvedValue({ rsvp: { id: 'r1', status: 'yes' }, updated: false });
});

describe('GET /api/rsvp/:token', () => {
  test('returns the invite without the address or internals', async () => {
    const res = await request(app()).get('/api/rsvp/tok123');
    expect(res.status).toBe(200);
    expect(res.body.event.title).toBe("Olivia's 7th Birthday");
    expect(res.body.hostFirstName).toBe('Sarah');
    // the veil: no address, no db internals in the public payload
    expect(JSON.stringify(res.body)).not.toContain('Oak Lane');
    expect(res.body.location).toBeUndefined();
    expect(res.body.householdId).toBeUndefined();
    expect(res.body.linkId).toBeUndefined();
    expect(res.body.event.hasLocation).toBe(true);
  });

  test('unknown token → 404', async () => {
    db.getEventInviteByToken.mockResolvedValue(null);
    const res = await request(app()).get('/api/rsvp/nope');
    expect(res.status).toBe(404);
  });

  test('expired link → 410', async () => {
    db.getEventInviteByToken.mockResolvedValue({ expired: true });
    const res = await request(app()).get('/api/rsvp/old');
    expect(res.status).toBe(410);
    expect(res.body.expired).toBe(true);
  });
});

describe('POST /api/rsvp/:token', () => {
  test('a yes reveals the address and does not bump the opens count', async () => {
    const res = await request(app())
      .post('/api/rsvp/tok123')
      .send({ familyName: 'The Smiths', status: 'yes', kidsCount: 2, adultsCount: 1, dietaryNotes: 'Nut allergy' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, status: 'yes', location: '12 Oak Lane, Guildford' });
    expect(db.getEventInviteByToken).toHaveBeenCalledWith('tok123', { bumpView: false });
    expect(db.upsertEventRsvp).toHaveBeenCalledWith(expect.objectContaining({
      inviteLinkId: 'l1', familyName: 'The Smiths', status: 'yes', userId: null,
    }));
  });

  test('a no gets no address', async () => {
    db.upsertEventRsvp.mockResolvedValue({ rsvp: { id: 'r1', status: 'no' }, updated: false });
    const res = await request(app())
      .post('/api/rsvp/tok123')
      .send({ familyName: 'The Joneses', status: 'no' });
    expect(res.status).toBe(200);
    expect(res.body.location).toBeNull();
  });

  test('invalid status → 400 before any lookup', async () => {
    const res = await request(app())
      .post('/api/rsvp/tok123')
      .send({ familyName: 'The Smiths', status: 'maybe' });
    expect(res.status).toBe(400);
    expect(db.getEventInviteByToken).not.toHaveBeenCalled();
  });

  test('missing family name → friendly 400', async () => {
    const err = new Error('name required');
    err.code = 'NAME_REQUIRED';
    db.upsertEventRsvp.mockRejectedValue(err);
    const res = await request(app())
      .post('/api/rsvp/tok123')
      .send({ familyName: '', status: 'yes' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/family name/i);
  });

  test('expired link refuses the RSVP with 410', async () => {
    db.getEventInviteByToken.mockResolvedValue({ expired: true });
    const res = await request(app())
      .post('/api/rsvp/old')
      .send({ familyName: 'The Smiths', status: 'yes' });
    expect(res.status).toBe(410);
    expect(db.upsertEventRsvp).not.toHaveBeenCalled();
  });
});

describe('GET /api/rsvp/:token/event.ics', () => {
  test('serves a single-event calendar file including the address', async () => {
    const res = await request(app()).get('/api/rsvp/tok123/event.ics');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/calendar/);
    expect(res.text).toContain('BEGIN:VEVENT');
    expect(res.text).toContain("Olivia's 7th Birthday");
    expect(res.text).toContain('12 Oak Lane');
    expect(db.getEventInviteByToken).toHaveBeenCalledWith('tok123', { bumpView: false });
  });

  test('dead link → 404', async () => {
    db.getEventInviteByToken.mockResolvedValue(null);
    const res = await request(app()).get('/api/rsvp/nope/event.ics');
    expect(res.status).toBe(404);
  });
});
