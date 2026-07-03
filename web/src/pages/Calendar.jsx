import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import api from '../lib/api';
import Spinner from '../components/Spinner';
import ErrorBanner from '../components/ErrorBanner';
import { IconCalendar, IconPlus, IconUser, IconCheck, IconSearch, IconSettings, IconTrash } from '../components/Icons';
import PageHeader from '../components/ui/PageHeader';
import Avatar from '../components/ui/Avatar';
import PillBtn from '../components/ui/PillBtn';
import { BottomSheet } from '../components/BottomSheet';
import Segmented from '../components/ui/Segmented';
import { useCanWrite } from '../context/SubscriptionContext';
import { useChildMode } from '../context/ChildModeContext';
import SubscribePrompt from '../components/SubscribePrompt';
import { readCache, writeCache, loadCached } from '../lib/offlineCache';
import { usePullToRefresh, PullIndicator } from '../hooks/usePullToRefresh';
import { useAppForegroundRefresh } from '../hooks/useAppForegroundRefresh';
import { confirmDestructive } from '../lib/action-sheet';

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
  sage: '#7DAE82', plum: '#6B3FA0', coral: '#E8724A', pink: '#D4537E',
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
const RECURRENCE_LABELS = { '': 'Does not repeat', daily: 'Daily', weekly: 'Weekly', biweekly: 'Biweekly', monthly: 'Monthly', yearly: 'Yearly' };

const REMINDER_OPTIONS = [
  { value: '5', unit: 'minutes', label: '5 minutes before' },
  { value: '10', unit: 'minutes', label: '10 minutes before' },
  { value: '15', unit: 'minutes', label: '15 minutes before' },
  { value: '30', unit: 'minutes', label: '30 minutes before' },
  { value: '45', unit: 'minutes', label: '45 minutes before' },
  { value: '1', unit: 'hours', label: '1 hour before' },
  { value: '2', unit: 'hours', label: '2 hours before' },
  { value: '3', unit: 'hours', label: '3 hours before' },
  { value: '1', unit: 'days', label: '1 day before' },
  { value: '2', unit: 'days', label: '2 days before' },
  { value: '1', unit: 'weeks', label: '1 week before' },
];

const DAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

// ── Date helpers ────────────────────────────────────────────

