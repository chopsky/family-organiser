/**
 * DeviceCalendarSync - "Connect your iPhone calendar" (EventKit, read-only).
 *
 * iOS app only. Flow: value explainer (so the one-shot OS permission prompt
 * isn't burned on a cold tap) → OS dialog → per-calendar picker → first sync.
 * Subscribed/Birthdays/Holidays calendars are default-off; Housemait's own
 * outbound feed never appears (echo-loop guard). Selection is stored on the
 * device; syncs run on save and every app-foreground.
 */

import { useEffect, useState } from 'react';
import {
  isDeviceCalendarSupported,
  requestCalendarAccess,
  listDeviceCalendars,
  getSelectedCalendarIds,
  setSelectedCalendarIds,
  syncDeviceCalendars,
  getLastSyncAt,
  MAX_CALENDARS,
} from '../lib/deviceCalendar';

function lastSyncLabel() {
  const iso = getLastSyncAt();
  if (!iso) return null;
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const d = new Date(iso);
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function DeviceCalendarSync({ onSynced }) {
  // intro | summary | denied | picking | syncing. Once configured, the
  // section is a ONE-LINE summary - the 15-row picker only appears on
  // "Manage" (it was permanently expanded before, dominating the page).
  const [stage, setStage] = useState(() => (getSelectedCalendarIds().length > 0 ? 'summary' : 'intro'));
  const [calendars, setCalendars] = useState([]);
  const [selected, setSelected] = useState(new Set(getSelectedCalendarIds()));
  const [error, setError] = useState('');
  const [savedNote, setSavedNote] = useState('');

  if (!isDeviceCalendarSupported()) return null;

  async function loadCalendars() {
    try {
      const granted = await requestCalendarAccess();
      if (!granted) { setStage('denied'); return; }
      const list = await listDeviceCalendars();
      // Likely-wanted calendars first; subscribed/birthday/holiday noise last.
      list.sort((a, b) => (a.defaultOff === b.defaultOff ? a.title.localeCompare(b.title) : a.defaultOff ? 1 : -1));
      setCalendars(list);
      // First run: pre-tick everything that isn't default-off, up to the cap.
      setSelected((prev) => {
        if (prev.size > 0) return prev;
        return new Set(list.filter((c) => !c.defaultOff).slice(0, MAX_CALENDARS).map((c) => c.id));
      });
      setStage('picking');
    } catch {
      setError('Could not read the device calendars.');
    }
  }

  async function handleSave() {
    setStage('syncing');
    setError('');
    try {
      setSelectedCalendarIds([...selected]);
      await syncDeviceCalendars();
      setSavedNote('Synced. Your selected calendars stay up to date automatically.');
      setStage(selected.size > 0 ? 'summary' : 'intro');
      onSynced?.();
    } catch (err) {
      setError(err.response?.data?.error || 'Sync failed. Please try again.');
      setStage('picking');
    }
  }

  const toggle = (id) => setSelected((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  return (
    <div className="border border-cream-border rounded-2xl p-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-bark">Connect your iPhone calendar</h3>
        <p className="text-xs text-cocoa mt-1">
          See your existing events inside Housemait — no URLs, no setup.
        </p>
      </div>

      {stage === 'intro' && (
        <div className="space-y-3">
          <ul className="text-xs text-cocoa space-y-1.5">
            <li>📅 Works with every calendar on your phone — iCloud, Google, Outlook.</li>
            <li>🔒 Read-only: Housemait can never change, add or delete anything in your calendars.</li>
            <li>👀 You choose exactly which calendars to share. Events become visible to your household.</li>
          </ul>
          <button
            onClick={loadCalendars}
            className="w-full bg-primary hover:bg-primary-pressed text-white font-medium px-4 py-3 rounded-2xl text-sm transition-colors"
          >
            Choose calendars
          </button>
        </div>
      )}

      {stage === 'summary' && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-cocoa">
            ✅ {getSelectedCalendarIds().length} calendar{getSelectedCalendarIds().length === 1 ? '' : 's'} syncing
            {lastSyncLabel() ? ` · last sync ${lastSyncLabel()}` : ''}
          </p>
          <button onClick={loadCalendars} className="text-xs font-semibold text-primary hover:text-primary-pressed shrink-0">
            Manage
          </button>
        </div>
      )}
      {stage === 'summary' && savedNote && (
        <p className="text-[11px] text-sage">{savedNote}</p>
      )}

      {stage === 'denied' && (
        <p className="text-xs text-cocoa bg-coral/10 rounded-xl px-3 py-2">
          Calendar access is off for Housemait. Enable it in iPhone Settings → Privacy &amp; Security → Calendars, then come back.
        </p>
      )}

      {(stage === 'picking' || stage === 'syncing') && (
        <div className="space-y-2">
          {selected.size >= MAX_CALENDARS && (
            <p className="text-[11px] text-warm-grey">Up to {MAX_CALENDARS} calendars can sync — untick one to choose another.</p>
          )}
          {calendars.map((c) => (
            <label key={c.id} className="flex items-center gap-2.5 py-1 cursor-pointer">
              <input
                type="checkbox"
                checked={selected.has(c.id)}
                onChange={() => toggle(c.id)}
                disabled={stage === 'syncing' || (!selected.has(c.id) && selected.size >= MAX_CALENDARS)}
                className="h-4 w-4 accent-[var(--plum)]"
              />
              <span className="w-3 h-3 rounded-full shrink-0" style={{ background: c.color || '#7DAE82' }} />
              <span className="flex-1 min-w-0 text-sm text-bark truncate">{c.title}</span>
              {c.defaultOff && (
                <span className="text-[10px] text-warm-grey shrink-0">
                  {c.type === 'subscription' ? 'subscribed feed' : c.type === 'birthday' ? 'birthdays' : 'holidays'}
                </span>
              )}
            </label>
          ))}
          <button
            onClick={handleSave}
            disabled={stage === 'syncing'}
            className="w-full bg-primary hover:bg-primary-pressed disabled:opacity-50 text-white font-medium px-4 py-3 rounded-2xl text-sm transition-colors"
          >
            {stage === 'syncing'
              ? 'Syncing…'
              : selected.size === 0
                ? 'Disconnect all calendars'
                : `Sync ${selected.size} calendar${selected.size === 1 ? '' : 's'}`}
          </button>
        </div>
      )}

      {error && <p className="text-xs text-coral">{error}</p>}
    </div>
  );
}
