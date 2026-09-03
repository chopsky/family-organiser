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

/**
 * Create the child profiles named at the kids step. Runs after
 * create-household (the dependents route needs one). Best-effort per name:
 * one failure must not cost the others, and a fully failed replay just
 * means the family adds the kids in Family Setup like before.
 */
export async function replayKids(names, schoolIdFor = null) {
  const created = [];
  for (const name of names || []) {
    try {
      // Link each child to THEIR school from the school step (a function of
      // the name, or one id for all), so the per-child term calendar and
      // prep pings resolve without a second visit to Family Setup.
      const schoolId = typeof schoolIdFor === 'function' ? schoolIdFor(name) : schoolIdFor;
      await api.post('/household/dependents', { name, dependent_kind: 'child', ...(schoolId ? { school_id: schoolId } : {}) });
      created.push(name);
    } catch { /* skip - Family Setup remains the fallback */ }
  }
  return created;
}

/**
 * Create the school picked at the school step and pull its term dates.
 * The pick is a GIAS directory row (urn/name/type/local_authority/
 * postcode), so POST /schools is exact; the LA import is the same call the
 * School page makes - the shared directory answers instantly for known
 * councils, and a miss just means the School page offers the other routes.
 * Independent schools have no LA calendar, so the import is skipped for
 * them rather than reported as a failure.
 *
 * Resolves { id, name, termDates } (termDates = number imported, or null
 * when nothing landed) - or null when the school itself couldn't be created.
 * Never throws.
 */
export async function replaySchool(school) {
  if (!school?.name) return null;
  let created = null;
  try {
    const { data } = await api.post('/schools', {
      school_name: school.name,
      school_urn: school.urn || null,
      school_type: school.type || null,
      local_authority: school.local_authority || null,
      postcode: school.postcode || null,
    });
    created = data?.school || null;
  } catch { return null; }
  if (!created?.id) return null;

  let termDates = null;
  const independent = /independent|private/i.test(String(school.type || ''));
  if (school.country === 'ZA' && school.usesNationalDates === true) {
    // South Africa: the national calendar applies to PUBLIC schools only -
    // independent schools set their own, so the family's explicit answer
    // at the step gates this import (never assumed).
    try {
      const { data } = await api.post(`/schools/${created.id}/import-sa-term-dates`, {});
      const n = Number(data?.count ?? 0);
      termDates = Number.isFinite(n) && n > 0 ? n : null;
    } catch { termDates = null; }
  } else if (!independent && (school.local_authority || school.urn)) {
    // England/Wales: the council's dates via the shared directory.
    try {
      const { data } = await api.post(`/schools/${created.id}/import-la-dates`);
      const n = Number(data?.imported ?? data?.count ?? 0);
      termDates = Number.isFinite(n) && n > 0 ? n : null;
    } catch { termDates = null; }
  }
  // Anywhere else (a free-text name, no urn): the school exists; term dates
  // come from the website/photo/PDF routes on the School page, and the Done
  // screen says exactly that.
  return { id: created.id, name: created.school_name || school.name, termDates };
}

export async function replayQueued(d) {
  const calendars = await replayCalendars(d?.cals || {});
  // A joiner skipped the inbox step, and the house inbox belongs to the
  // household they joined - never try to (re)claim it on their behalf.
  // Same for kids: the roster belongs to the household they joined.
  const inbox = d?.joining ? { claimed: false, conflict: false } : await replayInbox(d?.inbox);
  // Schools before kids, so the children can be created already linked to
  // theirs. `d.school` (singular) is the pre-3-Sep draft shape; a draft from
  // a run that straddled the deploy still replays.
  const drafts = d?.joining ? [] : (d?.schools?.length ? d.schools : (d?.school ? [{ ...d.school, kids: d.kids || [] }] : []));
  const schools = [];
  for (const sd of drafts) {
    const made = await replaySchool(sd);
    if (made) schools.push({ ...made, kids: sd.kids || [] });
  }
  // A child not placed on any card (the chips only appear with 2+ kids)
  // goes to the only school there is; with several, unplaced stays unlinked.
  const idFor = (name) => {
    const mine = schools.find((sc) => (sc.kids || []).includes(name));
    return (mine || (schools.length === 1 ? schools[0] : null))?.id || null;
  };
  const kids = d?.joining ? [] : await replayKids(d?.kids, idFor);
  return { calendars, inbox, kids, school: schools[0] || null, schools };
}
