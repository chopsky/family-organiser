import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import api from '../lib/api';
import Spinner from '../components/Spinner';
import ErrorBanner from '../components/ErrorBanner';
import { IconCalendar, IconPlus, IconUser, IconCheck } from '../components/Icons';

const EVENT_COLORS = {
  orange: { bg: 'bg-secondary/30', border: 'border-primary', dot: 'bg-primary', text: 'text-primary-pressed', darkBg: 'bg-secondary/50' },
  blue:   { bg: 'bg-blue-100',   border: 'border-blue-400',   dot: 'bg-blue-400',   text: 'text-blue-700',   darkBg: 'bg-blue-200' },
  green:  { bg: 'bg-success/20',  border: 'border-success',  dot: 'bg-success',  text: 'text-success',  darkBg: 'bg-success/30' },
  purple: { bg: 'bg-purple-100', border: 'border-purple-400', dot: 'bg-purple-400', text: 'text-purple-700', darkBg: 'bg-purple-200' },
  red:    { bg: 'bg-error/20',    border: 'border-error',    dot: 'bg-error',    text: 'text-error',    darkBg: 'bg-error/30' },
  gray:   { bg: 'bg-sand',   border: 'border-cream-border',   dot: 'bg-cocoa',   text: 'text-cocoa',   darkBg: 'bg-sand' },
};

const RECURRENCES = ['', 'daily', 'weekly', 'biweekly', 'monthly', 'yearly'];
const NOTIFICATION_OPTIONS = [
  { value: '', label: 'None' },
  { value: 'at_time', label: 'At time of task' },
  { value: '5_min', label: '5 minutes before' },
  { value: '15_min', label: '15 minutes before' },
  { value: '30_min', label: '30 minutes before' },
  { value: '1_hour', label: '1 hour before' },
  { value: '2_hours', label: '2 hours before' },
  { value: '1_day', label: '1 day before' },
  { value: '2_days', label: '2 days before' },
];
const RECURRENCE_LABELS = { '': 'Never', daily: 'Daily', weekly: 'Weekly', biweekly: 'Biweekly', monthly: 'Monthly', yearly: 'Yearly' };
const COLOR_OPTIONS = ['orange', 'blue', 'green', 'purple', 'red', 'gray'];
const DAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

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

function formatHour(hour) {
  if (hour === 0) return '12 AM';
  if (hour < 12) return `${hour} AM`;
  if (hour === 12) return '12 PM';
  return `${hour - 12} PM`;
}

function buildCalendarDays(year, month) {
  const firstDay = new Date(year, month, 1);
  const startOffset = mondayBasedDay(firstDay);
  const total = daysInMonth(year, month);

  const days = [];
  const prevTotal = daysInMonth(year, month - 1);
  for (let i = startOffset - 1; i >= 0; i--) {
    days.push({ date: new Date(year, month - 1, prevTotal - i), currentMonth: false });
  }
  for (let d = 1; d <= total; d++) {
    days.push({ date: new Date(year, month, d), currentMonth: true });
  }
  const remaining = 7 - (days.length % 7);
  if (remaining < 7) {
    for (let d = 1; d <= remaining; d++) {
      days.push({ date: new Date(year, month + 1, d), currentMonth: false });
    }
  }
  return days;
}

/** Get Monday of the week containing the given date */
function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day; // Monday-based
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Get array of 7 dates for the week starting from Monday */
function getWeekDays(weekStart) {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });
}

/** Get event position within hour grid (top offset & height in pixels) */
function getEventPosition(event, hourHeight) {
  const start = new Date(event.start_time);
  const end = new Date(event.end_time);
  const startMinutes = start.getHours() * 60 + start.getMinutes();
  const endMinutes = end.getHours() * 60 + end.getMinutes();
  const duration = Math.max(endMinutes - startMinutes, 15); // minimum 15 min display
  const top = (startMinutes / 60) * hourHeight;
  const height = (duration / 60) * hourHeight;
  return { top, height: Math.max(height, 20) }; // minimum 20px height
}

/** Get months to fetch for a given date range */
function getMonthsForRange(startDate, endDate) {
  const months = new Set();
  const d = new Date(startDate);
  while (d <= endDate) {
    months.add(monthParam(d));
    d.setMonth(d.getMonth() + 1);
  }
  return [...months];
}

// ── Component ───────────────────────────────────────────────

