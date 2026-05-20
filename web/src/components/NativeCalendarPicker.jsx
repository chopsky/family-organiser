/**
 * NativeCalendarPicker — Settings subsection that lets the user grant
 * Calendar permission and pick which of their device's calendars to
 * show inside Housemait's own Calendar view.
 *
 * Renders nothing on web/Android — the underlying EventKit plugin
 * only exists on native iOS.
 *
 * State machine:
 *   not_determined  → "Use my iPhone's Calendar" button
 *   denied          → recovery copy pointing to iOS Settings
 *   granted         → list of calendars with toggles (all OFF by
 *                     default — user opts in)
 *
 * Selection is persisted via native-calendar-selection.js, a shared
 * pub-sub so Calendar.jsx's useNativeCalendarEvents picks up
 * changes in the same tab immediately.
 */

import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { nativeCalendar } from '../lib/native-calendar';
import {
  getSelectedCalendarIds,
  setSelectedCalendarIds,
  subscribeToSelection,
} from '../lib/native-calendar-selection';

// Deep-link to iOS's per-app Settings → Privacy panel. iOS exposes
// the well-known "app-settings:" URL for this; the app handler picks
// it up via UIApplication.shared.open. We route through Capacitor's
// Browser-style open so it works inside the WebView.
async function openIosAppSettings() {
  try {
    const { App } = await import('@capacitor/app');
    if (App.openUrl) {
      await App.openUrl({ url: 'app-settings:' });
      return;
    }
  } catch { /* fall through */ }
  // Fallback: plain href — iOS treats app-settings: as a registered
  // scheme inside a WKWebView's navigation policy decider.
  try { window.location.href = 'app-settings:'; } catch { /* ignore */ }
}

export default function NativeCalendarPicker() {
  const [status, setStatus] = useState('not_determined');
  const [calendars, setCalendars] = useState([]);
  const [selected, setSelected] = useState(() => getSelectedCalendarIds());
  const [busy, setBusy] = useState(false);

  // Re-read whenever selection changes anywhere (e.g. the hook
  // reloads localStorage on app foreground).
  useEffect(() => subscribeToSelection((ids) => setSelected(ids)), []);

  // Mount: get current permission status. Don't auto-prompt — user
  // taps the button so the grant is an explicit choice.
  useEffect(() => {
    if (!nativeCalendar.isAvailable()) return;
    let cancelled = false;
    nativeCalendar.getAuthorizationStatus().then((s) => {
      if (cancelled) return;
      setStatus(s);
      if (s === 'granted') loadCalendars();
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadCalendars() {
    const cals = await nativeCalendar.listCalendars();
    setCalendars(cals);
    // Do NOT auto-select any calendars on first grant. The user
    // explicitly opts in per-calendar — avoids surprise duplicates
    // with calendars they've already subscribed to via iCal URL,
    // and is friendlier when work calendars are involved.
  }

  async function handleGrant() {
    setBusy(true);
    try {
      const result = await nativeCalendar.requestAccess();
      setStatus(result);
      if (result === 'granted') await loadCalendars();
    } finally {
      setBusy(false);
    }
  }

  function toggle(id) {
    const next = selected.includes(id)
      ? selected.filter((x) => x !== id)
      : [...selected, id];
    setSelectedCalendarIds(next);
  }

  if (!nativeCalendar.isAvailable()) return null;

  return (
    <div>
      <h3 className="text-sm font-semibold text-bark mb-1">iPhone Calendar</h3>
      <p className="text-xs text-cocoa mb-3">
        Show your personal calendars from this iPhone (Apple, Google, Outlook — anything you&apos;ve added to iOS Calendar). Visible only to you on this device. Read-only.
      </p>
      <p className="text-xs text-cocoa mb-3" style={{ fontStyle: 'italic' }}>
        Heads-up: if you&apos;ve already added a calendar in &ldquo;Subscribed calendars&rdquo; below, don&apos;t enable it here too — you&apos;ll see duplicates.
      </p>

      {status === 'not_determined' && (
        <button
          type="button"
          onClick={handleGrant}
          disabled={busy}
          className="bg-primary hover:bg-primary-pressed disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-2xl transition-colors"
        >
          {busy ? 'Asking…' : "Use my iPhone's Calendar"}
        </button>
      )}

      {status === 'denied' && (
        <div className="space-y-3">
          <p className="text-sm text-cocoa">
            Calendar access is turned off for Housemait. Tap the button below to open iOS Settings and switch it on — then return here.
          </p>
          {Capacitor.isNativePlatform() && (
            <button
              type="button"
              onClick={openIosAppSettings}
              className="bg-primary hover:bg-primary-pressed text-white text-sm font-medium px-4 py-2 rounded-2xl transition-colors"
            >
              Open iOS Settings
            </button>
          )}
          <p className="text-xs text-cocoa">
            Or do it manually: <span className="font-medium text-bark">Settings → Privacy &amp; Security → Calendars → Housemait → Full Access</span>.
          </p>
          <button
            type="button"
            onClick={handleGrant}
            className="text-xs text-primary hover:underline"
          >
            I&apos;ve enabled it — re-check
          </button>
        </div>
      )}

      {status === 'granted' && (
        <>
          {calendars.length === 0 ? (
            <p className="text-xs text-cocoa">No calendars found on this device.</p>
          ) : (
            <>
              <p className="text-xs text-cocoa mb-2">
                Pick which calendars to show. All off by default — turn on only the ones you want in Housemait.
              </p>
              <div className="space-y-1">
                {calendars.map((cal) => {
                  const isOn = selected.includes(cal.id);
                  return (
                    <button
                      key={cal.id}
                      type="button"
                      onClick={() => toggle(cal.id)}
                      className="w-full flex items-center justify-between py-2 px-1 hover:bg-oat rounded-lg transition-colors"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="w-3 h-3 rounded-full shrink-0"
                          style={{ backgroundColor: cal.color || '#999' }}
                          aria-hidden="true"
                        />
                        <div className="min-w-0 text-left">
                          <p className="text-sm font-medium text-bark truncate">{cal.name}</p>
                          {cal.type && <p className="text-[11px] text-cocoa truncate">{cal.type}</p>}
                        </div>
                      </div>
                      <div
                        className={`relative shrink-0 ml-3 w-11 h-6 rounded-full transition-colors duration-200 ${
                          isOn ? 'bg-primary' : 'bg-sand'
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${
                            isOn ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
