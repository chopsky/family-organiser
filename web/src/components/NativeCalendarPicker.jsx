/**
 * NativeCalendarPicker — Settings subsection that lets the user grant
 * Calendar permission and pick which of their device's calendars to
 * show inside Housemait's own Calendar view.
 *
 * Renders nothing on web/Android — the underlying EventKit plugin
 * only exists on native iOS. Keeping the conditional inside the
 * component (rather than at the call site) means Settings.jsx
 * doesn't have to know whether the feature is available; it just
 * mounts the picker.
 *
 * State machine:
 *   not_determined  → "Use my iPhone's Calendar" button
 *   denied          → recovery copy pointing to iOS Settings
 *   granted         → list of calendars with toggles
 */

import { useEffect, useState } from 'react';
import { nativeCalendar } from '../lib/native-calendar';

const SELECTED_CALENDARS_KEY = 'housemait-native-calendars';

function readSelected() {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(SELECTED_CALENDARS_KEY) : null;
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeSelected(ids) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SELECTED_CALENDARS_KEY, JSON.stringify(ids));
    }
  } catch { /* ignore */ }
}

export default function NativeCalendarPicker() {
  const [status, setStatus] = useState('not_determined');
  const [calendars, setCalendars] = useState([]);
  const [selected, setSelected] = useState(() => readSelected() ?? null);
  const [busy, setBusy] = useState(false);

  // Mount: get current permission status. We don't auto-prompt — the
  // user has to tap the button so it's an explicit choice.
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
    // First time after a grant: default to all calendars selected
    // EXCEPT birthdays (noisy) and subscribed (often public holidays
    // we already render via our own term-dates).
    if (selected === null) {
      const defaults = cals
        .filter((c) => c.type !== 'Birthdays' && c.type !== 'Subscribed')
        .map((c) => c.id);
      setSelected(defaults);
      writeSelected(defaults);
    }
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
    const current = selected || [];
    const next = current.includes(id)
      ? current.filter((x) => x !== id)
      : [...current, id];
    setSelected(next);
    writeSelected(next);
  }

  if (!nativeCalendar.isAvailable()) return null;

  return (
    <div>
      <h3 className="text-sm font-semibold text-bark mb-1">iPhone Calendar</h3>
      <p className="text-xs text-cocoa mb-3">
        Show events from your phone&apos;s Calendar app inside Housemait. Read-only — edits happen in Apple Calendar.
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
        <div className="text-xs text-cocoa space-y-2">
          <p>Calendar access is off. To enable it:</p>
          <p className="font-medium text-bark">iOS Settings → Privacy &amp; Security → Calendars → Housemait → Full Access.</p>
          <button
            type="button"
            onClick={handleGrant}
            className="mt-2 text-primary hover:underline"
          >
            Re-check
          </button>
        </div>
      )}

      {status === 'granted' && (
        <>
          {calendars.length === 0 ? (
            <p className="text-xs text-cocoa">No calendars found on this device.</p>
          ) : (
            <div className="space-y-1">
              {calendars.map((cal) => {
                const isOn = (selected || []).includes(cal.id);
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
          )}
        </>
      )}
    </div>
  );
}
