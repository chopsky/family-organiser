import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../lib/api';
import Spinner from '../components/Spinner';
import ErrorBanner from '../components/ErrorBanner';
import { IconCalendar, IconPlus, IconUser, IconCheck } from '../components/Icons';

const EVENT_COLORS = {
  orange: { bg: 'bg-orange-100', border: 'border-orange-400', dot: 'bg-orange-400', text: 'text-orange-700' },
  blue:   { bg: 'bg-blue-100',   border: 'border-blue-400',   dot: 'bg-blue-400',   text: 'text-blue-700' },
  green:  { bg: 'bg-green-100',  border: 'border-green-400',  dot: 'bg-green-400',  text: 'text-green-700' },
  purple: { bg: 'bg-purple-100', border: 'border-purple-400', dot: 'bg-purple-400', text: 'text-purple-700' },
  red:    { bg: 'bg-red-100',    border: 'border-red-400',    dot: 'bg-red-400',    text: 'text-red-700' },
  gray:   { bg: 'bg-gray-100',   border: 'border-gray-400',   dot: 'bg-gray-400',   text: 'text-gray-700' },
};

const PRIORITY_COLORS = { high: 'bg-rose-400', medium: 'bg-amber-400', low: 'bg-emerald-400' };
const RECURRENCES = ['', 'daily', 'weekly', 'biweekly', 'monthly', 'yearly'];
const RECURRENCE_LABELS = { '': 'Never', daily: 'Daily', weekly: 'Weekly', biweekly: 'Biweekly', monthly: 'Monthly', yearly: 'Yearly' };
const COLOR_OPTIONS = ['orange', 'blue', 'green', 'purple', 'red', 'gray'];
const DAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ── Date helpers ────────────────────────────────────────────

