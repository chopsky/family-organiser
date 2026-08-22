/**
 * Replaying what the user set up before they had an account.
 *
 * Steps 01-10 happen pre-account by design — sign-up sits at step 11 so the ask
 * lands at maximum investment. But a calendar feed row requires user_id AND
 * household_id (both NOT NULL, both foreign keys), and a WhatsApp link is a
 * column on users. So those two steps can only record intent at the time, and
 * this module is where the intent becomes real.
 *
 * The two are not symmetrical:
 *
 *   Calendars replay silently. We already verified each address on screen 08,
 *   so POSTing it now should succeed; if one doesn't, the user is told which
 *   rather than finding out weeks later that a calendar was never connected.
 *
 *   WhatsApp cannot replay silently. Pairing is a pull-push flow: the server
 *   issues a code and the user sends it to the bot, which is how the number is
 *   proved. So this returns a deep link for the UI to offer — there is no way
 *   to link a number on the user's behalf, and pretending otherwise would show
 *   "connected" for a number that can never receive anything.
 *
 * Never throws. A failed replay must not strand someone who has just paid us
 * ten screens of attention and successfully made an account.
 */
import api from '../../lib/api';
import { getAllCalUrls, clearCalUrls } from '../../lib/onboardingDraft';
import { CAL_PROVIDERS } from '../../lib/calendarConnect';

const labelFor = (id) => CAL_PROVIDERS.find((p) => p.id === id)?.label || 'Calendar';

/**
 * Attach every calendar the user connected during onboarding.
 * Resolves { connected: string[], failed: [{ label, error }] }.
 *
 * `promised` is the draft's cals map — what the user was TOLD was connected.
 * The addresses themselves live in memory only (bearer credentials, never
 * persisted), so they don't survive a webview teardown or the verification
 * link opening a fresh page. When one is promised but its address is gone,
 * that has to be reported: the alternative is a welcome screen that quietly
 * omits a calendar the user watched us find 244 events in.
 */
export async function replayCalendars(promised = {}) {
  const urls = getAllCalUrls();
  const entries = Object.entries(urls).filter(([, url]) => Boolean(url));

  const connected = [];
  const failed = Object.keys(promised)
    .filter((id) => !urls[id])
    .map((id) => ({
      label: labelFor(id),
      error: 'We lost the link when you left this screen — please add it again.',
    }));

  if (entries.length === 0) return { connected, failed };

  // Sequential rather than parallel: each POST triggers an initial pull on the
  // server, and three concurrent feed fetches on a cold container is a slow
  // start for the one request the user is actually waiting on.
  for (const [providerId, url] of entries) {
    try {
      await api.post('/calendar/external-feeds', {
        feed_url: url,
        display_name: '',            // the server reads the calendar's own name
        color: 'sky',
      });
      connected.push(labelFor(providerId));
    } catch (err) {
      const status = err?.response?.status;
      // 409 means someone in the household already subscribed to this exact
      // calendar. The user's goal is met, so it is not a failure to report.
      if (status === 409) { connected.push(labelFor(providerId)); continue; }
      failed.push({
        label: labelFor(providerId),
        error: err?.response?.data?.error || 'Could not connect it just now.',
      });
    }
  }

  // Drop the addresses as soon as they are attached — they are bearer
  // credentials and there is no reason to hold them any longer.
  clearCalUrls();
  return { connected, failed };
}

/**
 * Start WhatsApp pairing for someone who asked for it on screen 09.
 * Resolves { deepLink, code } or null if pairing isn't available — the caller
 * should simply not offer it rather than showing a broken button.
 */
export async function startWhatsAppPairing() {
  try {
    const { data } = await api.post('/auth/whatsapp-init-pairing');
    return data?.deep_link ? { deepLink: data.deep_link, code: data.code } : null;
  } catch {
    // 503 when WhatsApp isn't configured on this server, or a transient error.
    // Either way the user can pair from Settings later.
    return null;
  }
}

/**
 * Everything queued, replayed in one call. Returns a summary the welcome screen
 * can speak to honestly.
 */
/**
 * Claim the house-inbox alias the user picked at step 10.
 *
 * Availability was checked when they claimed it, but nothing was
 * reserved - a real reservation would need an anonymous-session table
 * and a TTL sweep to guard a window of minutes at a handful of signups
 * a day. So this is where it becomes real, and the ONE outcome that
 * matters is losing the race: 409 means somebody else took it while
 * this person was signing up. Report that (the welcome screen says so
 * and points at Settings) rather than leaving them believing they hold
 * an address they don't - the same rule replayCalendars follows.
 *
 * Resolves { claimed: string|null, conflict: boolean }. Never throws.
 */
export async function replayInbox(slug) {
  if (!slug) return { claimed: null, conflict: false };
  try {
    await api.patch('/household/email-alias', { alias: slug });
    return { claimed: slug, conflict: false };
  } catch (err) {
    const status = err?.response?.status;
    // 409 = taken in the meantime. Anything else (network, 500) is not
    // worth alarming someone about: the address simply isn't set, and
    // Settings offers it again with the same picker.
    return { claimed: null, conflict: status === 409 };
  }
}

export async function replayQueued(d) {
  const calendars = await replayCalendars(d?.cals || {});
  const whatsapp = d?.wa ? await startWhatsAppPairing() : null;
  const inbox = await replayInbox(d?.inbox);
  return { calendars, whatsapp, inbox };
}
