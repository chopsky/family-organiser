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
const LEAD_MS = 60 * 60 * 1000;

function isIos() {
  try { return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios'; } catch { return false; }
}

/**
 * Reconcile the Live Activity against the widget payload (buildWidgetPayload
 * output). Starts, updates or ends as needed. Never throws.
 */
export async function syncLiveActivity(payload) {
  if (!isIos()) return;
  try {
    const now = Date.now();
    const next = (payload?.events || [])
      .filter((e) => !e.allDay && e.start)
      .map((e) => ({ ...e, startMs: Date.parse(e.start), endMs: e.end ? Date.parse(e.end) : Date.parse(e.start) + 60 * 60000 }))
      .filter((e) => e.endMs > now)
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
