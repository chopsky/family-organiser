/**
 * Pre-account draft for the v4 onboarding flow.
 *
 * Nothing in this flow can be persisted server-side until step 11: a calendar
 * feed row requires BOTH user_id and household_id (both NOT NULL, both FK'd),
 * and a WhatsApp link is a column on users. So steps 01-10 are held client-side
 * and replayed against the API once the account exists.
 *
 * Backgrounding an app on iOS can tear down the webview, which would silently
 * lose ten screens of input, so the answers are mirrored to localStorage.
 *
 * SECURITY - what is deliberately NOT persisted:
 * Pasted ICS URLs are bearer credentials. iCloud's published link is genuinely
 * public and Google's/Outlook's are permanent and unguessable-but-unrevocable-
 * in-practice; anyone holding one can read that calendar forever. Writing them
 * to localStorage would leave those credentials in plaintext on the device
 * indefinitely if the user abandons the flow. So calendar URLs live in memory
 * ONLY (see `volatile` below) and are dropped if the webview is torn down. The
 * cost is re-pasting one link in a rare case; the alternative is a plaintext
 * credential store we would then have to defend. Everything else - the cheap,
 * non-sensitive answers - survives.
 */

const KEY = 'housemait_onboarding_v4_draft';
// Two hours, not a week. The job here is surviving a torn-down webview, which
// is a matter of minutes - a week was covering "came back next Tuesday", and
// silently restoring day-old answers onto what looks like a fresh Step 1 is
// how someone ends up staring at four pre-ticked boxes they don't remember
// picking, or at "WhatsApp it is" for a choice they never made this session.
const TTL_MS = 2 * 60 * 60 * 1000;

/** The shape held between screens. Mirrors the spec's `d` object. */
export const emptyDraft = () => ({
  pains: [],      // string[]  - drives the personalised plan on screen 03
  shape: '',      // household type
  you: '',        // first name -> screens 09, 11, 12
  role: '',
  house: '',      // household name -> screens 11, 12
  cals: {},       // { providerId: true } - CONNECTED INTENT ONLY, never the URL
  wa: false,      // wants WhatsApp; the real pairing happens after sign-up
  rem: false,     // notification permission granted
});

// Calendar URLs, in memory for the lifetime of this page only. Module scope
// rather than component state so a step unmount doesn't drop them.
const volatile = { calUrls: {} };

export const setCalUrl = (providerId, url) => { volatile.calUrls[providerId] = url; };
export const getCalUrl = (providerId) => volatile.calUrls[providerId] || null;
export const getAllCalUrls = () => ({ ...volatile.calUrls });
export const hasCalUrl = (providerId) => Boolean(volatile.calUrls[providerId]);
/** Called after a successful replay, and on flow exit. */
export const clearCalUrls = () => { volatile.calUrls = {}; };

/**
 * Does this draft hold anything the user actually chose?
 *
 * Used to decide whether a restore is worth telling them about. A draft that
 * loaded but holds nothing is indistinguishable from a fresh start, so
 * announcing it would be noise.
 */
export function isDraftEmpty(d) {
  if (!d) return true;
  return (d.pains || []).length === 0
    && !d.shape && !d.you && !d.role && !d.house
    && Object.keys(d.cals || {}).length === 0
    && !d.wa && !d.rem;
}

export function loadDraft() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyDraft();
    const { ts, d } = JSON.parse(raw);
    if (!ts || Date.now() - ts > TTL_MS) { clearDraft(); return emptyDraft(); }
    return { ...emptyDraft(), ...d };
  } catch {
    return emptyDraft(); // private mode / corrupt JSON - start clean
  }
}

export function saveDraft(d) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ts: Date.now(), d }));
  } catch { /* private mode - the flow still works, it just won't survive a kill */ }
}

export function clearDraft() {
  try { localStorage.removeItem(KEY); } catch { /* no-op */ }
  clearCalUrls();
}

/**
 * The recap on the sign-up screen lists ONLY completed steps - never skipped
 * ones as "Add later", which would read as a report card of failures right
 * before the ask. Returns [{ key, icon, label, value }] in spec order.
 */
export function completedRecap(d) {
  const rows = [];
  if (d.house) rows.push({ key: 'house', icon: '🏡', label: 'Household', value: d.house });
  if (d.you) {
    rows.push({
      key: 'you', icon: '💜', label: 'You',
      value: d.role ? `${d.you} · ${d.role}` : d.you,
    });
  }
  const calCount = Object.keys(d.cals || {}).length;
  if (calCount > 0) {
    rows.push({
      key: 'cals', icon: '📅', label: 'Calendars',
      value: `${calCount} connected`,
    });
  }
  if (d.wa) rows.push({ key: 'wa', icon: '💬', label: 'WhatsApp', value: 'Connected' });
  if (d.rem) rows.push({ key: 'rem', icon: '🔔', label: 'Nudges', value: 'On' });
  return rows;
}
