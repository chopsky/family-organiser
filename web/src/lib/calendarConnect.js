/**
 * Calendar connection, behind an interface.
 *
 * Today every provider connects the same way: the user publishes their
 * calendar and pastes the resulting ICS address. That is a mechanism decision
 * forced by Google OAuth not being set up yet — it is not meant to be
 * permanent, and the UI must not be written as though it is.
 *
 * So the UI layer never talks about ICS. It reads `provider.mode` to decide
 * which affordance to render, and calls `connectCalendar(provider, input)` to
 * do the work. Flipping Google to server-side OAuth means changing its `mode`
 * to 'oauth' and filling in the oauth branch below — no screen changes.
 *
 * SECURITY: a published ICS address is a bearer credential. Google's and
 * Outlook's "secret address" grants permanent read access to anyone holding
 * it, and iCloud's published link is genuinely public. So: these strings are
 * never logged, never persisted to localStorage, and never rendered in full.
 * See lib/onboardingDraft, which keeps them in memory only.
 */
import api from './api';

export const CAL_PROVIDERS = [
  {
    id: 'apple',
    label: 'Apple Calendar',
    sub: 'iCloud',
    // 'ics' = user publishes and pastes an address. 'oauth' = we redirect and
    // the server holds a token. Only 'ics' is implemented today.
    mode: 'ics',
    open: { label: 'Open iCloud Calendar', url: 'https://www.icloud.com/calendar' },
    placeholder: 'webcal://p12-caldav.icloud.com/published/…',
    // Apple is listed first deliberately: it is the only provider whose steps
    // can be completed entirely on the phone, so at least one path through
    // this screen doesn't require walking to a computer.
    steps: [
      'Open the Calendar app, tap Calendars, then the ⓘ beside the calendar you want.',
      'Turn on Public Calendar, tap Share Link, then Copy.',
    ],
    note: 'On a computer instead: iCloud Calendar, share icon beside the calendar, tick Public Calendar, copy the link.',
    warn: 'Public Calendar means anyone with the link can see it. Only publish a calendar you’re happy to share, and deleting the link switches it off.',
  },
  {
    id: 'google',
    label: 'Google Calendar',
    sub: 'Gmail account',
    mode: 'ics',
    open: { label: 'Open Google Calendar settings', url: 'https://calendar.google.com/calendar/u/0/r/settings' },
    placeholder: 'https://calendar.google.com/calendar/ical/…/basic.ics',
    steps: [
      'Pick your calendar on the left, under “Settings for my calendars”.',
      'Scroll to “Integrate calendar” and copy “Secret address in iCal format”.',
    ],
    note: 'Google only shows this on a computer. On a phone, tap AA in Safari’s address bar, then Request Desktop Website.',
    warn: 'Treat that link like a password — anyone who has it can see this calendar.',
  },
  {
    id: 'outlook',
    label: 'Outlook',
    sub: 'Microsoft 365',
    mode: 'ics',
    open: { label: 'Open Outlook’s publish page', url: 'https://outlook.live.com/calendar/0/options/calendar/SharedCalendars' },
    placeholder: 'https://outlook.live.com/owa/calendar/…/calendar.ics',
    steps: [
      'Under “Publish a calendar”, choose the calendar and “Can view all details”, then Publish.',
      'Copy the second link — the one ending in .ics.',
    ],
    note: 'Outlook only shows this on a computer. On a phone, tap AA in Safari’s address bar, then Request Desktop Website.',
    warn: 'Treat that link like a password — anyone who has it can see this calendar.',
  },
];

export const findProvider = (id) => CAL_PROVIDERS.find((p) => p.id === id) || null;

/**
 * How often the backend actually re-reads a subscribed calendar. Single source
 * of truth for the copy so the promise can't drift from the cron: see
 * src/jobs/scheduler.js. Do not hard-code an interval in a component.
 */
export const SYNC_CADENCE_COPY = 'about every hour';

/**
 * Verify a connection without saving it.
 *
 * The onboarding flow needs this because the calendar step runs before
 * sign-up, and a feed row requires a user and a household. It also has to be
 * genuinely honest: the server fetches AND parses the address, so a link that
 * 404s or returns a login page fails here rather than looking connected and
 * silently pulling nothing.
 *
 * Resolves { ok: true, name, eventCount } or { ok: false, error } — it never
 * throws for an invalid link, because "this address doesn't work" is an
 * expected answer on this screen, not an exception.
 */
export async function connectCalendar(provider, input = {}) {
  if (provider?.mode === 'oauth') {
    // Deliberately unimplemented rather than silently falling back to paste:
    // a half-working OAuth path is worse than an obvious gap.
    return { ok: false, error: `${provider.label} sign-in isn’t available yet.` };
  }
  const url = (input.url || '').trim();
  if (!url) return { ok: false, error: 'Paste the calendar address first.' };

  try {
    const { data } = await api.post('/calendar/validate-feed', { feed_url: url });
    return data?.ok
      ? { ok: true, name: data.name || null, eventCount: data.eventCount ?? 0 }
      : { ok: false, error: data?.error || 'That address didn’t work.' };
  } catch (err) {
    const error = err?.response?.data?.error;
    if (error) return { ok: false, error };
    // Network failure, not a bad link — say which, so the user doesn't go and
    // re-copy an address that was fine.
    return { ok: false, error: 'Couldn’t reach Housemait just then. Check your connection and try again.' };
  }
}

/**
 * Read a calendar address off the clipboard.
 *
 * Typing a published webcal URL on a phone is close to impossible, so Paste is
 * the primary input and the text field is the fallback. Returns null when the
 * clipboard is empty, unreadable, or holds something that isn't a URL — the
 * caller shows a nudge. It never invents a plausible-looking address, which is
 * what the prototype did.
 */
export async function readClipboardUrl() {
  try {
    const text = (await navigator.clipboard.readText())?.trim();
    return /^(webcal|https?):\/\/\S+$/i.test(text) ? text : null;
  } catch {
    return null; // permission denied or no clipboard API
  }
}

/**
 * Render a connected address without exposing it. The bearer token lives in
 * the middle of these URLs, so we show only the host plus a length hint.
 */
export function maskFeedUrl(url) {
  if (!url) return '';
  try {
    return `${new URL(url.replace(/^webcal:/i, 'https:')).hostname} · link hidden`;
  } catch {
    return 'link hidden';
  }
}
