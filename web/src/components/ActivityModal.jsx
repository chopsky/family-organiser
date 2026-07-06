import { useEffect, useState } from 'react';
import api from '../lib/api';
import Avatar from './ui/Avatar';

/**
 * ActivityModal - add/edit form for a child's weekly extracurricular
 * activity (child_weekly_schedule), shared by Family Setup and the
 * Calendar's activity sheet / create flow.
 *
 * Styled to the app's shared modal language (the Tasks/Rewards modals and
 * the Calendar create sheet): serif 22px heading, 12px/600 field labels,
 * white rounded-10 inputs, day-chip pills, avatar-ring child picker and a
 * right-aligned white-Cancel + solid-primary footer.
 *
 * Self-contained: owns its form state, loads the child's school terms for
 * the term selector (add mode only - edits keep their existing window),
 * and performs the POST/PATCH/DELETE + un-skip calls itself. ADD mode
 * supports MULTI-day selection (one schedule row per chosen weekday, the
 * same model as the Calendar create flow); EDIT mode moves the single row.
 *
 * Props:
 *   child        - { id, name } the activity belongs to. May be null in ADD
 *                  mode when childOptions is provided (the modal then shows
 *                  an avatar child picker).
 *   childOptions - dependents to choose from when `child` is null
 *   members      - household members for the pickup selector
 *   activity     - existing activity row (edit mode) or null (add mode).
 *                  In edit mode its `skips` / `overrides` render as
 *                  removable "one-off changes" chips (upcoming dates only).
 *   presetDay    - 0-6 (Mon-Sun) initial weekday for ADD mode (e.g. the
 *                  calendar cell the user started from)
 *   onClose      - dismiss without necessarily saving
 *   onChanged    - fired after any successful write (save / delete /
 *                  un-skip) so the caller can refresh its data
 */
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const todayYmd = () => new Date().toLocaleDateString('en-CA'); // local YYYY-MM-DD

// Shared modal tokens - mirrored from Chores.jsx / Calendar.jsx so every
// create/edit dialog reads as one family.
const M_INK = '#1A1620', M_INK2 = '#4A4453', M_INK3 = '#8A8493';
const M_LINE_STRONG = 'rgba(26,22,32,0.12)';
const M_BRAND = '#6C3DD9', M_BRAND_SOFT = '#EFE9FB';
const M_BG_SOFT = '#F3EEE5';
const M_SERIF = 'var(--font-serif-display)';
const mInput = { width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 10, border: `1px solid ${M_LINE_STRONG}`, fontSize: 14, color: M_INK, outline: 'none', background: '#fff', fontFamily: 'inherit' };

function Field({ label, right, children, style }) {
  return (
    <div style={{ marginBottom: 16, ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: M_INK2 }}>{label}</div>
        {right}
      </div>
      {children}
    </div>
  );
}

// "2026-07-06" → "Mon 6 Jul" for the one-off-change chips.
function fmtSkipDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

const COLOR_HEX = {
  red: '#E25555', 'burnt-orange': '#E07A3A', amber: '#E8A040', gold: '#C5A833',
  leaf: '#7BAE4E', emerald: '#3A9E6E', teal: '#3AADA0', sky: '#4A9FCC',
  cobalt: '#3A6FD4', indigo: '#6558C7', purple: '#9050B5', magenta: '#C74E95',
  rose: '#E06888', terracotta: '#C47A5E', moss: '#7C8A6E', slate: '#7A8694',
  sage: '#7DAE82', plum: '#6B3FA0', coral: '#E8724A', pink: '#D4537E',
  lavender: '#6558C7', orange: '#E8A040', blue: '#4A9FCC', green: '#7DAE82', gray: '#7A8694',
};
const hexFor = (m) => (m?.color_theme ? (COLOR_HEX[m.color_theme] || COLOR_HEX.sage) : COLOR_HEX.sage);

