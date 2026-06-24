import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../lib/api';

/**
 * Google Calendar (2020) logo, drawn inline to match the ProviderLogo glyphs
 * elsewhere in Connect Calendars.
 */
function GoogleCalIcon({ size = 26 }) {
  const s = { width: size, height: size, flexShrink: 0 };
  return (
    <svg viewBox="0 0 24 24" style={s} aria-hidden="true">
      <defs>
        <clipPath id="gcal-connect-card"><rect x="1.5" y="1.5" width="21" height="21" rx="3.5" /></clipPath>
      </defs>
      <g clipPath="url(#gcal-connect-card)">
        <rect x="1.5" y="1.5" width="10.5" height="10.5" fill="#4285F4" />
        <rect x="12" y="1.5" width="10.5" height="10.5" fill="#EA4335" />
        <rect x="1.5" y="12" width="10.5" height="10.5" fill="#34A853" />
        <rect x="12" y="12" width="10.5" height="10.5" fill="#FBBC04" />
      </g>
      <rect x="3.3" y="3.3" width="17.4" height="17.4" rx="1.6" fill="#fff" />
      <text x="12" y="16.2" textAnchor="middle" fontSize="8.4" fontWeight="700" fill="#4285F4" fontFamily="Arial, sans-serif">31</text>
    </svg>
  );
}

/**
 * "Connect Google Calendar" card for Settings → Connect Calendars → Import.
 *
 * Read-only OAuth inbound: signing in lets Housemait PULL events from chosen
 * Google calendars; nothing in Google is ever changed. The whole card stays
 * hidden unless the backend reports the feature enabled
 * (GOOGLE_CALENDAR_ENABLED), so it's invisible until the founder flips the flag.
 *
 * States: not-connected → Connect button (full-page redirect to Google's
 * consent screen). Connected → account email + a per-calendar checkbox picker
 * (Save / Disconnect). needs_reconnect → a Reconnect prompt.
 *
 * onChange() is called after a successful save/disconnect so the parent can
 * refresh its external-feeds list (Google calendars show up there as feeds).
 */