export default function Calendar() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [viewMode, setViewMode] = useState('month'); // 'day', 'week', 'month'
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
  const [deletingTask, setDeletingTask] = useState(new Set());

  // Task edit form state
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDueDate, setTaskDueDate] = useState('');
  const [taskDueTime, setTaskDueTime] = useState('');
  const [taskAssignee, setTaskAssignee] = useState('');
  const [taskRecurrence, setTaskRecurrence] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [taskNotification, setTaskNotification] = useState('');
  const [savingTask, setSavingTask] = useState(false);
  const taskFormRef = useRef(null);

  const [activeFilters, setActiveFilters] = useState(new Set(['events', 'tasks', 'birthdays', 'holidays']));
  const toggleFilter = (key) => setActiveFilters(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });
  const formRef = useRef(null);
  const scrollContainerRef = useRef(null);

  const HOUR_HEIGHT = 60; // pixels per hour

  // ── Data loading ────────────────────────────────────────

  const load = useCallback(async () => {
    try {
      // Determine which months to fetch based on view mode
      let monthsToFetch;
      if (viewMode === 'week') {
        const weekStart = getWeekStart(selectedDate);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);
        monthsToFetch = getMonthsForRange(weekStart, weekEnd);
      } else if (viewMode === 'day') {
        monthsToFetch = [monthParam(selectedDate)];
      } else {
        monthsToFetch = [monthParam(currentMonth)];
      }

      // Fetch all needed months
      const results = await Promise.all(
        monthsToFetch.map(mp =>
          Promise.all([
            api.get('/calendar/events', { params: { month: mp } }),
            api.get('/calendar/tasks', { params: { month: mp } }),
          ])
        )
      );

      const allEvents = results.flatMap(([evRes]) => evRes.data.events ?? []);
      const allTasks = results.flatMap(([, tkRes]) => tkRes.data.tasks ?? []);

      // Deduplicate by id
      const uniqueEvents = [...new Map(allEvents.map(e => [e.id, e])).values()];
      const uniqueTasks = [...new Map(allTasks.map(t => [t.id, t])).values()];

      setEvents(uniqueEvents);
      setTasks(uniqueTasks);
    } catch {
      setError('Could not load calendar data.');
    } finally {
      setLoading(false);
    }
  }, [currentMonth, selectedDate, viewMode]);

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

  // Scroll to current time in day/week view
  useEffect(() => {
    if ((viewMode === 'day' || viewMode === 'week') && scrollContainerRef.current) {
      const now = new Date();
      const scrollTo = Math.max(0, (now.getHours() - 1) * HOUR_HEIGHT);
      setTimeout(() => {
        scrollContainerRef.current?.scrollTo({ top: scrollTo, behavior: 'smooth' });
      }, 100);
    }
  }, [viewMode]);

  // ── Navigation ────────────────────────────────────────────

  function navigatePrev() {
    if (viewMode === 'month') {
      setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
    } else if (viewMode === 'week') {
      const d = new Date(selectedDate);
      d.setDate(d.getDate() - 7);
      setSelectedDate(d);
      setCurrentMonth(new Date(d.getFullYear(), d.getMonth(), 1));
    } else {
      const d = new Date(selectedDate);
      d.setDate(d.getDate() - 1);
      setSelectedDate(d);
      setCurrentMonth(new Date(d.getFullYear(), d.getMonth(), 1));
    }
  }

  function navigateNext() {
    if (viewMode === 'month') {
      setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
    } else if (viewMode === 'week') {
      const d = new Date(selectedDate);
      d.setDate(d.getDate() + 7);
      setSelectedDate(d);
      setCurrentMonth(new Date(d.getFullYear(), d.getMonth(), 1));
    } else {
      const d = new Date(selectedDate);
      d.setDate(d.getDate() + 1);
      setSelectedDate(d);
      setCurrentMonth(new Date(d.getFullYear(), d.getMonth(), 1));
    }
  }

  function goToday() {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    setCurrentMonth(new Date(now.getFullYear(), now.getMonth(), 1));
    setSelectedDate(new Date(now));
  }

  // ── Navigation label ──────────────────────────────────────

  const navigationLabel = useMemo(() => {
    if (viewMode === 'month') {
      return currentMonth.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    }
    if (viewMode === 'week') {
      const weekStart = getWeekStart(selectedDate);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      const startStr = weekStart.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      const endStr = weekEnd.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      return `${startStr} – ${endStr}`;
    }
    // day
    return selectedDate.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }, [viewMode, currentMonth, selectedDate]);

  // ── Items for a given date ─────────────────────────────

  function eventsForDate(date) {
    const ds = toDateStr(date);
    return events.filter(e => {
      const start = e.start_time?.split('T')[0];
      const end = e.end_time?.split('T')[0];
      if (!(start === ds || (start <= ds && end >= ds))) return false;
      // Apply category filters
      const cat = e.category || 'general';
      if (cat === 'general' && !activeFilters.has('events')) return false;
      if (cat === 'birthday' && !activeFilters.has('birthdays')) return false;
      if (cat === 'public_holiday' && !activeFilters.has('holidays')) return false;
      return true;
    });
  }

  function tasksForDate(date) {
    if (!activeFilters.has('tasks')) return [];
    const ds = toDateStr(date);
    return tasks.filter(t => t.due_date === ds);
  }

  /** Get timed (non-all-day) events for a date */
  function timedEventsForDate(date) {
    return eventsForDate(date).filter(e => !e.all_day);
  }

  /** Get all-day events for a date */
  function allDayEventsForDate(date) {
    return eventsForDate(date).filter(e => e.all_day);
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

  function openAddForm(date, hour) {
    resetForm();
    if (date) setFormDate(toDateStr(date));
    if (hour !== undefined) {
      setFormStart(`${String(hour).padStart(2, '0')}:00`);
      setFormEnd(`${String(Math.min(hour + 1, 23)).padStart(2, '0')}:00`);
    }
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

  async function deleteTask(task) {
    if (!window.confirm(`Delete "${task.title}"? This can't be undone.`)) return;
    setDeletingTask(prev => new Set(prev).add(task.id));
    try {
      await api.delete(`/tasks/${task.id}`);
      await load();
    } catch {
      setError('Could not delete task.');
    } finally {
      setDeletingTask(prev => { const s = new Set(prev); s.delete(task.id); return s; });
    }
  }

  function openTaskEditForm(task) {
    setEditingTask(task);
    setTaskTitle(task.title);
    setTaskDueDate(task.due_date);
    setTaskDueTime(task.due_time ? task.due_time.substring(0, 5) : '');
    setTaskAssignee(task.assigned_to_name || '');
    setTaskRecurrence(task.recurrence || '');
    setTaskDescription(task.description || '');
    setTaskNotification(task.notification || '');
    setShowTaskForm(true);
    setShowForm(false); // close event form if open
    setTimeout(() => taskFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
  }

  function closeTaskForm() {
    setShowTaskForm(false);
    setEditingTask(null);
  }

  async function handleTaskSubmit(e) {
    e.preventDefault();
    if (!taskTitle.trim()) return;
    setSavingTask(true);
    try {
      await api.patch(`/tasks/${editingTask.id}`, {
        title: taskTitle.trim(),
        due_date: taskDueDate,
        due_time: taskDueTime || null,
        assigned_to_name: taskAssignee || null,
        recurrence: taskRecurrence || null,
        description: taskDescription || null,
        notification: taskNotification || null,
      });
      closeTaskForm();
      await load();
    } catch {
      setError('Could not update task.');
    } finally {
      setSavingTask(false);
    }
  }

  // ── Calendar grid data ─────────────────────────────────

  const calendarDays = buildCalendarDays(currentMonth.getFullYear(), currentMonth.getMonth());
  const selectedEvents = selectedDate ? eventsForDate(selectedDate) : [];
  const selectedTasks = selectedDate ? tasksForDate(selectedDate) : [];

  // Week view data
  const weekStart = getWeekStart(selectedDate);
  const weekDays = getWeekDays(weekStart);

  // ── Current time indicator position ────────────────────

  const now = new Date();
  const currentTimeTop = (now.getHours() * 60 + now.getMinutes()) / 60 * HOUR_HEIGHT;

  // ── Time Grid (shared by Day & Week views) ─────────────

  function renderTimeGrid(dates, isSingleDay = false) {
    const allDayEventsByDate = dates.map(d => allDayEventsForDate(d));
    const hasAllDay = allDayEventsByDate.some(evs => evs.length > 0);
    const colCount = dates.length;

    return (
      <div className="bg-linen rounded-2xl shadow-sm border border-cream-border overflow-hidden">
        {/* Day headers */}
        <div className="border-b border-cream-border sticky top-0 bg-linen z-20">
          <div className="flex">
            {/* Time gutter header */}
            <div className="w-16 sm:w-20 shrink-0" />
            {/* Day columns */}
            {dates.map((date, i) => {
              const isToday_ = isSameDay(date, today);
              return (
                <div
                  key={i}
                  className={`flex-1 text-center py-2 border-l border-cream-border ${isToday_ ? 'bg-oat' : ''}`}
                >
                  <div className="text-xs text-cocoa font-medium">
                    {date.toLocaleDateString('en-GB', { weekday: 'short' })}
                  </div>
                  <button
                    onClick={() => { setSelectedDate(new Date(date)); setViewMode('day'); }}
                    className={`text-lg font-semibold leading-tight ${
                      isToday_
                        ? 'bg-primary text-white w-8 h-8 rounded-full inline-flex items-center justify-center'
                        : 'text-bark hover:text-primary'
                    }`}
                  >
                    {date.getDate()}
                  </button>
                </div>
              );
            })}
          </div>

          {/* All-day events row */}
          {hasAllDay && (
            <div className="flex border-t border-cream-border">
              <div className="w-16 sm:w-20 shrink-0 text-[10px] text-cocoa py-1 pr-2 text-right">all-day</div>
              {dates.map((date, i) => {
                const dayAllDay = allDayEventsByDate[i];
                return (
                  <div key={i} className="flex-1 border-l border-cream-border p-0.5 min-h-[28px]">
                    {dayAllDay.map(ev => {
                      const colors = EVENT_COLORS[ev.color] || EVENT_COLORS.orange;
                      return (
                        <button
                          key={ev.id}
                          onClick={() => openEditForm(ev)}
                          className={`block w-full text-left text-[10px] sm:text-xs px-1 py-0.5 rounded truncate ${colors.bg} ${colors.text} hover:opacity-80`}
                        >
                          {ev.title}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Scrollable time grid */}
        <div ref={scrollContainerRef} className="overflow-y-auto" style={{ maxHeight: '600px' }}>
          <div className="relative" style={{ height: `${24 * HOUR_HEIGHT}px` }}>
            {/* Hour lines and labels */}
            {HOURS.map(hour => (
              <div
                key={hour}
                className="absolute w-full flex"
                style={{ top: `${hour * HOUR_HEIGHT}px`, height: `${HOUR_HEIGHT}px` }}
              >
                <div className="w-16 sm:w-20 shrink-0 text-[10px] sm:text-xs text-cocoa pr-2 text-right -mt-2">
                  {hour > 0 ? formatHour(hour) : ''}
                </div>
                <div className="flex-1 border-t border-cream-border" />
              </div>
            ))}

            {/* Event columns */}
            <div className="absolute left-16 sm:left-20 right-0 top-0 bottom-0 flex">
              {dates.map((date, colIdx) => {
                const dayTimedEvents = timedEventsForDate(date);
                const isToday_ = isSameDay(date, today);

                return (
                  <div key={colIdx} className={`flex-1 relative border-l border-cream-border ${isToday_ ? 'bg-oat/30' : ''}`}>
                    {/* Click to add event */}
                    {HOURS.map(hour => (
                      <button
                        key={hour}
                        onClick={() => openAddForm(date, hour)}
                        className="absolute w-full hover:bg-oat/50 transition-colors"
                        style={{ top: `${hour * HOUR_HEIGHT}px`, height: `${HOUR_HEIGHT}px` }}
                        title={`Add event at ${formatHour(hour)}`}
                      />
                    ))}

                    {/* Events */}
                    {dayTimedEvents.map(ev => {
                      const pos = getEventPosition(ev, HOUR_HEIGHT);
                      const colors = EVENT_COLORS[ev.color] || EVENT_COLORS.orange;
                      return (
                        <button
                          key={ev.id}
                          onClick={(e) => { e.stopPropagation(); openEditForm(ev); }}
                          className={`absolute left-0.5 right-0.5 sm:left-1 sm:right-1 rounded ${colors.bg} border-l-2 ${colors.border} px-1 py-0.5 overflow-hidden hover:opacity-80 z-10 cursor-pointer text-left`}
                          style={{ top: `${pos.top}px`, height: `${pos.height}px` }}
                          title={`${ev.title}\n${formatTime(ev.start_time)} – ${formatTime(ev.end_time)}`}
                        >
                          <p className={`text-[10px] sm:text-xs font-medium ${colors.text} truncate leading-tight`}>{ev.title}</p>
                          {pos.height > 30 && (
                            <p className="text-[9px] sm:text-[10px] text-cocoa truncate leading-tight">
                              {formatTime(ev.start_time)} – {formatTime(ev.end_time)}
                            </p>
                          )}
                          {pos.height > 50 && ev.location && (
                            <p className="text-[9px] text-cocoa truncate leading-tight">{ev.location}</p>
                          )}
                        </button>
                      );
                    })}

                    {/* Current time indicator */}
                    {isToday_ && (
                      <div
                        className="absolute left-0 right-0 z-20 pointer-events-none"
                        style={{ top: `${currentTimeTop}px` }}
                      >
                        <div className="flex items-center">
                          <div className="w-2.5 h-2.5 bg-red-500 rounded-full -ml-1.5" />
                          <div className="flex-1 h-0.5 bg-red-500" />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      {error && <ErrorBanner message={error} onDismiss={() => setError('')} />}

      {/* ── Header ──────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-bark flex items-center gap-2">
          <IconCalendar className="h-6 w-6" /> Calendar
        </h1>
        <div className="flex items-center gap-2">
          <select
            value={viewMode}
            onChange={e => setViewMode(e.target.value)}
            className="border border-cream-border rounded-2xl px-3 py-2 text-sm text-bark focus:outline-none focus:ring-2 focus:ring-accent bg-oat"
          >
            <option value="day">Day</option>
            <option value="week">Week</option>
            <option value="month">Month</option>
          </select>
          <button onClick={() => openAddForm(selectedDate)} className="bg-primary hover:bg-primary-pressed text-white font-medium px-4 py-2 rounded-2xl text-sm transition-colors flex items-center gap-1">
            <IconPlus className="h-4 w-4" /> Add
          </button>
        </div>
      </div>

      {/* ── Navigation ──────────────────────────────────────── */}
      <div className="flex items-center justify-center gap-3">
        <button onClick={navigatePrev} className="border border-cream-border text-cocoa hover:bg-oat rounded-2xl px-3 py-1.5 text-sm transition-colors">&larr;</button>
        <span className="text-lg font-semibold text-bark min-w-[180px] text-center">{navigationLabel}</span>
        <button onClick={navigateNext} className="border border-cream-border text-cocoa hover:bg-oat rounded-2xl px-3 py-1.5 text-sm transition-colors">&rarr;</button>
        <button onClick={goToday} className="border border-cream-border text-cocoa hover:bg-oat rounded-2xl px-3 py-1.5 text-sm transition-colors">Today</button>
      </div>

      {/* ── Filter pills ─────────────────────────────────────── */}
      <div className="flex items-center justify-center gap-2 flex-wrap">
        {[
          { key: 'events', label: 'Events', color: 'bg-blue-500' },
          { key: 'tasks', label: 'Tasks', color: 'bg-orange-400' },
          { key: 'birthdays', label: 'Birthdays', color: 'bg-purple-500' },
          { key: 'holidays', label: 'Holidays', color: 'bg-red-500' },
        ].map(({ key, label, color }) => {
          const active = activeFilters.has(key);
          return (
            <button
              key={key}
              onClick={() => setActiveFilters((prev) => {
                const next = new Set(prev);
                if (next.has(key)) next.delete(key);
                else next.add(key);
                return next;
              })}
              className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
                active
                  ? 'border-bark/30 bg-linen text-bark'
                  : 'border-cream-border bg-oat text-cocoa/50 line-through'
              }`}
            >
              <span className={`inline-block w-2 h-2 rounded-full ${active ? color : 'bg-gray-300'}`} />
              {label}
            </button>
          );
        })}
      </div>

      {/* ── Day View ────────────────────────────────────────── */}
      {viewMode === 'day' && renderTimeGrid([selectedDate], true)}

      {/* ── Week View ───────────────────────────────────────── */}
      {viewMode === 'week' && renderTimeGrid(weekDays)}

      {/* ── Month View ──────────────────────────────────────── */}
      {viewMode === 'month' && (
        <>
          <div className="bg-linen rounded-2xl shadow-sm border border-cream-border p-3 sm:p-5">
            {/* Day-of-week headers */}
            <div className="grid grid-cols-7 mb-1">
              {DAY_HEADERS.map(d => (
                <div key={d} className="text-center text-xs font-medium text-cocoa py-1">{d}</div>
              ))}
            </div>

            {/* Day cells */}
            <div className="grid grid-cols-7">
              {loading && events.length === 0 ? (
                Array.from({ length: 35 }).map((_, idx) => (
                  <div
                    key={idx}
                    className="min-h-[56px] sm:min-h-[68px] p-1 border border-oat rounded animate-pulse"
                  >
                    <div className="w-5 h-3 bg-sand rounded" />
                  </div>
                ))
              ) : (
                calendarDays.map(({ date, currentMonth: isCurrent }, idx) => {
                  const isToday_ = isSameDay(date, today);
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
                        relative min-h-[56px] sm:min-h-[68px] p-1 border border-oat text-left transition-all rounded
                        ${!isCurrent ? 'text-cocoa' : 'text-bark'}
                        ${isToday_ ? 'bg-oat font-bold text-primary' : ''}
                        ${isSelected ? 'ring-2 ring-primary' : ''}
                        hover:bg-oat
                      `}
                    >
                      <span className="text-xs sm:text-sm">{date.getDate()}</span>
                      <div className="flex flex-wrap gap-0.5 mt-0.5">
                        {dayEvents.slice(0, maxShow).map(ev => (
                          <span key={ev.id} className={`w-2 h-2 rounded-full ${EVENT_COLORS[ev.color]?.dot || 'bg-primary'}`} title={ev.title} />
                        ))}
                        {dayTasks.slice(0, Math.max(0, maxShow - dayEvents.length)).map(tk => (
                          <span key={tk.id} className="w-2 h-2 rounded-full bg-warn" title={tk.title} />
                        ))}
                      </div>
                      {totalItems > maxShow && (
                        <span className="text-[10px] text-cocoa leading-none">+{totalItems - maxShow}</span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* ── Day Detail Panel (Month view only) ────────────── */}
          {selectedDate && (
            <div className="bg-linen rounded-2xl shadow-sm border border-cream-border p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-bark">{formatLongDate(selectedDate)}</h2>
                <button onClick={() => openAddForm(selectedDate)} className="text-sm text-primary hover:text-primary-pressed font-medium flex items-center gap-1">
                  <IconPlus className="h-4 w-4" /> Add event
                </button>
              </div>

              {/* Events */}
              {selectedEvents.length > 0 ? (
                <div className="space-y-2">
                  <h3 className="text-xs text-cocoa uppercase tracking-wide font-medium">Events</h3>
                  {selectedEvents.map(ev => {
                    const colors = EVENT_COLORS[ev.color] || EVENT_COLORS.orange;
                    return (
                      <div key={ev.id} className={`border-l-4 ${colors.border} ${colors.bg} rounded-r-lg px-3 py-2`}>
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className={`font-medium ${colors.text}`}>{ev.title}</p>
                            <p className="text-xs text-cocoa">
                              {ev.all_day ? 'All day' : `${formatTime(ev.start_time)} – ${formatTime(ev.end_time)}`}
                              {ev.location ? ` · ${ev.location}` : ''}
                            </p>
                            {ev.assigned_to_name && (
                              <p className="text-xs text-cocoa flex items-center gap-1 mt-0.5">
                                <IconUser className="h-3 w-3" /> {ev.assigned_to_name}
                              </p>
                            )}
                          </div>
                          <div className="flex gap-1 shrink-0">
                            <button onClick={() => openEditForm(ev)} className="text-xs text-cocoa hover:text-bark px-1">Edit</button>
                            <button onClick={() => deleteEvent(ev.id)} className="text-xs text-error hover:text-error px-1">Delete</button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : selectedTasks.length === 0 ? (
                <p className="text-sm text-cocoa">No events or tasks for this day</p>
              ) : null}

              {/* Tasks */}
              {selectedTasks.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs text-cocoa uppercase tracking-wide font-medium">Tasks</h3>
                  {selectedTasks.map(tk => (
                    <div key={tk.id} className="flex items-center gap-3 py-1.5">
                      <button
                        onClick={() => toggleTask(tk)}
                        disabled={toggling.has(tk.id)}
                        className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 transition-colors ${
                          tk.completed
                            ? 'bg-primary border-primary text-white'
                            : 'border-cream-border hover:border-primary'
                        }`}
                      >
                        {tk.completed && <IconCheck className="h-3 w-3" />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <span className={`text-sm ${tk.completed ? 'line-through text-cocoa' : 'text-bark'}`}>{tk.title}</span>
                        {tk.due_time && !tk.completed && (
                          <span className="text-xs text-cocoa ml-1">at {tk.due_time.substring(0, 5)}</span>
                        )}
                        {tk.assigned_to_name && (
                          <span className="text-xs text-cocoa flex items-center gap-1 mt-0.5">
                            <IconUser className="h-3 w-3" /> {tk.assigned_to_name}
                          </span>
                        )}
                      </div>
                      {!tk.completed && (
                        <div className="flex gap-1 shrink-0">
                          <button
                            onClick={() => openTaskEditForm(tk)}
                            className="text-cocoa hover:text-primary p-1 rounded transition-colors hover:bg-primary/10"
                            title="Edit task"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                              <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => deleteTask(tk)}
                            disabled={deletingTask.has(tk.id)}
                            className="text-cocoa hover:text-error p-1 rounded transition-colors hover:bg-error/10"
                            title="Delete task"
                          >
                            {deletingTask.has(tk.id) ? '…' : (
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                              </svg>
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ── Event Form ───────────────────────────────────── */}
      {showForm && (
        <div ref={formRef} className="bg-linen rounded-2xl shadow-sm border border-cream-border p-5">
          <h2 className="text-lg font-semibold text-bark mb-4">
            {editingEvent ? 'Edit Event' : 'New Event'}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-3">
            {/* Title */}
            <div>
              <label className="text-xs text-cocoa mb-1 block">Title *</label>
              <input
                type="text"
                value={formTitle}
                onChange={e => setFormTitle(e.target.value)}
                required
                className="w-full border border-cream-border rounded-2xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                placeholder="Event title"
              />
            </div>

            {/* Date */}
            <div>
              <label className="text-xs text-cocoa mb-1 block">Date</label>
              <input
                type="date"
                value={formDate}
                onChange={e => setFormDate(e.target.value)}
                className="w-full border border-cream-border rounded-2xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>

            {/* All-day toggle */}
            <label className="flex items-center gap-2 text-sm text-bark cursor-pointer">
              <input type="checkbox" checked={formAllDay} onChange={e => setFormAllDay(e.target.checked)} className="rounded" />
              All day
            </label>

            {/* Time inputs (hidden when all-day) */}
            {!formAllDay && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-cocoa mb-1 block">Start time</label>
                  <input
                    type="time"
                    value={formStart}
                    onChange={e => setFormStart(e.target.value)}
                    className="w-full border border-cream-border rounded-2xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                </div>
                <div>
                  <label className="text-xs text-cocoa mb-1 block">End time</label>
                  <input
                    type="time"
                    value={formEnd}
                    onChange={e => setFormEnd(e.target.value)}
                    className="w-full border border-cream-border rounded-2xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                </div>
              </div>
            )}

            {/* Description */}
            <div>
              <label className="text-xs text-cocoa mb-1 block">Description</label>
              <textarea
                value={formDesc}
                onChange={e => setFormDesc(e.target.value)}
                rows={2}
                className="w-full border border-cream-border rounded-2xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                placeholder="Optional description"
              />
            </div>

            {/* Location */}
            <div>
              <label className="text-xs text-cocoa mb-1 block">Location</label>
              <input
                type="text"
                value={formLocation}
                onChange={e => setFormLocation(e.target.value)}
                className="w-full border border-cream-border rounded-2xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                placeholder="Optional location"
              />
            </div>

            {/* Color picker */}
            <div>
              <label className="text-xs text-cocoa mb-1 block">Color</label>
              <div className="flex gap-2">
                {COLOR_OPTIONS.map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setFormColor(c)}
                    className={`w-7 h-7 rounded-full ${EVENT_COLORS[c].dot} transition-all ${
                      formColor === c ? 'ring-2 ring-offset-2 ring-primary scale-110' : 'hover:scale-105'
                    }`}
                    title={c}
                  />
                ))}
              </div>
            </div>

            {/* Assign to */}
            <div>
              <label className="text-xs text-cocoa mb-1 block">Assign to</label>
              <select
                value={formAssignee}
                onChange={e => setFormAssignee(e.target.value)}
                className="w-full border border-cream-border rounded-2xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              >
                <option value="">Unassigned</option>
                {members.map(m => (
                  <option key={m.name} value={m.name}>{m.name}</option>
                ))}
              </select>
            </div>

            {/* Recurrence */}
            <div>
              <label className="text-xs text-cocoa mb-1 block">Recurrence</label>
              <select
                value={formRecurrence}
                onChange={e => setFormRecurrence(e.target.value)}
                className="w-full border border-cream-border rounded-2xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
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
                className="bg-primary hover:bg-primary-pressed disabled:bg-primary/50 text-white font-medium px-4 py-2 rounded-2xl text-sm transition-colors"
              >
                {saving ? 'Saving…' : editingEvent ? 'Update' : 'Save'}
              </button>
              <button
                type="button"
                onClick={() => { setShowForm(false); resetForm(); }}
                className="border border-cream-border text-cocoa hover:bg-oat rounded-2xl px-4 py-2 text-sm transition-colors"
              >
                Cancel
              </button>
              {editingEvent && (
                <button
                  type="button"
                  onClick={() => deleteEvent(editingEvent.id)}
                  className="ml-auto text-sm text-error hover:text-error font-medium"
                >
                  Delete
                </button>
              )}
            </div>
          </form>
        </div>
      )}

      {/* ── Task Edit Form ────────────────────────────────── */}
      {showTaskForm && editingTask && (
        <div ref={taskFormRef} className="bg-linen rounded-2xl shadow-sm border border-cream-border p-5">
          <h2 className="text-lg font-semibold text-bark mb-4">Edit Task</h2>
          <form onSubmit={handleTaskSubmit} className="space-y-3">
            <div>
              <label className="text-xs text-cocoa mb-1 block">Title *</label>
              <input
                type="text"
                value={taskTitle}
                onChange={e => setTaskTitle(e.target.value)}
                required
                className="w-full border border-cream-border rounded-2xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                placeholder="Task title"
              />
            </div>
            <div>
              <label className="text-xs text-cocoa mb-1 block">Description (optional)</label>
              <textarea
                value={taskDescription}
                onChange={e => setTaskDescription(e.target.value)}
                placeholder="Add a description..."
                rows={2}
                className="w-full border border-cream-border rounded-2xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent resize-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-cocoa mb-1 block">Due date</label>
                <input
                  type="date"
                  value={taskDueDate}
                  onChange={e => setTaskDueDate(e.target.value)}
                  className="w-full border border-cream-border rounded-2xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
              <div>
                <label className="text-xs text-cocoa mb-1 block">Time (optional)</label>
                <input
                  type="time"
                  value={taskDueTime}
                  onChange={e => setTaskDueTime(e.target.value)}
                  className="w-full border border-cream-border rounded-2xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
              <div>
                <label className="text-xs text-cocoa mb-1 block">Assign to</label>
                <select
                  value={taskAssignee}
                  onChange={e => setTaskAssignee(e.target.value)}
                  className="w-full border border-cream-border rounded-2xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent"
                >
                  <option value="">Everyone</option>
                  {members.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-cocoa mb-1 block">Repeats</label>
                <select
                  value={taskRecurrence}
                  onChange={e => setTaskRecurrence(e.target.value)}
                  className="w-full border border-cream-border rounded-2xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent"
                >
                  {RECURRENCES.map(r => <option key={r} value={r}>{r || 'Never'}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-cocoa mb-1 block">Notification</label>
                <select
                  value={taskNotification}
                  onChange={e => setTaskNotification(e.target.value)}
                  className="w-full border border-cream-border rounded-2xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent"
                >
                  {NOTIFICATION_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex items-center gap-3 pt-2">
              <button
                type="submit"
                disabled={savingTask || !taskTitle.trim()}
                className="bg-primary hover:bg-primary-pressed disabled:bg-primary/50 text-white text-sm font-medium px-5 py-2.5 rounded-2xl transition-colors"
              >
                {savingTask ? 'Saving…' : 'Save changes'}
              </button>
              <button
                type="button"
                onClick={closeTaskForm}
                className="text-sm text-cocoa hover:text-bark"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
