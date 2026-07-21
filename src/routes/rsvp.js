const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db/queries');

// Public RSVP endpoints for event invite links - the invitee side of the
// party loop. NO auth anywhere here: the 128-bit token IS the credential,
// and the whole design rule is that a family can RSVP without an account
// (the signup wall sits after the value, on the confirmation screen).
//
// The address stays out of the GET payload and is only returned by a
// yes-RSVP. That's a courtesy to the host (a forwarded link doesn't leak
// their home address to lurkers), not a security boundary - anyone with the
// link could RSVP under any name. Hosts share to a trusted group chat.

const router = Router();

// Belt-and-braces abuse control, keyed by IP (express has trust proxy set).
// Generous read ceiling: one link shared into a class group chat produces a
// burst of opens, sometimes from carrier NAT sharing an IP.
const readLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: { error: 'Too many requests, please try again later' },
  validate: false,
});
const writeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  message: { error: 'Too many requests, please try again later' },
  validate: false,
});

// Same lazy ical-generator shim as routes/calendar.js.
let _ical = null;
async function getIcal() {
  if (!_ical) {
    const mod = require('ical-generator');
    _ical = mod.default || mod;
  }
  return _ical;
}

/**
 * GET /api/rsvp/:token - the invite as an invitee sees it. Event basics +
 * host first name; never the address, never household/link internals.
 */
router.get('/:token', readLimiter, async (req, res) => {
  try {
    const invite = await db.getEventInviteByToken(req.params.token);
    if (!invite) return res.status(404).json({ error: 'This invite link is no longer available' });
    if (invite.expired) return res.status(410).json({ expired: true });
    return res.json({ hostFirstName: invite.hostFirstName, event: invite.event });
  } catch (err) {
    console.error('GET /api/rsvp/:token error:', err?.message || err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/rsvp/:token - submit (or change) a family's RSVP.
 * Body: { familyName, status: 'yes'|'no', kidsCount, adultsCount, dietaryNotes }
 * A yes reveals the address in the response. user_id stays null in v1 -
 * it's the phase-2 hook for signed-in invitees getting the event synced.
 */
router.post('/:token', writeLimiter, async (req, res) => {
  try {
    const { familyName, status, kidsCount, adultsCount, dietaryNotes } = req.body || {};
    if (status !== 'yes' && status !== 'no') {
      return res.status(400).json({ error: 'status must be "yes" or "no"' });
    }
    const invite = await db.getEventInviteByToken(req.params.token, { bumpView: false });
    if (!invite) return res.status(404).json({ error: 'This invite link is no longer available' });
    if (invite.expired) return res.status(410).json({ expired: true });

    const { rsvp, updated } = await db.upsertEventRsvp({
      inviteLinkId: invite.linkId,
      familyName,
      status,
      kidsCount,
      adultsCount,
      dietaryNotes,
      userId: null,
    });
    return res.json({
      ok: true,
      updated,
      status: rsvp.status,
      location: rsvp.status === 'yes' ? invite.location : null,
    });
  } catch (err) {
    if (err.code === 'NAME_REQUIRED') {
      return res.status(400).json({ error: 'Please tell the host your family name' });
    }
    console.error('POST /api/rsvp/:token error:', err?.message || err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/rsvp/:token/event.ics - single-event calendar file, offered on
 * the confirmation screen after a yes. Includes the address (the courtesy
 * veil above has already lifted for this family by the time it's offered).
 */
router.get('/:token/event.ics', readLimiter, async (req, res) => {
  try {
    const invite = await db.getEventInviteByToken(req.params.token, { bumpView: false });
    if (!invite || invite.expired) return res.status(404).json({ error: 'This invite link is no longer available' });

    const ical = await getIcal();
    const calendar = ical({ name: invite.event.title });
    const vevent = {
      id: `housemait-invite-${invite.event.id}@housemait.com`,
      start: new Date(invite.event.start_time),
      end: new Date(invite.event.end_time || invite.event.start_time),
      summary: invite.event.title,
      allDay: invite.event.all_day || false,
    };
    if (invite.location) vevent.location = invite.location;
    calendar.createEvent(vevent);

    res.set('Content-Type', 'text/calendar; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="event.ics"');
    return res.send(calendar.toString());
  } catch (err) {
    console.error('GET /api/rsvp/:token/event.ics error:', err?.message || err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