export default function ActivityModal({ child = null, childOptions = [], members = [], activity = null, presetDay = 0, onClose, onChanged }) {
  const editing = !!activity;
  // Fixed child (Family page / edit) or picked from childOptions (the
  // Calendar's create path). All child-dependent logic uses `kid`.
  const [childSelId, setChildSelId] = useState(child?.id || childOptions[0]?.id || '');
  const kid = child || childOptions.find((c) => c.id === childSelId) || null;
  // EDIT moves the one row; ADD creates one row per selected day.
  const [days, setDays] = useState(editing ? [activity.day_of_week ?? 0] : [presetDay]);
  const [name, setName] = useState(editing ? (activity.activity || '') : '');
  const [timeStart, setTimeStart] = useState(editing && activity.time_start ? activity.time_start.substring(0, 5) : '');
  const [timeEnd, setTimeEnd] = useState(editing && activity.time_end ? activity.time_end.substring(0, 5) : '');
  const [pickup, setPickup] = useState(editing ? (activity.pickup_member_id || '') : '');
  const [onCalendar, setOnCalendar] = useState(editing ? activity.show_on_calendar !== false : true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // Upcoming per-date exceptions (edit mode) - removable chips. Skips hide
  // a date; overrides give it a one-off time/pickup. Past dates are
  // history, not something to manage, so they stay hidden.
  const [skips, setSkips] = useState(() =>
    editing ? (activity.skips || []).filter((d) => d >= todayYmd()) : []);
  const [overrideDates, setOverrideDates] = useState(() =>
    editing ? Object.keys(activity.overrides || {}).filter((d) => d >= todayYmd()).sort() : []);

  // Term selector (add mode only): the child's real school terms, with
  // "Ongoing" and "Custom dates" fallbacks. Edits keep their window.
  const [terms, setTerms] = useState([]);
  const [termsLoading, setTermsLoading] = useState(false);
  const [termKey, setTermKey] = useState('ongoing');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  useEffect(() => {
    if (editing || !kid?.id) return undefined;
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
    if (!name.trim() || !kid || days.length === 0) return;
    setSaving(true);
    setError('');
    try {
      const body = {
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
        await api.patch(`/schools/activities/${activity.id}`, { ...body, day_of_week: days[0] });
      } else {
        for (const day of [...days].sort((a, b) => a - b)) {
          await api.post('/schools/activities', { ...body, day_of_week: day, child_id: kid.id });
        }
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
      setOverrideDates((prev) => prev.filter((d) => d !== dateStr));
      onChanged?.();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not restore that date.');
    }
  }

  if (!kid) return null;
  const disabled = saving || !name.trim() || days.length === 0;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative bg-white rounded-2xl shadow-lg p-5 sm:p-6 w-full max-w-md max-h-[90vh] overflow-y-auto" style={{ border: `1px solid ${M_LINE_STRONG}` }} onClick={(e) => e.stopPropagation()}>
        {/* Header - serif 22 + soft square close, matching the Calendar /
            Tasks / Rewards modals. */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h2 style={{ margin: 0, fontFamily: M_SERIF, fontSize: 22, fontWeight: 400, color: M_INK }}>
            {editing ? 'Edit activity' : 'Add activity'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{ width: 34, height: 34, borderRadius: 10, border: 0, background: M_BG_SOFT, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={M_INK2} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* Who's it for - avatar-ring picker when the caller lets the user
            choose; a fixed-child caption chip otherwise. */}
        {!child && childOptions.length > 0 ? (
          <Field label="Who's it for">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {childOptions.map((c) => {
                const on = childSelId === c.id;
                const hx = hexFor(c);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setChildSelId(c.id)}
                    title={c.name}
                    style={{ position: 'relative', border: on ? `2px solid ${hx}` : '2px solid transparent', borderRadius: '50%', padding: 1, background: 'transparent', cursor: 'pointer' }}
                  >
                    <Avatar member={c} size={50} bg="#fff" />
                    {on && (
                      <span style={{ position: 'absolute', right: -2, bottom: -2, width: 18, height: 18, borderRadius: '50%', background: hx, border: '2px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </Field>
        ) : (
          <p style={{ margin: '0 0 14px', fontSize: 13, color: M_INK3 }}>For {kid.name}</p>
        )}

        {/* Activity name */}
        <Field label="Activity name">
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Swimming" style={mInput} />
        </Field>

        {/* Day chips - multi-select when adding (one row per day, matching
            the Calendar create flow); single-select when editing the row. */}
        <Field label={editing ? 'Day' : 'Repeats on'}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {DAY_LABELS.map((d, i) => {
              const on = days.includes(i);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  aria-label={d}
                  onClick={() => {
                    if (editing) setDays([i]);
                    else setDays((prev) => (prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]));
                  }}
                  style={{ padding: '6px 10px', borderRadius: 99, cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'inherit', border: on ? `1.5px solid ${M_BRAND}` : `1px solid ${M_LINE_STRONG}`, background: on ? M_BRAND_SOFT : '#fff', color: on ? M_BRAND : M_INK2 }}
                >
                  {d.slice(0, 2)}
                </button>
              );
            })}
          </div>
        </Field>

        {/* Time */}
        <div style={{ display: 'flex', gap: 12 }}>
          <Field label="Starts" style={{ flex: 1 }}>
            <input type="time" value={timeStart} onChange={(e) => setTimeStart(e.target.value)} style={{ ...mInput, WebkitAppearance: 'none', appearance: 'none' }} />
          </Field>
          <Field label="Ends" style={{ flex: 1 }}>
            <input type="time" value={timeEnd} onChange={(e) => setTimeEnd(e.target.value)} style={{ ...mInput, WebkitAppearance: 'none', appearance: 'none' }} />
          </Field>
        </div>

        {/* Term window applies only to NEW activities. Edits keep their
            existing window (the term concept is per-activity, not a move). */}
        {!editing && (
          <Field label={termsLoading ? 'Term (loading…)' : 'Term'}>
            <select value={termKey} onChange={(e) => setTermKey(e.target.value)} style={mInput}>
              {terms.map((t) => <option key={t.start_date} value={t.start_date}>{t.label}</option>)}
              <option value="ongoing">Ongoing (every term)</option>
              <option value="custom">Custom dates…</option>
            </select>
            {termKey === 'custom' ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} style={{ ...mInput, minWidth: 0, flex: 1 }} />
                <span style={{ fontSize: 12, color: M_INK3 }}>to</span>
                <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} min={customStart || undefined} style={{ ...mInput, minWidth: 0, flex: 1 }} />
              </div>
            ) : (
              <p style={{ fontSize: 12, color: M_INK3, margin: '8px 0 0' }}>
                {termKey === 'ongoing'
                  ? 'Repeats every selected day, every week, until you remove it.'
                  : 'Repeats every selected day this term, then stops automatically.'}
              </p>
            )}
          </Field>
        )}

        {/* Pickup - adults only; a child can't collect a child. */}
        <Field label="Pickup">
          <select value={pickup} onChange={(e) => setPickup(e.target.value)} style={mInput}>
            <option value="">Choose who collects {kid.name}</option>
            {members.filter((m) => m.member_type !== 'dependent').map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </Field>

        {/* Show on the family calendar - kids always see theirs in Child
            Mode; this switch additionally surfaces it on the adult calendar. */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: M_INK }}>Show on the family calendar</div>
            <div style={{ fontSize: 12, color: M_INK3, marginTop: 2 }}>Everyone sees it, colour-coded to {kid.name}.</div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={onCalendar}
            onClick={() => setOnCalendar((v) => !v)}
            style={{ width: 40, height: 22, borderRadius: 99, border: 0, cursor: 'pointer', background: onCalendar ? M_BRAND : M_LINE_STRONG, position: 'relative', transition: 'background .15s', padding: 0, flexShrink: 0 }}
          >
            <span style={{ position: 'absolute', top: 2, left: onCalendar ? 20 : 2, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
          </button>
        </div>

        {/* Upcoming per-date exceptions from the calendar or the AI:
            skipped dates and one-off changed dates. Removing a chip
            restores that occurrence to the usual schedule. */}
        {editing && (skips.length > 0 || overrideDates.length > 0) && (
          <Field label="One-off changes">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {skips.map((d) => (
                <span key={d} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, borderRadius: 99, background: '#fff', border: `1px solid ${M_LINE_STRONG}`, padding: '5px 10px', fontSize: 12, color: M_INK }}>
                  {fmtSkipDate(d)} · skipped
                  <button type="button" onClick={() => handleUnskip(d)} aria-label={`Restore ${fmtSkipDate(d)}`} style={{ background: 'transparent', border: 0, padding: 0, cursor: 'pointer', color: M_INK3, fontSize: 14, lineHeight: 1 }}>×</button>
                </span>
              ))}
              {overrideDates.map((d) => {
                const o = activity.overrides?.[d] || {};
                const t = o.time_start ? ` ${String(o.time_start).slice(0, 5)}` : '';
                return (
                  <span key={d} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, borderRadius: 99, background: '#fff', border: `1px solid ${M_LINE_STRONG}`, padding: '5px 10px', fontSize: 12, color: M_INK }}>
                    {fmtSkipDate(d)} · changed{t}
                    <button type="button" onClick={() => handleUnskip(d)} aria-label={`Restore ${fmtSkipDate(d)}`} style={{ background: 'transparent', border: 0, padding: 0, cursor: 'pointer', color: M_INK3, fontSize: 14, lineHeight: 1 }}>×</button>
                  </span>
                );
              })}
            </div>
          </Field>
        )}

        {error && <p style={{ fontSize: 12, color: '#D25454', margin: '0 0 12px' }}>{error}</p>}

        {/* Footer - same button treatment as the task modal. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
          {editing && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={saving}
              style={{ background: 'transparent', border: 0, padding: 0, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#E8724A', marginRight: 'auto', opacity: saving ? 0.5 : 1 }}
            >
              Delete
            </button>
          )}
          <div style={{ flex: editing ? 'none' : 1 }} />
          <button
            type="button"
            onClick={onClose}
            style={{ ...mInput, width: 'auto', padding: '10px 18px', cursor: 'pointer', fontWeight: 600, background: '#fff' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={disabled}
            style={{ padding: '10px 22px', borderRadius: 10, border: 0, cursor: 'pointer', fontWeight: 600, fontSize: 14, fontFamily: 'inherit', background: M_BRAND, color: '#fff', opacity: disabled ? 0.5 : 1 }}
          >
            {saving ? 'Saving…' : (editing ? 'Save' : 'Add')}
          </button>
        </div>
      </div>
    </div>
  );
}