export default function GoogleCalendarConnect({ onChange }) {
  const [status, setStatus] = useState(null);      // null while loading
  const [calendars, setCalendars] = useState(null); // null until the picker opens
  const [selected, setSelected] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const justConnected = useRef(false);

  const loadStatus = useCallback(async () => {
    try {
      const { data } = await api.get('/calendar/google/status');
      setStatus(data);
      return data;
    } catch {
      setStatus({ enabled: false });
      return { enabled: false };
    }
  }, []);

  const loadCalendars = useCallback(async () => {
    setError('');
    setBusy(true);
    try {
      const { data } = await api.get('/calendar/google/calendars');
      setCalendars(data.calendars || []);
      setSelected(new Set((data.calendars || []).filter((c) => c.selected).map((c) => c.id)));
      setPicking(true);
    } catch (err) {
      if (err?.response?.status === 409) {
        // Token revoked / never completed - reflect that and prompt reconnect.
        setStatus((s) => ({ ...(s || {}), connected: true, status: 'needs_reconnect' }));
      } else {
        setError('Could not load your Google calendars. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  }, []);

  // Initial status load + handle the post-consent redirect (?google=connected).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get('google');
    if (result === 'connected') {
      justConnected.current = true;
      setNotice('Google account connected — choose which calendars to import.');
    } else if (result === 'error') {
      setError(`Couldn't connect Google Calendar${params.get('reason') ? ` (${params.get('reason')})` : ''}. Please try again.`);
    }
    // Strip our own params so a refresh doesn't re-fire the toast (keep the rest,
    // e.g. ?section=calendars, so the section stays open).
    if (params.has('google')) {
      params.delete('google');
      params.delete('reason');
      const qs = params.toString();
      window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''));
    }
    loadStatus().then((s) => {
      if (justConnected.current && s?.connected && s.status !== 'needs_reconnect') loadCalendars();
    });
  }, [loadStatus, loadCalendars]);

  if (!status) return null;                 // still loading - stay quiet
  if (!status.enabled) return null;         // feature flag off - render nothing

  const connect = async () => {
    setError('');
    setBusy(true);
    try {
      const { data } = await api.get('/calendar/connect/google');
      if (data?.url) window.location.href = data.url;
      else { setError('Could not start Google sign-in.'); setBusy(false); }
    } catch {
      setError('Could not start Google sign-in. Please try again.');
      setBusy(false);
    }
  };

  const toggle = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const save = async () => {
    setError('');
    setBusy(true);
    try {
      const chosen = (calendars || []).filter((c) => selected.has(c.id)).map((c) => ({ id: c.id, summary: c.summary }));
      await api.post('/calendar/google/select', { calendars: chosen });
      setNotice(chosen.length ? `Importing ${chosen.length} calendar${chosen.length === 1 ? '' : 's'} from Google.` : 'No Google calendars selected.');
      setPicking(false);
      onChange?.();
    } catch {
      setError('Could not save your calendar selection. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!window.confirm('Disconnect Google Calendar? Events imported from it will be removed from Housemait. Your Google calendar itself is never changed.')) return;
    setError('');
    setBusy(true);
    try {
      await api.delete('/calendar/google/disconnect');
      setCalendars(null);
      setPicking(false);
      setSelected(new Set());
      setNotice('');
      await loadStatus();
      onChange?.();
    } catch {
      setError('Could not disconnect. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const connected = !!status.connected;
  const needsReconnect = status.status === 'needs_reconnect';

  return (
    <div className="bg-white border border-cream-border rounded-2xl p-4 mb-3">
      <div className="flex items-start gap-3">
        <GoogleCalIcon />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-bark">Google Calendar</p>
          {!connected && (
            <p className="text-[13px] text-cocoa mt-0.5">
              Sign in to import your Google calendars. Read-only — nothing in Google is ever changed.
            </p>
          )}
          {connected && status.email && (
            <p className="text-[13px] text-cocoa mt-0.5 truncate">{status.email}</p>
          )}
          {connected && !needsReconnect && Array.isArray(status.calendars) && status.calendars.length > 0 && !picking && (
            <p className="text-[12px] text-cocoa mt-0.5">
              Importing {status.calendars.length} calendar{status.calendars.length === 1 ? '' : 's'}.
            </p>
          )}
        </div>
        {!connected && (
          <button
            onClick={connect}
            disabled={busy}
            className="bg-primary hover:bg-primary-pressed disabled:bg-primary/50 text-white font-medium px-4 py-2 rounded-2xl text-sm whitespace-nowrap shrink-0 transition-colors"
          >
            {busy ? 'Connecting…' : 'Connect'}
          </button>
        )}
      </div>

      {error && <p className="text-[12px] text-error mt-2">{error}</p>}
      {notice && !error && <p className="text-[12px] text-success mt-2">{notice}</p>}

      {connected && needsReconnect && (
        <div className="mt-3 flex items-center justify-between gap-3 bg-amber/10 rounded-xl px-3 py-2">
          <p className="text-[12px] text-bark">Google asked us to reconnect — sign in again to keep these calendars syncing.</p>
          <button
            onClick={connect}
            disabled={busy}
            className="text-xs text-primary hover:text-primary-pressed font-medium whitespace-nowrap shrink-0"
          >
            Reconnect
          </button>
        </div>
      )}

      {connected && !needsReconnect && (
        <div className="mt-3">
          {!picking && (
            <div className="flex items-center gap-4">
              <button onClick={loadCalendars} disabled={busy} className="text-xs text-primary hover:text-primary-pressed font-medium">
                {busy ? 'Loading…' : 'Choose calendars'}
              </button>
              <button onClick={disconnect} disabled={busy} className="text-xs text-cocoa hover:text-error transition-colors">
                Disconnect
              </button>
            </div>
          )}

          {picking && calendars && (
            <div>
              {calendars.length === 0 ? (
                <p className="text-[13px] text-cocoa">No calendars found on this Google account.</p>
              ) : (
                <ul className="space-y-1.5 mb-3">
                  {calendars.map((c) => (
                    <li key={c.id}>
                      <label className="flex items-center gap-2.5 cursor-pointer py-1">
                        <input
                          type="checkbox"
                          checked={selected.has(c.id)}
                          onChange={() => toggle(c.id)}
                          className="w-4 h-4 rounded accent-primary shrink-0"
                        />
                        <span className="text-sm text-bark truncate">{c.summary}</span>
                        {c.primary && <span className="text-[10px] text-cocoa shrink-0">(main)</span>}
                      </label>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex items-center gap-3">
                <button
                  onClick={save}
                  disabled={busy}
                  className="bg-primary hover:bg-primary-pressed disabled:bg-primary/50 text-white font-medium px-4 py-2 rounded-2xl text-sm transition-colors"
                >
                  {busy ? 'Saving…' : 'Save'}
                </button>
                <button onClick={() => setPicking(false)} disabled={busy} className="text-xs text-cocoa hover:text-bark transition-colors">
                  Cancel
                </button>
                <button onClick={disconnect} disabled={busy} className="text-xs text-cocoa hover:text-error transition-colors ml-auto">
                  Disconnect
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
