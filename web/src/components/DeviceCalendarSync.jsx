/**
 * DeviceCalendarSync - "Connect your iPhone calendar" (EventKit, read-only).
 *
 * iOS app only. Flow: value explainer (so the one-shot OS permission prompt
 * isn't burned on a cold tap) → OS dialog → per-calendar picker → first sync.
 * Subscribed/Birthdays/Holidays calendars are default-off; Housemait's own
 * outbound feed never appears (echo-loop guard). Selection is stored on the
 * device; syncs run on save and every app-foreground.
 */

import { useState, useCallback } from 'react';
import api from '../lib/api';
import {
  isDeviceCalendarSupported,
  requestCalendarAccess,
  listDeviceCalendars,
  getSelectedCalendarIds,
  setSelectedCalendarIds,
  syncDeviceCalendars,
  getLastSyncAt,
  openAppSettings,
  MAX_CALENDARS,
} from '../lib/deviceCalendar';
import { useAppForegroundRefresh } from '../hooks/useAppForegroundRefresh';

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
  // Calendars the user explicitly ticked ON in this picker session. Only
  // these may resurrect a web-tombstoned link - a calendar that is merely
  // still-ticked (stale selection, first-run pre-tick) must not.
  const [userTicked, setUserTicked] = useState(() => new Set());
  const [error, setError] = useState('');
  const [savedNote, setSavedNote] = useState('');
  // URL-feed subscriptions the server detected as covering the SAME calendar
  // we now sync from this device - offered for one-tap removal so migrating
  // users don't have to figure out the old subscription is now redundant.
  const [overlaps, setOverlaps] = useState([]);

  // A useCallback (not a hoisted declaration) so the foreground re-check hook
  // below can reference it cleanly. Stable, empty deps: it only closes over
  // state setters and module imports.
  const loadCalendars = useCallback(async () => {
    try {
      const granted = await requestCalendarAccess();
      if (!granted) { setStage('denied'); return; }
      const list = await listDeviceCalendars();
      // Likely-wanted calendars first; subscribed/birthday/holiday noise last.
      list.sort((a, b) => (a.defaultOff === b.defaultOff ? a.title.localeCompare(b.title) : a.defaultOff ? 1 : -1));
      setCalendars(list);
      // Re-seed from storage each time the picker opens: a sync may have
      // pruned a web-tombstoned calendar from the stored selection since
      // mount, and stale component state would show it still ticked (and
      // write it back on Save). First run: pre-tick everything that isn't
      // default-off, up to the cap.
      setSelected(() => {
        const ids = getSelectedCalendarIds();
        if (ids.length > 0) return new Set(ids);
        return new Set(list.filter((c) => !c.defaultOff).slice(0, MAX_CALENDARS).map((c) => c.id));
      });
      setUserTicked(new Set()); // fresh picker session - no explicit ticks yet
      setStage('picking');
    } catch {
      setError('Could not read the device calendars.');
    }
  }, []);

  // If the user left to flip the permission in Settings, re-check when they
  // come back so they don't have to tap "Try again". Both the callback and the
  // hook sit above the platform early-return to keep hook order stable.
  useAppForegroundRefresh(() => {
    if (stage === 'denied') loadCalendars();
  }, { throttleMs: 0 });

  if (!isDeviceCalendarSupported()) return null;

  async function handleSave() {
    setStage('syncing');
    setError('');
    try {
      setSelectedCalendarIds([...selected]);
      // Only calendars the user deliberately ticked in THIS session may
      // resurrect a web-tombstoned link; still-ticked leftovers may not.
      const results = await syncDeviceCalendars({ reenableIds: [...userTicked].filter((id) => selected.has(id)) });
      const found = new Map();
      for (const r of results || []) {
        for (const f of r?.overlappingFeeds || []) found.set(f.id, f);
      }
      setOverlaps([...found.values()]);
      setSavedNote('Synced. Your selected calendars stay up to date automatically.');
      setStage(selected.size > 0 ? 'summary' : 'intro');
      onSynced?.();
    } catch (err) {
      setError(err.response?.data?.error || 'Sync failed. Please try again.');
      setStage('picking');
    }
  }

  const toggle = (id) => {
    const turningOn = !selected.has(id);
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
    setUserTicked((prev) => {
      const next = new Set(prev);
      turningOn ? next.add(id) : next.delete(id);
      return next;
    });
  };

  return (
    <div className="border border-cream-border rounded-2xl p-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-bark">Bring your events into Housemait</h3>
        <p className="text-xs text-cocoa mt-1">
          Events from your iPhone&apos;s calendars — iCloud, Google, Outlook — appear in the family calendar. No URLs, no setup.
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

      {/* Migration prompt: the old copy-a-URL subscription now duplicates a
          device-synced calendar. One tap retires it; the device sync
          re-supplies any events the old feed was credited with. */}
      {overlaps.length > 0 && (
        <div className="bg-amber/10 border border-amber/30 rounded-xl px-3 py-2 space-y-2">
          <p className="text-xs text-bark">
            💡 You&apos;re also subscribed to {overlaps.length === 1 ? 'a calendar' : 'calendars'} by link that your iPhone now syncs directly — keeping both shows duplicates.
          </p>
          {overlaps.map((f) => (
            <div key={f.id} className="flex items-center justify-between gap-2">
              <span className="text-xs text-cocoa truncate">{f.displayName}</span>
              <button
                onClick={async () => {
                  try {
                    await api.delete(`/calendar/external-feeds/${f.id}`);
                    setOverlaps((prev) => prev.filter((o) => o.id !== f.id));
                    onSynced?.();
                  } catch {
                    setError('Could not remove the old subscription.');
                  }
                }}
                className="text-xs font-semibold text-primary hover:text-primary-pressed shrink-0"
              >
                Remove old subscription
              </button>
            </div>
          ))}
        </div>
      )}

      {stage === 'denied' && (
        <div className="space-y-2.5 bg-coral/10 rounded-xl px-3 py-3">
          <p className="text-xs text-cocoa">
            Calendar access is off for Housemait. Turn on <strong>Calendars</strong> in Settings, then come back — your events will appear automatically.
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => openAppSettings()}
              className="bg-primary hover:bg-primary-pressed text-white text-xs font-semibold px-3 py-2 rounded-xl transition-colors"
            >
              Open Settings
            </button>
            <button
              onClick={loadCalendars}
              className="text-xs font-semibold text-primary hover:text-primary-pressed px-2 py-2"
            >
              Try again
            </button>
          </div>
        </div>
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
              <span className="flex-1 min-w-0 truncate">
                <span className="text-sm text-bark">{c.title}</span>
                {/* Account subtitle - two calendars can share a name (e.g. an
                    iCloud "Family" and a Google "Family"); the source account
                    is what tells them apart. */}
                {c.sourceTitle && <span className="text-[11px] text-warm-grey"> · {c.sourceTitle}</span>}
              </span>
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
