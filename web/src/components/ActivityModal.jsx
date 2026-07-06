import { useEffect, useState } from 'react';
import api from '../lib/api';

/**
 * ActivityModal - add/edit form for a child's weekly extracurricular
 * activity (child_weekly_schedule). Extracted from FamilySetup so the
 * Calendar's activity sheet (and its "Extracurricular" create flow) can
 * open the exact same form; visuals are unchanged from the FamilySetup
 * original.
 *
 * Self-contained: owns its form state, loads the child's school terms for
 * the term selector (add mode only - edits keep their existing window),
 * and performs the POST/PATCH/DELETE + un-skip calls itself.
 *
 * Props:
 *   child        - { id, name } the activity belongs to. May be null in ADD
 *                  mode when childOptions is provided (the modal then shows
 *                  a child selector - the Calendar's "new extracurricular"
 *                  path, where no child is implied yet).
 *   childOptions - dependents to choose from when `child` is null
 *   members      - household members for the pickup selector
 *   activity     - existing activity row (edit mode) or null (add mode).
 *                  In edit mode its `skips` array renders as removable
 *                  "skipped date" chips (upcoming dates only).
 *   presetDay    - 0-6 (Mon-Sun) initial weekday for ADD mode (e.g. the
 *                  calendar cell the user started from)
 *   onClose      - dismiss without necessarily saving
 *   onChanged    - fired after any successful write (save / delete /
 *                  un-skip) so the caller can refresh its data
 */
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const todayYmd = () => new Date().toLocaleDateString('en-CA'); // local YYYY-MM-DD

// "2026-07-06" → "Mon 6 Jul" for the skipped-date chips.
function fmtSkipDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

