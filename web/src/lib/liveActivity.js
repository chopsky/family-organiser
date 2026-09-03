/**
 * "Next up" Live Activity (iOS 16.1+): the family's next event counting
 * down on the Lock Screen and in the Dynamic Island.
 *
 * Policy, decided here rather than in Swift so it can evolve without a
 * native release: an activity runs when the next timed event starts
 * within the next LEAD_MS, and ends once that event is over. Called from
 * the dashboard whenever its digest loads (and on every foreground), so
 * the activity tracks the day without any background machinery. Android
 * and web: no-op.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';

const LiveActivity = registerPlugin('LiveActivity');
// 30 minutes, matching the activity reminders: a countdown to leaving,
// not an hour of Dynamic Island occupancy (was 60).
const LEAD_MS = 30 * 60 * 1000;
// Per-device switch (Settings > Next up in the Dynamic Island). Live
// Activities are a device thing, so this stays local rather than a
// household preference.
const PREF_KEY = 'housemait_next_up_activity';
export function nextUpEnabled() {
  try { return localStorage.getItem(PREF_KEY) !== 'off'; } catch { return true; }
}
export function setNextUpEnabled(on) {
  try { localStorage.setItem(PREF_KEY, on ? 'on' : 'off'); } catch { /* private mode */ }
  if (!on) endLiveActivity();
}
// Is this event the user's business? Assigned to them, or unassigned AND
// created in Housemait (household-wide by convention). An unassigned event
// that came in from a synced calendar is nobody-in-particular's: a
// holiday-camp booking on a third-party calendar sat in the founder's
// Dynamic Island though it had nothing to do with him (3 Sep).
function relevantTo(e, userId) {
  const ids = e.memberIds || [];
  if (ids.length > 0) return Boolean(userId) && ids.includes(userId);
  return !e.synced;
}
// The countdown's job is over once the event has begun. It lingers this
// long as "Now" so a glance at the island still says what just started,
// then the next sync ends it - a four-hour holiday camp must not sit in
// the Dynamic Island as "Now" all afternoon (founder, 3 Sep).
const GRACE_MS = 10 * 60 * 1000;

function isIos() {
  try { return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios'; } catch { return false; }
}

/**
 * Reconcile the Live Activity against the widget payload (buildWidgetPayload
 * output). Starts, updates or ends as needed. Never throws.
 */
export async function syncLiveActivity(payload, { userId = null } = {}) {
  if (!isIos()) return;
  try {
    const now = Date.now();
    if (!nextUpEnabled()) { await LiveActivity.end(); return; }
    const next = (payload?.events || [])
      .filter((e) => !e.allDay && e.start && relevantTo(e, userId))
      .map((e) => ({ ...e, startMs: Date.parse(e.start), endMs: e.end ? Date.parse(e.end) : Date.parse(e.start) + 60 * 60000 }))
      .filter((e) => e.startMs + GRACE_MS > now)
      .sort((a, b) => a.startMs - b.startMs)[0];

    if (!next || next.startMs - now > LEAD_MS) {
      await LiveActivity.end();
      return;
    }
    const fields = {
      title: next.title,
      start: new Date(next.startMs).toISOString(),
      end: new Date(next.endMs).toISOString(),
      location: next.location || null,
      color: next.color || '#6B3FA0',
      who: next.who || null,
      householdName: payload?.householdName || 'Housemait',
    };
    // update() is a no-op with zero activities; start() retires any old
    // one first - so "update, then start if nothing was updated" keeps
    // exactly one activity alive without the JS side tracking ids.
    const res = await LiveActivity.update(fields);
    if (res?.supported === false) return;
    if (!res?.updated) await LiveActivity.start(fields);
  } catch (err) {
    console.warn('[live-activity] sync failed:', err?.message || err);
  }
}

export async function endLiveActivity() {
  if (!isIos()) return;
  try { await LiveActivity.end(); } catch { /* no-op */ }
}
