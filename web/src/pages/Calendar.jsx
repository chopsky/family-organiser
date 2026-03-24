import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import api from '../lib/api';
import Spinner from '../components/Spinner';
import ErrorBanner from '../components/ErrorBanner';
import { IconCalendar, IconPlus, IconUser, IconCheck, IconSearch, IconSettings } from '../components/Icons';

// ── Colour map ──────────────────────────────────────────────
// Each member's color_theme maps to Tailwind utility classes.
const EVENT_COLORS = {
  // New 16 profile colours
  red:            { bg: 'bg-red/20',            border: 'border-red',            dot: 'bg-red',            text: 'text-red',            darkBg: 'bg-red/30' },
  'burnt-orange': { bg: 'bg-burnt-orange/20',   border: 'border-burnt-orange',   dot: 'bg-burnt-orange',   text: 'text-burnt-orange',   darkBg: 'bg-burnt-orange/30' },
  amber:          { bg: 'bg-amber/20',          border: 'border-amber',          dot: 'bg-amber',          text: 'text-amber',          darkBg: 'bg-amber/30' },
  gold:           { bg: 'bg-gold/20',           border: 'border-gold',           dot: 'bg-gold',           text: 'text-gold',           darkBg: 'bg-gold/30' },
  leaf:           { bg: 'bg-leaf/20',           border: 'border-leaf',           dot: 'bg-leaf',           text: 'text-leaf',           darkBg: 'bg-leaf/30' },
  emerald:        { bg: 'bg-emerald/20',        border: 'border-emerald',        dot: 'bg-emerald',        text: 'text-emerald',        darkBg: 'bg-emerald/30' },
  teal:           { bg: 'bg-teal/20',           border: 'border-teal',           dot: 'bg-teal',           text: 'text-teal',           darkBg: 'bg-teal/30' },
  sky:            { bg: 'bg-sky/20',            border: 'border-sky',            dot: 'bg-sky',            text: 'text-sky',            darkBg: 'bg-sky/30' },
  cobalt:         { bg: 'bg-cobalt/20',         border: 'border-cobalt',         dot: 'bg-cobalt',         text: 'text-cobalt',         darkBg: 'bg-cobalt/30' },
  indigo:         { bg: 'bg-indigo/20',         border: 'border-indigo',         dot: 'bg-indigo',         text: 'text-indigo',         darkBg: 'bg-indigo/30' },
  purple:         { bg: 'bg-purple/20',         border: 'border-purple',         dot: 'bg-purple',         text: 'text-purple',         darkBg: 'bg-purple/30' },
  magenta:        { bg: 'bg-magenta/20',        border: 'border-magenta',        dot: 'bg-magenta',        text: 'text-magenta',        darkBg: 'bg-magenta/30' },
  rose:           { bg: 'bg-rose/20',           border: 'border-rose',           dot: 'bg-rose',           text: 'text-rose',           darkBg: 'bg-rose/30' },
  terracotta:     { bg: 'bg-terracotta/20',     border: 'border-terracotta',     dot: 'bg-terracotta',     text: 'text-terracotta',     darkBg: 'bg-terracotta/30' },
  moss:           { bg: 'bg-moss/20',           border: 'border-moss',           dot: 'bg-moss',           text: 'text-moss',           darkBg: 'bg-moss/30' },
  slate:          { bg: 'bg-slate/20',          border: 'border-slate',          dot: 'bg-slate',          text: 'text-slate',          darkBg: 'bg-slate/30' },
  // Legacy fallbacks
  sage:       { bg: 'bg-sage/20',       border: 'border-sage',       dot: 'bg-sage',       text: 'text-sage',       darkBg: 'bg-sage/30' },
  plum:       { bg: 'bg-plum/20',       border: 'border-plum',       dot: 'bg-plum',       text: 'text-plum',       darkBg: 'bg-plum/30' },
  coral:      { bg: 'bg-coral/20',      border: 'border-coral',      dot: 'bg-coral',      text: 'text-coral',      darkBg: 'bg-coral/30' },
  lavender:   { bg: 'bg-indigo/20',     border: 'border-indigo',     dot: 'bg-indigo',     text: 'text-indigo',     darkBg: 'bg-indigo/30' },
  orange:     { bg: 'bg-amber/20',      border: 'border-amber',      dot: 'bg-amber',      text: 'text-amber',      darkBg: 'bg-amber/30' },
  blue:       { bg: 'bg-sky/20',        border: 'border-sky',        dot: 'bg-sky',        text: 'text-sky',        darkBg: 'bg-sky/30' },
  green:      { bg: 'bg-sage/20',       border: 'border-sage',       dot: 'bg-sage',       text: 'text-sage',       darkBg: 'bg-sage/30' },
  gray:       { bg: 'bg-slate/20',      border: 'border-slate',      dot: 'bg-slate',      text: 'text-slate',      darkBg: 'bg-slate/30' },
};

// Hex map for inline styles (event pills in calendar grids)
const COLOR_HEX = {
  red: '#E25555', 'burnt-orange': '#E07A3A', amber: '#E8A040', gold: '#C5A833',
  leaf: '#7BAE4E', emerald: '#3A9E6E', teal: '#3AADA0', sky: '#4A9FCC',
  cobalt: '#3A6FD4', indigo: '#6558C7', purple: '#9050B5', magenta: '#C74E95',
  rose: '#E06888', terracotta: '#C47A5E', moss: '#7C8A6E', slate: '#7A8694',
  sage: '#7DAE82', plum: '#6B3FA0', coral: '#E8724A',
  lavender: '#6558C7', orange: '#E8A040', blue: '#4A9FCC', green: '#7DAE82', gray: '#7A8694',
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
  const diff = day === 0 ? -6 : 1 - day;
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
  const duration = Math.max(endMinutes - startMinutes, 15);
  const top = (startMinutes / 60) * hourHeight;
  const height = (duration / 60) * hourHeight;
  return { top, height: Math.max(height, 20) };
}

/**
 * Calculate column layout for overlapping events.
 * Returns a Map of eventId -> { col, totalCols }
 */
