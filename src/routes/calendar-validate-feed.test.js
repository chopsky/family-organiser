/**
 * POST /api/calendar/validate-feed — the pre-account calendar check.
 *
 * The contract that matters: "connected" means fetched AND parsed. Providers
 * return 200 + an HTML login page for expired or private links, so a fetch
 * that succeeds is not evidence of a working calendar. This endpoint is also
 * unauthenticated, so it must never store the URL or echo raw fetch errors.
 */
jest.mock('../db/queries', () => ({}));
jest.mock('../middleware/auth', () => ({
  requireAuth: (req, res, next) => next(),
  requireHousehold: (req, res, next) => next(),
}));
jest.mock('../services/cache', () => ({ invalidate: jest.fn(), invalidatePattern: jest.fn() }));
jest.mock('../services/push', () => ({}));
jest.mock('../services/broadcast', () => ({}));
jest.mock('../services/publicHolidays', () => ({}));
jest.mock('../services/r2', () => ({}));
jest.mock('../services/externalFeed', () => ({
  normaliseFeedUrl: jest.fn((u) => String(u).replace(/^webcal:\/\//i, 'https://')),
  classifyFeedUrlMistake: jest.fn(() => null),
  friendlyPullError: jest.fn(() => ({ message: 'Could not reach that calendar.', permanent: false })),
  fetchFeed: jest.fn(),
  extractCalendarName: jest.fn(() => 'Family'),
  extractVEvents: jest.fn(() => ['a', 'b', 'c']),
}));

const express = require('express');
const request = require('supertest');
const externalFeed = require('../services/externalFeed');
const router = require('./calendar');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/calendar', router);
  return a;
}

const ICS = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nEND:VEVENT\r\nEND:VCALENDAR';

beforeEach(() => {
  jest.clearAllMocks();
  externalFeed.normaliseFeedUrl.mockImplementation((u) => String(u).replace(/^webcal:\/\//i, 'https://'));
  externalFeed.classifyFeedUrlMistake.mockReturnValue(null);
  externalFeed.friendlyPullError.mockReturnValue({ message: 'Could not reach that calendar.', permanent: false });
  externalFeed.extractCalendarName.mockReturnValue('Family');
  externalFeed.extractVEvents.mockReturnValue(['a', 'b', 'c']);
});

describe('POST /api/calendar/validate-feed', () => {
  it('reports success with the calendar name and event count', async () => {
    externalFeed.fetchFeed.mockResolvedValue(ICS);
    const res = await request(app())
      .post('/api/calendar/validate-feed')
      .send({ feed_url: 'webcal://p01.icloud.com/published/2/abc' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, name: 'Family', eventCount: 3 });
  });

  it('fails when the address returns HTML rather than a calendar', async () => {
    // The dangerous case: a 200 response that is a login page. Fetching
    // succeeded, so only the parse check catches this.
    externalFeed.fetchFeed.mockResolvedValue('<!doctype html><html><body>Sign in</body></html>');
    const res = await request(app())
      .post('/api/calendar/validate-feed')
      .send({ feed_url: 'https://example.com/calendar' });

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/isn’t a calendar|web page/i);
  });

  it('fails loudly when the fetch itself errors', async () => {
    externalFeed.fetchFeed.mockRejectedValue(new Error('Feed returned HTTP 404'));
    const res = await request(app())
      .post('/api/calendar/validate-feed')
      .send({ feed_url: 'https://example.com/gone.ics' });

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('never echoes the raw fetch error back to the caller', async () => {
    externalFeed.fetchFeed.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5:443'));
    const res = await request(app())
      .post('/api/calendar/validate-feed')
      .send({ feed_url: 'https://example.com/x.ics' });

    expect(res.body.error).not.toMatch(/ECONNREFUSED|10\.0\.0\.5/);
    expect(res.body.error).toBe('Could not reach that calendar.');
  });

  it('returns the provider-specific guidance for a known wrong paste', async () => {
    externalFeed.classifyFeedUrlMistake.mockReturnValue('That’s Google’s embed link, not the calendar’s address.');
    const res = await request(app())
      .post('/api/calendar/validate-feed')
      .send({ feed_url: 'https://calendar.google.com/calendar/embed?src=x' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/embed link/i);
    // Rejected on shape alone - no network call was spent on it.
    expect(externalFeed.fetchFeed).not.toHaveBeenCalled();
  });

  it('rejects a non-http scheme without fetching', async () => {
    externalFeed.normaliseFeedUrl.mockReturnValue('file:///etc/passwd');
    const res = await request(app())
      .post('/api/calendar/validate-feed')
      .send({ feed_url: 'file:///etc/passwd' });

    expect(res.status).toBe(400);
    expect(externalFeed.fetchFeed).not.toHaveBeenCalled();
  });

  it('rejects an absurdly long string without fetching', async () => {
    const res = await request(app())
      .post('/api/calendar/validate-feed')
      .send({ feed_url: `https://example.com/${'a'.repeat(3000)}` });

    expect(res.status).toBe(400);
    expect(externalFeed.fetchFeed).not.toHaveBeenCalled();
  });

  it('rejects a missing url', async () => {
    const res = await request(app()).post('/api/calendar/validate-feed').send({});
    expect(res.status).toBe(400);
    expect(externalFeed.fetchFeed).not.toHaveBeenCalled();
  });

  it('does not log the pasted address on failure', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    externalFeed.fetchFeed.mockRejectedValue(new Error('boom'));
    const secret = 'https://calendar.google.com/calendar/ical/SECRET-BEARER-TOKEN/basic.ics';

    await request(app()).post('/api/calendar/validate-feed').send({ feed_url: secret });

    const logged = warn.mock.calls.flat().join(' ');
    expect(logged).not.toMatch(/SECRET-BEARER-TOKEN/);
    warn.mockRestore();
  });
});