function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function monthParam(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

/** Monday = 0, Sunday = 6 */
function mondayBasedDay(date) {
  const d = date.getDay(); // 0=Sun
  return d === 0 ? 6 : d - 1;
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatLongDate(d) {
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function buildCalendarDays(year, month) {
  const firstDay = new Date(year, month, 1);
  const startOffset = mondayBasedDay(firstDay); // leading blanks (Mon-based)
  const total = daysInMonth(year, month);

  const days = [];

  // Previous month trailing days
  const prevTotal = daysInMonth(year, month - 1);
  for (let i = startOffset - 1; i >= 0; i--) {
    days.push({ date: new Date(year, month - 1, prevTotal - i), currentMonth: false });
  }

  // Current month
  for (let d = 1; d <= total; d++) {
    days.push({ date: new Date(year, month, d), currentMonth: true });
  }

  // Next month leading days to fill last row
  const remaining = 7 - (days.length % 7);
  if (remaining < 7) {
    for (let d = 1; d <= remaining; d++) {
      days.push({ date: new Date(year, month + 1, d), currentMonth: false });
    }
  }

  return days;
}

// ── Component ───────────────────────────────────────────────

export default function Calendar() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [currentMonth, setCurrentMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(new Date(today));
  const [events, setEvents] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);
  const [formTitle, setFormTitle] = useState('');
  const [formDate, setFormDate] = useState(toDateStr(today));
  const [formAllDay, setFormAllDay] = useState(false);
  const [formStart, setFormStart] = useState('09:00');
  const [formEnd, setFormEnd] = useState('10:00');
  const [formDesc, setFormDesc] = useState('');
  const [formLocation, setFormLocation] = useState('');
  const [formColor, setFormColor] = useState('orange');
  const [formAssignee, setFormAssignee] = useState('');
  const [formRecurrence, setFormRecurrence] = useState('');
  const [saving, setSaving] = useState(false);

  const [toggling, setToggling] = useState(new Set());
  const formRef = useRef(null);

  // ── Data loading ────────────────────────────────────────

  const load = useCallback(async () => {
    try {
      const mp = monthParam(currentMonth);
      const [evRes, tkRes] = await Promise.all([
        api.get('/calendar/events', { params: { month: mp } }),
        api.get('/calendar/tasks', { params: { month: mp } }),
      ]);
      setEvents(evRes.data.events ?? []);
      setTasks(tkRes.data.tasks ?? []);
    } catch {
      setError('Could not load calendar data.');
    } finally {
      setLoading(false);
    }
  }, [currentMonth]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  useEffect(() => {
    api.get('/household').then(({ data }) => setMembers(data.members ?? [])).catch(() => {});
  }, []);

  // Scroll to form when it opens
  useEffect(() => {
    if (showForm && formRef.current) {
      formRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [showForm]);

  // ── Month navigation ───────────────────────────────────

  function prevMonth() {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  }
  function nextMonth() {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
  }
  function goToday() {
    const now = new Date();
    setCurrentMonth(new Date(now.getFullYear(), now.getMonth(), 1));
    setSelectedDate(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
  }

  // ── Items for a given date ─────────────────────────────

  function eventsForDate(date) {
    const ds = toDateStr(date);
    return events.filter(e => {
      const start = e.start_time?.split('T')[0];
      const end = e.end_time?.split('T')[0];
      return start === ds || (start <= ds && end >= ds);
    });
  }

  function tasksForDate(date) {
    const ds = toDateStr(date);
    return tasks.filter(t => t.due_date === ds);
  }

  // ── Form helpers ───────────────────────────────────────

  function resetForm() {
    setEditingEvent(null);
    setFormTitle('');
    setFormDate(toDateStr(selectedDate || today));
    setFormAllDay(false);
    setFormStart('09:00');
    setFormEnd('10:00');
    setFormDesc('');
    setFormLocation('');
    setFormColor('orange');
    setFormAssignee('');
    setFormRecurrence('');
  }

  function openAddForm() {
    resetForm();
    setShowForm(true);
  }

  function openEditForm(ev) {
    setEditingEvent(ev);
    setFormTitle(ev.title || '');
    setFormDate(ev.start_time?.split('T')[0] || toDateStr(selectedDate));
    setFormAllDay(!!ev.all_day);
    setFormStart(ev.start_time ? formatTime(ev.start_time) : '09:00');
    setFormEnd(ev.end_time ? formatTime(ev.end_time) : '10:00');
    setFormDesc(ev.description || '');
    setFormLocation(ev.location || '');
    setFormColor(ev.color || 'orange');
    setFormAssignee(ev.assigned_to_name || '');
    setFormRecurrence(ev.recurrence || '');
    setShowForm(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!formTitle.trim()) return;
    setSaving(true);
    try {
      const payload = {
        title: formTitle.trim(),
        all_day: formAllDay,
        description: formDesc.trim() || null,
        location: formLocation.trim() || null,
        color: formColor,
        recurrence: formRecurrence || null,
        assigned_to_name: formAssignee || null,
      };
      if (formAllDay) {
        payload.start_time = `${formDate}T00:00:00`;
        payload.end_time = `${formDate}T23:59:59`;
      } else {
        payload.start_time = `${formDate}T${formStart}:00`;
        payload.end_time = `${formDate}T${formEnd}:00`;
      }

      if (editingEvent) {
        await api.patch(`/calendar/events/${editingEvent.id}`, payload);
      } else {
        await api.post('/calendar/events', payload);
      }
      setShowForm(false);
      resetForm();
      await load();
    } catch {
      setError('Could not save event.');
    } finally {
      setSaving(false);
    }
  }

  async function deleteEvent(id) {
    if (!window.confirm('Delete this event? This cannot be undone.')) return;
    try {
      await api.delete(`/calendar/events/${id}`);
      setShowForm(false);
      resetForm();
      await load();
    } catch {
      setError('Could not delete event.');
    }
  }

  async function toggleTask(task) {
    if (toggling.has(task.id)) return;
    setToggling(prev => new Set(prev).add(task.id));
    try {
      await api.patch(`/tasks/${task.id}`, { completed: !task.completed });
      await load();
    } catch {
      setError('Could not update task.');
    } finally {
      setToggling(prev => { const s = new Set(prev); s.delete(task.id); return s; });
    }
  }

  // ── Calendar grid data ─────────────────────────────────

  const calendarDays = buildCalendarDays(currentMonth.getFullYear(), currentMonth.getMonth());
  const monthLabel = currentMonth.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const selectedEvents = selectedDate ? eventsForDate(selectedDate) : [];
  const selectedTasks = selectedDate ? tasksForDate(selectedDate) : [];

  // ── Render ─────────────────────────────────────────────

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      {error && <ErrorBanner message={error} onDismiss={() => setError('')} />}

      {/* ── Month Navigation Header ──────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <IconCalendar className="h-6 w-6" /> Calendar
        </h1>
        <button onClick={openAddForm} className="bg-orange-500 hover:bg-orange-600 text-white font-medium px-4 py-2 rounded-lg text-sm transition-colors flex items-center gap-1">
          <IconPlus className="h-4 w-4" /> Add
        </button>
      </div>

      <div className="flex items-center justify-center gap-3">
        <button onClick={prevMonth} className="border border-gray-300 text-gray-600 hover:bg-gray-50 rounded-lg px-3 py-1.5 text-sm transition-colors">&larr;</button>
        <span className="text-lg font-semibold text-gray-800 min-w-[180px] text-center">{monthLabel}</span>
        <button onClick={nextMonth} className="border border-gray-300 text-gray-600 hover:bg-gray-50 rounded-lg px-3 py-1.5 text-sm transition-colors">&rarr;</button>
        <button onClick={goToday} className="border border-gray-300 text-gray-600 hover:bg-gray-50 rounded-lg px-3 py-1.5 text-sm transition-colors">Today</button>
      </div>

      {/* ── Monthly Grid ─────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-3 sm:p-5">
        {/* Day-of-week headers */}
        <div className="grid grid-cols-7 mb-1">
          {DAY_HEADERS.map(d => (
            <div key={d} className="text-center text-xs font-medium text-gray-400 py-1">{d}</div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7">
          {loading && events.length === 0 ? (
            // Skeleton grid while loading
            Array.from({ length: 35 }).map((_, idx) => (
              <div
                key={idx}
                className="min-h-[56px] sm:min-h-[68px] p-1 border border-gray-50 rounded animate-pulse"
              >
                <div className="w-5 h-3 bg-gray-100 rounded" />
              </div>
            ))
          ) : (
            calendarDays.map(({ date, currentMonth: isCurrent }, idx) => {
              const isToday = isSameDay(date, today);
              const isSelected = selectedDate && isSameDay(date, selectedDate);
              const dayEvents = eventsForDate(date);
              const dayTasks = tasksForDate(date);
              const totalItems = dayEvents.length + dayTasks.length;
              const maxShow = 3;

              return (
                <button
                  key={idx}
                  onClick={() => setSelectedDate(new Date(date))}
                  className={`
                    relative min-h-[56px] sm:min-h-[68px] p-1 border border-gray-50 text-left transition-all rounded
                    ${!isCurrent ? 'text-gray-300' : 'text-gray-700'}
                    ${isToday ? 'bg-orange-50 font-bold text-orange-600' : ''}
                    ${isSelected ? 'ring-2 ring-orange-400' : ''}
                    hover:bg-gray-50
                  `}
                >
                  <span className="text-xs sm:text-sm">{date.getDate()}</span>
                  <div className="flex flex-wrap gap-0.5 mt-0.5">
                    {dayEvents.slice(0, maxShow).map(ev => (
                      <span key={ev.id} className={`w-2 h-2 rounded-full ${EVENT_COLORS[ev.color]?.dot || 'bg-orange-400'}`} title={ev.title} />
                    ))}
                    {dayTasks.slice(0, Math.max(0, maxShow - dayEvents.length)).map(tk => (
                      <span key={tk.id} className={`w-2 h-2 rounded-full ${PRIORITY_COLORS[tk.priority] || 'bg-amber-400'}`} title={tk.title} />
                    ))}
                  </div>
                  {totalItems > maxShow && (
                    <span className="text-[10px] text-gray-400 leading-none">+{totalItems - maxShow}</span>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* ── Day Detail Panel ─────────────────────────────── */}
      {selectedDate && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-800">{formatLongDate(selectedDate)}</h2>
            <button onClick={openAddForm} className="text-sm text-orange-500 hover:text-orange-600 font-medium flex items-center gap-1">
              <IconPlus className="h-4 w-4" /> Add event
            </button>
          </div>

          {/* Events */}
          {selectedEvents.length > 0 ? (
            <div className="space-y-2">
              <h3 className="text-xs text-gray-500 uppercase tracking-wide font-medium">Events</h3>
              {selectedEvents.map(ev => {
                const colors = EVENT_COLORS[ev.color] || EVENT_COLORS.orange;
                return (
                  <div key={ev.id} className={`border-l-4 ${colors.border} ${colors.bg} rounded-r-lg px-3 py-2`}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className={`font-medium ${colors.text}`}>{ev.title}</p>
                        <p className="text-xs text-gray-500">
                          {ev.all_day ? 'All day' : `${formatTime(ev.start_time)} – ${formatTime(ev.end_time)}`}
                          {ev.location ? ` · ${ev.location}` : ''}
                        </p>
                        {ev.assigned_to_name && (
                          <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                            <IconUser className="h-3 w-3" /> {ev.assigned_to_name}
                          </p>
                        )}
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <button onClick={() => openEditForm(ev)} className="text-xs text-gray-400 hover:text-gray-600 px-1">Edit</button>
                        <button onClick={() => deleteEvent(ev.id)} className="text-xs text-red-400 hover:text-red-600 px-1">Delete</button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : selectedTasks.length === 0 ? (
            <p className="text-sm text-gray-400">No events or tasks for this day</p>
          ) : null}

          {/* Tasks */}
          {selectedTasks.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs text-gray-500 uppercase tracking-wide font-medium">Tasks</h3>
              {selectedTasks.map(tk => (
                <div key={tk.id} className="flex items-center gap-3 py-1.5">
                  <button
                    onClick={() => toggleTask(tk)}
                    disabled={toggling.has(tk.id)}
                    className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 transition-colors ${
                      tk.completed
                        ? 'bg-orange-500 border-orange-500 text-white'
                        : 'border-gray-300 hover:border-orange-400'
                    }`}
                  >
                    {tk.completed && <IconCheck className="h-3 w-3" />}
                  </button>
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${PRIORITY_COLORS[tk.priority] || 'bg-amber-400'}`} />
                  <span className={`text-sm flex-1 ${tk.completed ? 'line-through text-gray-400' : 'text-gray-700'}`}>{tk.title}</span>
                  {tk.assigned_to_name && (
                    <span className="text-xs text-gray-400 flex items-center gap-1">
                      <IconUser className="h-3 w-3" /> {tk.assigned_to_name}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Event Form ───────────────────────────────────── */}
      {showForm && (
        <div ref={formRef} className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">
            {editingEvent ? 'Edit Event' : 'New Event'}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-3">
            {/* Title */}
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Title *</label>
              <input
                type="text"
                value={formTitle}
                onChange={e => setFormTitle(e.target.value)}
                required
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                placeholder="Event title"
              />
            </div>

            {/* Date */}
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Date</label>
              <input
                type="date"
                value={formDate}
                onChange={e => setFormDate(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              />
            </div>

            {/* All-day toggle */}
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" checked={formAllDay} onChange={e => setFormAllDay(e.target.checked)} className="rounded" />
              All day
            </label>

            {/* Time inputs (hidden when all-day) */}
            {!formAllDay && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Start time</label>
                  <input
                    type="time"
                    value={formStart}
                    onChange={e => setFormStart(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">End time</label>
                  <input
                    type="time"
                    value={formEnd}
                    onChange={e => setFormEnd(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                  />
                </div>
              </div>
            )}

            {/* Description */}
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Description</label>
              <textarea
                value={formDesc}
                onChange={e => setFormDesc(e.target.value)}
                rows={2}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                placeholder="Optional description"
              />
            </div>

            {/* Location */}
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Location</label>
              <input
                type="text"
                value={formLocation}
                onChange={e => setFormLocation(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                placeholder="Optional location"
              />
            </div>

            {/* Color picker */}
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Color</label>
              <div className="flex gap-2">
                {COLOR_OPTIONS.map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setFormColor(c)}
                    className={`w-7 h-7 rounded-full ${EVENT_COLORS[c].dot} transition-all ${
                      formColor === c ? 'ring-2 ring-offset-2 ring-orange-400 scale-110' : 'hover:scale-105'
                    }`}
                    title={c}
                  />
                ))}
              </div>
            </div>

            {/* Assign to */}
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Assign to</label>
              <select
                value={formAssignee}
                onChange={e => setFormAssignee(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              >
                <option value="">Unassigned</option>
                {members.map(m => (
                  <option key={m.name} value={m.name}>{m.name}</option>
                ))}
              </select>
            </div>

            {/* Recurrence */}
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Recurrence</label>
              <select
                value={formRecurrence}
                onChange={e => setFormRecurrence(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              >
                {RECURRENCES.map(r => (
                  <option key={r} value={r}>{RECURRENCE_LABELS[r]}</option>
                ))}
              </select>
            </div>

            {/* Buttons */}
            <div className="flex items-center gap-2 pt-2">
              <button
                type="submit"
                disabled={saving || !formTitle.trim()}
                className="bg-orange-500 hover:bg-orange-600 disabled:bg-orange-300 text-white font-medium px-4 py-2 rounded-lg text-sm transition-colors"
              >
                {saving ? 'Saving…' : editingEvent ? 'Update' : 'Save'}
              </button>
              <button
                type="button"
                onClick={() => { setShowForm(false); resetForm(); }}
                className="border border-gray-300 text-gray-600 hover:bg-gray-50 rounded-lg px-4 py-2 text-sm transition-colors"
              >
                Cancel
              </button>
              {editingEvent && (
                <button
                  type="button"
                  onClick={() => deleteEvent(editingEvent.id)}
                  className="ml-auto text-sm text-red-500 hover:text-red-700 font-medium"
                >
                  Delete
                </button>
              )}
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