export default function ActivityModal({ child = null, childOptions = [], members = [], activity = null, presetDay = 0, onClose, onChanged }) {
  const editing = !!activity;
  // Fixed child (Family page / edit) or picked from childOptions (the
  // Calendar's create path). All child-dependent logic uses `kid`.
  const [childSelId, setChildSelId] = useState(child?.id || childOptions[0]?.id || '');
  const kid = child || childOptions.find((c) => c.id === childSelId) || null;
  const [day, setDay] = useState(editing ? (activity.day_of_week ?? 0) : presetDay);
  const [name, setName] = useState(editing ? (activity.activity || '') : '');
  const [timeStart, setTimeStart] = useState(editing && activity.time_start ? activity.time_start.substring(0, 5) : '');
  const [timeEnd, setTimeEnd] = useState(editing && activity.time_end ? activity.time_end.substring(0, 5) : '');
  const [pickup, setPickup] = useState(editing ? (activity.pickup_member_id || '') : '');
  const [onCalendar, setOnCalendar] = useState(editing ? activity.show_on_calendar !== false : true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // Upcoming skipped dates (edit mode) - removable chips. Past skips are
  // history, not something to manage, so they stay hidden.
  const [skips, setSkips] = useState(() =>
    editing ? (activity.skips || []).filter((d) => d >= todayYmd()) : []);

  // Term selector (add mode only): the child's real school terms, with
  // "Ongoing" and "Custom dates" fallbacks. Edits keep their window.
  const [terms, setTerms] = useState([]);
  const [termsLoading, setTermsLoading] = useState(false);
  const [termKey, setTermKey] = useState('ongoing');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  useEffect(() => {
    if (editing || !kid?.id) return;
    let cancelled = false;
    setTermsLoading(true);
    api.get(`/schools/terms/${kid.id}`)
      .then(({ data }) => {
        if (cancelled) return;
        const t = data.terms || [];
        setTerms(t);
        const today = todayYmd();
        const cur = t.find((x) => today >= x.start_date && today <= x.end_date);
        setTermKey(cur ? cur.start_date : 'ongoing');
      })
      .catch(() => { if (!cancelled) { setTerms([]); setTermKey('ongoing'); } })
      .finally(() => { if (!cancelled) setTermsLoading(false); });
    return () => { cancelled = true; };
  }, [editing, kid?.id]);

  async function handleSave() {
    if (!name.trim() || !kid) return;
    setSaving(true);
    setError('');
    try {
      const body = {
        day_of_week: day,
        activity: name.trim(),
        time_start: timeStart || null,
        time_end: timeEnd || null,
        pickup_member_id: pickup || null,
        show_on_calendar: onCalendar,
      };
      // New activities inherit the selected term's window so they only show
      // that term (and next term can be prepared without touching this one).
      // Edits preserve the activity's existing window (the grid selector is a
      // view control, not a per-activity move).
      if (!editing) {
        const termObj = terms.find((t) => t.start_date === termKey) || null;
        if (termKey === 'custom') {
          Object.assign(body, { start_date: customStart || null, end_date: customEnd || null, term_label: null });
        } else if (termObj) {
          Object.assign(body, { start_date: termObj.start_date, end_date: termObj.end_date, term_label: termObj.label });
        } else {
          Object.assign(body, { start_date: null, end_date: null, term_label: null });
        }
      }
      if (editing) {
        await api.patch(`/schools/activities/${activity.id}`, body);
      } else {
        await api.post('/schools/activities', { ...body, child_id: kid.id });
      }
      onChanged?.();
      onClose?.();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save activity.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!editing) return;
    setSaving(true);
    setError('');
    try {
      await api.delete(`/schools/activities/${activity.id}`);
      onChanged?.();
      onClose?.();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not remove activity.');
      setSaving(false);
    }
  }

  async function handleUnskip(dateStr) {
    try {
      await api.delete(`/schools/activities/${activity.id}/skips/${dateStr}`);
      setSkips((prev) => prev.filter((d) => d !== dateStr));
      onChanged?.();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not restore that date.');
    }
  }

  if (!kid) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative bg-linen rounded-2xl shadow-lg border border-cream-border p-5 sm:p-6 w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base md:text-medium font-semibold text-bark">{editing ? 'Edit activity' : 'Add activity'}</h2>
          <button onClick={onClose} className="text-cocoa hover:text-bark p-1">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
        {!child && childOptions.length > 0 ? (
          <div className="flex items-center gap-2 mb-4">
            <label className="text-xs text-cocoa">For:</label>
            <select value={childSelId} onChange={(e) => setChildSelId(e.target.value)} className="border border-cream-border rounded-lg px-2 py-1.5 text-sm bg-white">
              {childOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        ) : (
          <p className="text-xs text-cocoa mb-4">For {kid.name}</p>
        )}

        <div className="space-y-3">
          <div className="flex gap-2">
            <select value={day} onChange={(e) => setDay(Number(e.target.value))} className="border border-cream-border rounded-lg px-2 py-2 text-sm bg-white">
              {DAY_LABELS.map((d, i) => <option key={i} value={i}>{d}</option>)}
            </select>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Swimming" className="flex-1 border border-cream-border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent" autoFocus />
          </div>
          <div className="flex gap-2 items-center flex-wrap">
            <label className="text-xs text-cocoa">Starts at:</label>
            <input type="time" value={timeStart} onChange={(e) => setTimeStart(e.target.value)} className="border border-cream-border rounded-lg px-2 py-1.5 text-sm bg-white" />
            <label className="text-xs text-cocoa">Ends at:</label>
            <input type="time" value={timeEnd} onChange={(e) => setTimeEnd(e.target.value)} className="border border-cream-border rounded-lg px-2 py-1.5 text-sm bg-white" />
          </div>

          {/* Term window applies only to NEW activities. Edits keep their
              existing window (the term concept is per-activity, not a move). */}
          {!editing && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <label className="text-xs text-cocoa font-medium">Term:</label>
                <select value={termKey} onChange={(e) => setTermKey(e.target.value)} className="border border-cream-border rounded-lg px-2 py-1.5 text-sm bg-white">
                  {terms.map((t) => <option key={t.start_date} value={t.start_date}>{t.label}</option>)}
                  <option value="ongoing">Ongoing (every term)</option>
                  <option value="custom">Custom dates…</option>
                </select>
                {termsLoading && <span className="text-[11px] text-cocoa">Loading…</span>}
              </div>
              {termKey === 'custom' ? (
                <div className="flex gap-2 items-center flex-wrap">
                  <label className="text-xs text-cocoa">Runs:</label>
                  <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="border border-cream-border rounded-lg px-2 py-1.5 text-sm bg-white" />
                  <span className="text-xs text-cocoa">to</span>
                  <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="border border-cream-border rounded-lg px-2 py-1.5 text-sm bg-white" />
                </div>
              ) : (
                <p className="text-[11px] text-cocoa">
                  {termKey === 'ongoing'
                    ? 'Will show every term, until you remove it.'
                    : `Will be set for ${(terms.find((t) => t.start_date === termKey)?.label) || 'this term'} only.`}
                </p>
              )}
            </div>
          )}

          <div className="flex gap-2 items-center">
            <label className="text-xs text-cocoa whitespace-nowrap">Pickup:</label>
            {/* Adults only - a child can't collect a child. */}
            <select value={pickup} onChange={(e) => setPickup(e.target.value)} className="flex-1 border border-cream-border rounded-lg px-2 py-1.5 text-sm bg-white">
              <option value="">No pickup set</option>
              {members.filter((m) => m.member_type !== 'dependent').map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>

          {/* Kids always see their activities in Child Mode; this toggle
              additionally surfaces them on the main adult calendar. */}
          <label className="flex gap-2 items-center text-xs text-cocoa cursor-pointer select-none">
            <input
              type="checkbox"
              checked={onCalendar}
              onChange={(e) => setOnCalendar(e.target.checked)}
              className="h-4 w-4 rounded border-cream-border accent-[var(--color-plum)]"
            />
            Show on the family calendar
          </label>

          {/* Upcoming skipped dates ("skip just this day" from the calendar
              or the AI). Removing a chip restores that occurrence. */}
          {editing && skips.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs text-cocoa font-medium">Skipped dates:</div>
              <div className="flex flex-wrap gap-1.5">
                {skips.map((d) => (
                  <span key={d} className="inline-flex items-center gap-1 rounded-full bg-white border border-cream-border px-2.5 py-1 text-xs text-bark">
                    {fmtSkipDate(d)}
                    <button
                      type="button"
                      onClick={() => handleUnskip(d)}
                      aria-label={`Restore ${fmtSkipDate(d)}`}
                      className="text-cocoa hover:text-coral leading-none"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {error && <p className="text-xs text-coral">{error}</p>}
        </div>

        <div className="flex items-center gap-2 mt-5">
          {editing && (
            <button
              onClick={handleDelete}
              disabled={saving}
              className="text-xs font-medium text-coral hover:text-coral/80 mr-auto disabled:opacity-50"
            >
              Delete
            </button>
          )}
          <button onClick={onClose} className="text-sm font-medium text-cocoa hover:text-bark px-4 py-2">Cancel</button>
          <button onClick={handleSave} disabled={saving || !name.trim()} className="text-sm font-semibold text-white bg-primary hover:bg-primary-pressed disabled:opacity-50 rounded-lg px-4 py-2">
            {saving ? 'Saving…' : (editing ? 'Save' : 'Add')}
          </button>
        </div>
      </div>
    </div>
  );
}