function layoutOverlappingEvents(events) {
  if (!events.length) return new Map();

  const items = events.map(ev => {
    const s = new Date(ev.start_time);
    const e = new Date(ev.end_time);
    const startMin = s.getHours() * 60 + s.getMinutes();
    const endMin = Math.max(e.getHours() * 60 + e.getMinutes(), startMin + 15);
    return { id: ev.id, startMin, endMin };
  });

  items.sort((a, b) => a.startMin - b.startMin || (b.endMin - b.startMin) - (a.endMin - a.startMin));

  const clusters = [];
  let current = [items[0]];
  let clusterEnd = items[0].endMin;

  for (let i = 1; i < items.length; i++) {
    if (items[i].startMin < clusterEnd) {
      current.push(items[i]);
      clusterEnd = Math.max(clusterEnd, items[i].endMin);
    } else {
      clusters.push(current);
      current = [items[i]];
      clusterEnd = items[i].endMin;
    }
  }
  clusters.push(current);

  const layout = new Map();
  for (const cluster of clusters) {
    const columns = [];
    for (const item of cluster) {
      let placed = false;
      for (let c = 0; c < columns.length; c++) {
        const lastInCol = columns[c][columns[c].length - 1];
        if (item.startMin >= lastInCol.endMin) {
          columns[c].push(item);
          item._col = c;
          placed = true;
          break;
        }
      }
      if (!placed) {
        item._col = columns.length;
        columns.push([item]);
      }
    }
    const totalCols = columns.length;
    for (const item of cluster) {
      layout.set(item.id, { col: item._col, totalCols });
    }
  }
  return layout;
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

// ── SVG icons (inline for calendar-specific UI) ─────────────

function ChevronLeft({ className = 'w-3.5 h-3.5' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

function ChevronRight({ className = 'w-3.5 h-3.5' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}

function SettingsIcon({ className = 'w-4 h-4' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9c.26.46.4.98.42 1.51" />
    </svg>
  );
}

function MapPinIcon({ className = 'w-2.5 h-2.5' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" />
    </svg>
  );
}

// ── Component ───────────────────────────────────────────────

export default function Calendar() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [viewMode, setViewMode] = useState('month');
  const [currentMonth, setCurrentMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(new Date(today));
  const [events, setEvents] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [members, setMembers] = useState([]);
  const [schoolData, setSchoolData] = useState(null);
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
  const [formColor, setFormColor] = useState('lavender');
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

  // Search state
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchRef = useRef(null);

  // Settings popup
  const [showSettings, setShowSettings] = useState(false);
  const settingsRef = useRef(null);

  // Filters
  const [activeFilters, setActiveFilters] = useState(new Set(['events', 'tasks', 'birthdays', 'holidays', 'school']));
  const [activeMemberFilters, setActiveMemberFilters] = useState(null); // null = all members shown
  const toggleFilter = (key) => setActiveFilters(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  const formRef = useRef(null);
  const scrollContainerRef = useRef(null);

  const HOUR_HEIGHT = 52; // matches mockup

  // ── Data loading ────────────────────────────────────────

  const load = useCallback(async () => {
    try {
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

      const monthFetches = monthsToFetch.map(mp =>
        Promise.all([
          api.get('/calendar/events', { params: { month: mp } }),
          api.get('/calendar/tasks', { params: { month: mp } }),
        ])
      );
      const schoolFetch = schoolData ? Promise.resolve(null) : api.get('/schools').catch(() => null);
      const [results, freshSchoolData] = await Promise.all([Promise.all(monthFetches), schoolFetch]);

      const allEvents = results.flatMap(([evRes]) => evRes.data.events ?? []);
      const allTasks = results.flatMap(([, tkRes]) => tkRes.data.tasks ?? []);

      // Dedup by ID first, then by title+date
      const byId = [...new Map(allEvents.map(e => [e.id, e])).values()];
      const seen = new Set();
      const uniqueEvents = byId.filter(e => {
        const key = `${(e.title || '').toLowerCase().trim()}|${(e.start_time || '').split('T')[0]}|${(e.end_time || '').split('T')[0]}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      const uniqueTasks = [...new Map(allTasks.map(t => [t.id, t])).values()];

      const schools = freshSchoolData ? freshSchoolData.data.schools || [] : schoolData || [];
      if (freshSchoolData) setSchoolData(schools);

      // Build school events
      const schoolEvents = [];
      for (const school of schools) {
        for (const td of (school.term_dates || [])) {
          if (!td.date) continue;
          schoolEvents.push({
            id: `td-${td.id}`,
            title: `${school.school_name} — ${td.label || (td.event_type || 'school event').replace(/_/g, ' ')}`,
            start_time: `${td.date}T00:00:00Z`,
            end_time: td.end_date ? `${td.end_date}T23:59:59Z` : `${td.date}T23:59:59Z`,
            all_day: true,
            category: 'school',
            color: school.colour || 'lavender',
            _school: true,
          });
        }
        for (const child of (school.children || [])) {
          for (const act of (child.activities || [])) {
            const start = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1);
            const end = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 2, 0);
            for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
              const jsDay = d.getDay();
              const ourDay = (jsDay + 6) % 7;
              if (ourDay === act.day_of_week) {
                const dateStr = d.toISOString().split('T')[0];
                schoolEvents.push({
                  id: `act-${act.id}-${dateStr}`,
                  title: `${child.name} — ${act.activity}`,
                  start_time: act.time_start ? `${dateStr}T${act.time_start}` : `${dateStr}T00:00:00Z`,
                  end_time: act.time_end ? `${dateStr}T${act.time_end}` : null,
                  all_day: !act.time_start,
                  category: 'school',
                  assigned_to_name: child.name,
                  color: child.color_theme || 'sky',
                  _school: true,
                  _activity: true,
                });
              }
            }
          }
        }
      }

      setEvents([...uniqueEvents, ...schoolEvents]);
      setTasks(uniqueTasks);
    } catch (err) {
      console.error('Calendar load error:', err);
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

  // Close settings on click outside
  useEffect(() => {
    if (!showSettings) return;
    function handleClick(e) {
      if (settingsRef.current && !settingsRef.current.contains(e.target)) {
        setShowSettings(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showSettings]);

  // Close search on click outside
  useEffect(() => {
    if (!showSearch) return;
    function handleClick(e) {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setShowSearch(false);
        setSearchQuery('');
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showSearch]);

  // Init member filters when members load
  useEffect(() => {
    if (members.length > 0 && activeMemberFilters === null) {
      setActiveMemberFilters(new Set(members.map(m => m.name)));
    }
  }, [members]);

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
      const startStr = weekStart.toLocaleDateString('en-GB', { day: 'numeric' });
      const endStr = weekEnd.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
      return `${startStr} – ${endStr}`;
    }
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
      if (cat === 'school' && !activeFilters.has('school')) return false;
      // Apply member filter
      if (activeMemberFilters && e.assigned_to_name && !activeMemberFilters.has(e.assigned_to_name)) return false;
      return true;
    });
  }

  function tasksForDate(date) {
    if (!activeFilters.has('tasks')) return [];
    const ds = toDateStr(date);
    return tasks.filter(t => {
      if (t.due_date !== ds) return false;
      if (activeMemberFilters && t.assigned_to_name && !activeMemberFilters.has(t.assigned_to_name)) return false;
      return true;
    });
  }

  function timedEventsForDate(date) {
    return eventsForDate(date).filter(e => !e.all_day);
  }

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
    setFormColor('lavender');
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
    const assignedMember = members.find(m => m.name === ev.assigned_to_name);
    setFormColor(assignedMember?.color_theme || ev.color || 'lavender');
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

  // Resolve event colour: prefer assigned member's theme, fallback to sage
  function getEventColor(ev) {
    if (ev.assigned_to_name) {
      const m = members.find(member => member.name === ev.assigned_to_name);
      if (m?.color_theme) return m.color_theme;
    }
    return 'sage';
  }

  function getEventHex(ev) {
    return COLOR_HEX[getEventColor(ev)] || COLOR_HEX.sage;
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
    setShowForm(false);
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

  // Current time indicator position
  const now = new Date();
  const currentTimeTop = (now.getHours() * 60 + now.getMinutes()) / 60 * HOUR_HEIGHT;

  // ── Search results ─────────────────────────────────────

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase().trim();
    const matches = [];

    for (const ev of events) {
      if (ev.title?.toLowerCase().includes(q) || ev.description?.toLowerCase().includes(q) || ev.location?.toLowerCase().includes(q)) {
        matches.push({ type: 'event', item: ev, date: ev.start_time?.split('T')[0], title: ev.title });
      }
    }
    for (const t of tasks) {
      if (t.title?.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q)) {
        matches.push({ type: 'task', item: t, date: t.due_date, title: t.title });
      }
    }

    matches.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    return matches.slice(0, 20);
  }, [searchQuery, events, tasks]);

  function jumpToSearchResult(result) {
    const dateStr = result.date;
    if (dateStr) {
      const [y, m, d] = dateStr.split('-').map(Number);
      const date = new Date(y, m - 1, d);
      setSelectedDate(date);
      setCurrentMonth(new Date(y, m - 1, 1));
      setViewMode('day');
    }
    setShowSearch(false);
    setSearchQuery('');
  }

  // ── Today's events (for panel below month/week view) ───

  const todayEvents = useMemo(() => {
    const items = [];
    const todayEvs = eventsForDate(today);
    const todayTasks = tasksForDate(today);
    todayEvs.forEach(ev => items.push({ ...ev, _type: 'event' }));
    todayTasks.forEach(t => items.push({ ...t, _type: 'task', start_time: t.due_time ? `${t.due_date}T${t.due_time}` : null }));
    // Sort by start time
    items.sort((a, b) => {
      const at = a.start_time || '';
      const bt = b.start_time || '';
      return at.localeCompare(bt);
    });
    return items;
  }, [events, tasks, activeFilters, activeMemberFilters]);

  // Helper to get member initials + color
  function getMemberInfo(name) {
    const m = members.find(member => member.name === name);
    return {
      initial: name?.[0]?.toUpperCase() || '?',
      hex: m?.color_theme ? (COLOR_HEX[m.color_theme] || COLOR_HEX.sage) : COLOR_HEX.sage,
    };
  }

  // Type badge styling
  function getTypeBadge(item) {
    const cat = item.category || 'general';
    if (item._type === 'task') return { label: 'Task', bg: '#FDF0EB', color: '#993C1D' };
    if (cat === 'school') return { label: 'School', bg: '#EDF5EE', color: '#3B6D11' };
    if (cat === 'birthday') return { label: 'Birthday', bg: '#F3EDFC', color: '#6B3FA0' };
    if (cat === 'public_holiday') return { label: 'Holiday', bg: '#EDF5EE', color: '#3B6D11' };
    return { label: 'Event', bg: '#F3EDFC', color: '#6B3FA0' };
  }

  // ── Render ─────────────────────────────────────────────

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      {error && <ErrorBanner message={error} onDismiss={() => setError('')} />}

      {/* ── Toolbar ──────────────────────────────────────────── */}
      <div className="flex items-center gap-2.5 flex-wrap">
        <h1 className="flex items-center gap-2.5 flex-1 min-w-0" style={{ fontFamily: 'var(--font-display)', fontSize: '26px', fontWeight: 600 }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#6B3FA0" strokeWidth="1.5">
            <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          Calendar
        </h1>

        <div className="flex items-center gap-2">
          {/* Search button */}
          <div ref={searchRef} className="relative">
            <button
              onClick={() => { setShowSearch(!showSearch); setTimeout(() => searchRef.current?.querySelector('input')?.focus(), 50); }}
              className={`w-9 h-9 rounded-[10px] border-[1.5px] flex items-center justify-center transition-all ${
                showSearch
                  ? 'border-plum bg-plum-light text-plum'
                  : 'border-light-grey bg-white text-charcoal hover:border-plum hover:text-plum hover:bg-plum-light'
              }`}
            >
              <IconSearch className="w-4 h-4" />
            </button>
            {showSearch && (
              <div className="absolute right-0 top-[42px] w-[300px] bg-white rounded-2xl border border-light-grey z-30 p-3" style={{ boxShadow: 'var(--shadow-lg)' }}>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search events, tasks..."
                  className="w-full h-[42px] rounded-xl px-3.5 text-sm outline-none text-charcoal"
                  style={{ border: '2px solid #E8724A', background: 'white' }}
                  autoFocus
                  onKeyDown={(e) => { if (e.key === 'Escape') { setShowSearch(false); setSearchQuery(''); } }}
                />
                {searchQuery.trim() && (
                  <div className="mt-2 max-h-64 overflow-y-auto">
                    {searchResults.length === 0 ? (
                      <p className="text-sm text-warm-grey p-3 text-center">No results found</p>
                    ) : (
                      searchResults.map((result, i) => {
                        const dateLabel = result.date
                          ? new Date(result.date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
                          : 'No date';
                        return (
                          <button
                            key={`${result.type}-${result.item.id}-${i}`}
                            onClick={() => jumpToSearchResult(result)}
                            className="w-full text-left px-3 py-2 hover:bg-cream transition-colors flex items-start gap-3 rounded-lg"
                          >
                            <div className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ background: result.type === 'event' ? getEventHex(result.item) : '#7A8694' }} />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-semibold text-charcoal truncate">{result.title}</p>
                              <p className="text-xs text-warm-grey">{dateLabel} · {result.type === 'event' ? 'Event' : 'Task'}</p>
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* View select */}
          <select
            value={viewMode}
            onChange={e => setViewMode(e.target.value)}
            className="h-9 rounded-[10px] border-[1.5px] border-light-grey bg-white text-charcoal text-xs font-semibold px-3 pr-7 outline-none cursor-pointer hover:border-plum focus:border-plum transition-colors"
            style={{ appearance: 'none', backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L5 5L9 1' stroke='%236B6774' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center' }}
          >
            <option value="month">Month</option>
            <option value="week">Week</option>
            <option value="day">Day</option>
          </select>

          {/* Add event button */}
          <button
            onClick={() => openAddForm(selectedDate)}
            className="h-9 px-3 md:px-4 rounded-xl bg-plum hover:bg-plum-dark text-white text-[13px] font-semibold flex items-center gap-1.5 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span className="hidden md:inline">Add</span>
          </button>

          {/* Settings cog */}
          <div ref={settingsRef} className="relative">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className={`w-9 h-9 rounded-[10px] border-[1.5px] flex items-center justify-center transition-all ${
                showSettings
                  ? 'border-plum bg-plum-light text-plum'
                  : 'border-light-grey bg-white text-charcoal hover:border-plum hover:text-plum hover:bg-plum-light'
              }`}
            >
              <SettingsIcon />
            </button>

            {/* Settings popup */}
            {showSettings && (
              <div className="absolute right-0 top-[42px] w-80 bg-white rounded-2xl border border-light-grey z-30 p-5" style={{ boxShadow: 'var(--shadow-lg)' }}>
                <h3 className="text-[15px] font-semibold mb-3" style={{ fontFamily: 'var(--font-display)' }}>Calendar filters</h3>

                {/* Family members */}
                <div className="mb-4">
                  <div className="text-[11px] font-semibold text-warm-grey uppercase tracking-wider mb-2">Family members</div>
                  <div className="flex flex-wrap gap-1.5">
                    {members.map(m => {
                      const hex = COLOR_HEX[m.color_theme] || COLOR_HEX.sage;
                      const isOn = activeMemberFilters === null || activeMemberFilters.has(m.name);
                      return (
                        <button
                          key={m.name}
                          onClick={() => {
                            setActiveMemberFilters(prev => {
                              const next = new Set(prev || members.map(x => x.name));
                              next.has(m.name) ? next.delete(m.name) : next.add(m.name);
                              return next;
                            });
                          }}
                          className="flex items-center gap-1.5 rounded-2xl text-[11px] font-semibold transition-all cursor-pointer"
                          style={{
                            padding: '5px 12px 5px 5px',
                            border: isOn ? 'none' : '1.5px solid #E8E5EC',
                            background: isOn ? hex : 'white',
                            color: isOn ? 'white' : '#2D2A33',
                          }}
                        >
                          <div className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white" style={{ background: hex }}>
                            {m.name?.[0]?.toUpperCase()}
                          </div>
                          {m.name}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Calendar type */}
                <div className="mb-4">
                  <div className="text-[11px] font-semibold text-warm-grey uppercase tracking-wider mb-2">Calendar type</div>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { key: 'events', label: 'Events', dot: '#6B3FA0' },
                      { key: 'tasks', label: 'Tasks', dot: '#E8724A' },
                      { key: 'birthdays', label: 'Birthdays', dot: '#D4537E' },
                      { key: 'holidays', label: 'Holidays', dot: '#7DAE82' },
                      { key: 'school', label: 'School', dot: '#E8A040' },
                    ].map(({ key, label, dot }) => {
                      const isOn = activeFilters.has(key);
                      return (
                        <button
                          key={key}
                          onClick={() => toggleFilter(key)}
                          className="flex items-center gap-1.5 rounded-2xl text-[11px] font-semibold transition-all cursor-pointer"
                          style={{
                            padding: '5px 12px 5px 5px',
                            border: isOn ? '1.5px solid #6B3FA0' : '1.5px solid #E8E5EC',
                            background: isOn ? '#6B3FA0' : 'white',
                            color: isOn ? 'white' : '#2D2A33',
                          }}
                        >
                          <div className="w-3 h-3 rounded" style={{ background: dot }} />
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Connected calendars */}
                <div className="h-px bg-light-grey my-4" />
                <div className="text-[11px] font-semibold text-warm-grey uppercase tracking-wider mb-2">Connected calendars</div>
                <div className="flex flex-col gap-1.5">
                  {[
                    { name: 'Google Calendar', status: 'Connected', statusColor: '#7DAE82', iconBg: '#E8F0FE' },
                    { name: 'Outlook Calendar', status: 'Connect', statusColor: '#6B6774', iconBg: '#E6F1FB' },
                    { name: 'Apple Calendar', status: 'Connect', statusColor: '#6B6774', iconBg: '#F1EFE8' },
                  ].map(cal => (
                    <div
                      key={cal.name}
                      className="flex items-center gap-2.5 p-2.5 rounded-lg border-[1.5px] border-light-grey cursor-pointer hover:border-plum hover:bg-plum-light transition-all"
                    >
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: cal.iconBg }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                          <rect x="3" y="4" width="18" height="18" rx="2" stroke="#555" strokeWidth="1.5" />
                          <path d="M3 10h18" stroke="#555" strokeWidth="1.5" />
                        </svg>
                      </div>
                      <div className="flex-1">
                        <div className="text-xs font-semibold">{cal.name}</div>
                        <div className="text-[10px]" style={{ color: cal.statusColor }}>{cal.status}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Nav row ──────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="text-lg font-semibold" style={{ fontFamily: 'var(--font-display)' }}>{navigationLabel}</div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={navigatePrev}
            className="w-9 h-9 rounded-[10px] border-[1.5px] border-light-grey bg-white flex items-center justify-center text-charcoal hover:border-plum hover:text-plum hover:bg-plum-light transition-all"
          >
            <ChevronLeft />
          </button>
          <button
            onClick={goToday}
            className="px-4 py-1.5 rounded-full border-[1.5px] border-plum bg-transparent text-plum text-xs font-semibold hover:bg-plum hover:text-white transition-all"
          >
            Today
          </button>
          <button
            onClick={navigateNext}
            className="w-9 h-9 rounded-[10px] border-[1.5px] border-light-grey bg-white flex items-center justify-center text-charcoal hover:border-plum hover:text-plum hover:bg-plum-light transition-all"
          >
            <ChevronRight />
          </button>
        </div>
      </div>

      {/* ── Month View ──────────────────────────────────────── */}
      {viewMode === 'month' && (
        <>
          {/* Desktop month grid */}
          <div className="hidden md:block">
            <div className="border border-light-grey rounded-2xl overflow-hidden bg-white">
              {/* Day headers */}
              <div className="grid grid-cols-7">
                {DAY_HEADERS.map(d => (
                  <div key={d} className="py-2.5 px-1 text-center text-[11px] font-semibold text-warm-grey uppercase tracking-wider bg-cream border-b border-light-grey">
                    {d}
                  </div>
                ))}
              </div>
              {/* Day cells */}
              <div className="grid grid-cols-7">
                {loading && events.length === 0 ? (
                  Array.from({ length: 35 }).map((_, idx) => (
                    <div key={idx} className="min-h-[90px] p-1.5 border-r border-b border-light-grey animate-pulse">
                      <div className="w-6 h-3 bg-light-grey rounded" />
                    </div>
                  ))
                ) : (
                  calendarDays.map(({ date, currentMonth: isCurrent }, idx) => {
                    const isToday_ = isSameDay(date, today);
                    const dayEvents = eventsForDate(date);
                    const dayTasks = tasksForDate(date);
                    const allItems = [...dayEvents.map(e => ({ ...e, _isEvent: true })), ...dayTasks.map(t => ({ ...t, _isTask: true }))];
                    const maxShow = 2;
                    const overflow = allItems.length - maxShow;

                    return (
                      <div
                        key={idx}
                        onClick={() => { setSelectedDate(new Date(date)); }}
                        className={`min-h-[90px] p-1.5 cursor-pointer transition-colors border-b border-light-grey ${
                          idx % 7 !== 6 ? 'border-r' : ''
                        } ${!isCurrent ? 'bg-[#F8F6F2]' : isToday_ ? 'bg-plum-light' : 'bg-white hover:bg-cream'}`}
                      >
                        <div className={`text-xs font-semibold mb-0.5 w-6 h-6 flex items-center justify-center ${
                          !isCurrent ? 'text-light-grey' : isToday_ ? 'bg-plum text-white rounded-full' : 'text-charcoal'
                        }`}>
                          {date.getDate()}
                        </div>
                        {allItems.slice(0, maxShow).map(item => (
                          <div
                            key={item.id}
                            className="text-[9px] font-semibold px-1.5 py-0.5 rounded-[3px] mb-0.5 text-white truncate"
                            style={{ background: item._isTask ? '#E8724A' : getEventHex(item) }}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (item._isTask) {
                                openTaskEditForm(item);
                              } else if (item.category !== 'public_holiday' && item.category !== 'birthday') {
                                openEditForm(item);
                              }
                            }}
                          >
                            {item.title}
                          </div>
                        ))}
                        {overflow > 0 && (
                          <div className="text-[9px] font-semibold text-plum px-1.5 py-0.5 cursor-pointer" onClick={(e) => { e.stopPropagation(); setSelectedDate(new Date(date)); setViewMode('day'); }}>
                            +{overflow} more
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* Mobile mini calendar */}
          <div className="md:hidden">
            <div className="grid grid-cols-7 gap-0 mb-3.5">
              {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
                <div key={i} className="text-center text-[10px] font-semibold text-warm-grey uppercase py-1">{d}</div>
              ))}
              {calendarDays.map(({ date, currentMonth: isCurrent }, idx) => {
                const isToday_ = isSameDay(date, today);
                const isSelected = selectedDate && isSameDay(date, selectedDate);
                const dayEvts = eventsForDate(date);
                const dayTasks_ = tasksForDate(date);
                const hasEvents = dayEvts.length > 0 || dayTasks_.length > 0;

                return (
                  <button
                    key={idx}
                    onClick={() => setSelectedDate(new Date(date))}
                    className={`relative text-center text-xs font-medium py-1.5 rounded-full transition-colors ${
                      !isCurrent ? 'text-light-grey' : isToday_ ? 'bg-plum text-white font-bold' : isSelected ? 'bg-plum-light text-plum' : 'hover:bg-plum-light'
                    }`}
                  >
                    {date.getDate()}
                    {hasEvents && !isToday_ && (
                      <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-coral" />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Selected day events list for mobile */}
            {selectedDate && (
              <div>
                <h3 className="text-[15px] font-semibold mb-2.5" style={{ fontFamily: 'var(--font-display)' }}>
                  {isSameDay(selectedDate, today) ? 'Today' : selectedDate.toLocaleDateString('en-GB', { weekday: 'short' })}, {selectedDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}
                </h3>
                {[...eventsForDate(selectedDate).map(e => ({ ...e, _type: 'event' })), ...tasksForDate(selectedDate).map(t => ({ ...t, _type: 'task' }))].map(item => {
                  const hex = item._type === 'task' ? '#E8724A' : getEventHex(item);
                  const badge = getTypeBadge(item);
                  const memberInfo = getMemberInfo(item.assigned_to_name);
                  return (
                    <div
                      key={item.id}
                      className="flex items-center gap-2.5 p-3 bg-white rounded-r-xl mb-2"
                      style={{ borderLeft: `4px solid ${hex}` }}
                      onClick={() => {
                        if (item._type === 'task') openTaskEditForm(item);
                        else if (item.category !== 'public_holiday' && item.category !== 'birthday') openEditForm(item);
                      }}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-semibold truncate">{item.title}</div>
                        <div className="text-[11px] text-warm-grey">
                          {item._type === 'task'
                            ? (item.due_time ? item.due_time.substring(0, 5) : 'All day')
                            : (item.all_day ? 'All day' : formatTime(item.start_time))}
                        </div>
                      </div>
                      <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded shrink-0" style={{ background: badge.bg, color: badge.color }}>{badge.label}</span>
                      {item.assigned_to_name && (
                        <div className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0" style={{ background: memberInfo.hex }}>
                          {memberInfo.initial}
                        </div>
                      )}
                    </div>
                  );
                })}
                {eventsForDate(selectedDate).length === 0 && tasksForDate(selectedDate).length === 0 && (
                  <p className="text-sm text-warm-grey py-4">No events or tasks for this day</p>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Week View ───────────────────────────────────────── */}
      {viewMode === 'week' && (
        <div className="border border-light-grey rounded-2xl overflow-hidden bg-white">
          {/* Headers */}
          <div className="grid" style={{ gridTemplateColumns: '48px repeat(7, minmax(0, 1fr))' }}>
            <div className="bg-cream border-b border-light-grey border-r border-light-grey" />
            {weekDays.map((date, i) => {
              const isToday_ = isSameDay(date, today);
              return (
                <div key={i} className={`py-2 px-1 text-center bg-cream border-b border-light-grey ${i < 6 ? 'border-r border-light-grey' : ''}`}>
                  <div className="text-[10px] font-semibold text-warm-grey uppercase">{date.toLocaleDateString('en-GB', { weekday: 'short' })}</div>
                  <button
                    onClick={() => { setSelectedDate(new Date(date)); setViewMode('day'); }}
                    className={`text-[15px] font-bold mt-0.5 ${
                      isToday_ ? 'bg-plum text-white w-[26px] h-[26px] rounded-full inline-flex items-center justify-center text-[13px]' : 'text-charcoal hover:text-plum'
                    }`}
                  >
                    {date.getDate()}
                  </button>
                </div>
              );
            })}
          </div>

          {/* All-day events strip */}
          {(() => {
            const allDayByDate = weekDays.map(d => allDayEventsForDate(d));
            const hasAllDay = allDayByDate.some(evs => evs.length > 0);
            if (!hasAllDay) return null;
            return (
              <div className="grid border-b border-light-grey" style={{ gridTemplateColumns: '48px repeat(7, minmax(0, 1fr))' }}>
                <div className="text-[10px] text-warm-grey text-right pr-1 py-1 bg-cream border-r border-light-grey">all-day</div>
                {allDayByDate.map((dayEvs, i) => (
                  <div key={i} className={`p-0.5 flex flex-col gap-0.5 bg-cream ${i < 6 ? 'border-r border-light-grey' : ''}`}>
                    {dayEvs.map(ev => (
                      <div
                        key={ev.id}
                        className="text-[9px] font-semibold px-1 py-0.5 rounded text-white truncate cursor-pointer hover:opacity-85"
                        style={{ background: getEventHex(ev) }}
                        onClick={() => { if (ev.category !== 'public_holiday' && ev.category !== 'birthday') openEditForm(ev); }}
                      >
                        {ev.title}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            );
          })()}

          {/* Time grid */}
          <div ref={scrollContainerRef} className="overflow-y-auto" style={{ maxHeight: '560px' }}>
            <div className="relative" style={{ height: `${24 * HOUR_HEIGHT}px` }}>
              {/* Hour rows */}
              {HOURS.map(hour => (
                <div
                  key={hour}
                  className="absolute w-full grid border-b border-light-grey"
                  style={{ top: `${hour * HOUR_HEIGHT}px`, height: `${HOUR_HEIGHT}px`, gridTemplateColumns: '48px repeat(7, minmax(0, 1fr))' }}
                >
                  <div className="text-[10px] font-medium text-warm-grey text-right pr-1.5 -mt-1.5 border-r border-light-grey">
                    {hour > 0 ? formatHour(hour) : ''}
                  </div>
                  {weekDays.map((date, i) => (
                    <div
                      key={i}
                      className={`${i < 6 ? 'border-r border-light-grey' : ''} cursor-pointer hover:bg-cream transition-colors`}
                      onClick={() => openAddForm(date, hour)}
                    />
                  ))}
                </div>
              ))}

              {/* Event layers per day */}
              <div className="absolute top-0 bottom-0 grid" style={{ left: '48px', right: 0, gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}>
                {weekDays.map((date, colIdx) => {
                  const dayTimedEvents = timedEventsForDate(date);
                  const overlapLayout = layoutOverlappingEvents(dayTimedEvents);
                  const isToday_ = isSameDay(date, today);

                  return (
                    <div key={colIdx} className={`relative ${colIdx < 6 ? 'border-r border-light-grey' : ''} ${isToday_ ? 'bg-plum-light/30' : ''}`}>
                      {dayTimedEvents.map(ev => {
                        const pos = getEventPosition(ev, HOUR_HEIGHT);
                        const layout = overlapLayout.get(ev.id) || { col: 0, totalCols: 1 };
                        const widthPct = 100 / layout.totalCols;
                        const leftPct = layout.col * widthPct;

                        return (
                          <div
                            key={ev.id}
                            className="absolute rounded-[5px] px-1.5 py-0.5 text-[10px] font-semibold text-white overflow-hidden z-[2] cursor-pointer hover:opacity-85 leading-snug"
                            style={{
                              top: `${pos.top}px`,
                              height: `${pos.height}px`,
                              left: `calc(${leftPct}% + 2px)`,
                              width: `calc(${widthPct}% - 4px)`,
                              background: getEventHex(ev),
                            }}
                            onClick={(e) => { e.stopPropagation(); if (ev.category !== 'public_holiday' && ev.category !== 'birthday') openEditForm(ev); }}
                          >
                            <div className="truncate">{ev.title}</div>
                            {pos.height > 28 && (
                              <div className="text-[8px] font-medium opacity-75 mt-0.5 truncate">
                                {formatTime(ev.start_time)}{ev.end_time ? `–${formatTime(ev.end_time)}` : ''}
                              </div>
                            )}
                          </div>
                        );
                      })}

                      {/* Current time indicator */}
                      {isToday_ && (
                        <div className="absolute left-0 right-0 z-20 pointer-events-none" style={{ top: `${currentTimeTop}px` }}>
                          <div className="flex items-center">
                            <div className="w-2.5 h-2.5 bg-coral rounded-full -ml-1.5" />
                            <div className="flex-1 h-0.5 bg-coral" />
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
      )}

      {/* ── Day View ────────────────────────────────────────── */}
      {viewMode === 'day' && selectedDate && (
        <div className="border border-light-grey rounded-2xl overflow-hidden bg-white">
          {/* Day header */}
          <div className="flex items-center justify-between px-5 py-4 bg-cream border-b border-light-grey">
            <div className="text-lg font-semibold" style={{ fontFamily: 'var(--font-display)' }}>
              {formatLongDate(selectedDate)}
            </div>
            <div className="text-xs text-warm-grey">
              {eventsForDate(selectedDate).length + tasksForDate(selectedDate).length} events
            </div>
          </div>

          {/* All-day events */}
          {(() => {
            const allDay = allDayEventsForDate(selectedDate);
            if (allDay.length === 0) return null;
            return (
              <div className="px-5 py-2 bg-cream border-b border-light-grey flex flex-wrap gap-1.5">
                {allDay.map(ev => (
                  <div
                    key={ev.id}
                    className="text-[10px] font-semibold text-white px-2 py-0.5 rounded cursor-pointer hover:opacity-85"
                    style={{ background: getEventHex(ev) }}
                    onClick={() => { if (ev.category !== 'public_holiday' && ev.category !== 'birthday') openEditForm(ev); }}
                  >
                    {ev.title}
                  </div>
                ))}
              </div>
            );
          })()}

          {/* Timeline */}
          <div ref={viewMode === 'day' ? scrollContainerRef : undefined} className="overflow-y-auto px-5" style={{ maxHeight: '600px' }}>
            <div className="relative" style={{ height: `${24 * 56}px` }}>
              {HOURS.map(hour => {
                return (
                  <div
                    key={hour}
                    className="relative border-b border-light-grey"
                    style={{ height: '56px' }}
                    onClick={() => openAddForm(selectedDate, hour)}
                  >
                    <div className="absolute left-0 -top-1.5 text-[10px] font-medium text-warm-grey" style={{ width: '42px' }}>
                      {hour > 0 ? formatHour(hour) : ''}
                    </div>
                  </div>
                );
              })}

              {/* Events */}
              {(() => {
                const dayTimedEvents = timedEventsForDate(selectedDate);
                const overlapLayout = layoutOverlappingEvents(dayTimedEvents);
                const hourH = 56;

                return dayTimedEvents.map(ev => {
                  const start = new Date(ev.start_time);
                  const end = new Date(ev.end_time);
                  const startMin = start.getHours() * 60 + start.getMinutes();
                  const endMin = Math.max(end.getHours() * 60 + end.getMinutes(), startMin + 15);
                  const top = (startMin / 60) * hourH;
                  const height = Math.max(((endMin - startMin) / 60) * hourH, 20);
                  const layout = overlapLayout.get(ev.id) || { col: 0, totalCols: 1 };
                  const widthPct = 100 / layout.totalCols;
                  const leftPct = layout.col * widthPct;
                  const hex = getEventHex(ev);
                  const memberInfo = ev.assigned_to_name ? getMemberInfo(ev.assigned_to_name) : null;

                  return (
                    <div
                      key={ev.id}
                      className="absolute rounded-lg px-2.5 py-1.5 text-white z-[2] cursor-pointer hover:opacity-90 flex items-start gap-2 overflow-hidden"
                      style={{
                        top: `${top}px`,
                        height: `${height}px`,
                        left: `calc(52px + ${leftPct}%)`,
                        width: `calc(${widthPct}% - 52px * ${widthPct / 100} - 4px)`,
                        background: hex,
                      }}
                      onClick={(e) => { e.stopPropagation(); if (ev.category !== 'public_holiday' && ev.category !== 'birthday') openEditForm(ev); }}
                    >
                      <div className="flex-1 min-w-0 overflow-hidden">
                        <div className="text-[13px] font-semibold truncate leading-tight">{ev.title}</div>
                        {height > 32 && (
                          <div className="text-[10px] font-medium opacity-80 mt-0.5 truncate">
                            {formatTime(ev.start_time)} – {formatTime(ev.end_time)}
                          </div>
                        )}
                        {ev.location && height > 56 && (
                          <div className="text-[9px] opacity-75 mt-0.5 flex items-center gap-1 truncate">
                            <MapPinIcon /> {ev.location}
                          </div>
                        )}
                      </div>
                      {memberInfo && height > 32 && (
                        <div className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0 mt-0.5" style={{ background: hex, border: '2px solid rgba(255,255,255,0.3)' }}>
                          {memberInfo.initial}
                        </div>
                      )}
                    </div>
                  );
                });
              })()}

              {/* Current time indicator */}
              {isSameDay(selectedDate, today) && (
                <div className="absolute z-20 pointer-events-none" style={{ top: `${(now.getHours() * 60 + now.getMinutes()) / 60 * 56}px`, left: '42px', right: 0 }}>
                  <div className="flex items-center">
                    <div className="w-2.5 h-2.5 bg-coral rounded-full -ml-1.5" />
                    <div className="flex-1 h-0.5 bg-coral" />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Today's Events Panel (below month/week, hidden in day) ── */}
      {viewMode !== 'day' && todayEvents.length > 0 && (
        <div className="mt-5">
          <h3 className="text-[17px] font-semibold mb-3" style={{ fontFamily: 'var(--font-display)' }}>Today's events</h3>
          <div className="flex flex-col gap-2">
            {todayEvents.map(item => {
              const hex = item._type === 'task' ? '#E8724A' : getEventHex(item);
              const badge = getTypeBadge(item);
              const memberInfo = item.assigned_to_name ? getMemberInfo(item.assigned_to_name) : null;

              return (
                <div
                  key={item.id}
                  className="flex items-center gap-3 py-3 px-4 bg-white cursor-pointer hover:shadow-[0_2px_8px_rgba(107,63,160,0.06)] transition-shadow"
                  style={{ borderLeft: `4px solid ${hex}`, borderRadius: '0 12px 12px 0' }}
                  onClick={() => {
                    if (item._type === 'task') openTaskEditForm(item);
                    else if (item.category !== 'public_holiday' && item.category !== 'birthday') openEditForm(item);
                  }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-charcoal truncate">{item.title}</div>
                    <div className="text-xs text-warm-grey">
                      {item._type === 'task'
                        ? (item.due_time ? new Date(`2000-01-01T${item.due_time}`).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit' }) : 'All day')
                        : (item.all_day ? 'All day' : formatTime(item.start_time))}
                      {item.assigned_to_name ? ` · ${item.assigned_to_name}` : ''}
                    </div>
                  </div>
                  <span
                    className="text-[9px] font-semibold px-2 py-0.5 rounded-md shrink-0"
                    style={{ background: badge.bg, color: badge.color }}
                  >
                    {badge.label}
                  </span>
                  {memberInfo && (
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0" style={{ background: memberInfo.hex }}>
                      {memberInfo.initial}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Day Detail Panel (Month view selected date) ────── */}
      {viewMode === 'month' && selectedDate && !isSameDay(selectedDate, today) && (
        <div className="hidden md:block bg-white rounded-2xl p-5 space-y-4" style={{ boxShadow: '0 2px 8px rgba(107,63,160,0.06)' }}>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-charcoal" style={{ fontFamily: 'var(--font-display)' }}>{formatLongDate(selectedDate)}</h2>
            <button onClick={() => openAddForm(selectedDate)} className="text-sm text-plum hover:text-plum-dark font-medium flex items-center gap-1">
              <IconPlus className="h-4 w-4" /> Add event
            </button>
          </div>

          {selectedEvents.length > 0 ? (
            <div className="space-y-2">
              <h3 className="text-[11px] text-warm-grey uppercase tracking-wider font-semibold">Events</h3>
              {selectedEvents.map(ev => {
                const hex = getEventHex(ev);
                const colors = EVENT_COLORS[getEventColor(ev)] || EVENT_COLORS.lavender;
                return (
                  <div key={ev.id} className={`border-l-4 ${colors.border} ${colors.bg} rounded-r-lg px-3 py-2`}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className={`font-medium ${colors.text}`}>{ev.title}</p>
                        <p className="text-xs text-warm-grey">
                          {ev.all_day ? 'All day' : `${formatTime(ev.start_time)} – ${formatTime(ev.end_time)}`}
                          {ev.location ? ` · ${ev.location}` : ''}
                        </p>
                        {ev.assigned_to_name && (
                          <p className="text-xs text-warm-grey flex items-center gap-1 mt-0.5">
                            <IconUser className="h-3 w-3" /> {ev.assigned_to_name}
                          </p>
                        )}
                      </div>
                      {ev.category !== 'public_holiday' && ev.category !== 'birthday' && (
                        <div className="flex gap-1 shrink-0">
                          <button onClick={() => openEditForm(ev)} className="text-warm-grey hover:text-plum p-1 rounded transition-colors" title="Edit">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                              <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                            </svg>
                          </button>
                          <button onClick={() => deleteEvent(ev.id)} className="text-warm-grey hover:text-coral p-1 rounded transition-colors" title="Delete">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                            </svg>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : selectedTasks.length === 0 ? (
            <p className="text-sm text-warm-grey">No events or tasks for this day</p>
          ) : null}

          {selectedTasks.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-[11px] text-warm-grey uppercase tracking-wider font-semibold">Tasks</h3>
              {selectedTasks.map(tk => (
                <div key={tk.id} className="flex items-center gap-3 py-1.5">
                  <button
                    onClick={() => toggleTask(tk)}
                    disabled={toggling.has(tk.id)}
                    className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 transition-colors ${
                      tk.completed ? 'bg-plum border-plum text-white' : 'border-light-grey hover:border-plum'
                    }`}
                  >
                    {tk.completed && <IconCheck className="h-3 w-3" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <span className={`text-sm ${tk.completed ? 'line-through text-warm-grey' : 'text-charcoal'}`}>{tk.title}</span>
                    {tk.due_time && !tk.completed && (
                      <span className="text-xs text-warm-grey ml-1">at {tk.due_time.substring(0, 5)}</span>
                    )}
                    {tk.assigned_to_name && (
                      <span className="text-xs text-warm-grey flex items-center gap-1 mt-0.5">
                        <IconUser className="h-3 w-3" /> {tk.assigned_to_name}
                      </span>
                    )}
                  </div>
                  {!tk.completed && (
                    <div className="flex gap-1 shrink-0">
                      <button onClick={() => openTaskEditForm(tk)} className="text-warm-grey hover:text-plum p-1 rounded transition-colors" title="Edit">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                          <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => deleteTask(tk)}
                        disabled={deletingTask.has(tk.id)}
                        className="text-warm-grey hover:text-coral p-1 rounded transition-colors"
                        title="Delete"
                      >
                        {deletingTask.has(tk.id) ? '...' : (
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

      {/* ── Event Form Modal ───────────────────────────────────── */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => { setShowForm(false); resetForm(); }}>
          <div className="absolute inset-0 bg-black/40" />
          <div ref={formRef} onClick={(e) => e.stopPropagation()} className="relative bg-white rounded-2xl border border-light-grey p-6 w-full max-w-md max-h-[90vh] overflow-y-auto" style={{ boxShadow: 'var(--shadow-lg)' }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-charcoal" style={{ fontFamily: 'var(--font-display)' }}>
                {editingEvent ? 'Edit Event' : 'New Event'}
              </h2>
              <button type="button" onClick={() => { setShowForm(false); resetForm(); }} className="text-warm-grey hover:text-charcoal p-1">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="text-[13px] font-medium text-charcoal mb-1 block">Title *</label>
                <input
                  type="text"
                  value={formTitle}
                  onChange={e => setFormTitle(e.target.value)}
                  required
                  className="w-full h-12 border-[1.5px] border-light-grey rounded-[10px] px-3 text-sm bg-cream focus:border-plum focus:outline-none focus:ring-1 focus:ring-plum/20"
                  placeholder="Event title"
                />
              </div>
              <div>
                <label className="text-[13px] font-medium text-charcoal mb-1 block">Date</label>
                <input
                  type="date"
                  value={formDate}
                  onChange={e => setFormDate(e.target.value)}
                  className="w-full h-12 border-[1.5px] border-light-grey rounded-[10px] px-3 text-sm bg-cream focus:border-plum focus:outline-none focus:ring-1 focus:ring-plum/20"
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-charcoal cursor-pointer">
                <input type="checkbox" checked={formAllDay} onChange={e => setFormAllDay(e.target.checked)} className="rounded" />
                All day
              </label>
              {!formAllDay && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[13px] font-medium text-charcoal mb-1 block">Start time</label>
                    <input
                      type="time"
                      value={formStart}
                      onChange={e => setFormStart(e.target.value)}
                      className="w-full h-12 border-[1.5px] border-light-grey rounded-[10px] px-3 text-sm bg-cream focus:border-plum focus:outline-none focus:ring-1 focus:ring-plum/20"
                    />
                  </div>
                  <div>
                    <label className="text-[13px] font-medium text-charcoal mb-1 block">End time</label>
                    <input
                      type="time"
                      value={formEnd}
                      onChange={e => setFormEnd(e.target.value)}
                      className="w-full h-12 border-[1.5px] border-light-grey rounded-[10px] px-3 text-sm bg-cream focus:border-plum focus:outline-none focus:ring-1 focus:ring-plum/20"
                    />
                  </div>
                </div>
              )}
              <div>
                <label className="text-[13px] font-medium text-charcoal mb-1 block">Description</label>
                <textarea
                  value={formDesc}
                  onChange={e => setFormDesc(e.target.value)}
                  rows={2}
                  className="w-full border-[1.5px] border-light-grey rounded-[10px] px-3 py-2 text-sm bg-cream focus:border-plum focus:outline-none focus:ring-1 focus:ring-plum/20"
                  placeholder="Optional description"
                />
              </div>
              <div>
                <label className="text-[13px] font-medium text-charcoal mb-1 block">Location</label>
                <input
                  type="text"
                  value={formLocation}
                  onChange={e => setFormLocation(e.target.value)}
                  className="w-full h-12 border-[1.5px] border-light-grey rounded-[10px] px-3 text-sm bg-cream focus:border-plum focus:outline-none focus:ring-1 focus:ring-plum/20"
                  placeholder="Optional location"
                />
              </div>
              <div>
                <label className="text-[13px] font-medium text-charcoal mb-1 block">Assign to</label>
                <select
                  value={formAssignee}
                  onChange={e => {
                    setFormAssignee(e.target.value);
                    const assignedMember = members.find(m => m.name === e.target.value);
                    setFormColor(assignedMember?.color_theme || 'lavender');
                  }}
                  className="w-full h-12 border-[1.5px] border-light-grey rounded-[10px] px-3 text-sm bg-cream focus:border-plum focus:outline-none focus:ring-1 focus:ring-plum/20"
                >
                  <option value="">Unassigned</option>
                  {members.map(m => (
                    <option key={m.name} value={m.name}>{m.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[13px] font-medium text-charcoal mb-1 block">Recurrence</label>
                <select
                  value={formRecurrence}
                  onChange={e => setFormRecurrence(e.target.value)}
                  className="w-full h-12 border-[1.5px] border-light-grey rounded-[10px] px-3 text-sm bg-cream focus:border-plum focus:outline-none focus:ring-1 focus:ring-plum/20"
                >
                  {RECURRENCES.map(r => (
                    <option key={r} value={r}>{RECURRENCE_LABELS[r]}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2 pt-2">
                <button
                  type="submit"
                  disabled={saving || !formTitle.trim()}
                  className="h-10 px-5 rounded-xl bg-plum hover:bg-plum-dark disabled:opacity-50 text-white text-sm font-semibold transition-colors"
                >
                  {saving ? 'Saving...' : editingEvent ? 'Update' : 'Save'}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowForm(false); resetForm(); }}
                  className="h-10 px-5 rounded-xl border-[1.5px] border-light-grey text-warm-grey hover:bg-cream text-sm font-semibold transition-colors"
                >
                  Cancel
                </button>
                {editingEvent && (
                  <button
                    type="button"
                    onClick={() => deleteEvent(editingEvent.id)}
                    className="ml-auto text-sm text-coral hover:text-coral font-semibold"
                  >
                    Delete
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Task Edit Form Modal ────────────────────────────────── */}
      {showTaskForm && editingTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={closeTaskForm}>
          <div className="absolute inset-0 bg-black/40" />
          <div ref={taskFormRef} onClick={(e) => e.stopPropagation()} className="relative bg-white rounded-2xl border border-light-grey p-6 w-full max-w-md max-h-[90vh] overflow-y-auto" style={{ boxShadow: 'var(--shadow-lg)' }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-charcoal" style={{ fontFamily: 'var(--font-display)' }}>Edit Task</h2>
              <button type="button" onClick={closeTaskForm} className="text-warm-grey hover:text-charcoal p-1">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
            <form onSubmit={handleTaskSubmit} className="space-y-3">
              <div>
                <label className="text-[13px] font-medium text-charcoal mb-1 block">Title *</label>
                <input
                  type="text"
                  value={taskTitle}
                  onChange={e => setTaskTitle(e.target.value)}
                  required
                  className="w-full h-12 border-[1.5px] border-light-grey rounded-[10px] px-3 text-sm bg-cream focus:border-plum focus:outline-none focus:ring-1 focus:ring-plum/20"
                  placeholder="Task title"
                />
              </div>
              <div>
                <label className="text-[13px] font-medium text-charcoal mb-1 block">Description (optional)</label>
                <textarea
                  value={taskDescription}
                  onChange={e => setTaskDescription(e.target.value)}
                  placeholder="Add a description..."
                  rows={2}
                  className="w-full border-[1.5px] border-light-grey rounded-[10px] px-3 py-2 text-sm bg-cream focus:border-plum focus:outline-none focus:ring-1 focus:ring-plum/20 resize-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[13px] font-medium text-charcoal mb-1 block">Due date</label>
                  <input
                    type="date"
                    value={taskDueDate}
                    onChange={e => setTaskDueDate(e.target.value)}
                    className="w-full h-12 border-[1.5px] border-light-grey rounded-[10px] px-3 text-sm bg-cream focus:border-plum focus:outline-none focus:ring-1 focus:ring-plum/20"
                  />
                </div>
                <div>
                  <label className="text-[13px] font-medium text-charcoal mb-1 block">Time (optional)</label>
                  <input
                    type="time"
                    value={taskDueTime}
                    onChange={e => setTaskDueTime(e.target.value)}
                    className="w-full h-12 border-[1.5px] border-light-grey rounded-[10px] px-3 text-sm bg-cream focus:border-plum focus:outline-none focus:ring-1 focus:ring-plum/20"
                  />
                </div>
                <div>
                  <label className="text-[13px] font-medium text-charcoal mb-1 block">Assign to</label>
                  <select
                    value={taskAssignee}
                    onChange={e => setTaskAssignee(e.target.value)}
                    className="w-full h-12 border-[1.5px] border-light-grey rounded-[10px] px-3 text-sm bg-white focus:border-plum focus:outline-none focus:ring-1 focus:ring-plum/20"
                  >
                    <option value="">Everyone</option>
                    {members.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[13px] font-medium text-charcoal mb-1 block">Repeats</label>
                  <select
                    value={taskRecurrence}
                    onChange={e => setTaskRecurrence(e.target.value)}
                    className="w-full h-12 border-[1.5px] border-light-grey rounded-[10px] px-3 text-sm bg-white focus:border-plum focus:outline-none focus:ring-1 focus:ring-plum/20"
                  >
                    {RECURRENCES.map(r => <option key={r} value={r}>{r || 'Never'}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[13px] font-medium text-charcoal mb-1 block">Notification</label>
                  <select
                    value={taskNotification}
                    onChange={e => setTaskNotification(e.target.value)}
                    className="w-full h-12 border-[1.5px] border-light-grey rounded-[10px] px-3 text-sm bg-white focus:border-plum focus:outline-none focus:ring-1 focus:ring-plum/20"
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
                  className="h-10 px-5 rounded-xl bg-plum hover:bg-plum-dark disabled:opacity-50 text-white text-sm font-semibold transition-colors"
                >
                  {savingTask ? 'Saving...' : 'Save changes'}
                </button>
                <button
                  type="button"
                  onClick={closeTaskForm}
                  className="text-sm text-warm-grey hover:text-charcoal font-medium"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