function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function monthParam(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Dedup calendar events. Recurring events reuse their base row id across every
// expanded occurrence (only occurrence_key is unique), so key on occurrence_key
// first. Then prefer a NATIVE event over a read-only SYNCED copy on a title+date
// collision (a subscribed event deleted at the source lingers in our copy until
// the feed pull confirms removal, and would otherwise hide the user's re-created
// event). Finally drop exact dupes by title + START TIME (keying on the time so
// two same-title events on one day both survive). Shared by load() and the
// cache-first seed so both surfaces agree.
function dedupeEvents(allEvents) {
  const byId = [...new Map(allEvents.map(e => [e.occurrence_key || e.id, e])).values()];
  byId.sort((a, b) => (a.external_feed_id ? 1 : 0) - (b.external_feed_id ? 1 : 0));
  const nativeTitleDates = new Set(
    byId.filter(e => !e.external_feed_id)
      .map(e => `${(e.title || '').toLowerCase().trim()}|${(e.start_time || '').split('T')[0]}`),
  );
  const seen = new Set();
  return byId.filter(e => {
    const title = (e.title || '').toLowerCase().trim();
    if (e.external_feed_id && nativeTitleDates.has(`${title}|${(e.start_time || '').split('T')[0]}`)) return false;
    const key = `${title}|${e.start_time || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
  const canWrite = useCanWrite();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [viewMode, setViewMode] = useState('month');
  const [currentMonth, setCurrentMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(new Date(today));
  const [morePopup, setMorePopup] = useState(null); // { date, items, rect }
  // Cache-first seed: paint the last-persisted current month instantly on a cold
  // launch so the calendar never opens blank (within-session month navigation is
  // already instant via monthCacheRef). load() revalidates right after.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- read once, at mount
  const seedMonth = useMemo(() => readCache(`calendar:month:${monthParam(new Date(today.getFullYear(), today.getMonth(), 1))}`)?.data || null, []);
  const [events, setEvents] = useState(() => (seedMonth ? dedupeEvents(Array.isArray(seedMonth.events) ? seedMonth.events : []) : []));
  const [tasks, setTasks] = useState(() => (seedMonth ? [...new Map((Array.isArray(seedMonth.tasks) ? seedMonth.tasks : []).map(t => [t.id, t])).values()] : []));
  const [members, setMembers] = useState([]);
  const { enabled: childMode } = useChildMode();
  const [schoolData, setSchoolData] = useState(null);
  const [activitiesData, setActivitiesData] = useState(null);
  // Subscribed (read-only) external calendars. Used to colour their
  // events with the per-feed colour configured in Settings, so a
  // subscribed event reads visually distinct from a native Housemait
  // event - previously everything-not-assigned fell through to plum,
  // which made it impossible to tell at a glance which events were
  // 'yours' vs 'pulled from someone else's calendar'.
  const [externalFeeds, setExternalFeeds] = useState([]);
  const [syncedEvent, setSyncedEvent] = useState(null); // read-only detail sheet for synced events
  const [loading, setLoading] = useState(!seedMonth);
  const [error, setError] = useState('');
  // Form state
  const [showForm, setShowForm] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);
  // Event attachments (files linked to an existing event).
  const [eventAttachments, setEventAttachments] = useState([]);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const attachmentInputRef = useRef(null);
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
  const [formEndDate, setFormEndDate] = useState(toDateStr(today));
  const [formAssignees, setFormAssignees] = useState([]);
  // Default to no reminder. The "+ Add notification" button lets users
  // opt in explicitly. Pre-checking a 5-min default surprised users who
  // never asked for one (and silently saved an actual reminder row if
  // they edited the event without touching the field).
  const [formReminders, setFormReminders] = useState([]);
  const [showMoreOptions, setShowMoreOptions] = useState(false);
  const [saving, setSaving] = useState(false);

  const [toggling, setToggling] = useState(new Set());
  const [deletingTask, setDeletingTask] = useState(new Set());

  // Task edit form state
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDueDate, setTaskDueDate] = useState('');
  const [taskDueTime, setTaskDueTime] = useState('');
  // Calendar's inline task-edit modal: multi-assignee names.
  const [taskAssignees, setTaskAssignees] = useState([]);
  const [taskRecurrence, setTaskRecurrence] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [taskNotification, setTaskNotification] = useState('');
  const [savingTask, setSavingTask] = useState(false);
  const taskFormRef = useRef(null);

  // Search state
  const [showSearch, setShowSearch] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false); // mobile-only search toggle (desktop uses showSearch)
  const [searchQuery, setSearchQuery] = useState('');
  const searchRef = useRef(null);

  // Settings popup
  const [showSettings, setShowSettings] = useState(false);
  const settingsRef = useRef(null);
  // Mobile filter sheet (the desktop cog is hidden on phones)
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

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

  // ── Client-side month cache (avoids re-fetching already loaded months) ──
  const monthCacheRef = useRef({}); // { '2026-03': { events: [...], tasks: [...], ts: Date.now() } }
  const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  function invalidateMonthCache() {
    monthCacheRef.current = {};
  }

  async function fetchMonth(mp) {
    const cached = monthCacheRef.current[mp];
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      return { events: cached.events, tasks: cached.tasks };
    }
    try {
      const res = await api.get('/calendar/month', { params: { month: mp } });
      const rawEvents = res.data?.events; const rawTasks = res.data?.tasks;
      const entry = { events: Array.isArray(rawEvents) ? rawEvents : [], tasks: Array.isArray(rawTasks) ? rawTasks : [], ts: Date.now() };
      monthCacheRef.current[mp] = entry;
      writeCache(`calendar:month:${mp}`, { events: entry.events, tasks: entry.tasks });
      return entry;
    } catch (err) {
      // Offline fallback - fall back to whatever we last persisted for
      // this month, if anything. Memory-cache it too so subsequent
      // accesses this session don't keep hitting the network.
      const persisted = readCache(`calendar:month:${mp}`);
      if (persisted) {
        const entry = { events: persisted.data.events || [], tasks: persisted.data.tasks || [], ts: Date.now() };
        monthCacheRef.current[mp] = entry;
        return entry;
      }
      throw err;
    }
  }

  // Prefetch adjacent months in the background
  function prefetchAdjacent(date) {
    const prev = new Date(date.getFullYear(), date.getMonth() - 1, 1);
    const next = new Date(date.getFullYear(), date.getMonth() + 1, 1);
    [prev, next].forEach(d => {
      const mp = monthParam(d);
      if (!monthCacheRef.current[mp]) {
        fetchMonth(mp).catch(() => {}); // fire-and-forget
      }
    });
  }

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

      const monthResults = await Promise.all(monthsToFetch.map(fetchMonth));
      const schoolFetch = schoolData ? Promise.resolve(null) : api.get('/schools').catch(() => null);
      const activitiesFetch = activitiesData ? Promise.resolve(null) : api.get('/schools/activities').catch(() => null);
      const [freshSchoolData, freshActivities] = await Promise.all([schoolFetch, activitiesFetch]);

      const allEvents = monthResults.flatMap(r => r.events);
      const allTasks = monthResults.flatMap(r => r.tasks);

      // Prefetch adjacent months in background
      prefetchAdjacent(viewMode === 'month' ? currentMonth : selectedDate);

      // Dedup by occurrence first, then by title+date. Recurring events reuse
      // their base row id across EVERY expanded occurrence (only occurrence_key
      // is unique), so keying the Map on e.id alone collapsed a whole series to
      // a single day - which is why a recurring event showed on the dashboard
      // (single-day window) but vanished from the calendar's month grid. Key on
      // the unique occurrence_key when present, falling back to id.
      // Dedup events (recurring occurrences, synced-vs-native collisions, exact
      // title+time dupes) - shared with the cache-first seed. See dedupeEvents.
      const uniqueEvents = dedupeEvents(allEvents);
      const uniqueTasks = [...new Map(allTasks.map(t => [t.id, t])).values()];

      const rawSchools = freshSchoolData ? freshSchoolData.data?.schools : schoolData;
      const schools = Array.isArray(rawSchools) ? rawSchools : [];
      if (freshSchoolData) setSchoolData(schools);

      const rawActivities = freshActivities ? freshActivities.data?.activities : activitiesData;
      const activities = Array.isArray(rawActivities) ? rawActivities : [];
      if (freshActivities) setActivitiesData(activities);

      // Scope all school-derived events (term dates AND weekly activities) to
      // the exact months we fetched events for, so leak-through cells (days
      // from prev/next month shown in the grid when the 1st falls mid-week)
      // stay consistent with the rest of the displayed events. Without this,
      // school events appear in cells where regular events are hidden, which
      // looks like a broken grid.
      const sortedMonths = [...monthsToFetch].sort();
      const [firstY, firstM] = sortedMonths[0].split('-').map(Number);
      const [lastY, lastM] = sortedMonths[sortedMonths.length - 1].split('-').map(Number);
      const rangeStartStr = `${firstY}-${String(firstM).padStart(2, '0')}-01`;
      const lastDayOfLastM = new Date(lastY, lastM, 0).getDate();
      const rangeEndStr = `${lastY}-${String(lastM).padStart(2, '0')}-${String(lastDayOfLastM).padStart(2, '0')}`;

      // Build school events
      const schoolEvents = [];
      for (const school of schools) {
        for (const td of (school.term_dates || [])) {
          if (!td.date) continue;
          // Skip term dates whose whole range falls outside the displayed
          // months (lexicographic compare works because dates are YYYY-MM-DD).
          const tdEnd = td.end_date || td.date;
          if (tdEnd < rangeStartStr || td.date > rangeEndStr) continue;
          schoolEvents.push({
            id: `td-${td.id}`,
            title: `${school.school_name} - ${td.label || (td.event_type || 'school event').replace(/_/g, ' ')}`,
            start_time: `${td.date}T00:00:00Z`,
            end_time: td.end_date ? `${td.end_date}T23:59:59Z` : `${td.date}T23:59:59Z`,
            all_day: true,
            category: 'school',
            color: school.colour || 'lavender',
            _school: true,
          });
        }
      }

      // Weekly extracurriculars come from the flat, school-independent
      // /schools/activities endpoint (every child's child_weekly_schedule,
      // whether or not the child is linked to a school). The school-nested
      // payload above only carries activities for children whose school_id
      // matches a school, so a child with no linked school - the common case,
      // since a child carries no school by default - would otherwise never
      // surface here. Resolve each child_id to a member for the name + colour.
      // Child Mode shows every activity; the parent view shows the ones
      // flagged show_on_calendar (the "Show on the family calendar" toggle
      // in the Family page's activity modal - default on, absent = true for
      // rows created before the flag existed).
      const memberById = new Map(members.map((m) => [m.id, m]));
      const visibleActs = childMode ? activities : activities.filter((a) => a.show_on_calendar !== false);
      for (const act of visibleActs) {
        const child = memberById.get(act.child_id);
        if (!child) continue;
        const start = new Date(firstY, firstM - 1, 1);
        const end = new Date(lastY, lastM, 0); // day=0 → last day of (lastM)
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
          const jsDay = d.getDay();
          const ourDay = (jsDay + 6) % 7;
          if (ourDay === act.day_of_week) {
            // Use local-date components, NOT toISOString - during BST,
            // a `Date` for "Mon 4 May 00:00 local" is "Sun 3 May 23:00 UTC",
            // so toISOString().split('T')[0] would return Sunday's date and
            // the activity would render on the wrong day.
            const dateStr = toDateStr(d);
            schoolEvents.push({
              id: `act-${act.id}-${dateStr}`,
              title: `${child.name} - ${act.activity}`,
              start_time: act.time_start ? `${dateStr}T${act.time_start}` : `${dateStr}T00:00:00Z`,
              end_time: act.time_end ? `${dateStr}T${act.time_end}` : null,
              all_day: !act.time_start,
              category: 'school',
              assigned_to_names: [child.name],
              color: child.color_theme || 'sky',
              _school: true,
              _activity: true,
            });
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
  }, [currentMonth, selectedDate, viewMode, members, childMode]);

  useEffect(() => {
    // No setLoading(true) here: keep the current (stale) events visible while
    // revalidating, so switching month/view - and the cache-first cold start -
    // never flash a skeleton over data we can already show. The skeleton shows
    // only on a genuinely empty first launch (initial `loading` state above).
    load();
  }, [load]);

  // Pull-to-refresh (iOS gesture) + refresh on app foreground, matching the
  // Dashboard. Both clear the 5-min in-memory month cache so they pull fresh.
  const refresh = useCallback(async () => {
    monthCacheRef.current = {};
    await load();
  }, [load]);
  const ptr = usePullToRefresh(refresh);
  useAppForegroundRefresh(refresh);

  // The AI chat overlay creates/deletes events while this page stays
  // mounted; its broadcast busts the 5-min month cache so the new event
  // shows up immediately rather than after the TTL or a manual refresh.
  useEffect(() => {
    const onDataChanged = () => { refresh(); };
    window.addEventListener('housemait:data-changed', onDataChanged);
    return () => window.removeEventListener('housemait:data-changed', onDataChanged);
  }, [refresh]);

  useEffect(() => {
    loadCached(
      'household:members',
      () => api.get('/household').then(r => r.data.members ?? []),
      setMembers,
    ).catch(() => {});
  }, []);

  // Load the household's subscribed external calendars once so we can
  // colour their events with the per-feed colour the user configured.
  // Failure here is non-fatal: external events just fall back to plum.
  useEffect(() => {
    api.get('/calendar/external-feeds')
      .then(({ data }) => setExternalFeeds(Array.isArray(data?.feeds) ? data.feeds : []))
      .catch(() => {});
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
      setActiveMemberFilters(new Set(members.map(m => m.id)));
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
    return selectedDate.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
  }, [viewMode, currentMonth, selectedDate]);

  // ── Items for a given date ─────────────────────────────

  // Resolve an item's assignees to a Set of CURRENT member IDs, drawing from
  // every source: the event_assignees-derived `assignees` (member_id - the same
  // source the dashboard avatars use), the assigned_to_ids column, and any
  // assigned_to_names mapped onto current members. Matching on identity rather
  // than text means a stale/drifted stored name can never cause a mismatch.
  // Only current members are included, so the result is empty when an item
  // resolves to nobody in the household - the filter then treats it as
  // household-wide.
  function assigneeMemberIds(item, nameToId, memberIdSet) {
    const ids = new Set();
    for (const a of (item.assignees || [])) {
      if (a?.member_id && memberIdSet.has(a.member_id)) ids.add(a.member_id);
    }
    for (const id of (item.assigned_to_ids || [])) {
      if (memberIdSet.has(id)) ids.add(id);
    }
    const names = Array.isArray(item.assigned_to_names) && item.assigned_to_names.length > 0
      ? item.assigned_to_names
      : (item.assigned_to_name ? [item.assigned_to_name] : []);
    for (const n of names) {
      const id = nameToId.get(n);
      if (id) ids.add(id);
    }
    return ids;
  }

  function eventsForDate(date) {
    const ds = toDateStr(date);
    const memberIdSet = new Set(members.map((m) => m.id));
    const nameToId = new Map(members.map((m) => [m.name, m.id]));
    const kidIds = childMode ? new Set(members.filter((m) => m.member_type === 'dependent').map((m) => m.id)) : null;
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
      // Child Mode: holidays + school (term dates / extracurriculars) stay; any
      // other event must be assigned to a dependent. Unassigned adult/household
      // events are hidden (a deliberate departure from the fail-open default).
      if (childMode && cat !== 'public_holiday' && cat !== 'school') {
        const ids = assigneeMemberIds(e, nameToId, memberIdSet);
        if (![...ids].some((id) => kidIds.has(id))) return false;
      }
      // Member filter by IDENTITY (member id), and FAIL OPEN: hide only when the
      // item is assigned to current member(s) who are ALL toggled off. An item
      // resolving to no current member is treated as household-wide and shown -
      // so a drifted/stale stored name can never silently hide it.
      if (activeMemberFilters) {
        const ids = assigneeMemberIds(e, nameToId, memberIdSet);
        if (ids.size > 0 && ![...ids].some((id) => activeMemberFilters.has(id))) return false;
      }
      return true;
    });
  }

  function tasksForDate(date) {
    if (!activeFilters.has('tasks')) return [];
    const ds = toDateStr(date);
    const memberIdSet = new Set(members.map((m) => m.id));
    const nameToId = new Map(members.map((m) => [m.name, m.id]));
    const kidIds = childMode ? new Set(members.filter((m) => m.member_type === 'dependent').map((m) => m.id)) : null;
    return tasks.filter(t => {
      if (t.due_date !== ds) return false;
      // Child Mode: only a dependent's tasks appear on the calendar.
      if (childMode) {
        const ids = assigneeMemberIds(t, nameToId, memberIdSet);
        if (![...ids].some((id) => kidIds.has(id))) return false;
      }
      if (activeMemberFilters) {
        const ids = assigneeMemberIds(t, nameToId, memberIdSet);
        if (ids.size > 0 && ![...ids].some((id) => activeMemberFilters.has(id))) return false;
      }
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
    setFormEndDate(toDateStr(selectedDate || today));
    setFormAllDay(false);
    setFormStart('09:00');
    setFormEnd('10:00');
    setFormDesc('');
    setFormLocation('');
    setFormColor('lavender');
    setFormAssignee('');
    setFormAssignees([]);
    setFormRecurrence('');
    setFormReminders([]);
    setShowMoreOptions(false);
    setEventAttachments([]);
  }

  async function loadAttachments(eventId) {
    try {
      const { data } = await api.get(`/calendar/events/${eventId}/attachments`);
      setEventAttachments(data.attachments || []);
    } catch {
      setEventAttachments([]);
    }
  }

  async function handleAttachmentUpload(e) {
    const file = e.target.files?.[0];
    if (!file || !editingEvent?.id) return;
    setUploadingAttachment(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { data } = await api.post(`/calendar/events/${editingEvent.id}/attachments`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setEventAttachments(prev => [...prev, data.attachment]);
    } catch (err) {
      alert(err.response?.data?.error || 'Could not attach that file.');
    } finally {
      setUploadingAttachment(false);
      if (attachmentInputRef.current) attachmentInputRef.current.value = '';
    }
  }

  async function deleteAttachment(id) {
    try {
      await api.delete(`/calendar/attachments/${id}`);
      setEventAttachments(prev => prev.filter(a => a.id !== id));
    } catch {
      alert('Could not remove that attachment.');
    }
  }

  function openAddForm(date, hour) {
    if (childMode) return; // calendar is read-only for kids
    resetForm();
    if (date) {
      setFormDate(toDateStr(date));
      setFormEndDate(toDateStr(date));
    }
    if (hour !== undefined) {
      setFormStart(`${String(hour).padStart(2, '0')}:00`);
      setFormEnd(`${String(Math.min(hour + 1, 23)).padStart(2, '0')}:00`);
    }
    setShowForm(true);
  }

  function openEditForm(ev) {
    // In Child Mode the calendar is read-only: tapping an event opens the
    // detail sheet (title/date/time/location) so kids can see what's on,
    // but never the editor.
    if (childMode) {
      setSyncedEvent(ev);
      return;
    }
    // Synced copies (device sync / URL feeds) are READ-ONLY: an edit here
    // would silently revert on the next sync and a delete would resurrect -
    // the most confusing possible outcome. Show a detail sheet with
    // provenance instead of the edit modal.
    if (ev.external_feed_id) {
      setSyncedEvent(ev);
      return;
    }
    setEditingEvent(ev);
    setEventAttachments([]);
    if (ev.id) loadAttachments(ev.id);
    setFormTitle(ev.title || '');
    setFormDate(ev.start_time?.split('T')[0] || toDateStr(selectedDate));
    setFormEndDate(ev.end_time?.split('T')[0] || ev.start_time?.split('T')[0] || toDateStr(selectedDate));
    setFormAllDay(!!ev.all_day);
    setFormStart(ev.start_time ? formatTime(ev.start_time) : '09:00');
    setFormEnd(ev.end_time ? formatTime(ev.end_time) : '10:00');
    setFormDesc(ev.description || '');
    setFormLocation(ev.location || '');
    // Pick the chip colour from the first assignee. Multi-assignee events
    // still get one colour on the calendar; the multi-avatar stack covers
    // the "who" disambiguation in the UI.
    const initialNames = Array.isArray(ev.assigned_to_names) && ev.assigned_to_names.length > 0
      ? ev.assigned_to_names.filter(Boolean)
      : (ev.assignees && Array.isArray(ev.assignees) && ev.assignees.length > 0)
        ? ev.assignees.map(a => a.member_name).filter(Boolean)
        : (ev.assigned_to_name ? [ev.assigned_to_name] : []);
    const firstAssignedMember = initialNames.length > 0
      ? members.find(m => m.name === initialNames[0])
      : null;
    setFormColor(firstAssignedMember?.color_theme || ev.color || 'lavender');
    setFormAssignee(initialNames[0] || '');
    setFormAssignees(initialNames);
    setFormRecurrence(ev.recurrence || '');
    setFormReminders(ev.reminders && Array.isArray(ev.reminders) ? ev.reminders : []);
    setShowMoreOptions(false);
    setShowForm(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!formTitle.trim()) return;

    // Guard against an end that lands at or before the start (e.g. start
    // 15:00, end 10:00 on the same day). Compare the actual instants we'd
    // persist so the rule is identical for all-day and timed events. The
    // date pickers already stop the end DATE preceding the start date; this
    // closes the same-day time gap they can't catch.
    const startAt = formAllDay
      ? new Date(`${formDate}T00:00:00`)
      : new Date(`${formDate}T${formStart}:00`);
    const endAt = formAllDay
      ? new Date(`${formEndDate || formDate}T23:59:59`)
      : new Date(`${formEndDate || formDate}T${formEnd}:00`);
    if (endAt <= startAt) {
      setError(formAllDay
        ? 'The end date can’t be before the start date.'
        : 'The end time must be after the start time.');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        title: formTitle.trim(),
        all_day: formAllDay,
        description: formDesc.trim() || null,
        location: formLocation.trim() || null,
        color: formColor,
        recurrence: formRecurrence || null,
        // The backend now stores assignees as parallel id + name arrays.
        // We send only the names; the route resolves them and writes
        // both columns.
        assigned_to_names: formAssignees,
        reminders: formReminders.length > 0 ? formReminders : null,
      };
      if (formAllDay) {
        // All-day events are stored at UTC midnight (the canonical "this
        // day" marker), so we can ship them as naked timestamps - Postgres
        // will interpret them as UTC, which is what we want.
        payload.start_time = `${formDate}T00:00:00`;
        payload.end_time = `${formEndDate || formDate}T23:59:59`;
      } else {
        // Timed events: the user types a *local* time ("10:00" in BST).
        // `new Date("2026-05-12T10:00:00")` (no trailing Z) parses as local
        // time, and `.toISOString()` converts to the correct UTC instant.
        // Without this conversion, Postgres' timestamptz column would
        // interpret the naked timestamp as UTC and the event would land
        // an hour late on every BST/CEST/etc. clock.
        payload.start_time = new Date(`${formDate}T${formStart}:00`).toISOString();
        payload.end_time = new Date(`${formEndDate || formDate}T${formEnd}:00`).toISOString();
      }

      if (editingEvent) {
        await api.patch(`/calendar/events/${editingEvent.id}`, payload);
      } else {
        try {
          await api.post('/calendar/events', payload);
        } catch (err) {
          // Backend returns 409 when a matching event already exists for the
          // same date, to prevent silent duplicates. Ask the user whether to
          // add a second copy anyway and, if yes, re-send with force: true.
          if (err.response?.status === 409) {
            const existingMsg = err.response?.data?.message || 'A similar event already exists.';
            const confirmMsg = `${existingMsg}\n\nAdd it anyway?`;
            if (window.confirm(confirmMsg)) {
              await api.post('/calendar/events', { ...payload, force: true });
            } else {
              setSaving(false);
              return; // keep the form open so the user can edit or cancel
            }
          } else {
            throw err;
          }
        }
      }
      setShowForm(false);
      resetForm();
      invalidateMonthCache();
      await load();
    } catch (err) {
      // Surface the server's actual error message instead of swallowing
      // it behind a generic banner - previously a failing PATCH said
      // only "Could not save event." with no hint of why. The backend
      // returns { error: "..." } for known issues, so prefer that;
      // otherwise fall back to the request error message.
      const serverMsg = err?.response?.data?.error || err?.response?.data?.message;
      const fallback = err?.message;
      setError(serverMsg
        ? `Could not save event: ${serverMsg}`
        : fallback
          ? `Could not save event: ${fallback}`
          : 'Could not save event.');
    } finally {
      setSaving(false);
    }
  }

  // Lookup of external-feed-id → configured colour for that feed.
  // Built once per feed-list change so getEventColor stays O(1).
  const feedColorById = useMemo(() => {
    const m = {};
    for (const f of externalFeeds) {
      if (f?.id) m[f.id] = f.color || 'slate';
    }
    return m;
  }, [externalFeeds]);

  // Resolve event colour. Precedence:
  //   1. Subscribed external calendar - use the feed's own colour so
  //      these read distinct from native Housemait events (previously
  //      both fell through to plum and were visually indistinguishable).
  //   2. First assigned member's theme.
  //   3. Category default (public holiday / birthday / school).
  //   4. Plum fallback for native unassigned ("everyone") events.
  // Multi-assignee events still get one colour - the avatar stack
  // carries the multi-person signal.
  function getEventColor(ev) {
    if (ev.external_feed_id && feedColorById[ev.external_feed_id]) {
      return feedColorById[ev.external_feed_id];
    }
    const names = Array.isArray(ev.assigned_to_names) && ev.assigned_to_names.length > 0
      ? ev.assigned_to_names
      : (ev.assigned_to_name ? [ev.assigned_to_name] : []);
    if (names.length > 0) {
      const m = members.find(member => member.name === names[0]);
      if (m?.color_theme) return m.color_theme;
    }
    if (ev.category === 'public_holiday') return 'sage';
    if (ev.category === 'birthday') return 'pink';
    if (ev.category === 'school') return 'amber';
    return 'plum';
  }

  function getEventHex(ev) {
    return COLOR_HEX[getEventColor(ev)] || COLOR_HEX.sage;
  }

  // Returns { bg, text } - light background with coloured text for softer event pills
  function getEventStyle(ev) {
    const hex = getEventHex(ev);
    return { bg: hex + '18', text: hex }; // 18 = ~9% opacity in hex alpha
  }

  async function deleteEvent(id) {
    const ok = await confirmDestructive({ title: 'Delete this event?', message: 'This cannot be undone.' });
    if (!ok) return;
    // Optimistic: yank from local state + close the modal immediately so the
    // user sees instant feedback. The reconciling load() runs in the
    // background and is mostly a safety net (a parallel update from another
    // device, or an event we know about that the API doesn't, etc.).
    setEvents(prev => prev.filter(e => e.id !== id));
    setShowForm(false);
    resetForm();
    invalidateMonthCache();
    try {
      await api.delete(`/calendar/events/${id}`);
      // Background refresh - don't await. If it adds the event back because
      // delete actually failed, the catch block below has already shown an
      // error and triggered the rollback path.
      load().catch(() => {});
    } catch {
      setError('Could not delete event.');
      // Rollback: re-fetch so the optimistic removal is undone if the
      // server still has the event.
      await load();
    }
  }

  async function toggleTask(task) {
    if (toggling.has(task.id)) return;
    setToggling(prev => new Set(prev).add(task.id));
    try {
      await api.patch(`/tasks/${task.id}`, { completed: !task.completed });
      invalidateMonthCache();
      await load();
    } catch {
      setError('Could not update task.');
    } finally {
      setToggling(prev => { const s = new Set(prev); s.delete(task.id); return s; });
    }
  }

  async function deleteTask(task) {
    const ok = await confirmDestructive({ title: `Delete "${task.title}"?`, message: "This can't be undone." });
    if (!ok) return;
    setDeletingTask(prev => new Set(prev).add(task.id));
    try {
      await api.delete(`/tasks/${task.id}`);
      invalidateMonthCache();
      await load();
    } catch {
      setError('Could not delete task.');
    } finally {
      setDeletingTask(prev => { const s = new Set(prev); s.delete(task.id); return s; });
    }
  }

  function openTaskEditForm(task) {
    if (childMode) return; // read-only for kids; they complete via the checkbox
    setEditingTask(task);
    setTaskTitle(task.title);
    setTaskDueDate(task.due_date);
    setTaskDueTime(task.due_time ? task.due_time.substring(0, 5) : '');
    setTaskAssignees(
      Array.isArray(task.assigned_to_names) && task.assigned_to_names.length > 0
        ? task.assigned_to_names.filter(Boolean)
        : task.assigned_to_name ? [task.assigned_to_name] : []
    );
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
        assigned_to_names: taskAssignees,
        recurrence: taskRecurrence || null,
        description: taskDescription || null,
        notification: taskNotification || null,
      });
      closeTaskForm();
      invalidateMonthCache();
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
  //
  // Search hits the backend (GET /api/calendar/search) with the full
  // typed query - no date filter, so it covers every event + task in
  // the household, not just the ~3-month window that's been loaded
  // into memory. Debounced 300 ms so each keystroke doesn't fire a
  // request, and only sends once the query is at least 2 chars.

  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);

  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }

    setSearchLoading(true);
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await api.get('/calendar/search', { params: { q } });
        if (cancelled) return;
        const matches = [];
        for (const ev of res.data?.events || []) {
          matches.push({
            type: 'event',
            item: ev,
            date: ev.start_time?.split('T')[0],
            title: ev.title,
          });
        }
        for (const t of res.data?.tasks || []) {
          matches.push({
            type: 'task',
            item: t,
            date: t.due_date,
            title: t.title,
          });
        }
        // School term dates live in their own table - added to the
        // backend payload so we can surface them here. The title shown
        // in the dropdown carries the school name so a parent searching
        // "Pesach" sees "Pesach (Herzlia)" rather than a context-free
        // label.
        for (const sd of res.data?.schoolDates || []) {
          matches.push({
            type: 'school_date',
            item: sd,
            date: sd.date,
            title: sd.school_name ? `${sd.label} (${sd.school_name})` : sd.label,
          });
        }
        // Sort newest-first: results from years out or years past
        // both sit below stuff close to "now" in the dropdown.
        // (Replaces the prior ascending sort, which pushed old
        // events to the top of a tight 20-row cap and effectively
        // hid recent matches.)
        matches.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        setSearchResults(matches.slice(0, 50));
      } catch {
        if (!cancelled) setSearchResults([]);
      } finally {
        if (!cancelled) setSearchLoading(false);
      }
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchQuery]);

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

  // Items for whichever day is selected in the month grid. Clicking a day
  // cell sets selectedDate; the rail below the grid renders this so desktop
  // reaches parity with mobile (where tapping a day already swaps the list).
  // selectedDate defaults to today, so this covers the today case too.
  const selectedDayItems = useMemo(() => {
    if (!selectedDate) return [];
    const items = [];
    eventsForDate(selectedDate).forEach(ev => items.push({ ...ev, _type: 'event' }));
    tasksForDate(selectedDate).forEach(t => items.push({ ...t, _type: 'task', start_time: t.due_time ? `${t.due_date}T${t.due_time}` : null }));
    items.sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, events, tasks, activeFilters, activeMemberFilters]);

  // Helper to get member initials + color
  /**
   * Returns the household member objects assigned to an event/task, for the
   * shared <Avatar> stack.
   * Source preference: the row's own `assigned_to_names[]` (the source
   * of truth post-migration), then the event_assignees join table
   * (still populated for reminder fanout), then the legacy single name.
   */
  function getEventMembers(ev) {
    // Prefer assigned_to_ids: it's stable across renames, whereas
    // assigned_to_names goes stale the moment a member is renamed (e.g.
    // "James Bennett" → "James"), which left renamed members showing a plain
    // coloured initial instead of their avatar. Resolving to the real member
    // object lets the shared <Avatar> render their illustrated avatar_id /
    // photo / initial. Fall back to name matching for rows without ids.
    const byId = Array.isArray(ev.assigned_to_ids)
      ? ev.assigned_to_ids.map((id) => members.find((m) => m.id === id)).filter(Boolean)
      : [];
    if (byId.length) return byId;

    const resolve = (names) => names
      .filter(Boolean)
      .map((name) => members.find((x) => x.name === name) || { name, color_theme: null });
    if (Array.isArray(ev.assigned_to_names) && ev.assigned_to_names.length > 0) return resolve(ev.assigned_to_names);
    if (Array.isArray(ev.assignees) && ev.assignees.length > 0) return resolve(ev.assignees.map((a) => a.member_name));
    if (ev.assigned_to_name) return resolve([ev.assigned_to_name]);
    return [];
  }

  /**
   * Render up to 3 stacked avatars with a "+N" overflow pill. Size in px;
   * `ringColor` is the background colour behind the stack so the ring blends.
   */
  function renderMemberStack(list, { size = 24, ringColor = '#FFFFFF' } = {}) {
    if (!list || list.length === 0) return null;
    const visible = list.slice(0, 3);
    const overflow = list.length - visible.length;
    const fontSize = Math.max(9, Math.round(size * 0.4));
    return (
      <div className="flex -space-x-2 shrink-0">
        {visible.map((m, i) => (
          <Avatar key={`${m.name}-${i}`} member={m} size={size} style={{ boxShadow: `0 0 0 2px ${ringColor}` }} />
        ))}
        {overflow > 0 && (
          <div
            className="rounded-full flex items-center justify-center font-semibold"
            style={{ width: size, height: size, background: '#EAE7E0', color: '#6B6774', fontSize, boxShadow: `0 0 0 2px ${ringColor}` }}
          >
            +{overflow}
          </div>
        )}
      </div>
    );
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

  // Shared search-results renderer, used by both the desktop popover and the
  // mobile full-width search bar. jumpToSearchResult already clears the query,
  // so a tapped result self-closes either dropdown.
  function renderSearchResults() {
    if (searchQuery.trim().length < 2) return <p className="text-sm text-warm-grey p-3 text-center">Type at least 2 characters…</p>;
    if (searchLoading && searchResults.length === 0) return <p className="text-sm text-warm-grey p-3 text-center">Searching…</p>;
    if (searchResults.length === 0) return <p className="text-sm text-warm-grey p-3 text-center">No results found</p>;
    return searchResults.map((result, i) => {
      const dateLabel = result.date
        ? new Date(result.date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
        : 'No date';
      const typeLabel = result.type === 'event' ? 'Event' : result.type === 'task' ? 'Task' : 'School';
      // Dot colour: events get their own colour; tasks and school-term-dates
      // each get a category tint.
      const dotColor = result.type === 'event'
        ? getEventHex(result.item)
        : result.type === 'school_date'
          ? '#6B3FA0'
          : '#7A8694';
      return (
        <button
          key={`${result.type}-${result.item.id}-${i}`}
          onClick={() => jumpToSearchResult(result)}
          className="w-full text-left px-3 py-2 hover:bg-cream transition-colors flex items-start gap-3 rounded-lg"
        >
          <div className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ background: dotColor }} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-charcoal truncate">{result.title}</p>
            <p className="text-xs text-warm-grey">{dateLabel} · {typeLabel}</p>
          </div>
        </button>
      );
    });
  }

  // The calendar filter panel (family members + calendar type), shared by the
  // desktop settings popup and the mobile filter bottom sheet.
  function renderCalendarFilters() {
    return (
      <>
        <h3 className="text-[15px] font-semibold mb-3" style={{ fontFamily: 'var(--font-display)' }}>Calendar filters</h3>

        {/* Family members */}
        <div className="mb-4">
          <div className="text-[11px] font-semibold text-warm-grey uppercase tracking-wider mb-2">Family members</div>
          <div className="flex flex-wrap gap-1.5">
            {members.map(m => {
              const hex = COLOR_HEX[m.color_theme] || COLOR_HEX.sage;
              const isOn = activeMemberFilters === null || activeMemberFilters.has(m.id);
              return (
                <button
                  key={m.id}
                  onClick={() => {
                    setActiveMemberFilters(prev => {
                      const next = new Set(prev || members.map(x => x.id));
                      next.has(m.id) ? next.delete(m.id) : next.add(m.id);
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
      </>
    );
  }

  // ── Render ─────────────────────────────────────────────

  return (
    <div {...ptr.bindings} className="mx-auto space-y-4">
      <PullIndicator state={ptr.state} />
      {error && <ErrorBanner message={error} onDismiss={() => setError('')} />}
      {!canWrite && <SubscribePrompt message="Subscribe to add or edit calendar events" className="mb-4" />}

      {/* ── Toolbar ──────────────────────────────────────────── */}
      <PageHeader
        kicker={navigationLabel}
        title="Calendar"
        actions={
        <>
        {/* Mobile: round search + add buttons matched to the Tasks/Lists
            PillBtn (h-11 w-11, rounded-full) so all three pages share one
            toolbar style. The full toolbar below is desktop-only. */}
        <PillBtn
          aria-label="Search"
          aria-expanded={mobileSearchOpen}
          onClick={() => setMobileSearchOpen(o => !o)}
          className={`md:hidden h-11 w-11 justify-center px-0! rounded-full! ${mobileSearchOpen ? 'border-plum! bg-plum-light! text-plum!' : ''}`}
          icon={<IconSearch className="h-[18px] w-[18px]" />}
        />
        {!childMode && (
          <PillBtn
            aria-label="Filters"
            aria-expanded={mobileFiltersOpen}
            onClick={() => setMobileFiltersOpen(o => !o)}
            className={`md:hidden h-11 w-11 justify-center px-0! rounded-full! ${mobileFiltersOpen ? 'border-plum! bg-plum-light! text-plum!' : ''}`}
            icon={<SettingsIcon className="h-[18px] w-[18px]" />}
          />
        )}
        {canWrite && !childMode && (
          <PillBtn
            primary
            aria-label="New event"
            onClick={() => openAddForm(selectedDate)}
            className="md:hidden h-11 w-11 justify-center px-0! rounded-full!"
            icon={<IconPlus className="h-[18px] w-[18px]" strokeWidth={2.4} />}
          />
        )}
        <div className="hidden md:flex items-center gap-2">
          {/* Search button */}
          <div ref={searchRef} className="relative">
            <button
              onClick={() => { setShowSearch(!showSearch); setTimeout(() => searchRef.current?.querySelector('input')?.focus(), 50); }}
              className={`w-9 h-9 rounded-[10px] border-[1.5px] flex items-center justify-center transition-all active:scale-[0.98] ${
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
                    {renderSearchResults()}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* View switcher */}
          <Segmented
            ariaLabel="Calendar view"
            value={viewMode}
            onChange={setViewMode}
            options={[
              { value: 'month', label: 'Month' },
              { value: 'week', label: 'Week' },
              { value: 'day', label: 'Day' },
            ]}
          />

          {/* Prev / next */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={navigatePrev}
              aria-label="Previous"
              className="w-9 h-9 rounded-[10px] border-[1.5px] border-light-grey bg-white flex items-center justify-center text-charcoal hover:border-plum hover:text-plum hover:bg-plum-light transition-all"
            >
              <ChevronLeft />
            </button>
            <button
              onClick={navigateNext}
              aria-label="Next"
              className="w-9 h-9 rounded-[10px] border-[1.5px] border-light-grey bg-white flex items-center justify-center text-charcoal hover:border-plum hover:text-plum hover:bg-plum-light transition-all"
            >
              <ChevronRight />
            </button>
          </div>

          {/* Today */}
          <button
            onClick={goToday}
            className="h-9 px-4 rounded-[10px] border-[1.5px] border-light-grey bg-white text-charcoal text-[13px] font-semibold hover:border-plum hover:text-plum hover:bg-plum-light transition-all"
          >
            Today
          </button>

          {/* Add event button - hidden for expired households; inline
              SubscribePrompt appears below the toolbar instead. */}
          {canWrite && (
            <button
              onClick={() => openAddForm(selectedDate)}
              aria-label="New event"
              className="h-9 w-9 rounded-[10px] bg-plum text-white shadow-sm hover:bg-plum/90 active:scale-[0.98] flex items-center justify-center transition-transform"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          )}

          {/* Settings cog - hidden in Child Mode so kids can't change filters */}
          {!childMode && (
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
                {renderCalendarFilters()}

              </div>
            )}
          </div>
          )}
        </div>
        </>
        }
      />

      {/* ── Mobile controls: full-width search, view switcher, month nav.
            Desktop keeps these inline in the header toolbar above. ── */}
      <div className="md:hidden flex flex-col gap-3">
        {/* Search - hidden by default, revealed by the header search button */}
        {mobileSearchOpen && (
          <div className="relative">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-warm-grey pointer-events-none">
              <IconSearch className="w-[18px] h-[18px]" />
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search events, people, places…"
              autoFocus
              className="w-full h-12 rounded-2xl pl-11 pr-11 text-[15px] text-charcoal bg-white border border-light-grey outline-none focus:border-plum placeholder:text-warm-grey"
            />
            <button
              onClick={() => { setMobileSearchOpen(false); setSearchQuery(''); }}
              aria-label="Close search"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-warm-grey hover:text-charcoal"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
            {searchQuery.trim() && (
              <div className="absolute left-0 right-0 top-[54px] bg-white rounded-2xl border border-light-grey z-30 p-2 max-h-72 overflow-y-auto" style={{ boxShadow: 'var(--shadow-lg)' }}>
                {renderSearchResults()}
              </div>
            )}
          </div>
        )}

        {/* View switcher - full width */}
        <Segmented
          fluid
          ariaLabel="Calendar view"
          value={viewMode}
          onChange={setViewMode}
          options={[
            { value: 'month', label: 'Month' },
            { value: 'week', label: 'Week' },
            { value: 'day', label: 'Day' },
          ]}
        />

        {/* Month navigation */}
        <div className="flex items-center justify-between">
          <button onClick={navigatePrev} aria-label="Previous" className="w-9 h-9 rounded-full border border-light-grey bg-white flex items-center justify-center text-charcoal active:bg-plum-light">
            <ChevronLeft />
          </button>
          <div className="flex items-center gap-2.5">
            <span className="text-base font-semibold text-charcoal" style={{ fontFamily: 'var(--font-display)' }}>{navigationLabel}</span>
            <button onClick={goToday} className="px-3 py-1 rounded-full bg-plum-light text-plum text-xs font-semibold">Today</button>
          </div>
          <button onClick={navigateNext} aria-label="Next" className="w-9 h-9 rounded-full border border-light-grey bg-white flex items-center justify-center text-charcoal active:bg-plum-light">
            <ChevronRight />
          </button>
        </div>
      </div>

      {/* ── Month View ──────────────────────────────────────── */}
      {viewMode === 'month' && (
        <>
          {/* Desktop month grid */}
          <div className="hidden md:block">
            <div className="border border-[rgba(26,22,32,0.07)] rounded-2xl overflow-hidden bg-white">
              {/* Day headers */}
              <div className="grid grid-cols-7">
                {DAY_HEADERS.map(d => (
                  <div key={d} className="py-2.5 px-1 text-center text-[11px] font-semibold text-warm-grey uppercase tracking-wider bg-white border-b border-[rgba(26,22,32,0.07)]">
                    {d}
                  </div>
                ))}
              </div>
              {/* Day cells */}
              <div className="grid grid-cols-7">
                {loading && events.length === 0 ? (
                  Array.from({ length: 35 }).map((_, idx) => (
                    <div key={idx} className="min-h-[90px] p-1.5 border-r border-b border-[rgba(26,22,32,0.07)] animate-pulse">
                      <div className="w-6 h-3 bg-light-grey rounded" />
                    </div>
                  ))
                ) : (
                  calendarDays.map(({ date, currentMonth: isCurrent }, idx) => {
                    const isToday_ = isSameDay(date, today);
                    const isSelected = selectedDate && isSameDay(date, selectedDate);
                    const dayEvents = eventsForDate(date);
                    const dayTasks = tasksForDate(date);
                    const allItems = [...dayEvents.map(e => ({ ...e, _isEvent: true })), ...dayTasks.map(t => ({ ...t, _isTask: true }))];
                    const maxShow = 2;
                    const overflow = allItems.length - maxShow;

                    return (
                      <div
                        key={idx}
                        // Current-month cells are clickable: selecting a day
                        // drives the "events for this day" rail below the grid
                        // (parity with the mobile month view). Padding cells
                        // from the prev/next month stay inert.
                        onClick={isCurrent ? () => setSelectedDate(new Date(date)) : undefined}
                        className={`min-h-[90px] p-1.5 transition-colors border-b border-[rgba(26,22,32,0.07)] ${
                          idx % 7 !== 6 ? 'border-r' : ''
                        } ${isCurrent ? 'cursor-pointer hover:bg-plum-light/60' : ''} ${
                          isToday_ ? 'bg-plum-light' : isSelected ? 'bg-plum-light/50' : 'bg-white'
                        }`}
                      >
                        {/* Padding cells for the previous/next month are left
                            empty (no day number, no events) - only the current
                            month's days are shown. */}
                        {isCurrent && (
                          <>
                            <div className={`text-sm font-semibold mb-0.5 w-6 h-6 flex items-center justify-center ${
                              isToday_ ? 'bg-plum text-white rounded-full' : 'text-charcoal'
                            }`}>
                              {date.getDate()}
                            </div>
                            {allItems.slice(0, maxShow).map(item => {
                              const pillStyle = item._isTask ? { bg: '#E8724A18', text: '#E8724A' } : getEventStyle(item);
                              return (
                              <div
                                key={item.id}
                                className="text-[11px] font-semibold px-1.5 py-0.5 rounded-[3px] mb-0.5 truncate"
                                style={{ background: pillStyle.bg, color: pillStyle.text }}
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
                              );
                            })}
                            {overflow > 0 && (
                              <div
                                className="text-[11px] font-semibold text-plum px-1.5 py-0.5 cursor-pointer hover:underline"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  setMorePopup({ date, items: allItems, rect: { top: rect.bottom + 4, left: rect.left } });
                                }}
                              >
                                +{overflow} more
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* "+N more" popup */}
          {morePopup && (
            <div className="fixed inset-0 z-40" onClick={() => setMorePopup(null)}>
              <div
                className="absolute bg-white rounded-xl border border-light-grey p-3 min-w-[200px] max-w-[280px] max-h-[320px] overflow-y-auto"
                style={{
                  top: `${Math.min(morePopup.rect.top, window.innerHeight - 340)}px`,
                  left: `${Math.min(morePopup.rect.left, window.innerWidth - 300)}px`,
                  boxShadow: '0 8px 24px rgba(107,63,160,0.12)',
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="text-xs font-semibold text-charcoal mb-2">
                  {morePopup.date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
                </div>
                <div className="flex flex-col gap-1">
                  {morePopup.items.map(item => {
                    const pillStyle = item._isTask ? { bg: '#E8724A18', text: '#E8724A' } : getEventStyle(item);
                    return (
                      <div
                        key={item.id}
                        className="text-[11px] font-semibold px-2 py-1.5 rounded-md cursor-pointer hover:opacity-80 truncate"
                        style={{ background: pillStyle.bg, color: pillStyle.text }}
                        onClick={() => {
                          setMorePopup(null);
                          if (item._isTask) openTaskEditForm(item);
                          else if (item.category !== 'public_holiday' && item.category !== 'birthday') openEditForm(item);
                        }}
                      >
                        {item.title}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Mobile mini calendar */}
          <div className="md:hidden">
            <div className="bg-white rounded-2xl border border-light-grey p-3 mb-4" style={{ boxShadow: 'var(--shadow-sm)' }}>
              <div className="grid grid-cols-7 gap-1">
                {DAY_HEADERS.map((d, i) => (
                  <div key={i} className="text-center text-[11px] font-semibold text-warm-grey uppercase tracking-wider pb-1">{d.toUpperCase()}</div>
                ))}
                {calendarDays.map(({ date, currentMonth: isCurrent }, idx) => {
                  // Blank leading/trailing cells (no prev/next-month numbers), per the design.
                  if (!isCurrent) return <div key={idx} />;
                  const isToday_ = isSameDay(date, today);
                  const isSelected = selectedDate && isSameDay(date, selectedDate);
                  // Up to three coloured dots: each event in its own colour, tasks coral.
                  const dots = [
                    ...eventsForDate(date).map(e => getEventHex(e)),
                    ...tasksForDate(date).map(() => '#E8724A'),
                  ].slice(0, 3);
                  return (
                    <button
                      key={idx}
                      onClick={() => setSelectedDate(new Date(date))}
                      className={`aspect-square flex flex-col items-center justify-center gap-1 rounded-2xl transition-colors ${
                        isToday_ ? 'bg-plum' : isSelected ? 'bg-plum-light' : 'active:bg-plum-light'
                      }`}
                    >
                      <span className={`text-sm leading-none ${isToday_ ? 'text-white font-bold' : isSelected ? 'text-plum font-semibold' : 'text-charcoal font-medium'}`}>
                        {date.getDate()}
                      </span>
                      <span className="flex items-center justify-center gap-[3px] h-1.5">
                        {dots.map((c, di) => (
                          <span key={di} className="w-1.5 h-1.5 rounded-full" style={{ background: isToday_ ? 'rgba(255,255,255,0.92)' : c }} />
                        ))}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Selected day events list for mobile */}
            {selectedDate && (
              <div>
                <h3 className="text-[15px] font-semibold mb-2.5" style={{ fontFamily: 'var(--font-display)' }}>
                  {isSameDay(selectedDate, today) ? 'Today, ' : `${selectedDate.toLocaleDateString('en-GB', { weekday: 'short' })}, `}{selectedDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}
                </h3>
                {[...eventsForDate(selectedDate).map(e => ({ ...e, _type: 'event' })), ...tasksForDate(selectedDate).map(t => ({ ...t, _type: 'task' }))].map(item => {
                  const hex = item._type === 'task' ? '#E8724A' : getEventHex(item);
                  const badge = getTypeBadge(item);
                  // Tasks and events share the same multi-assignee model
                  // now, so getEventMembers covers both. It picks up the
                  // assigned_to_names[] column (post-migration), the
                  // event_assignees join table (still populated for
                  // reminder fanout), or the legacy single name as
                  // fallback.
                  const eventMembers = getEventMembers(item);
                  return (
                    <div
                      key={item.occurrence_key || `${item._type}-${item.id}`}
                      className="flex items-center gap-2.5 p-3 bg-white rounded-xl mb-2"
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
                            : (item.all_day
                                ? 'All day'
                                : `${formatTime(item.start_time)}${item.end_time ? ` – ${formatTime(item.end_time)}` : ''}`)}
                        </div>
                      </div>
                      <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded shrink-0" style={{ background: badge.bg, color: badge.color }}>{badge.label}</span>
                      {renderMemberStack(eventMembers, { size: 24, ringColor: '#FFFFFF' })}
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
        <div
          // Mobile vs desktop chrome stacks differ - mobile has the sticky
          // header + bottom nav (~320px combined), desktop just the page
          // padding + H1 (~240px). Tailwind responsive class swaps the
          // offset at the md: breakpoint.
          className="border border-light-grey rounded-2xl overflow-hidden bg-white flex flex-col max-h-[calc(100dvh_-_280px_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom))] md:max-h-[calc(100dvh_-_190px)]"
        >
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
                        key={ev.occurrence_key || ev.id}
                        className="text-[11px] font-semibold px-1 py-0.5 rounded truncate cursor-pointer hover:opacity-85"
                        style={{ background: getEventHex(ev) + '18', color: getEventHex(ev) }}
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

          {/* Time grid - takes the remaining vertical space below the
              week headers + all-day strip. flex-1 stretches it; min-h-0
              lets it actually shrink below its content size so the
              overflow-y-auto kicks in. The viewport cap lives on the
              outer card so the entire calendar fits the screen. */}
          <div ref={scrollContainerRef} className="overflow-y-auto flex-1 min-h-0">
            <div className="relative" style={{ height: `${24 * HOUR_HEIGHT}px` }}>
              {/* Hour rows */}
              {HOURS.map(hour => (
                <div
                  key={hour}
                  className="absolute w-full grid border-b border-light-grey"
                  style={{ top: `${hour * HOUR_HEIGHT}px`, height: `${HOUR_HEIGHT}px`, gridTemplateColumns: '48px repeat(7, minmax(0, 1fr))' }}
                >
                  <div className="relative text-[10px] font-medium text-warm-grey text-right pr-1.5 -mt-1.5 border-r border-light-grey bg-white z-[1]">
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
                            key={ev.occurrence_key || ev.id}
                            className="absolute rounded-[5px] px-1.5 py-0.5 text-[11px] font-semibold overflow-hidden z-[2] cursor-pointer hover:opacity-85 leading-snug"
                            style={{
                              top: `${pos.top}px`,
                              height: `${pos.height}px`,
                              left: `calc(${leftPct}% + 2px)`,
                              width: `calc(${widthPct}% - 4px)`,
                              background: getEventHex(ev) + '18',
                              color: getEventHex(ev),
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
        <div
          // See note on the week-view card above for the offset rationale.
          className="border border-light-grey rounded-2xl overflow-hidden bg-white flex flex-col max-h-[calc(100dvh_-_280px_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom))] md:max-h-[calc(100dvh_-_190px)]"
        >
          {/* Day header - date itself is already shown in the toolbar's
              navigation label above, so we keep just the event count here. */}
          <div className="flex items-center justify-end px-5 py-3 bg-cream border-b border-light-grey">
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
                    key={ev.occurrence_key || ev.id}
                    className="text-[10px] font-semibold px-2 py-0.5 rounded cursor-pointer hover:opacity-85"
                    style={{ background: getEventHex(ev) + '18', color: getEventHex(ev) }}
                    onClick={() => { if (ev.category !== 'public_holiday' && ev.category !== 'birthday') openEditForm(ev); }}
                  >
                    {ev.title}
                  </div>
                ))}
              </div>
            );
          })()}

          {/* Timeline */}
          <div ref={viewMode === 'day' ? scrollContainerRef : undefined} className="overflow-y-auto px-5 flex-1 min-h-0">
            <div className="relative" style={{ height: `${24 * 56}px` }}>
              {HOURS.map(hour => {
                return (
                  <div
                    key={hour}
                    className="relative border-b border-light-grey"
                    style={{ height: '56px' }}
                    onClick={() => openAddForm(selectedDate, hour)}
                  >
                    <div className="absolute left-0 -top-1.5 text-[10px] font-medium text-warm-grey bg-white pr-2 z-[1]" style={{ width: '42px' }}>
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
                  const hex = getEventHex(ev);
                  const eventMembers = getEventMembers(ev);
                  const ringHex = hex + '18';

                  return (
                    <div
                      key={ev.occurrence_key || ev.id}
                      className="absolute rounded-lg px-2.5 py-1.5 z-[2] cursor-pointer hover:opacity-90 flex items-start gap-2 overflow-hidden"
                      style={{
                        // Left gutter (44px) reserves room for the time
                        // labels on the left rail. We distribute the
                        // *remaining* width across `totalCols` columns -
                        // the previous formula proportionally shaved the
                        // gutter from every column, which made the
                        // rightmost card overflow past the hour line.
                        top: `${top}px`,
                        height: `${height}px`,
                        left: `calc(44px + ${layout.col} * (100% - 44px) / ${layout.totalCols})`,
                        width: `calc((100% - 44px) / ${layout.totalCols} - 4px)`,
                        background: hex + '18',
                        color: hex,
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
                          <div className="text-[11px] opacity-75 mt-0.5 flex items-center gap-1 truncate">
                            <MapPinIcon /> {ev.location}
                          </div>
                        )}
                      </div>
                      {eventMembers.length > 0 && height > 32 && (
                        <div className="mt-0.5">
                          {renderMemberStack(eventMembers, { size: 24, ringColor: ringHex })}
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

      {/* ── Selected-day events panel (desktop month view only - week view
            shows its own timed events inline, day view IS the day's events;
            mobile month has its own selected-day panel above). Clicking a day
            cell sets selectedDate, which this rail follows. We keep it hidden
            when the default (today) is selected and empty, but show it for any
            explicitly-picked day so the click always has a visible result. ── */}
      {viewMode === 'month' && selectedDate && (selectedDayItems.length > 0 || !isSameDay(selectedDate, today)) && (
        <div className="mt-5 hidden md:block">
          <h3 className="text-[17px] font-semibold mb-3" style={{ fontFamily: 'var(--font-display)' }}>
            {isSameDay(selectedDate, today)
              ? "Today's events"
              : selectedDate.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long' })}
          </h3>
          <div className="flex flex-col gap-2">
            {selectedDayItems.length === 0 && (
              <p className="text-sm text-warm-grey py-2">No events or tasks for this day</p>
            )}
            {selectedDayItems.map(item => {
              const hex = item._type === 'task' ? '#E8724A' : getEventHex(item);
              const badge = getTypeBadge(item);
              // Tasks and events share the multi-assignee model; the
              // shared helper handles both shapes.
              const eventMembers = getEventMembers(item);

              return (
                <div
                  key={item.id}
                  className="flex items-center gap-3 py-3 px-4 bg-white cursor-pointer hover:shadow-[0_2px_8px_rgba(107,63,160,0.06)] transition-shadow"
                  style={{ borderLeft: `4px solid ${hex}`, borderRadius: '12px' }}
                  onClick={() => {
                    if (item._type === 'task') openTaskEditForm(item);
                    else if (item.category !== 'public_holiday' && item.category !== 'birthday') openEditForm(item);
                  }}
                >
                  {item._type === 'task' && (
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleTask(item); }}
                      disabled={toggling.has(item.id)}
                      className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors ${
                        item.completed ? 'bg-sage border-sage text-white' : 'border-light-grey hover:border-sage'
                      }`}
                    >
                      {item.completed && <IconCheck className="h-3 w-3" />}
                    </button>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm font-semibold truncate ${item._type === 'task' && item.completed ? 'line-through text-warm-grey' : 'text-charcoal'}`}>{item.title}</div>
                    <div className="text-xs text-warm-grey">
                      {item._type === 'task'
                        ? (item.due_time ? new Date(`2000-01-01T${item.due_time}`).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit' }) : 'All day')
                        : (item.all_day
                            ? 'All day'
                            : `${formatTime(item.start_time)}${item.end_time ? ` – ${formatTime(item.end_time)}` : ''}`)}
                    </div>
                  </div>
                  <span
                    className="text-[9px] md:text-[10px] font-semibold px-2 py-0.5 rounded-md shrink-0"
                    style={{ background: badge.bg, color: badge.color }}
                  >
                    {badge.label}
                  </span>
                  {renderMemberStack(eventMembers, { size: 28, ringColor: '#FFFFFF' })}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Day Detail Panel removed - "+N more" popup handles overflow */}

      {/* ── Mobile filter sheet (the desktop settings cog is hidden on phones).
            md:hidden wrapper keeps it off desktop, which uses the cog popup. ── */}
      <div className="md:hidden">
        <BottomSheet open={mobileFiltersOpen} onDismiss={() => setMobileFiltersOpen(false)}>
          <div className="px-5 pb-safe">
            {renderCalendarFilters()}
          </div>
        </BottomSheet>
      </div>

      {/* ── Event Form Modal ───────────────────────────────────── */}
      {showForm && (
        <BottomSheet open={showForm} onDismiss={() => { setShowForm(false); resetForm(); }} desktopWidthClass="sm:w-[480px]">
          <div ref={formRef} className="overflow-y-auto min-h-0">
            {/* Header */}
            <div className="flex items-center justify-between px-6 pt-2 pb-2">
              <h2 className="text-lg font-medium text-charcoal" style={{ fontFamily: 'var(--font-display)' }}>
                {editingEvent ? 'Edit Event' : 'New Event'}
              </h2>
              <button type="button" onClick={() => { setShowForm(false); resetForm(); }} className="text-warm-grey hover:text-charcoal p-1">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="px-6 pb-5">
              {/* ── 1. Title ── */}
              <input
                type="text"
                value={formTitle}
                onChange={e => setFormTitle(e.target.value)}
                required
                className="w-full text-lg font-medium text-charcoal placeholder-warm-grey/60 border-0 border-b-2 border-light-grey bg-transparent py-3 focus:border-plum focus:outline-none transition-colors"
                placeholder="Add title"
              />

              <div className="mt-5 space-y-4">
                {/* ── 2. Date / Time ── */}
                <div className="flex gap-3">
                  {/* Clock icon */}
                  <div className="flex-shrink-0 pt-2.5">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-warm-grey"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  </div>
                  {/* min-w-0 on the flex-1 wrapper prevents the inner row from
                      growing past the modal width on narrow phones - flex
                      items default to min-width:auto, and native iOS date
                      inputs have a wide intrinsic min-width that would
                      otherwise force the row to overflow. */}
                  <div className="flex-1 min-w-0 space-y-2">
                    {/* All-day toggle - own row, right-aligned. Was inline
                        with the start row, but on narrow phones it ate
                        enough horizontal space that the native iOS date
                        picker had no room to render "DD Mmm YYYY" and the
                        date string wrapped/truncated. Promoting it to
                        its own row frees the entire row width for the
                        date+time pair on both lines. */}
                    <div className="flex justify-end">
                      <label className="flex items-center gap-1.5 text-xs font-medium text-warm-grey cursor-pointer whitespace-nowrap select-none">
                        <div
                          className={`relative w-8 h-[18px] rounded-full transition-colors cursor-pointer ${formAllDay ? 'bg-plum' : 'bg-light-grey'}`}
                          onClick={() => setFormAllDay(!formAllDay)}
                        >
                          <div className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-sm transition-transform ${formAllDay ? 'translate-x-[16px]' : 'translate-x-[2px]'}`} />
                        </div>
                        All day
                      </label>
                    </div>
                    {/* Start row */}
                    <div className="flex items-center gap-2">
                      <input
                        type="date"
                        value={formDate}
                        onChange={e => {
                          setFormDate(e.target.value);
                          if (formEndDate < e.target.value) setFormEndDate(e.target.value);
                        }}
                        style={{ minWidth: 0, maxWidth: '100%', boxSizing: 'border-box', WebkitAppearance: 'none', appearance: 'none', lineHeight: '40px' }}
                        className="flex-1 min-w-0 h-10 border-[1.5px] border-light-grey rounded-lg px-2.5 text-sm bg-cream focus:border-plum focus:outline-none focus:ring-1 focus:ring-plum/20"
                      />
                      {!formAllDay && (
                        <input
                          type="time"
                          value={formStart}
                          onChange={e => {
                            const v = e.target.value;
                            setFormStart(v);
                            // Keep the end ahead of the start on a same-day event,
                            // mirroring the start-date bump above. Nudge the end to
                            // one hour later (capped at 23:59) when it would now sit
                            // at or before the new start time.
                            if ((formEndDate || formDate) === formDate && formEnd <= v) {
                              const [h, m] = v.split(':').map(Number);
                              setFormEnd(h >= 23
                                ? '23:59'
                                : `${String(h + 1).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
                            }
                          }}
                          style={{ minWidth: 0, maxWidth: '100%', boxSizing: 'border-box', WebkitAppearance: 'none', appearance: 'none', lineHeight: '40px' }}
                          className="w-[88px] flex-shrink-0 h-10 border-[1.5px] border-light-grey rounded-lg px-2.5 text-sm bg-cream focus:border-plum focus:outline-none focus:ring-1 focus:ring-plum/20"
                        />
                      )}
                    </div>
                    {/* End row */}
                    <div className="flex items-center gap-2">
                      <input
                        type="date"
                        value={formEndDate}
                        onChange={e => setFormEndDate(e.target.value)}
                        min={formDate}
                        style={{ minWidth: 0, maxWidth: '100%', boxSizing: 'border-box', WebkitAppearance: 'none', appearance: 'none', lineHeight: '40px' }}
                        className="flex-1 min-w-0 h-10 border-[1.5px] border-light-grey rounded-lg px-2.5 text-sm bg-cream focus:border-plum focus:outline-none focus:ring-1 focus:ring-plum/20"
                      />
                      {!formAllDay && (
                        <input
                          type="time"
                          value={formEnd}
                          onChange={e => setFormEnd(e.target.value)}
                          style={{ minWidth: 0, maxWidth: '100%', boxSizing: 'border-box', WebkitAppearance: 'none', appearance: 'none', lineHeight: '40px' }}
                          className="w-[88px] flex-shrink-0 h-10 border-[1.5px] border-light-grey rounded-lg px-2.5 text-sm bg-cream focus:border-plum focus:outline-none focus:ring-1 focus:ring-plum/20"
                        />
                      )}
                    </div>
                  </div>
                </div>

                {/* ── 3. Members multi-select ── */}
                <div className="flex gap-3">
                  <div className="flex-shrink-0 pt-2">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-warm-grey"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                  </div>
                  <div className="flex-1">
                    <p className="text-xs font-medium text-warm-grey mb-2">Select members:</p>
                    <div className="flex flex-wrap gap-2">
                      {members.map(m => {
                        const isSelected = formAssignees.includes(m.name);
                        const hex = m.color_theme ? (COLOR_HEX[m.color_theme] || COLOR_HEX.sage) : COLOR_HEX.sage;
                        return (
                          <button
                            key={m.name}
                            type="button"
                            onClick={() => {
                              if (isSelected) {
                                const next = formAssignees.filter(n => n !== m.name);
                                setFormAssignees(next);
                                if (next.length > 0) {
                                  const firstMember = members.find(mem => mem.name === next[0]);
                                  setFormColor(firstMember?.color_theme || 'lavender');
                                  setFormAssignee(next[0]);
                                } else {
                                  setFormColor('lavender');
                                  setFormAssignee('');
                                }
                              } else {
                                const next = [...formAssignees, m.name];
                                setFormAssignees(next);
                                if (next.length === 1) {
                                  setFormColor(m.color_theme || 'lavender');
                                  setFormAssignee(m.name);
                                }
                              }
                            }}
                            className="flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-medium transition-all"
                            style={{
                              border: `1.5px solid ${hex}`,
                              background: isSelected ? hex : 'transparent',
                              color: isSelected ? '#fff' : hex,
                            }}
                          >
                            {/* Avatar circle */}
                            <span
                              className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                              style={{
                                background: isSelected ? 'rgba(255,255,255,0.3)' : hex,
                                color: isSelected ? '#fff' : '#fff',
                              }}
                            >
                              {isSelected ? (
                                <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                              ) : (
                                m.name?.[0]?.toUpperCase() || '?'
                              )}
                            </span>
                            {m.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* ── 4. Repeat ── */}
                <div className="flex gap-3 items-center">
                  <div className="flex-shrink-0">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-warm-grey"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                  </div>
                  <select
                    value={formRecurrence}
                    onChange={e => setFormRecurrence(e.target.value)}
                    className="flex-1 h-10 border-[1.5px] border-light-grey rounded-lg px-2.5 text-sm bg-cream focus:border-plum focus:outline-none focus:ring-1 focus:ring-plum/20"
                  >
                    {RECURRENCES.map(r => (
                      <option key={r} value={r}>{RECURRENCE_LABELS[r]}</option>
                    ))}
                  </select>
                </div>

                {/* ── 5. Reminders ── */}
                <div className="flex gap-3">
                  <div className="flex-shrink-0 pt-2">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-warm-grey"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                  </div>
                  <div className="flex-1 space-y-2">
                    {formReminders.map((reminder, idx) => {
                      // The bot can create reminders with arbitrary offsets
                      // (e.g. "remind me 20 minutes before") that aren't in
                      // the preset dropdown. Detect those non-preset values
                      // and render the actual saved value as a small chip
                      // below the dropdown rather than silently snapping it
                      // to whatever the <select> falls back to.
                      const isPreset = REMINDER_OPTIONS.some(
                        opt => String(opt.value) === String(reminder.time) && opt.unit === reminder.unit,
                      );
                      const customLabel = !isPreset
                        ? `${reminder.time} ${reminder.unit} before`
                        : null;
                      return (
                        <div key={idx} className="flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <select
                              value={isPreset ? `${reminder.time}_${reminder.unit}` : ''}
                              onChange={e => {
                                if (!e.target.value) return;
                                const [time, unit] = e.target.value.split('_');
                                const next = [...formReminders];
                                next[idx] = { time, unit };
                                setFormReminders(next);
                              }}
                              className="flex-1 h-9 border-[1.5px] border-light-grey rounded-lg px-2.5 text-sm bg-cream focus:border-plum focus:outline-none focus:ring-1 focus:ring-plum/20"
                            >
                              {!isPreset && <option value="">Pick a preset…</option>}
                              {REMINDER_OPTIONS.map(opt => (
                                <option key={`${opt.value}_${opt.unit}`} value={`${opt.value}_${opt.unit}`}>{opt.label}</option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => setFormReminders(formReminders.filter((_, i) => i !== idx))}
                              className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-full text-warm-grey hover:bg-cream hover:text-charcoal transition-colors"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                            </button>
                          </div>
                          {customLabel && (
                            <div
                              className="inline-flex items-center self-start px-2 py-0.5 rounded-full"
                              style={{
                                fontSize: 11,
                                background: 'var(--cream, #FBF8F3)',
                                color: 'var(--warm-grey, #6B6774)',
                                border: '1px solid var(--light-grey, #E8E5EC)',
                              }}
                              title="The bot added this custom timing. Pick a preset above to change it."
                            >
                              Currently set to {customLabel}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => setFormReminders([...formReminders, { time: '10', unit: 'minutes' }])}
                      className="pt-2 text-xs font-semibold text-plum hover:text-plum-dark transition-colors"
                    >
                      + Add reminder
                    </button>
                  </div>
                </div>

                {/* ── 6. More options / Less options ── */}
                {showMoreOptions && (
                  <div className="space-y-4 pt-1">
                    {/* Description */}
                    <div className="flex gap-3">
                      <div className="flex-shrink-0 pt-2">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-warm-grey"><line x1="17" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="17" y1="18" x2="3" y2="18"/></svg>
                      </div>
                      <textarea
                        value={formDesc}
                        onChange={e => setFormDesc(e.target.value)}
                        rows={2}
                        className="flex-1 border-[1.5px] border-light-grey rounded-lg px-2.5 py-2 text-sm bg-cream focus:border-plum focus:outline-none focus:ring-1 focus:ring-plum/20"
                        placeholder="Add description"
                      />
                    </div>
                    {/* Location */}
                    <div className="flex gap-3 items-center">
                      <div className="flex-shrink-0">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-warm-grey"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                      </div>
                      <input
                        type="text"
                        value={formLocation}
                        onChange={e => setFormLocation(e.target.value)}
                        className="flex-1 h-10 border-[1.5px] border-light-grey rounded-lg px-2.5 text-sm bg-cream focus:border-plum focus:outline-none focus:ring-1 focus:ring-plum/20"
                        placeholder="Add location"
                      />
                    </div>
                    {/* Attachments */}
                    <div className="flex gap-3 items-start">
                      <div className="flex-shrink-0 pt-0.5">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-warm-grey"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        {editingEvent ? (
                          <>
                            {eventAttachments.length > 0 && (
                              <ul className="space-y-1 mb-2">
                                {eventAttachments.map(a => (
                                  <li key={a.id} className="flex items-center gap-2 text-sm">
                                    <a href={a.url || '#'} target="_blank" rel="noopener noreferrer" className="text-plum hover:underline truncate flex-1">{a.name}</a>
                                    <button type="button" onClick={() => deleteAttachment(a.id)} className="text-warm-grey hover:text-coral text-xs shrink-0" title="Remove">×</button>
                                  </li>
                                ))}
                              </ul>
                            )}
                            <input ref={attachmentInputRef} type="file" className="hidden" onChange={handleAttachmentUpload} />
                            <button
                              type="button"
                              onClick={() => attachmentInputRef.current?.click()}
                              disabled={uploadingAttachment}
                              className="text-sm text-warm-grey hover:text-plum transition-colors disabled:opacity-50"
                            >
                              {uploadingAttachment ? 'Uploading…' : '+ Add attachment'}
                            </button>
                          </>
                        ) : (
                          <span className="text-sm text-warm-grey">Save the event first, then you can attach files.</span>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* ── 7. Bottom bar ── */}
              <div className="flex items-center justify-between mt-5 pt-4 border-t border-light-grey">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowMoreOptions(!showMoreOptions)}
                    className="text-xs font-semibold text-plum hover:text-plum-dark transition-colors"
                  >
                    {showMoreOptions ? 'Less options \u2227' : 'More options \u2228'}
                  </button>
                  {editingEvent && (
                    <button
                      type="button"
                      onClick={() => deleteEvent(editingEvent.id)}
                      className="text-coral hover:text-coral/80 ml-2 p-1.5 -m-1.5 transition-colors"
                      aria-label="Delete event"
                      title="Delete event"
                    >
                      <IconTrash className="w-[18px] h-[18px]" />
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => { setShowForm(false); resetForm(); }}
                    className="h-9 px-4 rounded-xl border-[1.5px] border-light-grey text-warm-grey hover:bg-cream text-sm font-semibold transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving || !formTitle.trim()}
                    className="h-9 px-5 rounded-xl bg-plum hover:bg-plum-dark disabled:opacity-50 text-white text-sm font-semibold transition-colors"
                  >
                    {saving ? 'Saving...' : editingEvent ? 'Update' : 'Save'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </BottomSheet>
      )}

      {/* ── Task Edit Form Modal ────────────────────────────────── */}
      {showTaskForm && editingTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={closeTaskForm}>
          <div className="absolute inset-0 bg-black/40" />
          <div ref={taskFormRef} onClick={(e) => e.stopPropagation()} className="relative bg-white rounded-2xl border border-light-grey p-6 w-full max-w-md max-h-[90vh] overflow-y-auto" style={{ boxShadow: 'var(--shadow-lg)' }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-medium text-charcoal" style={{ fontFamily: 'var(--font-display)' }}>Edit Task</h2>
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
              {/* min-w-0 on each grid child is critical - without it, native iOS
                  <input type="date"> and <input type="time"> report an intrinsic
                  min-width that exceeds the grid track on narrow phones, causing
                  the right column to overflow the modal. Same fix as Tasks.jsx. */}
              <div className="grid grid-cols-2 gap-2">
                <div className="min-w-0 overflow-hidden">
                  <label className="text-[13px] font-medium text-charcoal mb-1 block">Due date</label>
                  <input
                    type="date"
                    value={taskDueDate}
                    onChange={e => setTaskDueDate(e.target.value)}
                    style={{ minWidth: 0, maxWidth: '100%', boxSizing: 'border-box', WebkitAppearance: 'none', appearance: 'none', display: 'block', lineHeight: '48px' }}
                    className="w-full h-12 border-[1.5px] border-light-grey rounded-[10px] px-3 text-sm bg-cream focus:border-plum focus:outline-none focus:ring-1 focus:ring-plum/20"
                  />
                </div>
                <div className="min-w-0 overflow-hidden">
                  <label className="text-[13px] font-medium text-charcoal mb-1 block">Time (optional)</label>
                  <input
                    type="time"
                    value={taskDueTime}
                    onChange={e => setTaskDueTime(e.target.value)}
                    style={{ minWidth: 0, maxWidth: '100%', boxSizing: 'border-box', WebkitAppearance: 'none', appearance: 'none', display: 'block', lineHeight: '48px' }}
                    className="w-full h-12 border-[1.5px] border-light-grey rounded-[10px] px-3 text-sm bg-cream focus:border-plum focus:outline-none focus:ring-1 focus:ring-plum/20"
                  />
                </div>
                <div className="min-w-0">
                  <label className="text-[13px] font-medium text-charcoal mb-1 block">Assign to</label>
                  <div
                    className="flex flex-wrap gap-2 border-[1.5px] border-light-grey rounded-[10px] bg-white"
                    style={{ minHeight: 48, padding: '8px 10px' }}
                  >
                    {members.length === 0 && (
                      <span style={{ fontSize: 13, color: 'var(--warm-grey, #6B6774)', alignSelf: 'center' }}>No members yet</span>
                    )}
                    {members.map((m) => {
                      const selected = taskAssignees.includes(m.name);
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => {
                            setTaskAssignees((prev) =>
                              prev.includes(m.name)
                                ? prev.filter((n) => n !== m.name)
                                : [...prev, m.name]
                            );
                          }}
                          style={{
                            padding: '6px 12px',
                            borderRadius: 999,
                            fontSize: 12,
                            fontWeight: 600,
                            border: selected ? '1.5px solid var(--plum, #6B3FA0)' : '1.5px solid var(--light-grey, #E8E5EC)',
                            background: selected ? 'var(--plum-light, #F3EDFC)' : '#fff',
                            color: selected ? 'var(--plum, #6B3FA0)' : 'var(--charcoal, #2D2A33)',
                            cursor: 'pointer',
                          }}
                        >
                          {m.name}
                        </button>
                      );
                    })}
                  </div>
                  <p style={{ fontSize: 11, color: 'var(--warm-grey, #6B6774)', marginTop: 4 }}>
                    {taskAssignees.length === 0 ? 'Leave empty for everyone.' : `Assigned to ${taskAssignees.length} ${taskAssignees.length === 1 ? 'person' : 'people'}.`}
                  </p>
                </div>
                <div className="min-w-0">
                  <label className="text-[13px] font-medium text-charcoal mb-1 block">Repeats</label>
                  <select
                    value={taskRecurrence}
                    onChange={e => setTaskRecurrence(e.target.value)}
                    className="w-full h-12 border-[1.5px] border-light-grey rounded-[10px] px-3 text-sm bg-white focus:border-plum focus:outline-none focus:ring-1 focus:ring-plum/20"
                  >
                    {RECURRENCES.map(r => <option key={r} value={r}>{r || 'Never'}</option>)}
                  </select>
                </div>
                <div className="min-w-0">
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

      {/* Read-only detail sheet for SYNCED events (device sync / URL feeds).
          Editing happens in the source calendar; changes flow in on the next
          sync - which is also why there is deliberately no Delete button. */}
      {syncedEvent && (() => {
        const feed = externalFeeds.find((f) => f.id === syncedEvent.external_feed_id);
        const owner = feed?.device_owner_user_id
          ? members.find((m) => m.id === feed.device_owner_user_id)?.name
          : null;
        const sourceLine = feed
          ? (feed.source === 'device'
            ? `Synced from ${owner ? `${owner}'s iPhone` : 'a family iPhone'} · ${feed.display_name}`
            : `Subscribed calendar · ${feed.display_name}`)
          : 'Synced from an external calendar';
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setSyncedEvent(null)}>
            <div className="absolute inset-0 bg-black/40" />
            <div className="relative bg-white rounded-2xl shadow-lg border border-light-grey p-5 sm:p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-start justify-between gap-3 mb-1">
                <h2 className="text-base md:text-lg font-medium text-charcoal">{syncedEvent.title}</h2>
                <button onClick={() => setSyncedEvent(null)} className="text-warm-grey hover:text-charcoal p-1 shrink-0">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
              <p className="text-sm text-warm-grey">
                {new Date(syncedEvent.start_time).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                {syncedEvent.all_day ? ' · All day' : ` · ${formatTime(syncedEvent.start_time)} – ${formatTime(syncedEvent.end_time)}`}
              </p>
              {syncedEvent.location && <p className="text-sm text-warm-grey mt-1">📍 {syncedEvent.location}</p>}
              {/* Provenance footer only applies to genuinely synced events. In
                  Child Mode this same sheet shows native events read-only, where
                  the "edit it in that calendar" copy would be misleading. */}
              {syncedEvent.external_feed_id && (
                <div className="mt-4 bg-plum-light rounded-xl px-3 py-2.5">
                  <p className="text-xs font-medium text-plum">🔄 {sourceLine}</p>
                  <p className="text-[11px] text-plum/70 mt-0.5">
                    Read-only here - edit or delete it in that calendar and Housemait updates automatically.
                  </p>
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
