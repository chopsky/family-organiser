/**
 * Home-screen widgets (iOS): hand the widget extension today's events.
 *
 * The extension can't call the API, so whenever the dashboard digest
 * loads we serialise today's events - already deduped and filtered the
 * way the dashboard shows them - into the shared App Group via the
 * WidgetBridge plugin (web/ios/App/App/WidgetBridgePlugin.swift), which
 * also asks WidgetKit to redraw. Payload shape mirrors WidgetData.swift.
 *
 * Web and Android: no-op (Android widgets are a separate project).
 */
import { Capacitor, registerPlugin } from '@capacitor/core';
import { hexFor } from './memberColors';

const WidgetBridge = registerPlugin('WidgetBridge');

function isIos() {
  try { return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios'; } catch { return false; }
}

const ymdLocal = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** "Mason" / "Mason & Logan" / "Mason, Logan & 1 more" - the widget's who-line. */
function whoLabel(members) {
  const names = (members || []).map((m) => m?.name).filter(Boolean);
  if (names.length === 0) return null;
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  return `${names[0]}, ${names[1]} & ${names.length - 2} more`;
}

/**
 * Build the widget payload from the dashboard's data.
 * @param {object[]} todayEvents  digest.todayEvents (server-shaped rows)
 * @param {(ev) => object[]} membersFor  resolves an event's members (the
 *   dashboard's getMembersForEvent) - keeps colour/name logic in one place
 * @param {string} householdName
 */
export function buildWidgetPayload(todayEvents, membersFor, householdName) {
  const events = (todayEvents || []).map((ev, i) => {
    const members = membersFor ? (membersFor(ev) || []) : [];
    const primary = members[0] || null;
    return {
      id: String(ev.id || ev.occurrence_key || i),
      title: ev.title || 'Event',
      start: ev.start_time ? new Date(ev.start_time).toISOString() : null,
      end: ev.end_time ? new Date(ev.end_time).toISOString() : null,
      allDay: Boolean(ev.all_day),
      location: ev.location || null,
      color: primary ? hexFor(primary) : '#6B3FA0',
      who: whoLabel(members),
    };
  });
  return {
    generatedAt: new Date().toISOString(),
    dateYmd: ymdLocal(),
    householdName: householdName || null,
    events,
  };
}

/** Push a built payload to the widgets. Fire-and-forget; never throws. */
export async function syncWidgets(payload) {
  if (!isIos() || !payload) return;
  try {
    await WidgetBridge.setToday({ json: JSON.stringify(payload) });
  } catch (err) {
    console.warn('[widgets] sync failed:', err?.message || err);
  }
}

/** On sign-out: the widgets must not keep showing a family's day. */
export async function clearWidgets() {
  if (!isIos()) return;
  try { await WidgetBridge.clear(); } catch { /* no-op */ }
}
