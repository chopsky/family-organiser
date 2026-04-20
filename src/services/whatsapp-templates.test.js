/**
 * Unit tests for the WhatsApp 24-hour window check and send-path router.
 *
 * These are pure-function tests — no Twilio calls, no DB. The integration
 * wiring (broadcast.js → whatsapp-templates → whatsapp service) is exercised
 * by hand against the Twilio sandbox; this file just guards the logic that
 * decides WHICH path to take for each member.
 */

const {
  isWithin24hWindow,
  decideSendPath,
  WINDOW_MS,
} = require('./whatsapp-templates');

// Fixed "now" for deterministic tests.
const NOW = Date.UTC(2026, 3, 20, 12, 0, 0); // 2026-04-20T12:00:00Z

function isoMinusHours(hours) {
  return new Date(NOW - hours * 60 * 60 * 1000).toISOString();
}

// ─── isWithin24hWindow ───────────────────────────────────────────────────────

describe('isWithin24hWindow()', () => {
  test('returns true when the inbound timestamp is well under 24 hours old', () => {
    const member = { whatsapp_last_inbound_at: isoMinusHours(3) };
    expect(isWithin24hWindow(member, NOW)).toBe(true);
  });

  test('returns true right up to (but not including) the 24-hour boundary', () => {
    // Exactly 23h 59m 59s old → still inside.
    const member = { whatsapp_last_inbound_at: new Date(NOW - WINDOW_MS + 1000).toISOString() };
    expect(isWithin24hWindow(member, NOW)).toBe(true);
  });

  test('returns false exactly at the 24-hour boundary', () => {
    // Some Twilio docs phrase the window as "within 24 hours", which is
    // inclusive; being strict about the edge is safer than drifting past.
    const member = { whatsapp_last_inbound_at: new Date(NOW - WINDOW_MS).toISOString() };
    expect(isWithin24hWindow(member, NOW)).toBe(false);
  });

  test('returns false when the timestamp is more than 24 hours old', () => {
    const member = { whatsapp_last_inbound_at: isoMinusHours(48) };
    expect(isWithin24hWindow(member, NOW)).toBe(false);
  });

  test('returns false when whatsapp_last_inbound_at is null, missing, or unparseable', () => {
    // Users who have never messaged the bot (e.g. a passive recipient who
    // only reads notifications) have null here. That's the whole reason we
    // need the template path.
    expect(isWithin24hWindow({ whatsapp_last_inbound_at: null }, NOW)).toBe(false);
    expect(isWithin24hWindow({}, NOW)).toBe(false);
    expect(isWithin24hWindow(null, NOW)).toBe(false);
    expect(isWithin24hWindow({ whatsapp_last_inbound_at: 'not a date' }, NOW)).toBe(false);
  });
});

// ─── decideSendPath ──────────────────────────────────────────────────────────

describe('decideSendPath()', () => {
  const LINKED_IN_WINDOW = {
    whatsapp_linked: true,
    whatsapp_phone: '+447700900001',
    whatsapp_last_inbound_at: isoMinusHours(2),
  };
  const LINKED_OUT_OF_WINDOW = {
    whatsapp_linked: true,
    whatsapp_phone: '+447700900002',
    whatsapp_last_inbound_at: isoMinusHours(48),
  };
  const LINKED_NEVER_REPLIED = {
    whatsapp_linked: true,
    whatsapp_phone: '+447700900003',
    whatsapp_last_inbound_at: null,
  };
  const UNLINKED = { whatsapp_linked: false, whatsapp_phone: null };

  test("returns 'freeform' for a linked member inside the 24h window", () => {
    expect(decideSendPath(LINKED_IN_WINDOW, { templateSid: 'HXsomesid', whatsappConfigured: true, nowMs: NOW })).toBe('freeform');
  });

  test("returns 'template' for a linked member outside the window when a template SID is configured", () => {
    expect(decideSendPath(LINKED_OUT_OF_WINDOW, { templateSid: 'HXsomesid', whatsappConfigured: true, nowMs: NOW })).toBe('template');
    expect(decideSendPath(LINKED_NEVER_REPLIED, { templateSid: 'HXsomesid', whatsappConfigured: true, nowMs: NOW })).toBe('template');
  });

  test("returns 'skip' for a linked member outside the window when no template SID is configured yet", () => {
    // This is the state we ship in before the user has registered the
    // template with Meta — out-of-window sends would hit 63016, so we
    // skip entirely rather than waste a round-trip.
    expect(decideSendPath(LINKED_OUT_OF_WINDOW, { templateSid: null, whatsappConfigured: true, nowMs: NOW })).toBe('skip');
    expect(decideSendPath(LINKED_NEVER_REPLIED, { templateSid: '', whatsappConfigured: true, nowMs: NOW })).toBe('skip');
  });

  test("returns 'skip' when the member isn't linked or has no phone", () => {
    expect(decideSendPath(UNLINKED, { templateSid: 'HXsomesid', whatsappConfigured: true, nowMs: NOW })).toBe('skip');
    expect(decideSendPath(null, { templateSid: 'HXsomesid', whatsappConfigured: true, nowMs: NOW })).toBe('skip');
  });

  test("returns 'skip' when WhatsApp isn't configured globally (no Twilio env vars)", () => {
    expect(decideSendPath(LINKED_IN_WINDOW, { templateSid: 'HXsomesid', whatsappConfigured: false, nowMs: NOW })).toBe('skip');
  });

  test('uses Date.now() when nowMs is omitted', () => {
    // Smoke test: if a freshly-minted timestamp returns 'freeform', the
    // default-argument plumbing is working.
    const member = {
      whatsapp_linked: true,
      whatsapp_phone: '+447700900099',
      whatsapp_last_inbound_at: new Date().toISOString(),
    };
    expect(decideSendPath(member, { templateSid: 'HXsomesid', whatsappConfigured: true })).toBe('freeform');
  });
});
