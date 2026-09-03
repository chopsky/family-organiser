import { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from 'react';
import api from '../lib/api';
import Spinner from '../components/Spinner';
import ErrorBanner from '../components/ErrorBanner';
import { IconCalendar, IconPlus, IconUser, IconCheck, IconSearch, IconSettings, IconTrash, IconStar } from '../components/Icons';
import PageHeader from '../components/ui/PageHeader';
import Avatar from '../components/ui/Avatar';
import PillBtn from '../components/ui/PillBtn';
import { BottomSheet } from '../components/BottomSheet';
import Segmented from '../components/ui/Segmented';
import HeaderIconBtn from '../components/ui/HeaderIconBtn';
import { useCanWrite } from '../context/SubscriptionContext';
import useSwipeNavigate from '../hooks/useSwipeNavigate';
import { useChildMode } from '../context/ChildModeContext';
import SubscribePrompt from '../components/SubscribePrompt';
import { readCache, writeCache, loadCached } from '../lib/offlineCache';
import { usePullToRefresh, PullIndicator } from '../hooks/usePullToRefresh';
import { useAppForegroundRefresh } from '../hooks/useAppForegroundRefresh';
import { confirmDestructive } from '../lib/action-sheet';
import ActivityModal from '../components/ActivityModal';
import { looksLikeGathering } from '../lib/partyDetect';
import { conflictedKeys, itemKey } from '../lib/conflicts';
import WhatsAppWinNudge from '../components/WhatsAppWinNudge';
import { isKidMember } from '../lib/kidsTheme';
import { openInMaps } from '../lib/maps';

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

// ── Modal styling shared with the Tasks/Rewards modals ──────────────────
// The New Event / New activity sheet must read as the same family as
// Chores.jsx's TaskModal and Rewards.jsx's reward modal: serif 22px
// heading, 12px/600 field labels, white rounded-10 inputs, avatar-ring
// member pickers and right-aligned rounded-10 footer buttons. Constants
// mirror Chores.jsx exactly.
const M_INK = '#1A1620', M_INK2 = '#4A4453', M_INK3 = '#8A8493';
const M_LINE_STRONG = 'rgba(26,22,32,0.12)';
const M_BRAND = 'var(--color-plum)', M_BRAND_SOFT = 'var(--color-plum-light)';
const M_BG_SOFT = '#F3EEE5';
const M_SERIF = 'var(--font-serif-display)';
const mInput = { width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 10, border: `1px solid ${M_LINE_STRONG}`, fontSize: 14, color: M_INK, outline: 'none', background: '#fff', fontFamily: 'inherit' };

// Field wrapper: label row (12/600, optional right-aligned control such as
// the All-day toggle) above the control - identical to Chores' Field.
function MField({ label, right, children, style }) {
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

// Avatar-ring member picker button (the task modal's "Who" control).
function MAvatarPick({ member, on, onClick, hex }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={member.name}
      style={{ position: 'relative', border: on ? `2px solid ${hex}` : '2px solid transparent', borderRadius: '50%', padding: 1, background: 'transparent', cursor: 'pointer' }}
    >
      <Avatar member={member} size={50} bg="#fff" />
      {on && (
        <span style={{ position: 'absolute', right: -2, bottom: -2, width: 18, height: 18, borderRadius: '50%', background: hex, border: '2px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        </span>
      )}
    </button>
  );
}

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
const CAL_VIEWS = [
  { value: 'month', label: 'Month' },
  { value: 'week', label: 'Week' },
  { value: 'day', label: 'Day' },
  { value: 'schedule', label: 'Schedule' },
];

// ── Event kinds (design_handoff_calendar type filter) ──
// The handoff wants a `kind` per event; rather than a migration we DERIVE
// it: weekly-activity occurrences are Clubs, school category is School,
// appointment-ish titles are Appointments, everything else (birthdays
// included) is Family. Public holidays match no kind, so any kind filter
// hides them - you don't mean bank holidays when you ask for "Clubs".
const CAL_KINDS = [
  ['school', 'School'],
  ['activity', 'Clubs'],
  ['appointment', 'Appointments'],
  ['family', 'Family'],
];
const APPOINTMENT_RE = /\b(dentist|doctor|dr|gp|optician|hygienist|physio|osteopath|chiropractor|vet|appointment|check-?up|clinic|hospital|orthodontist|midwife|barber|haircut)\b/i;
function eventKind(e) {
  if (e._activity) return 'activity';
  if (e.category === 'school') return 'school';
  if (e.category === 'birthday') return 'family';
  if (e.category === 'public_holiday') return null;
  return APPOINTMENT_RE.test(e.title || '') ? 'appointment' : 'family';
}

// Week/Day time-grid range: 07:00-22:00 per the handoff, stretched when
// real events fall outside it (a 6am flight must not be invisible).
const GRID_START_MIN = 7 * 60;
const GRID_END_MIN = 22 * 60;
function gridRangeFor(dayEventLists) {
  let start = GRID_START_MIN; let end = GRID_END_MIN;
  for (const list of dayEventLists) {
    for (const ev of list) {
      const s = new Date(ev.start_time); const e = ev.end_time ? new Date(ev.end_time) : null;
      if (!Number.isNaN(s.getTime())) start = Math.min(start, Math.floor((s.getHours() * 60 + s.getMinutes()) / 60) * 60);
      const endMin = e && !Number.isNaN(e.getTime()) ? e.getHours() * 60 + e.getMinutes() : null;
      if (endMin != null && endMin > 0) end = Math.max(end, Math.min(24 * 60, Math.ceil(endMin / 60) * 60));
    }
  }
  return { start, end };
}
const minOfDay = (iso) => { const d = new Date(iso); return d.getHours() * 60 + d.getMinutes(); };
// The handoff's block text colour: the event colour pulled 58% toward ink.
const inkMix = (hex) => `color-mix(in srgb, ${hex}, #1A1620 58%)`;

// Filter chip (mobile filter panel): ink-filled when active, hairline ring
// when not - per design_handoff_calendar.
function MobileFilterChip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 flex items-center font-semibold"
      style={{
        gap: 6, borderRadius: 99, padding: '7px 13px', fontSize: 12.5,
        background: active ? M_INK : '#fff', color: active ? '#fff' : M_INK2,
        boxShadow: active ? 'none' : `inset 0 0 0 1px ${M_LINE_STRONG}`,
        transition: 'all .15s ease',
      }}
    >
      {children}
    </button>
  );
}

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
  // Walk months anchored to the 1st: incrementing setMonth from a
  // month-END date overflows (Aug 31 + 1 month = "Sep 31" = Oct 1), which
  // skipped September entirely for the 31 Aug - 6 Sep week and left six
  // empty columns (live report 2026-09-02). Day-1 anchoring can't overflow.
  const months = new Set();
  const d = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  const end = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
  while (d <= end) {
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

function ChevronDown({ className = 'w-4 h-4' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9l6 6 6-6" />
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
  // Schedule view: how many months BEYOND currentMonth the agenda list
  // extends. Starts at 1 (current + next month covers "the next couple of
  // weeks" even late in a month); a sentinel at the list's end bumps it as
  // the user scrolls, so the list crosses month boundaries instead of
  // stopping dead. Reset on month paging so chevrons stay cheap.
  const [scheduleMonthsAhead, setScheduleMonthsAhead] = useState(1);
  // Floating "↑ Today" pill, shown once the schedule list is scrolled
  // meaningfully off the top (the page scrolls the window in this view).
  const [scheduleShowTop, setScheduleShowTop] = useState(false);
  const scheduleEndRef = useRef(null);
  // ── Mobile chrome (design_handoff_calendar) ──
  const [mobileSearching, setMobileSearching] = useState(false); // title row morphed into search
  const [showMobileFilters, setShowMobileFilters] = useState(false); // chip rows open
  const [mobileKindFilter, setMobileKindFilter] = useState(null); // null | school|activity|appointment|family
  // One extension in flight at a time: cleared when fresh events land, so a
  // still-visible sentinel re-fires only after the new month has rendered.
  const scheduleExtendBusyRef = useRef(false);
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
  // Tap on a weekly-activity occurrence → its own sheet (skip this day /
  // edit series / delete series), NOT the event modal: activities live in
  // child_weekly_schedule, so the event editor's PATCH would 404.
  const [activitySheet, setActivitySheet] = useState(null); // { activity, child, date }
  const [activityBusy, setActivityBusy] = useState(false);
  // "Change just this day" mini-form inside the sheet (per-date override:
  // different time/pickup for one occurrence, series untouched).
  const [actChangeOpen, setActChangeOpen] = useState(false);
  const [ovStart, setOvStart] = useState('');
  const [ovEnd, setOvEnd] = useState('');
  const [ovPickup, setOvPickup] = useState('');
  const [activityEdit, setActivityEdit] = useState(null); // { child, activity } → shared ActivityModal
  const [loading, setLoading] = useState(!seedMonth);
  const [error, setError] = useState('');
  // Form state
  const [showForm, setShowForm] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);
  // Event attachments (files linked to an existing event).
  const [eventAttachments, setEventAttachments] = useState([]);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const attachmentInputRef = useRef(null);
  // Party invites: the host-side roster for the event being edited, plus the
  // shareable link once one exists. Null roster = not loaded / no tables yet.
  const [inviteRoster, setInviteRoster] = useState(null);
  const [inviteUrl, setInviteUrl] = useState('');
  const [inviteBusy, setInviteBusy] = useState(false);
  // Just-saved gathering offer ({id, title}) - see the save handler.
  const [gatherOffer, setGatherOffer] = useState(null);
  // WhatsApp win-moment: flips true after an event is saved in the app - the
  // moment 'next time, just text it' is a concrete offer, not a pitch.
  const [waWin, setWaWin] = useState(false);
  const [gatherBusy, setGatherBusy] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [inviteRosterOpen, setInviteRosterOpen] = useState(false);
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
  // Create-sheet type: one modal morphs between a household event and a
  // kid's weekly activity (design_handoff_event_activity). Create-only -
  // editing an event never shows the toggle, and activity edits go through
  // the activity sheet → ActivityModal.
  const [createKind, setCreateKind] = useState('event'); // 'event' | 'activity'
  const [actKid, setActKid] = useState('');
  const [actDays, setActDays] = useState([]); // 0=Mon..6=Sun, multi-select
  const [actStart, setActStart] = useState('');
  const [actEnd, setActEnd] = useState('');
  const [actTerms, setActTerms] = useState([]);
  const [actTermsLoading, setActTermsLoading] = useState(false);
  const [actTermKey, setActTermKey] = useState('ongoing'); // term start_date | 'ongoing' | 'custom'
  const [actCustomStart, setActCustomStart] = useState('');
  const [actCustomEnd, setActCustomEnd] = useState('');
  const [actPickup, setActPickup] = useState('');
  // Default to no reminder. The "+ Add notification" button lets users
  // opt in explicitly. Pre-checking a 5-min default surprised users who
  // never asked for one (and silently saved an actual reminder row if
  // they edited the event without touching the field).
  const [formReminders, setFormReminders] = useState([]);
  const [showMoreOptions, setShowMoreOptions] = useState(false);
  const [saving, setSaving] = useState(false);
  // Delete choice for a RECURRING event's occurrence: just this day
  // (event_skips row) vs the whole series (soft delete).
  const [recurDeleteOpen, setRecurDeleteOpen] = useState(false);

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
  // Mobile month/week/day dropdown (sits in the header next to +)
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const viewMenuRef = useRef(null);

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

  const load = useCallback(async (opts = {}) => {
    try {
      let monthsToFetch;
      if (viewMode === 'week') {
        const weekStart = getWeekStart(selectedDate);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);
        monthsToFetch = getMonthsForRange(weekStart, weekEnd);
      } else if (viewMode === 'day') {
        monthsToFetch = [monthParam(selectedDate)];
      } else if (viewMode === 'schedule') {
        // The agenda list runs from currentMonth through however far the
        // user has scrolled; the school-event scoping below already handles
        // a contiguous multi-month range (proven by week view spanning two).
        monthsToFetch = Array.from({ length: scheduleMonthsAhead + 1 }, (_, i) =>
          monthParam(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + i, 1)));
      } else {
        monthsToFetch = [monthParam(currentMonth)];
      }

      const monthResults = await Promise.all(monthsToFetch.map(fetchMonth));
      const schoolFetch = schoolData ? Promise.resolve(null) : api.get('/schools').catch(() => null);
      // Activities are cached for the page's lifetime, EXCEPT on explicit
      // refreshes (pull-to-refresh, AI data-changed broadcast, the activity
      // sheet's skip/edit/delete) - those must see fresh skips/edits.
      const activitiesFetch = (activitiesData && !opts.force) ? Promise.resolve(null) : api.get('/schools/activities').catch(() => null);
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
            // Term window (same rule as Kids Mode + the ICS feed - this
            // view previously rendered activities year-round) and per-date
            // skips ("skip just this day" from the activity sheet / AI).
            if (act.start_date && dateStr < act.start_date) continue;
            if (act.end_date && dateStr > act.end_date) continue;
            if (act.skips?.includes(dateStr)) continue;
            // Per-date override ("piano is at 16:00 today"): replace the
            // series time for this one occurrence.
            const ov = act.overrides?.[dateStr] || null;
            const effStart = ov?.time_start || act.time_start;
            const effEnd = ov ? (ov.time_end || null) : act.time_end;
            schoolEvents.push({
              id: `act-${act.id}-${dateStr}`,
              title: `${child.name} - ${act.activity}`,
              start_time: effStart ? `${dateStr}T${effStart}` : `${dateStr}T00:00:00Z`,
              end_time: effEnd ? `${dateStr}T${effEnd}` : null,
              all_day: !effStart,
              category: 'school',
              assigned_to_names: [child.name],
              color: child.color_theme || 'sky',
              _school: true,
              _activity: true,
              // The activity sheet (tap → skip/edit/delete) needs the series
              // id + the concrete occurrence date.
              _activityId: act.id,
              _activityDate: dateStr,
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
  }, [currentMonth, selectedDate, viewMode, members, childMode, scheduleMonthsAhead]);

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
    await load({ force: true });
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

  // Scroll to current time in day/week view. The grids start at 07:00
  // (design_handoff_calendar) with 60px/50px hours - land the now-line a
  // little below the card's top edge.
  useEffect(() => {
    if ((viewMode === 'day' || viewMode === 'week') && scrollContainerRef.current) {
      const nowD = new Date();
      const rowH = viewMode === 'day' ? 60 : 50;
      const scrollTo = Math.max(0, (nowD.getHours() - 7 - 1) * rowH);
      setTimeout(() => {
        scrollContainerRef.current?.scrollTo({ top: scrollTo, behavior: 'smooth' });
      }, 100);
    }
  }, [viewMode]);

  // Schedule view: paging months resets the scroll-extension so chevrons
  // always land on a cheap one-extra-month window.
  useEffect(() => {
    setScheduleMonthsAhead(1);
  }, [currentMonth]);

  // Schedule view: extend across month boundaries as the user scrolls. A
  // sentinel under the list bumps monthsAhead when it nears the viewport;
  // the busy ref serialises extensions (cleared below when fresh events
  // land), and the 12-month cap makes an event-free future stop asking.
  useEffect(() => {
    if (viewMode !== 'schedule') return undefined;
    const el = scheduleEndRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const obs = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      if (scheduleExtendBusyRef.current) return;
      scheduleExtendBusyRef.current = true;
      setScheduleMonthsAhead((n) => Math.min(n + 1, 12));
    }, { rootMargin: '400px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, [viewMode, scheduleMonthsAhead]);

  useEffect(() => {
    scheduleExtendBusyRef.current = false;
  }, [events]);

  // Schedule view: show the floating "↑ Today" pill after ~260px of window
  // scroll; hide it again near the top. Passive listener, torn down (and
  // the pill hidden) whenever the view changes.
  useEffect(() => {
    if (viewMode !== 'schedule') {
      setScheduleShowTop(false);
      return undefined;
    }
    const onScroll = () => setScheduleShowTop(window.scrollY > 260);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
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

  // Close the mobile view dropdown on click outside
  useEffect(() => {
    if (!viewMenuOpen) return undefined;
    function handleClick(e) {
      if (viewMenuRef.current && !viewMenuRef.current.contains(e.target)) {
        setViewMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [viewMenuOpen]);

  // Init member filters when members load
  useEffect(() => {
    if (members.length > 0 && activeMemberFilters === null) {
      setActiveMemberFilters(new Set(members.map(m => m.id)));
    }
  }, [members]);

  // ── Navigation ────────────────────────────────────────────

  function navigatePrev() {
    if (viewMode === 'month' || viewMode === 'schedule') {
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
    if (viewMode === 'month' || viewMode === 'schedule') {
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

  // Swipe left/right anywhere on the view = next/previous day, week or
  // month - the arrows stay for desktop, but on a phone the page turns
  // like the native calendar.
  const swipe = useSwipeNavigate({ onPrev: navigatePrev, onNext: navigateNext });

  // ── Navigation label ──────────────────────────────────────

  const navigationLabel = useMemo(() => {
    if (viewMode === 'month') {
      return currentMonth.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    }
    if (viewMode === 'schedule') {
      const now = new Date();
      const isThisMonth = currentMonth.getFullYear() === now.getFullYear() && currentMonth.getMonth() === now.getMonth();
      return isThisMonth
        ? `Coming up · ${currentMonth.toLocaleDateString('en-GB', { month: 'short' })}`
        : currentMonth.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
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

  // ── Mobile header title + sub per view (design_handoff_calendar) ──
  const mobileNav = useMemo(() => {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    if (viewMode === 'day') {
      return {
        title: selectedDate.toLocaleDateString('en-GB', { weekday: 'long' }),
        sub: `${selectedDate.getDate()} ${selectedDate.toLocaleDateString('en-GB', { month: 'short' })}`,
      };
    }
    if (viewMode === 'week') {
      const ws = getWeekStart(selectedDate);
      const we = new Date(ws); we.setDate(we.getDate() + 6);
      // The title already names the month, so a same-month week is just
      // "7–13"; a straddling week spells both months out.
      const sub = ws.getMonth() === we.getMonth()
        ? `${ws.getDate()}–${we.getDate()}`
        : `${ws.getDate()} ${ws.toLocaleDateString('en-GB', { month: 'short' })} – ${we.getDate()} ${we.toLocaleDateString('en-GB', { month: 'short' })}`;
      return { title: ws.toLocaleDateString('en-GB', { month: 'long' }), sub };
    }
    if (viewMode === 'schedule') {
      const cur = currentMonth.getFullYear() === now.getFullYear() && currentMonth.getMonth() === now.getMonth();
      return cur
        ? { title: 'Coming up', sub: currentMonth.toLocaleDateString('en-GB', { month: 'long' }) }
        : { title: currentMonth.toLocaleDateString('en-GB', { month: 'long' }), sub: String(currentMonth.getFullYear()) };
    }
    return { title: currentMonth.toLocaleDateString('en-GB', { month: 'long' }), sub: String(currentMonth.getFullYear()) };
  }, [viewMode, currentMonth, selectedDate]);

  // Today pill shows only when the user is OFF today (month/selection-wise).
  const offToday = !(
    currentMonth.getFullYear() === today.getFullYear()
    && currentMonth.getMonth() === today.getMonth()
    && (viewMode === 'month' || viewMode === 'schedule' ? true : isSameDay(selectedDate, today))
  ) || ((viewMode === 'day' || viewMode === 'week') && !isSameDay(selectedDate, today));

  // Person filter (mobile chips): single-select over the SAME
  // activeMemberFilters state the desktop cog multi-toggles. One member in
  // the set = that chip active; the existing fail-open rule (items
  // resolving to no member are household-wide and always shown) is exactly
  // the handoff's "person filter includes whole-family events".
  const mobileFilterWho = activeMemberFilters && activeMemberFilters.size === 1
    ? [...activeMemberFilters][0] : null;
  const personFilterActive = !!(activeMemberFilters && members.length > 0 && activeMemberFilters.size < members.length);
  const mobileFilterCount = (personFilterActive ? 1 : 0) + (mobileKindFilter ? 1 : 0);
  const setMobileFilterWho = (id) => {
    setActiveMemberFilters(id ? new Set([id]) : new Set(members.map((m) => m.id)));
  };
  const clearMobileFilters = () => {
    setMobileFilterWho(null);
    setMobileKindFilter(null);
  };
  const mobileSearchActive = mobileSearching && searchQuery.trim().length > 0;

  // Real layout containment for the week/day grid cards: scroll the page
  // to the top, measure where the card actually starts, and cap it to the
  // space remaining above the floating nav - instead of guessing chrome
  // heights (the guessed --grid-cap constants broke the moment a variable-
  // height all-day strip appeared above the card; live report 2026-09-02).
  // env() stays inside the calc so the safe-area works without JS needing
  // to read it. Re-measures on anything that can move the card's top.
  // NOTE this effect must sit BELOW the derived consts its dep array reads
  // (mobileFilterCount etc.) - a dependency array is evaluated at render
  // time, and reading a later `const` from up here is a TDZ crash, which
  // took the whole page down ("Cannot access 'ei' before initialization",
  // live report 2026-09-02).
  useLayoutEffect(() => {
    if (viewMode !== 'week' && viewMode !== 'day') return undefined;
    const apply = () => {
      const el = scrollContainerRef.current;
      if (!el) return;
      const top = Math.round(el.getBoundingClientRect().top + window.scrollY);
      const isDesktop = window.matchMedia('(min-width: 768px)').matches;
      el.style.maxHeight = isDesktop
        ? `calc(100dvh - ${top}px - 24px)`
        : `calc(100dvh - ${top}px - max(22px, env(safe-area-inset-bottom, 0px) + 8px) - 88px)`;
    };
    window.scrollTo(0, 0);
    const raf = requestAnimationFrame(apply);
    window.addEventListener('resize', apply);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', apply); };
  }, [viewMode, showMobileFilters, mobileFilterCount, mobileSearchActive, events, members, currentMonth, selectedDate]);

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

  // Person-filter fallback for UNASSIGNED events: match member first names
  // in the title, word-bounded ("Mason Dermatologist" → Mason; "Garden
  // bin" → nobody). Device-synced feeds carry no assignment (real data:
  // the founder's week is ~85% such events), so without this the person
  // filter looked inert - everything stayed via the fail-open rule.
  // Filter-only: Child Mode's visibility gate keeps using real assignees.
  function titleMemberIds(title, membersList) {
    const ids = new Set();
    if (!title) return ids;
    for (const m of membersList) {
      const first = String(m.name || '').trim().split(/\s+/)[0];
      if (first.length < 3) continue; // "Jo"/initials: too collision-prone
      const re = new RegExp(`\\b${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (re.test(title)) ids.add(m.id);
    }
    return ids;
  }

  function eventsForDate(date) {
    const ds = toDateStr(date);
    const memberIdSet = new Set(members.map((m) => m.id));
    const nameToId = new Map(members.map((m) => [m.name, m.id]));
    const kidIds = childMode ? new Set(members.filter(isKidMember).map((m) => m.id)) : null;
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
      // Type filter (mobile chip rows): matches the derived kind. Every
      // view and the search read through here, so it composes with the
      // member filter below for free.
      if (mobileKindFilter && eventKind(e) !== mobileKindFilter) return false;
      // Child Mode: holidays + school (term dates / extracurriculars) stay; any
      // other event must be assigned to a dependent. Unassigned adult/household
      // events are hidden (a deliberate departure from the fail-open default).
      if (childMode && cat !== 'public_holiday' && cat !== 'school') {
        const ids = assigneeMemberIds(e, nameToId, memberIdSet);
        if (![...ids].some((id) => kidIds.has(id))) return false;
      }
      // Member filter by IDENTITY (member id), and FAIL OPEN: hide only when the
      // item is assigned to current member(s) who are ALL toggled off. An item
      // resolving to no current member falls back to name-in-title matching
      // (unassigned synced events), and only then counts as household-wide -
      // so a drifted/stale stored name can never silently hide it.
      if (activeMemberFilters) {
        let ids = assigneeMemberIds(e, nameToId, memberIdSet);
        if (ids.size === 0) ids = titleMemberIds(e.title, members);
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
    const kidIds = childMode ? new Set(members.filter(isKidMember).map((m) => m.id)) : null;
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
    // New timed events default to one 30-min reminder (a removable chip) -
    // parity with the bot's auto-reminder. Real near-miss 2026-09-01: an
    // app-created event defaulted to NO reminders and went silent. Edits
    // never pass here (openEditForm loads the event's own reminders).
    setFormReminders([{ time: '30', unit: 'minutes' }]);
    setShowMoreOptions(false);
    setEventAttachments([]);
    setInviteRoster(null);
    setInviteUrl('');
    setInviteBusy(false);
    setInviteCopied(false);
    setInviteRosterOpen(false);
    // Activity-mode fields (the Event / Kids' activity toggle).
    setCreateKind('event');
    const base = selectedDate || today;
    setActDays([(new Date(base).getDay() + 6) % 7]);
    setActStart('');
    setActEnd('');
    setActTermKey('ongoing');
    setActCustomStart('');
    setActCustomEnd('');
    setActPickup('');
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
      alert(err.response?.data?.status === 'premium_required'
        ? 'Attaching files is part of Premium. Everything already attached stays viewable - upgrade any time in Settings.'
        : (err.response?.data?.error || 'Could not attach that file.'));
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

  // ── Party invites (host side) ──────────────────────────
  // The public link lives at housemait.com/p/<token>, so it can be rebuilt
  // client-side from the roster's token - one source of truth for the path.
  const inviteUrlFromToken = (token) => `${window.location.origin}/p/${token}`;

  // Invite actions have two hosts: the event editor (native events) and the
  // read-only synced sheet (third-party calendar events - read-only content,
  // but real rows, so links attach fine). The sheet wins when open: closing
  // it always nulls syncedEvent, whereas editingEvent can linger after the
  // editor closes (the convert-to-task path skips resetForm).
  const inviteEventId = syncedEvent?.id || editingEvent?.id || null;
  const inviteEventTitle = syncedEvent ? (syncedEvent.title || '') : formTitle;

  async function loadInviteRoster(eventId) {
    try {
      const { data } = await api.get(`/calendar/events/${eventId}/rsvps`);
      setInviteRoster(data);
      setInviteUrl(data?.hasLink && data.token ? inviteUrlFromToken(data.token) : '');
    } catch {
      setInviteRoster(null); // quiet: the section just shows the create button
    }
  }

  async function copyInviteUrl(url) {
    try {
      await navigator.clipboard.writeText(url);
      setInviteCopied(true);
      setTimeout(() => setInviteCopied(false), 2000);
    } catch {
      // Clipboard can be blocked (older WebViews) - the visible URL is
      // selectable, so failing silently beats an alert here.
    }
  }

  async function revokeInviteLink() {
    if (!inviteEventId || inviteBusy) return;
    const ok = await confirmDestructive({
      title: 'Turn off this invite link?',
      message: 'Anyone with the link won’t be able to open it or RSVP any more. RSVPs you’ve already received are kept.',
      confirmLabel: 'Turn off',
    });
    if (!ok) return;
    setInviteBusy(true);
    try {
      await api.delete(`/calendar/events/${inviteEventId}/invite-link`);
      await loadInviteRoster(inviteEventId);
    } catch {
      alert('Could not turn off the link — try again in a moment.');
    } finally {
      setInviteBusy(false);
    }
  }

  async function createInviteLink() {
    if (!inviteEventId || inviteBusy) return;
    setInviteBusy(true);
    try {
      const { data } = await api.post(`/calendar/events/${inviteEventId}/invite-link`);
      setInviteUrl(data.url);
      setInviteRoster(prev => ({ ...(prev || { going: 0, declined: 0, kids: 0, adults: 0, dietary: [], rsvps: [] }), hasLink: true }));
      // On phones go straight to the share sheet - the whole flow is "make
      // link, paste into the class group chat".
      if (navigator.share) {
        try {
          await navigator.share({ title: inviteEventTitle || 'You’re invited', url: data.url });
        } catch { /* user closed the sheet - the link row stays visible */ }
      } else {
        copyInviteUrl(data.url);
      }
    } catch (err) {
      alert(err.response?.data?.error || 'Could not create the invite link.');
    } finally {
      setInviteBusy(false);
    }
  }

  function openAddForm(date, hour) {
    if (childMode) return; // calendar is read-only for kids
    resetForm();
    if (date) {
      setFormDate(toDateStr(date));
      setFormEndDate(toDateStr(date));
      // Activity mode defaults its "Repeats on" day to the tapped cell.
      setActDays([(new Date(date).getDay() + 6) % 7]);
    }
    if (hour !== undefined) {
      setFormStart(`${String(hour).padStart(2, '0')}:00`);
      setFormEnd(`${String(Math.min(hour + 1, 23)).padStart(2, '0')}:00`);
    }
    // Default the activity's child: the single filtered member when the
    // filter is one kid, otherwise the household's first dependent.
    const kids = members.filter(isKidMember); // activities belong to a child, never a pet
    let defaultKid = kids[0]?.id || '';
    if (activeMemberFilters && activeMemberFilters.size === 1) {
      const only = [...activeMemberFilters][0];
      if (kids.some((k) => k.id === only)) defaultKid = only;
    }
    setActKid(defaultKid);
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
    // Weekly-activity occurrences get their own sheet: the series lives in
    // child_weekly_schedule (not calendar_events), so the event editor
    // can't touch it. The sheet offers skip-this-day / edit / delete.
    if (ev._activity) {
      const act = (activitiesData || []).find((a) => a.id === ev._activityId);
      if (act) {
        setActivitySheet({
          activity: act,
          child: members.find((m) => m.id === act.child_id) || null,
          date: ev._activityDate,
        });
        // Prefill the change-just-this-day form with the occurrence's
        // EFFECTIVE values (existing override wins over the series).
        const ov = act.overrides?.[ev._activityDate] || null;
        setOvStart(String(ov?.time_start || act.time_start || '').slice(0, 5));
        setOvEnd(String(ov?.time_end || act.time_end || '').slice(0, 5));
        setOvPickup((ov ? ov.pickup_member_id : act.pickup_member_id) || '');
        setActChangeOpen(false);
      }
      return;
    }
    // Synced copies (device sync / URL feeds) are READ-ONLY: an edit here
    // would silently revert on the next sync and a delete would resurrect -
    // the most confusing possible outcome. Show a detail sheet with
    // provenance instead of the edit modal. The event CONTENT is read-only,
    // but it's still a real calendar_events row in this household, so party
    // invites attach fine - load the roster for the sheet's invite section
    // (without it the 🎈 label promised a card this sheet never had - live
    // report 2026-09-01, play date created in a third-party calendar).
    if (ev.external_feed_id) {
      setSyncedEvent(ev);
      setInviteRoster(null);
      setInviteUrl('');
      setInviteCopied(false);
      setInviteRosterOpen(false);
      if (ev.id) loadInviteRoster(ev.id);
      return;
    }
    // School term dates are fabricated entries derived from the School
    // page's imports - there is no calendar_events row behind them, so the
    // editor's PATCH had nothing to hit and 500ed (real report 2026-08-11).
    // Read-only detail sheet, managed on the School page.
    if (ev._school) {
      setSyncedEvent(ev);
      return;
    }
    setEditingEvent(ev);
    setEventAttachments([]);
    if (ev.id) loadAttachments(ev.id);
    setInviteRoster(null);
    setInviteUrl('');
    setInviteCopied(false);
    setInviteRosterOpen(false);
    if (ev.id) loadInviteRoster(ev.id);
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

  // Activity mode's term selector: load the chosen child's real school
  // terms (same source as the Family page's form) and default to the term
  // covering today. Falls back to "Ongoing" when the child has no terms.
  useEffect(() => {
    if (!showForm || createKind !== 'activity' || !actKid) return undefined;
    let cancelled = false;
    setActTermsLoading(true);
    api.get(`/schools/terms/${actKid}`)
      .then(({ data }) => {
        if (cancelled) return;
        const t = data.terms || [];
        setActTerms(t);
        const todayStr = toDateStr(new Date());
        const cur = t.find((x) => todayStr >= x.start_date && todayStr <= x.end_date);
        setActTermKey(cur ? cur.start_date : 'ongoing');
      })
      .catch(() => { if (!cancelled) { setActTerms([]); setActTermKey('ongoing'); } })
      .finally(() => { if (!cancelled) setActTermsLoading(false); });
    return () => { cancelled = true; };
  }, [showForm, createKind, actKid]);

  // Submit for the create sheet's Kids' activity mode: one
  // child_weekly_schedule row per selected weekday (how multi-day
  // activities are modelled everywhere else), sharing the chosen term
  // window, pickup person and show-on-calendar flag.
  async function handleActivityCreate(e) {
    e.preventDefault();
    if (!formTitle.trim() || !actKid || actDays.length === 0) return;
    setSaving(true);
    try {
      const base = {
        child_id: actKid,
        activity: formTitle.trim(),
        time_start: actStart || null,
        time_end: actEnd || null,
        pickup_member_id: actPickup || null,
        // Created FROM the calendar, so it obviously belongs on it - the
        // visibility toggle lives in Family Setup / the edit modal.
        show_on_calendar: true,
      };
      const termObj = actTerms.find((t) => t.start_date === actTermKey) || null;
      if (actTermKey === 'custom') {
        Object.assign(base, { start_date: actCustomStart || null, end_date: actCustomEnd || null, term_label: null });
      } else if (termObj) {
        Object.assign(base, { start_date: termObj.start_date, end_date: termObj.end_date, term_label: termObj.label });
      } else {
        Object.assign(base, { start_date: null, end_date: null, term_label: null });
      }
      for (const day of [...actDays].sort((a, b) => a - b)) {
        await api.post('/schools/activities', { ...base, day_of_week: day });
      }
      setShowForm(false);
      resetForm();
      refresh();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save the activity.');
    } finally {
      setSaving(false);
    }
  }

  // ── Activity sheet actions (skip one date / delete the series) ─────
  async function handleSkipActivityDay() {
    if (!activitySheet) return;
    setActivityBusy(true);
    try {
      await api.post(`/schools/activities/${activitySheet.activity.id}/skips`, { date: activitySheet.date });
      setActivitySheet(null);
      refresh();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not skip this day.');
    } finally {
      setActivityBusy(false);
    }
  }

  // "Change just this day": write a per-date override (same exceptions
  // table as skips, kind='override') carrying the one-off time/pickup.
  async function handleOverrideActivityDay() {
    if (!activitySheet) return;
    setActivityBusy(true);
    try {
      await api.post(`/schools/activities/${activitySheet.activity.id}/skips`, {
        date: activitySheet.date,
        time_start: ovStart || null,
        time_end: ovEnd || null,
        pickup_member_id: ovPickup || null,
      });
      setActivitySheet(null);
      refresh();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not change this day.');
    } finally {
      setActivityBusy(false);
    }
  }

  // Remove an existing per-date override (back to the usual time/pickup).
  async function handleResetActivityDay() {
    if (!activitySheet) return;
    setActivityBusy(true);
    try {
      await api.delete(`/schools/activities/${activitySheet.activity.id}/skips/${activitySheet.date}`);
      setActivitySheet(null);
      refresh();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not reset this day.');
    } finally {
      setActivityBusy(false);
    }
  }

  async function handleDeleteActivitySeries() {
    if (!activitySheet) return;
    const ok = await confirmDestructive({
      title: 'Delete activity?',
      message: `This removes "${activitySheet.activity.activity}" every week, not just this day.`,
    });
    if (!ok) return;
    setActivityBusy(true);
    try {
      await api.delete(`/schools/activities/${activitySheet.activity.id}`);
      setActivitySheet(null);
      refresh();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not delete the activity.');
    } finally {
      setActivityBusy(false);
    }
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

      let createdEvent = null;
      if (editingEvent) {
        await api.patch(`/calendar/events/${editingEvent.id}`, payload);
      } else {
        try {
          const { data } = await api.post('/calendar/events', payload);
          createdEvent = data?.event || null;
        } catch (err) {
          // Backend returns 409 when a matching event already exists for the
          // same date, to prevent silent duplicates. Ask the user whether to
          // add a second copy anyway and, if yes, re-send with force: true.
          if (err.response?.status === 409) {
            const existingMsg = err.response?.data?.message || 'A similar event already exists.';
            const confirmMsg = `${existingMsg}\n\nAdd it anyway?`;
            if (window.confirm(confirmMsg)) {
              const { data } = await api.post('/calendar/events', { ...payload, force: true });
              createdEvent = data?.event || null;
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
      // Creation-moment invite offer: the "🎈 Hosting a party?" card only
      // lives inside the saved event's edit sheet, which most people never
      // reopen - so a just-created gathering offers the RSVP link right
      // here, at the moment of maximum intent. (The bot has had this
      // parity since the party-invite loop shipped.)
      if (createdEvent?.id && looksLikeGathering(createdEvent.title || payload.title) && !childMode) {
        setGatherOffer({ id: createdEvent.id, title: createdEvent.title || payload.title });
      }
      if (createdEvent?.id && !childMode) setWaWin(true);
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
    // A recurring event's occurrence gets the choice sheet instead of the
    // straight confirm - "delete today's" must not silently kill the
    // series (real user incident: a weekly event deleted for good when
    // only one day was meant).
    if (editingEvent?.recurrence && editingEvent?.start_time) {
      setRecurDeleteOpen(true);
      return;
    }
    const ok = await confirmDestructive({ title: 'Delete this event?', message: 'This cannot be undone.' });
    if (!ok) return;
    await performEventDelete(id);
  }

  async function performEventDelete(id) {
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

  // "Delete just this day": one event_skips row hides this occurrence
  // everywhere (calendar, digest, reminders, AI) - the series marches on.
  // The date key is the occurrence's ISO start sliced to YYYY-MM-DD,
  // exactly how the server's expansion derives it.
  async function skipEventOccurrence() {
    const ev = editingEvent;
    if (!ev) return;
    const date = String(ev.start_time).slice(0, 10);
    const occKey = ev.occurrence_key || ev.id;
    setRecurDeleteOpen(false);
    setShowForm(false);
    resetForm();
    setEvents(prev => prev.filter(e => (e.occurrence_key || e.id) !== occKey));
    invalidateMonthCache();
    try {
      await api.post(`/calendar/events/${ev.id}/skips`, { date });
      load().catch(() => {});
    } catch {
      setError('Could not remove this day.');
      await load();
    }
  }

  // Un-skip from the edit modal's "Removed days" chips.
  async function unskipEventDay(dateStr) {
    const ev = editingEvent;
    if (!ev) return;
    try {
      await api.delete(`/calendar/events/${ev.id}/skips/${dateStr}`);
      setEditingEvent(prev => (prev ? { ...prev, skips: (prev.skips || []).filter(d => d !== dateStr) } : prev));
      invalidateMonthCache();
      load().catch(() => {});
    } catch {
      setError('Could not restore that day.');
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
    const id = editingTask.id;
    const patch = {
      title: taskTitle.trim(),
      due_date: taskDueDate,
      due_time: taskDueTime || null,
      assigned_to_names: taskAssignees,
      recurrence: taskRecurrence || null,
      description: taskDescription || null,
      notification: taskNotification || null,
    };
    // Optimistic: move + relabel the to-do in local state and close the form at
    // once, so it jumps to its new day instantly instead of waiting on the PATCH
    // AND a full month re-fetch (the old flow awaited both, hence the lag). A
    // background reconcile then picks up server-resolved fields (e.g. the
    // assignee id/name arrays); a failure rolls the optimistic change back.
    const prevTasks = tasks;
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    closeTaskForm();
    try {
      await api.patch(`/tasks/${id}`, patch);
      invalidateMonthCache();
      load(); // background reconcile — not awaited, the UI has already moved
    } catch {
      setTasks(prevTasks); // roll the move back
      setError('Could not update the to-do.');
    }
  }

  // ── Calendar grid data ─────────────────────────────────

  const calendarDays = buildCalendarDays(currentMonth.getFullYear(), currentMonth.getMonth());
  const selectedEvents = selectedDate ? eventsForDate(selectedDate) : [];
  const selectedTasks = selectedDate ? tasksForDate(selectedDate) : [];

  // Week view data
  const weekStart = getWeekStart(selectedDate);
  const weekDays = getWeekDays(weekStart);

  // Current time, for the week/day grids' red now-line.
  const now = new Date();

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

  // Same-person double-bookings among the selected day's EVENTS (tasks
  // don't clash) - drives the amber ⚠️ chip. Cheap n² over one day.
  const selectedDayClashKeys = conflictedKeys(
    selectedDayItems.filter((i) => i._type === 'event'), members,
  );

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
    if (item._type === 'task') return { label: 'To-do', bg: '#FDF0EB', color: '#993C1D' };
    if (cat === 'school') return { label: 'School', bg: '#EDF5EE', color: '#3B6D11' };
    if (cat === 'birthday') return { label: 'Birthday', bg: '#F3EDFC', color: '#6B3FA0' };
    if (cat === 'public_holiday') return { label: 'Holiday', bg: '#EDF5EE', color: '#3B6D11' };
    return { label: 'Event', bg: '#F3EDFC', color: '#6B3FA0' };
  }

  // Shared search-results renderer, used by both the desktop popover and the
  // mobile full-width search bar. jumpToSearchResult already clears the query,
  // so a tapped result self-closes either dropdown.
  // Mobile search agenda (design_handoff_calendar): full-width result cards
  // replacing the views while a query is live. Same visibility rules as the
  // views - category toggles, kind filter, member filter all apply.
  function renderMobileSearchAgenda() {
    const q = searchQuery.trim().toLowerCase();
    const memberIdSetAll = new Set(members.map((m) => m.id));
    const nameToId = new Map(members.map((m) => [m.name, m.id]));
    const hits = events.filter((e) => {
      const matches = (e.title || '').toLowerCase().includes(q) || (e.location || '').toLowerCase().includes(q);
      if (!matches) return false;
      const cat = e.category || 'general';
      if (cat === 'general' && !activeFilters.has('events')) return false;
      if (cat === 'birthday' && !activeFilters.has('birthdays')) return false;
      if (cat === 'public_holiday' && !activeFilters.has('holidays')) return false;
      if (cat === 'school' && !activeFilters.has('school')) return false;
      if (mobileKindFilter && eventKind(e) !== mobileKindFilter) return false;
      if (activeMemberFilters) {
        let ids = assigneeMemberIds(e, nameToId, memberIdSetAll);
        if (ids.size === 0) ids = titleMemberIds(e.title, members);
        if (ids.size > 0 && ![...ids].some((id) => activeMemberFilters.has(id))) return false;
      }
      return true;
    }).sort((a, b) => (a.start_time || '').localeCompare(b.start_time || '')).slice(0, 60);

    return (
      <div style={{ paddingTop: 4 }}>
        <div className="text-[12px]" style={{ color: M_INK3, marginBottom: 12 }}>
          {hits.length} {hits.length === 1 ? 'result' : 'results'} for “{searchQuery.trim()}”
        </div>
        <div className="flex flex-col" style={{ gap: 10 }}>
          {hits.map((ev) => {
            const hex = getEventHex(ev);
            const d = new Date(ev.start_time);
            const eventMembers = getEventMembers(ev);
            return (
              <div
                key={ev.occurrence_key || ev.id}
                className="flex items-center bg-white cursor-pointer text-left"
                style={{ gap: 12, borderRadius: 16, padding: '12px 14px', borderLeft: `4px solid ${hex}`, boxShadow: '0 1px 0 rgba(26,22,32,0.04), 0 4px 14px rgba(26,22,32,0.04)' }}
                onClick={() => { if (ev.category !== 'public_holiday' && ev.category !== 'birthday') openEditForm(ev); }}
              >
                <div style={{ width: 52, flexShrink: 0 }}>
                  <div className="font-bold" style={{ fontSize: 11, color: 'var(--color-plum)', letterSpacing: '0.04em' }}>
                    {d.toLocaleDateString('en-GB', { weekday: 'short' }).toUpperCase()} {d.getDate()}
                  </div>
                  <div className="font-bold" style={{ fontSize: 13, color: M_INK, fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>
                    {ev.all_day ? 'All day' : formatTime(ev.start_time)}
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="truncate font-semibold" style={{ fontSize: 14, color: M_INK }}>{ev.title}</div>
                  {ev.location && <div className="truncate" style={{ fontSize: 12, color: M_INK3, marginTop: 1 }}>{ev.location}</div>}
                </div>
                {renderMemberStack(eventMembers, { size: eventMembers.length > 1 ? 24 : 28, ringColor: '#FFFFFF' })}
              </div>
            );
          })}
          {hits.length === 0 && (
            <div className="text-center" style={{ padding: '40px 0', color: M_INK3, fontFamily: M_SERIF, fontSize: 20 }}>
              No matching events
            </div>
          )}
        </div>
      </div>
    );
  }

  function renderSearchResults() {
    if (searchQuery.trim().length < 2) return <p className="text-sm text-warm-grey p-3 text-center">Type at least 2 characters…</p>;
    if (searchLoading && searchResults.length === 0) return <p className="text-sm text-warm-grey p-3 text-center">Searching…</p>;
    if (searchResults.length === 0) return <p className="text-sm text-warm-grey p-3 text-center">No results found</p>;
    return searchResults.map((result, i) => {
      const dateLabel = result.date
        ? new Date(result.date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
        : 'No date';
      const typeLabel = result.type === 'event' ? 'Event' : result.type === 'task' ? 'To-do' : 'School';
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
              { key: 'tasks', label: 'To-dos', dot: '#E8724A' },
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
      <WhatsAppWinNudge show={waWin} context="event" />

      {/* ── Toolbar (desktop only - mobile gets the compact chrome below,
            per design_handoff_calendar: no page title on phones) ── */}
      <div className="hidden md:block">
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
        {/* Mobile month/week/day dropdown - sits inline in the header next to
            the + button (replaces the old full-width switcher below and the
            filters cog). */}
        <div ref={viewMenuRef} className="md:hidden relative">
          <button
            type="button"
            aria-label="Calendar view"
            aria-haspopup="listbox"
            aria-expanded={viewMenuOpen}
            onClick={() => setViewMenuOpen(o => !o)}
            className={`inline-flex items-center gap-1.5 h-11 pl-4 pr-3 rounded-full border-[1.5px] bg-white text-[15px] font-semibold transition-colors active:scale-[0.98] ${
              viewMenuOpen ? 'border-plum text-plum' : 'border-light-grey text-charcoal'
            }`}
          >
            {CAL_VIEWS.find(v => v.value === viewMode)?.label || 'Month'}
            <ChevronDown className={`h-4 w-4 transition-transform ${viewMenuOpen ? 'rotate-180' : ''}`} />
          </button>
          {viewMenuOpen && (
            <div
              role="listbox"
              className="absolute right-0 top-[52px] w-44 bg-white rounded-2xl border border-light-grey z-30 p-1.5"
              style={{ boxShadow: 'var(--shadow-lg)' }}
            >
              {CAL_VIEWS.map(({ value, label }) => {
                const active = viewMode === value;
                return (
                  <button
                    key={value}
                    role="option"
                    aria-selected={active}
                    onClick={() => { setViewMode(value); setViewMenuOpen(false); }}
                    className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-[15px] font-semibold transition-colors ${
                      active ? 'bg-plum-light text-plum' : 'text-charcoal active:bg-cream'
                    }`}
                  >
                    {label}
                    {active && (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
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
                  placeholder="Search events, to-dos..."
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
              { value: 'schedule', label: 'Schedule' },
            ]}
          />

          {/* Current month / week / day - the desktop toolbar's only place
              for it (the PageHeader kicker is not rendered, and the mobile
              month-nav bar is md:hidden). Sits by the arrows that change it. */}
          <span
            className="ml-1 mr-1 text-[15px] font-semibold text-charcoal whitespace-nowrap"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {navigationLabel}
          </span>

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
      </div>

      {/* ── Mobile chrome (design_handoff_calendar): compact two-row header.
            Row 1: serif view title + sub (or the morphed search bar), Today
            pill only when off today, then search / filter / add circles
            (34px visuals inside 44px hit wrappers). Row 2 (below the filter
            panel): chevrons flanking the 4-up segmented switcher. ── */}
      <div className="md:hidden flex flex-col">
        <div className="flex items-center gap-2" style={{ minHeight: 38, marginBottom: 12 }}>
          {mobileSearching ? (
            <>
              <div
                className="flex-1 min-w-0 flex items-center gap-2 bg-white"
                style={{ borderRadius: 13, padding: '9px 13px', border: '1px solid rgba(26,22,32,0.07)', boxShadow: '0 1px 0 rgba(26,22,32,0.03)' }}
              >
                <IconSearch className="w-4 h-4 shrink-0" style={{ color: M_INK3 }} />
                <input
                  autoFocus
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search events, people, places…"
                  className="flex-1 min-w-0 border-0 outline-none bg-transparent text-[14px]"
                  style={{ color: M_INK }}
                />
                {searchQuery && (
                  <button type="button" aria-label="Clear search" onClick={() => setSearchQuery('')} className="shrink-0 flex" style={{ color: M_INK3 }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => { setMobileSearching(false); setSearchQuery(''); }}
                className="shrink-0 text-[14px] font-semibold"
                style={{ color: M_INK2, padding: '4px 2px' }}
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              {/* flex-wrap, not overflow-hidden: with four controls on the
                  row the range label ("7–13") was clipped to nothing on a
                  phone. It now sits beside the title when there's room and
                  drops under it when there isn't. */}
              <div className="flex-1 min-w-0 flex flex-wrap items-baseline" style={{ columnGap: 7, rowGap: 2 }}>
                <span className="whitespace-nowrap" style={{ fontFamily: 'var(--font-serif-display)', fontSize: 27, lineHeight: 1, color: M_INK, letterSpacing: -0.4 }}>
                  {mobileNav.title}
                </span>
                <span className="whitespace-nowrap text-[13px] font-semibold" style={{ color: M_INK3 }}>{mobileNav.sub}</span>
              </div>
              {offToday && (
                <button
                  type="button"
                  onClick={goToday}
                  className="shrink-0 rounded-full text-[11px] font-bold"
                  style={{ color: 'var(--color-plum)', background: 'var(--color-plum-light)', padding: '5px 10px' }}
                >
                  Today
                </button>
              )}
              {!childMode && (
                <HeaderIconBtn aria-label="Search" onClick={() => setMobileSearching(true)}>
                  <IconSearch className="w-4 h-4" />
                </HeaderIconBtn>
              )}
              {!childMode && (
                <HeaderIconBtn aria-label="Filters" aria-expanded={showMobileFilters} active={showMobileFilters} badge={mobileFilterCount} onClick={() => setShowMobileFilters((s) => !s)}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h9M19 7h1M4 17h1M11 17h9" /><circle cx="16" cy="7" r="2.6" /><circle cx="8" cy="17" r="2.6" /></svg>
                </HeaderIconBtn>
              )}
              {canWrite && !childMode && (
                <HeaderIconBtn primary aria-label="New event" onClick={() => openAddForm(selectedDate)}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                </HeaderIconBtn>
              )}
            </>
          )}
        </div>

        {/* Filter panel: two horizontally scrollable chip rows */}
        {!childMode && showMobileFilters && (
          <div className="flex flex-col" style={{ gap: 7, paddingBottom: 14 }}>
            <div className="flex overflow-x-auto -mx-5 px-5" style={{ gap: 6, scrollbarWidth: 'none' }}>
              <MobileFilterChip active={!personFilterActive} onClick={() => setMobileFilterWho(null)}>Everyone</MobileFilterChip>
              {members.map((mb) => (
                <MobileFilterChip key={mb.id} active={mobileFilterWho === mb.id} onClick={() => setMobileFilterWho(mobileFilterWho === mb.id ? null : mb.id)}>
                  <Avatar member={mb} size={18} />
                  {mb.name}
                </MobileFilterChip>
              ))}
            </div>
            <div className="flex overflow-x-auto -mx-5 px-5" style={{ gap: 6, scrollbarWidth: 'none' }}>
              <MobileFilterChip active={!mobileKindFilter} onClick={() => setMobileKindFilter(null)}>All types</MobileFilterChip>
              {CAL_KINDS.map(([k, label]) => (
                <MobileFilterChip key={k} active={mobileKindFilter === k} onClick={() => setMobileKindFilter(mobileKindFilter === k ? null : k)}>{label}</MobileFilterChip>
              ))}
            </div>
          </div>
        )}
        {/* Collapsed summary pill */}
        {!childMode && !showMobileFilters && mobileFilterCount > 0 && (
          <div style={{ paddingBottom: 12 }}>
            <button
              type="button"
              onClick={clearMobileFilters}
              className="inline-flex items-center rounded-full font-bold"
              style={{ gap: 7, background: 'var(--color-plum-light)', color: 'var(--color-plum)', padding: '6px 12px', fontSize: 12 }}
            >
              Filtered: {[
                personFilterActive && (mobileFilterWho ? (members.find((m) => m.id === mobileFilterWho)?.name || 'People') : 'People'),
                mobileKindFilter && (CAL_KINDS.find((x) => x[0] === mobileKindFilter) || [])[1],
              ].filter(Boolean).join(' · ')}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>
        )}

        {/* View switcher row: chevrons page the current view */}
        {!mobileSearchActive && (
          <div className="flex items-center" style={{ gap: 8, paddingBottom: 2 }}>
            <button type="button" aria-label="Previous" onClick={navigatePrev} className="shrink-0 w-11 h-11 -m-[6px] flex items-center justify-center bg-transparent">
              <span className="w-8 h-8 rounded-full bg-white flex items-center justify-center" style={{ border: '1px solid rgba(26,22,32,0.07)', boxShadow: '0 1px 0 rgba(26,22,32,0.03)', color: M_INK2 }}>
                <ChevronLeft />
              </span>
            </button>
            <Segmented
              fluid
              ariaLabel="Calendar view"
              value={viewMode}
              onChange={setViewMode}
              options={CAL_VIEWS}
              className="flex-1"
            />
            <button type="button" aria-label="Next" onClick={navigateNext} className="shrink-0 w-11 h-11 -m-[6px] flex items-center justify-center bg-transparent">
              <span className="w-8 h-8 rounded-full bg-white flex items-center justify-center" style={{ border: '1px solid rgba(26,22,32,0.07)', boxShadow: '0 1px 0 rgba(26,22,32,0.03)', color: M_INK2 }}>
                <ChevronRight />
              </span>
            </button>
          </div>
        )}
      </div>

      {/* Mobile search results: an agenda list replacing the views while a
          query is live (the desktop popup search is untouched above). */}
      {mobileSearchActive && (
        <div className="md:hidden">{renderMobileSearchAgenda()}</div>
      )}

      {/* ── Month View ──────────────────────────────────────── */}
      {viewMode === 'month' && !mobileSearchActive && (
        <div {...swipe.bindings}>
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

          {/* Mobile mini calendar (design_handoff_calendar month card):
              white radius-22 card, dot rows in event colours, SELECTED day
              gets the brand fill (today reads as a brand number when not
              selected - on load today IS selected, so it starts filled). */}
          <div className="md:hidden">
            <div className="bg-white mb-[22px]" style={{ borderRadius: 22, padding: '14px 12px 10px', boxShadow: '0 1px 0 rgba(26,22,32,0.04), 0 4px 14px rgba(26,22,32,0.04)' }}>
              <div className="grid grid-cols-7" style={{ marginBottom: 6 }}>
                {DAY_HEADERS.map((d, i) => (
                  <div key={i} className="text-center font-bold" style={{ fontSize: 10, color: M_INK3, letterSpacing: '0.06em' }}>{d.toUpperCase()}</div>
                ))}
              </div>
              <div className="grid grid-cols-7" style={{ gap: 2 }}>
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
                      className="aspect-square flex flex-col items-center justify-center transition-colors"
                      style={{ gap: 3, borderRadius: 12, background: isSelected ? 'var(--color-plum)' : 'transparent' }}
                    >
                      <span style={{ fontSize: 14, lineHeight: 1, fontWeight: (isToday_ || isSelected) ? 700 : 500, color: isSelected ? '#fff' : (isToday_ ? 'var(--color-plum)' : M_INK) }}>
                        {date.getDate()}
                      </span>
                      <span className="flex items-center justify-center" style={{ gap: 2, height: 4 }}>
                        {dots.map((c, di) => (
                          <span key={di} style={{ width: 4, height: 4, borderRadius: 2, background: isSelected ? 'rgba(255,255,255,0.85)' : c }} />
                        ))}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Selected day agenda for mobile - the SAME day-section shape as
                the Schedule view (header row + cards), so the two agenda
                surfaces are indistinguishable. Header tap opens Day view,
                as it does there. */}
            {selectedDate && (
              <div>
                <button
                  type="button"
                  onClick={() => setViewMode('day')}
                  className="flex items-baseline bg-transparent border-0 cursor-pointer"
                  style={{ gap: 7, marginBottom: 9, padding: '0 2px', fontFamily: 'inherit' }}
                >
                  <span style={{ fontSize: 13, fontWeight: 700, color: isSameDay(selectedDate, today) ? 'var(--color-plum)' : M_INK }}>
                    {isSameDay(selectedDate, today) ? 'Today' : selectedDate.toLocaleDateString('en-GB', { weekday: 'long' })}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: M_INK3, fontVariantNumeric: 'tabular-nums' }}>
                    {selectedDate.toLocaleDateString('en-GB', { month: 'short' })} {selectedDate.getDate()}
                  </span>
                </button>
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
                      className="flex items-center bg-white"
                      style={{ gap: 12, borderRadius: 16, padding: '11px 14px', marginBottom: 8, borderLeft: `4px solid ${hex}`, boxShadow: '0 1px 0 rgba(26,22,32,0.04), 0 4px 14px rgba(26,22,32,0.04)' }}
                      onClick={() => {
                        if (item._type === 'task') openTaskEditForm(item);
                        else if (item.category !== 'public_holiday' && item.category !== 'birthday') openEditForm(item);
                      }}
                    >
                      {/* Time column (start over end); tasks keep their small
                          badge - the design's cards are events-only and the
                          checkbox-less list needs the type distinction
                          somewhere. Typography matches the Schedule view's
                          cards exactly (founder, 2026-09-02): 13/500 start,
                          10.5 end, 14/600 title, 11.5 location - and the
                          same card metrics too (radius 16, 11x14 padding,
                          8px between cards, 44px time column, 26/22
                          avatars), so the two agenda surfaces are one. */}
                      <div style={{ width: 44, flexShrink: 0 }}>
                        {item._type === 'task' ? (
                          <>
                            <div style={{ fontSize: 13, fontWeight: 500, color: M_INK, fontVariantNumeric: 'tabular-nums' }}>
                              {item.due_time ? item.due_time.substring(0, 5) : 'All day'}
                            </div>
                            <span className="inline-block font-semibold" style={{ fontSize: 9, background: badge.bg, color: badge.color, borderRadius: 4, padding: '1px 5px', marginTop: 2 }}>{badge.label}</span>
                          </>
                        ) : item.all_day ? (
                          <div style={{ fontSize: 12, fontWeight: 500, color: M_INK, lineHeight: 1.3 }}>All day</div>
                        ) : (
                          <>
                            <div style={{ fontSize: 13, fontWeight: 500, color: M_INK, fontVariantNumeric: 'tabular-nums' }}>{formatTime(item.start_time)}</div>
                            {item.end_time && <div style={{ fontSize: 10.5, color: M_INK3, fontVariantNumeric: 'tabular-nums' }}>{formatTime(item.end_time)}</div>}
                          </>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold truncate" style={{ fontSize: 14, color: M_INK }}>{item.title}</div>
                        {(item.location || (item._type === 'event' && (selectedDayClashKeys.has(itemKey(item)) || (!childMode && item.category !== 'public_holiday' && item.category !== 'birthday' && looksLikeGathering(item.title))))) && (
                          <div className="truncate" style={{ fontSize: 11.5, color: M_INK3, marginTop: 1 }}>
                            {item.location}
                            {item._type === 'event' && selectedDayClashKeys.has(itemKey(item)) && (
                              <span className={`font-semibold ${item.location ? 'ml-1.5' : ''}`} style={{ color: '#B45309' }}>⚠️ Clash</span>
                            )}
                            {/* Ambient discovery for the invite loop: gatherings
                                show where the RSVP link lives (tap = the event
                                sheet, where the 🎈 card sits). */}
                            {item._type === 'event' && !childMode
                              && item.category !== 'public_holiday' && item.category !== 'birthday'
                              && looksLikeGathering(item.title) && (
                              <span className="ml-1.5 font-semibold text-plum">🎈 Invite families</span>
                            )}
                          </div>
                        )}
                      </div>
                      {renderMemberStack(eventMembers, { size: eventMembers.length > 1 ? 22 : 26, ringColor: '#FFFFFF' })}
                    </div>
                  );
                })}
                {eventsForDate(selectedDate).length === 0 && tasksForDate(selectedDate).length === 0 && (
                  <div className="text-center bg-white" style={{ padding: '32px 20px', color: M_INK3, borderRadius: 18, fontFamily: M_SERIF, fontSize: 20 }}>
                    Nothing scheduled
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Week View (design_handoff_calendar): day-number header row pinned
            OUTSIDE the card; the white time-grid card scrolls internally and
            is height-capped to end above the tab bar (the --grid-cap var
            carries the real chrome heights, incl. the filter panel). Blocks
            are solid tints of the event colour with ink-mixed text. ── */}
      {viewMode === 'week' && !mobileSearchActive && (
        <div {...swipe.bindings}>
          {/* Day header row */}
          <div className="grid items-center" style={{ gridTemplateColumns: '38px repeat(7, minmax(0, 1fr))', marginBottom: 8 }}>
            <div />
            {weekDays.map((date, i) => {
              const isToday_ = isSameDay(date, today);
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => { setSelectedDate(new Date(date)); setViewMode('day'); }}
                  className="flex flex-col items-center bg-transparent"
                  style={{ gap: 3, padding: '2px 0' }}
                >
                  <span className="font-bold" style={{ fontSize: 10, letterSpacing: '0.04em', color: isToday_ ? 'var(--color-plum)' : M_INK3 }}>
                    {date.toLocaleDateString('en-GB', { weekday: 'short' })}
                  </span>
                  <span
                    className="flex items-center justify-center font-bold"
                    style={{ width: 26, height: 26, borderRadius: '50%', fontSize: 13, fontVariantNumeric: 'tabular-nums', background: isToday_ ? 'var(--color-plum)' : 'transparent', color: isToday_ ? '#fff' : M_INK }}
                  >
                    {date.getDate()}
                  </span>
                </button>
              );
            })}
          </div>

          {/* All-day strip - the prototype's data had none, real weeks do
              (term dates, birthdays). Compact tinted chips per day. */}
          {(() => {
            const allDayByDate = weekDays.map((d) => allDayEventsForDate(d));
            if (!allDayByDate.some((l) => l.length > 0)) return null;
            return (
              <div className="grid" style={{ gridTemplateColumns: '38px repeat(7, minmax(0, 1fr))', gap: 2, marginBottom: 8 }}>
                <div style={{ fontSize: 9, color: M_INK3, textAlign: 'right', paddingRight: 4, paddingTop: 2 }}>all day</div>
                {allDayByDate.map((list, i) => (
                  <div key={i} className="flex flex-col min-w-0" style={{ gap: 2 }}>
                    {list.map((ev) => {
                      const hex = getEventHex(ev);
                      return (
                        <div
                          key={ev.occurrence_key || ev.id}
                          className="truncate cursor-pointer font-bold"
                          style={{ fontSize: 9.5, color: inkMix(hex), background: hex + '2E', borderRadius: 5, padding: '2px 4px' }}
                          onClick={() => { if (ev.category !== 'public_holiday' && ev.category !== 'birthday') openEditForm(ev); }}
                        >
                          {ev.title}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            );
          })()}

          {/* Scrollable time-grid card */}
          {(() => {
            const perDay = weekDays.map((d) => timedEventsForDate(d));
            const { start, end } = gridRangeFor(perDay);
            const rowH = 50; const gutter = 38;
            const totalH = ((end - start) / 60) * rowH;
            const nowMin = now.getHours() * 60 + now.getMinutes();
            const weekHasToday = weekDays.some((d) => isSameDay(d, today));
            const hourCount = (end - start) / 60;
            return (
              <div
                ref={scrollContainerRef}
                className="overflow-y-auto bg-white"
                style={{ borderRadius: 18, padding: '10px 10px 0', boxShadow: '0 1px 0 rgba(26,22,32,0.04), 0 4px 14px rgba(26,22,32,0.04)' }}
              >
                <div className="relative" style={{ height: totalH, marginBottom: 20 }}>
                  {Array.from({ length: hourCount + 1 }, (_, i) => start / 60 + i).map((h, i) => (
                    <div key={h} className="absolute left-0 right-0" style={{ top: i * rowH, height: 0 }}>
                      <div className="absolute text-right" style={{ left: 0, top: -7, width: gutter - 8, fontSize: 11, color: M_INK3, fontVariantNumeric: 'tabular-nums' }}>
                        {String(h).padStart(2, '0')}:00
                      </div>
                      <div className="absolute" style={{ left: gutter, right: 0, top: 0, borderTop: '1px solid rgba(26,22,32,0.07)' }} />
                    </div>
                  ))}
                  {weekHasToday && nowMin >= start && nowMin <= end && (
                    <div className="absolute" style={{ left: gutter - 4, right: 0, top: ((nowMin - start) / 60) * rowH, height: 0, zIndex: 6 }}>
                      <div className="absolute rounded-full" style={{ left: 0, top: -4, width: 8, height: 8, background: '#E5484D' }} />
                      <div className="absolute" style={{ left: 4, right: 0, top: 0, borderTop: '2px solid #E5484D' }} />
                    </div>
                  )}
                  <div className="absolute" style={{ left: gutter, right: 0, top: 0, bottom: 0 }}>
                    <div className="absolute inset-0 grid" style={{ gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}>
                      {perDay.map((dayEvents, ci) => {
                        const layout = layoutOverlappingEvents(dayEvents);
                        return (
                          <div key={ci} className="relative" style={{ borderLeft: ci ? '1px solid rgba(26,22,32,0.07)' : 'none' }}>
                            {dayEvents.map((ev) => {
                              const sMin = minOfDay(ev.start_time);
                              const eMin = ev.end_time ? Math.max(minOfDay(ev.end_time), sMin + 20) : sMin + 60;
                              const info = layout.get(ev.id) || { col: 0, totalCols: 1 };
                              const w = 100 / info.totalCols;
                              const hex = getEventHex(ev);
                              return (
                                <button
                                  key={ev.occurrence_key || ev.id}
                                  type="button"
                                  className="absolute overflow-hidden text-left flex flex-col"
                                  style={{
                                    top: ((sMin - start) / 60) * rowH,
                                    height: Math.max(16, ((eMin - sMin) / 60) * rowH - 2),
                                    left: `calc(${info.col * w}% + 1px)`,
                                    width: `calc(${w}% - 2px)`,
                                    background: hex + '2E',
                                    borderRadius: 6,
                                    padding: '2px 4px',
                                    gap: 1,
                                  }}
                                  onClick={() => { if (ev.category !== 'public_holiday' && ev.category !== 'birthday') openEditForm(ev); }}
                                >
                                  <span className="font-bold" style={{ fontSize: 8.5, color: inkMix(hex), lineHeight: 1.05, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                                    {ev.title}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* ── Day View (design_handoff_calendar): the week grid at reading
            scale - 60px hours, tinted blocks with title + time · location,
            avatar top-right when the block is wide/tall enough. Header rows
            stay pinned; only the card scrolls. Tapping an empty hour keeps
            the existing quick-add behaviour. ── */}
      {viewMode === 'day' && selectedDate && !mobileSearchActive && (
        <div {...swipe.bindings}>
          {/* All-day strip */}
          {(() => {
            const allDay = allDayEventsForDate(selectedDate);
            if (allDay.length === 0) return null;
            return (
              <div className="flex flex-wrap" style={{ gap: 4, marginBottom: 8 }}>
                {allDay.map((ev) => {
                  const hex = getEventHex(ev);
                  return (
                    <div
                      key={ev.occurrence_key || ev.id}
                      className="cursor-pointer font-bold"
                      style={{ fontSize: 11, color: inkMix(hex), background: hex + '2E', borderRadius: 6, padding: '3px 8px' }}
                      onClick={() => { if (ev.category !== 'public_holiday' && ev.category !== 'birthday') openEditForm(ev); }}
                    >
                      {ev.title}
                    </div>
                  );
                })}
              </div>
            );
          })()}

          {/* Scrollable time-grid card */}
          {(() => {
            const dayEvents = timedEventsForDate(selectedDate);
            const { start, end } = gridRangeFor([dayEvents]);
            const rowH = 60; const gutter = 46;
            const totalH = ((end - start) / 60) * rowH;
            const isToday_ = isSameDay(selectedDate, today);
            const nowMin = now.getHours() * 60 + now.getMinutes();
            const hourCount = (end - start) / 60;
            const layout = layoutOverlappingEvents(dayEvents);
            return (
              <div
                ref={scrollContainerRef}
                className="overflow-y-auto bg-white"
                style={{ borderRadius: 18, padding: '12px 14px 0', boxShadow: '0 1px 0 rgba(26,22,32,0.04), 0 4px 14px rgba(26,22,32,0.04)' }}
              >
                {dayEvents.length === 0 && allDayEventsForDate(selectedDate).length === 0 ? (
                  <div className="text-center" style={{ padding: '48px 0 68px', color: M_INK3, fontFamily: M_SERIF, fontSize: 20 }}>
                    Nothing scheduled
                  </div>
                ) : (
                  <div className="relative" style={{ height: totalH, marginBottom: 20 }}>
                    {Array.from({ length: hourCount + 1 }, (_, i) => start / 60 + i).map((h, i) => (
                      <div key={h} className="absolute left-0 right-0" style={{ top: i * rowH, height: 0 }}>
                        <div className="absolute text-right" style={{ left: 0, top: -7, width: gutter - 8, fontSize: 11, color: M_INK3, fontVariantNumeric: 'tabular-nums' }}>
                          {String(h).padStart(2, '0')}:00
                        </div>
                        <div className="absolute" style={{ left: gutter, right: 0, top: 0, borderTop: '1px solid rgba(26,22,32,0.07)' }} />
                      </div>
                    ))}
                    {/* Tap an empty hour to quick-add (existing behaviour) */}
                    {canWrite && !childMode && Array.from({ length: hourCount }, (_, i) => start / 60 + i).map((h, i) => (
                      <div
                        key={`add-${h}`}
                        className="absolute"
                        style={{ top: i * rowH, height: rowH, left: gutter, right: 0 }}
                        onClick={() => openAddForm(selectedDate, h)}
                      />
                    ))}
                    {isToday_ && nowMin >= start && nowMin <= end && (
                      <div className="absolute pointer-events-none" style={{ left: gutter - 4, right: 0, top: ((nowMin - start) / 60) * rowH, height: 0, zIndex: 6 }}>
                        <div className="absolute rounded-full" style={{ left: 0, top: -4, width: 8, height: 8, background: '#E5484D' }} />
                        <div className="absolute" style={{ left: 4, right: 0, top: 0, borderTop: '2px solid #E5484D' }} />
                      </div>
                    )}
                    <div className="absolute" style={{ left: gutter, right: 0, top: 0, bottom: 0, pointerEvents: 'none' }}>
                      {dayEvents.map((ev) => {
                        const sMin = minOfDay(ev.start_time);
                        const eMin = ev.end_time ? Math.max(minOfDay(ev.end_time), sMin + 20) : sMin + 60;
                        const info = layout.get(ev.id) || { col: 0, totalCols: 1 };
                        const w = 100 / info.totalCols;
                        const hex = getEventHex(ev);
                        const blockH = Math.max(34, ((eMin - sMin) / 60) * rowH - 4);
                        const narrow = info.totalCols > 1;
                        const eventMembers = getEventMembers(ev);
                        return (
                          <div
                            key={ev.occurrence_key || ev.id}
                            className="absolute overflow-hidden flex flex-col cursor-pointer"
                            style={{
                              pointerEvents: 'auto',
                              top: ((sMin - start) / 60) * rowH,
                              height: blockH,
                              left: `calc(${info.col * w}% + 2px)`,
                              width: `calc(${w}% - 4px)`,
                              background: hex + '2E',
                              borderRadius: 9,
                              padding: '7px 9px',
                              gap: 2,
                            }}
                            onClick={() => { if (ev.category !== 'public_holiday' && ev.category !== 'birthday') openEditForm(ev); }}
                          >
                            <div className="flex items-center justify-between" style={{ gap: 6 }}>
                              <span className="truncate font-bold" style={{ fontSize: 13, color: inkMix(hex), lineHeight: 1.15 }}>{ev.title}</span>
                              {!narrow && blockH > 40 && renderMemberStack(eventMembers, { size: 22, ringColor: '#FFFFFF' })}
                            </div>
                            <span style={{ fontSize: 11, color: inkMix(hex), opacity: 0.75, fontVariantNumeric: 'tabular-nums' }}>
                              {formatTime(ev.start_time)}{ev.end_time ? `–${formatTime(ev.end_time)}` : ''}{!narrow && blockH > 52 && ev.location ? ` · ${ev.location}` : ''}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* ── Schedule View (continuous agenda - skips empty days) ──────────
            Design: design_handoff_schedule_view. Full-width day sections from
            today (or the 1st when paged to another month) through
            scheduleMonthsAhead extra months; the sentinel below the list
            extends it as the user scrolls. Events only (the reference spec) -
            tasks keep their own page; header tap opens the day, card tap the
            event's own sheet per each category's existing pattern. ── */}
      {viewMode === 'schedule' && !mobileSearchActive && (
        <div {...swipe.bindings}>
          {(() => {
            const now = new Date();
            now.setHours(0, 0, 0, 0);
            const isThisMonth = currentMonth.getFullYear() === now.getFullYear() && currentMonth.getMonth() === now.getMonth();
            const start = isThisMonth ? now : new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
            const end = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + scheduleMonthsAhead + 1, 0);
            const days = [];
            for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
              const evs = eventsForDate(d);
              if (evs.length === 0) continue; // skip empty days entirely
              const sorted = [...evs].sort((a, b) => {
                if (!!a.all_day !== !!b.all_day) return a.all_day ? -1 : 1;
                return new Date(a.start_time) - new Date(b.start_time);
              });
              days.push({ date: new Date(d), evs: sorted });
            }
            if (days.length === 0) {
              return (
                <div className="text-center" style={{ padding: '48px 0', color: M_INK3, fontFamily: M_SERIF, fontSize: 20 }}>
                  Nothing coming up
                </div>
              );
            }
            return (
              <div className="flex flex-col" style={{ gap: 20 }}>
                {days.map(({ date, evs }) => {
                  const isToday_ = isSameDay(date, now);
                  const clashKeys = conflictedKeys(evs, members);
                  return (
                    <div key={toDateStr(date)}>
                      <button
                        type="button"
                        onClick={() => { setSelectedDate(new Date(date)); setViewMode('day'); }}
                        className="flex items-baseline bg-transparent border-0 cursor-pointer"
                        style={{ gap: 7, marginBottom: 9, padding: '0 2px', fontFamily: 'inherit' }}
                      >
                        <span style={{ fontSize: 13, fontWeight: 700, color: isToday_ ? 'var(--color-plum)' : M_INK }}>
                          {isToday_ ? 'Today' : date.toLocaleDateString('en-GB', { weekday: 'long' })}
                        </span>
                        <span style={{ fontSize: 12, fontWeight: 600, color: M_INK3, fontVariantNumeric: 'tabular-nums' }}>
                          {date.toLocaleDateString('en-GB', { month: 'short' })} {date.getDate()}
                        </span>
                      </button>
                      <div className="flex flex-col" style={{ gap: 8 }}>
                        {evs.map((ev) => {
                          const hex = getEventHex(ev);
                          const eventMembers = getEventMembers(ev);
                          return (
                            <div
                              key={ev.occurrence_key || ev.id}
                              className="flex items-center bg-white cursor-pointer"
                              style={{
                                gap: 12,
                                borderRadius: 16,
                                padding: '11px 14px',
                                borderLeft: `4px solid ${hex}`,
                                boxShadow: '0 1px 0 rgba(26,22,32,0.04), 0 4px 14px rgba(26,22,32,0.04)',
                              }}
                              onClick={() => { if (ev.category !== 'public_holiday' && ev.category !== 'birthday') openEditForm(ev); }}
                            >
                              <div style={{ width: 44, flexShrink: 0 }}>
                                {ev.all_day ? (
                                  <div style={{ fontSize: 12, fontWeight: 500, color: M_INK, lineHeight: 1.3 }}>All day</div>
                                ) : (
                                  <>
                                    <div style={{ fontSize: 13, fontWeight: 500, color: M_INK, fontVariantNumeric: 'tabular-nums' }}>{formatTime(ev.start_time)}</div>
                                    {ev.end_time && (
                                      <div style={{ fontSize: 10.5, color: M_INK3, fontVariantNumeric: 'tabular-nums' }}>{formatTime(ev.end_time)}</div>
                                    )}
                                  </>
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="truncate" style={{ fontSize: 14, fontWeight: 600, color: M_INK }}>{ev.title}</div>
                                {ev.location && (
                                  <div className="truncate" style={{ fontSize: 11.5, color: M_INK3, marginTop: 1 }}>{ev.location}</div>
                                )}
                                {clashKeys.has(itemKey(ev)) && (
                                  <div style={{ fontSize: 11, fontWeight: 700, color: '#B45309', marginTop: 1 }}>⚠️ Clash</div>
                                )}
                              </div>
                              {renderMemberStack(eventMembers, { size: eventMembers.length > 1 ? 22 : 26, ringColor: '#FFFFFF' })}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
          {/* Scroll sentinel: nearing it loads another month into the list. */}
          <div ref={scheduleEndRef} style={{ height: 1 }} />
          {/* Floating "↑ Today" - same centered black pill as the Documents
              undo toast (the house above-the-tab-bar treatment). Fades with
              opacity so it can transition both ways; pointer-events off while
              hidden. If the user has paged to another month, "Today" also
              means re-anchoring the list, not just scrolling. */}
          <button
            type="button"
            aria-hidden={!scheduleShowTop}
            tabIndex={scheduleShowTop ? 0 : -1}
            onClick={() => {
              const now = new Date();
              if (currentMonth.getFullYear() !== now.getFullYear() || currentMonth.getMonth() !== now.getMonth()) {
                goToday();
              }
              const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
              window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
            }}
            // Mobile bottom offset mirrors the floating nav's own inset
            // formula (max(22px, safe-area+8px)) plus the nav pill's real
            // height (10+7+23+3+~15+6+10 padding/icon/gap/label ≈ 76px,
            // measured from Layout's TabItem - a 70px guess still clipped
            // it) and a 12px gap, so this floats clear of the nav.
            className={`fixed bottom-[calc(max(22px,env(safe-area-inset-bottom,0px)_+_8px)_+_88px)] md:bottom-8 left-1/2 -translate-x-1/2 z-40 bg-charcoal text-white rounded-3xl px-4 py-2 text-[13px] font-semibold transition-opacity duration-200 ease-out ${
              scheduleShowTop ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
            style={{ boxShadow: '0 8px 24px rgba(26,22,32,0.25)' }}
          >
            ↑ Today
          </button>
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
                      {item._type === 'event' && selectedDayClashKeys.has(itemKey(item)) && (
                        <span className="ml-1.5 font-semibold" style={{ color: '#B45309' }}>⚠️ Clash</span>
                      )}
                      {item._type === 'event' && !childMode
                        && item.category !== 'public_holiday' && item.category !== 'birthday'
                        && looksLikeGathering(item.title) && (
                        <span className="ml-1.5 font-semibold text-plum">🎈 Invite families</span>
                      )}
                    </div>
                  </div>
                  <span
                    className="text-[9px] md:text-[10px] font-semibold px-2 py-0.5 rounded-md shrink-0"
                    style={{ background: badge.bg, color: badge.color }}
                  >
                    {badge.label}
                  </span>
                  {renderMemberStack(eventMembers, { size: 35, ringColor: '#FFFFFF' })}
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
            {/* Header - serif 22 + soft square close button, matching the
                Tasks/Rewards modals. */}
            <div className="flex items-center justify-between px-6 pt-2" style={{ marginBottom: 12 }}>
              <h2 className="serif-display" style={{ margin: 0, fontFamily: M_SERIF, fontSize: 22, fontWeight: 400, color: M_INK }}>
                {editingEvent ? 'Edit event' : createKind === 'activity' ? 'New activity' : 'New event'}
              </h2>
              <button
                type="button"
                onClick={() => { setShowForm(false); resetForm(); }}
                aria-label="Close"
                style={{ width: 34, height: 34, borderRadius: 10, border: 0, background: M_BG_SOFT, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={M_INK2} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            <form onSubmit={(!editingEvent && createKind === 'activity') ? handleActivityCreate : handleSubmit} className="px-6 pb-5">
              {/* ── 0. Event / Kids' activity toggle (create only) ──
                  One modal that morphs in place (design_handoff_event_
                  activity): an activity is a specialised term-bounded
                  recurring event with a child, pickup person and weekly
                  days, so it gets its own field set rather than a banner
                  to a second dialog. Households without kids never see
                  the toggle. The typed title survives switching type. */}
              {!editingEvent && members.some(isKidMember) && (
                <div className="mb-3">
                  <Segmented
                    fluid
                    value={createKind}
                    onChange={setCreateKind}
                    ariaLabel="What are you creating?"
                    options={[
                      { value: 'event', label: <><IconCalendar className="h-4 w-4" /> Event</> },
                      { value: 'activity', label: <><IconStar className="h-4 w-4" /> Kids&rsquo; activity</> },
                    ]}
                  />
                  <p className="text-xs text-warm-grey mt-2 px-0.5">
                    {createKind === 'activity'
                      ? 'A recurring weekly club or class, with a pickup person and term dates.'
                      : 'A one-off or repeating event for anyone in the household.'}
                  </p>
                </div>
              )}

              {/* ── Who's it for (activity mode) - avatar-ring single-select,
                     the same "Who" control as the task modal. ── */}
              {!editingEvent && createKind === 'activity' && (
                <MField label="Who's it for">
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {members.filter(isKidMember).map((m) => (
                      <MAvatarPick
                        key={m.id}
                        member={m}
                        on={actKid === m.id}
                        onClick={() => setActKid(m.id)}
                        hex={m.color_theme ? (COLOR_HEX[m.color_theme] || COLOR_HEX.sage) : COLOR_HEX.sage}
                      />
                    ))}
                  </div>
                </MField>
              )}

              {/* ── 1. Title / activity name ── */}
              <MField label={(!editingEvent && createKind === 'activity') ? 'Activity name' : 'Title'}>
                <input
                  type="text"
                  value={formTitle}
                  onChange={e => setFormTitle(e.target.value)}
                  required
                  style={mInput}
                  placeholder={(!editingEvent && createKind === 'activity') ? 'e.g. Swimming' : 'e.g. Dentist appointment'}
                />
              </MField>

              {(editingEvent || createKind === 'event') && (
              <div>
                {/* ── 2. When - date/time rows with the All-day switch in the
                       label row. min-w-0 on the date inputs stops native iOS
                       pickers forcing the row past the modal width. ── */}
                <MField
                  label="When"
                  right={(
                    <label className="flex items-center gap-1.5 text-xs font-medium cursor-pointer whitespace-nowrap select-none" style={{ color: M_INK2 }}>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={formAllDay}
                        onClick={() => {
                          const next = !formAllDay;
                          setFormAllDay(next);
                          // A 30-min-before reminder is meaningless for an
                          // all-day event: toggling ON clears the untouched
                          // default chip (user-added sets are kept); toggling
                          // OFF restores it when none remain.
                          if (next) {
                            setFormReminders((prev) => (prev.length === 1 && prev[0].time === '30' && prev[0].unit === 'minutes') ? [] : prev);
                          } else {
                            setFormReminders((prev) => (prev.length === 0 ? [{ time: '30', unit: 'minutes' }] : prev));
                          }
                        }}
                        style={{ width: 34, height: 20, borderRadius: 99, border: 0, cursor: 'pointer', background: formAllDay ? M_BRAND : M_LINE_STRONG, position: 'relative', transition: 'background .15s', padding: 0 }}
                      >
                        <span style={{ position: 'absolute', top: 2, left: formAllDay ? 16 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
                      </button>
                      All day
                    </label>
                  )}
                >
                  <div className="space-y-2">
                    {/* Start row */}
                    <div className="flex items-center gap-2">
                      <input
                        type="date"
                        value={formDate}
                        onChange={e => {
                          setFormDate(e.target.value);
                          if (formEndDate < e.target.value) setFormEndDate(e.target.value);
                        }}
                        style={{ ...mInput, minWidth: 0, flex: 1, WebkitAppearance: 'none', appearance: 'none' }}
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
                          style={{ ...mInput, width: 96, flexShrink: 0, WebkitAppearance: 'none', appearance: 'none' }}
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
                        style={{ ...mInput, minWidth: 0, flex: 1, WebkitAppearance: 'none', appearance: 'none' }}
                      />
                      {!formAllDay && (
                        <input
                          type="time"
                          value={formEnd}
                          onChange={e => setFormEnd(e.target.value)}
                          style={{ ...mInput, width: 96, flexShrink: 0, WebkitAppearance: 'none', appearance: 'none' }}
                        />
                      )}
                    </div>
                  </div>
                </MField>

                {/* ── 3. Who - avatar-ring multi-select (the task modal's
                       Who control). Selection logic unchanged: names drive
                       assignees, first pick sets the event colour. ── */}
                <MField label="Who">
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {members.map(m => {
                      const isSelected = formAssignees.includes(m.name);
                      const hex = m.color_theme ? (COLOR_HEX[m.color_theme] || COLOR_HEX.sage) : COLOR_HEX.sage;
                      return (
                        <MAvatarPick
                          key={m.name}
                          member={m}
                          on={isSelected}
                          hex={hex}
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
                        />
                      );
                    })}
                  </div>
                </MField>

                {/* ── 4. Repeat ── */}
                <MField label="Repeat">
                  <select
                    value={formRecurrence}
                    onChange={e => setFormRecurrence(e.target.value)}
                    style={mInput}
                  >
                    {RECURRENCES.map(r => (
                      <option key={r} value={r}>{RECURRENCE_LABELS[r]}</option>
                    ))}
                  </select>
                  {/* Days removed with "Delete just this day" - tap ✕ to
                      bring one back. Only shows when the series has skips. */}
                  {editingEvent?.recurrence && editingEvent?.skips?.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                      {editingEvent.skips.map((d) => (
                        <span key={d} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 8px 5px 10px', borderRadius: 8, background: M_BG_SOFT, fontSize: 12, fontWeight: 600, color: M_INK2 }}>
                          {new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} removed
                          <button
                            type="button"
                            onClick={() => unskipEventDay(d)}
                            aria-label={`Restore ${d}`}
                            style={{ border: 0, background: 'transparent', color: M_INK3, cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: 0 }}
                          >
                            ✕
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </MField>

                {/* ── 5. Reminders ── */}
                <MField label="Reminders">
                  <div className="space-y-2">
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
                              style={{ ...mInput, flex: 1, width: 'auto' }}
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
                      style={{ background: 'transparent', border: 0, padding: 0, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: M_BRAND }}
                    >
                      + Add reminder
                    </button>
                  </div>
                </MField>

                {/* ── 5b. Invite guests (saved events only) ──
                    Available on EVERY event via the quiet link; promoted to a
                    card when the title looks like a gathering (partyDetect -
                    prominence only, never availability). */}
                {editingEvent?.id && (
                  (inviteRoster?.hasLink || inviteRoster?.rsvps?.length > 0) ? (
                    <MField label="Invites">
                      <div style={{ borderRadius: 12, border: `1px solid ${M_LINE_STRONG}`, background: '#FBF8F3', padding: '12px 14px' }}>
                        <div style={{ fontSize: 13.5, fontWeight: 600, color: M_INK }}>
                          {inviteRoster.going > 0
                            ? `${inviteRoster.going} going${(inviteRoster.kids + inviteRoster.adults) > 0 ? ` · ${inviteRoster.adults} adult${inviteRoster.adults === 1 ? '' : 's'}, ${inviteRoster.kids} kid${inviteRoster.kids === 1 ? '' : 's'}` : ''}`
                            : inviteRoster.hasLink
                              ? 'No RSVPs yet — share the link below'
                              : 'RSVPs received'}
                          {inviteRoster.declined > 0 && (
                            <span style={{ fontWeight: 400, color: M_INK3 }}> · {inviteRoster.declined} can’t make it</span>
                          )}
                        </div>
                        {inviteRoster.dietary?.length > 0 && (
                          <div style={{ marginTop: 8, borderRadius: 10, background: '#EDF5EE', border: '1px solid rgba(125,174,130,0.3)', padding: '8px 10px' }}>
                            {inviteRoster.dietary.map((d, i) => (
                              <div key={i} style={{ fontSize: 12.5, color: M_INK2, lineHeight: 1.5 }}>
                                <strong>{d.family}:</strong> {d.note}
                              </div>
                            ))}
                          </div>
                        )}
                        {inviteRoster.rsvps?.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setInviteRosterOpen(o => !o)}
                            style={{ marginTop: 8, background: 'transparent', border: 0, padding: 0, cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: M_BRAND }}
                          >
                            {inviteRosterOpen ? 'Hide replies' : `See all replies (${inviteRoster.rsvps.length})`}
                          </button>
                        )}
                        {inviteRosterOpen && (
                          <ul style={{ margin: '6px 0 0', padding: 0, listStyle: 'none' }}>
                            {inviteRoster.rsvps.map((r, i) => (
                              <li key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12.5, color: M_INK2, padding: '3px 0' }}>
                                <span>{r.family_name}</span>
                                <span style={{ color: r.status === 'yes' ? '#5B8A60' : M_INK3, fontWeight: 600 }}>
                                  {r.status === 'yes' ? `Yes · ${(r.kids_count || 0) + (r.adults_count || 0)} coming` : 'No'}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                        {inviteRoster.hasLink ? (
                          <>
                            <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
                              <input
                                readOnly
                                value={inviteUrl}
                                onFocus={(e) => e.target.select()}
                                style={{ ...mInput, flex: 1, width: 'auto', fontSize: 12.5, color: M_INK3, background: '#fff' }}
                              />
                              <button
                                type="button"
                                onClick={() => (navigator.share ? navigator.share({ title: formTitle || 'You’re invited', url: inviteUrl }).catch(() => {}) : copyInviteUrl(inviteUrl))}
                                style={{ flexShrink: 0, padding: '9px 14px', borderRadius: 10, border: 0, cursor: 'pointer', fontWeight: 600, fontSize: 13, fontFamily: 'inherit', background: M_BRAND, color: '#fff' }}
                              >
                                {inviteCopied ? 'Copied!' : 'Share'}
                              </button>
                            </div>
                            <button
                              type="button"
                              onClick={revokeInviteLink}
                              disabled={inviteBusy}
                              style={{ marginTop: 8, background: 'transparent', border: 0, padding: 0, cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#C0562F', fontFamily: 'inherit' }}
                            >
                              Turn off link
                            </button>
                          </>
                        ) : (
                          <div style={{ display: 'flex', gap: 10, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 12.5, color: M_INK3 }}>The invite link is turned off.</span>
                            <button
                              type="button"
                              onClick={createInviteLink}
                              disabled={inviteBusy}
                              style={{ background: 'transparent', border: 0, padding: 0, cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: M_BRAND, fontFamily: 'inherit' }}
                            >
                              {inviteBusy ? 'Creating…' : 'Create a new link'}
                            </button>
                          </div>
                        )}
                      </div>
                    </MField>
                  ) : looksLikeGathering(formTitle) ? (
                    <MField label="Invites">
                      <div style={{ borderRadius: 12, border: '1px solid rgba(107,63,160,0.25)', background: M_BRAND_SOFT, padding: '12px 14px' }}>
                        <div style={{ fontSize: 13.5, fontWeight: 600, color: M_INK }}>🎈 Hosting a party?</div>
                        <div style={{ fontSize: 12.5, color: M_INK2, marginTop: 3, lineHeight: 1.5 }}>
                          Share one link with your guests — you’ll get RSVPs, headcounts and allergy notes back here.
                        </div>
                        <button
                          type="button"
                          onClick={createInviteLink}
                          disabled={inviteBusy}
                          style={{ marginTop: 10, padding: '9px 16px', borderRadius: 10, border: 0, cursor: 'pointer', fontWeight: 600, fontSize: 13, fontFamily: 'inherit', background: M_BRAND, color: '#fff', opacity: inviteBusy ? 0.6 : 1 }}
                        >
                          {inviteBusy ? 'Creating…' : 'Create invite link'}
                        </button>
                      </div>
                    </MField>
                  ) : (
                    <div style={{ marginBottom: 14 }}>
                      <button
                        type="button"
                        onClick={createInviteLink}
                        disabled={inviteBusy}
                        style={{ background: 'transparent', border: 0, padding: 0, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: M_BRAND, fontFamily: 'inherit' }}
                      >
                        {inviteBusy ? 'Creating link…' : '+ Invite guests'}
                      </button>
                    </div>
                  )
                )}

                {/* ── 6. More options / Less options ── */}
                {showMoreOptions && (
                  <div>
                    <MField label="Description">
                      <textarea
                        value={formDesc}
                        onChange={e => setFormDesc(e.target.value)}
                        rows={2}
                        style={{ ...mInput, resize: 'vertical' }}
                        placeholder="Add description"
                      />
                    </MField>
                    <MField label="Location">
                      <input
                        type="text"
                        value={formLocation}
                        onChange={e => setFormLocation(e.target.value)}
                        style={mInput}
                        placeholder="Add location"
                      />
                      {formLocation.trim() && (
                        <button
                          type="button"
                          onClick={() => openInMaps(formLocation)}
                          className="mt-1.5 text-xs font-semibold text-plum underline decoration-plum/30 underline-offset-2"
                        >
                          Open in Maps ↗
                        </button>
                      )}
                    </MField>
                    <MField label="Attachments">
                      <div className="min-w-0">
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
                    </MField>
                  </div>
                )}
              </div>
              )}

              {/* ── Kids' activity mode body (create only) ── */}
              {!editingEvent && createKind === 'activity' && (
              <div>
                {/* Repeats on - Mon-Sun multi-select chips (the task
                    modal's weekly-day pills; one schedule row per day). */}
                <MField label="Repeats on">
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => {
                      const on = actDays.includes(i);
                      return (
                        <button
                          key={d}
                          type="button"
                          aria-pressed={on}
                          aria-label={d}
                          onClick={() => setActDays((prev) => (prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]))}
                          style={{ padding: '6px 10px', borderRadius: 99, cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'inherit', border: on ? `1.5px solid ${M_BRAND}` : `1px solid ${M_LINE_STRONG}`, background: on ? M_BRAND_SOFT : '#fff', color: on ? M_BRAND : M_INK2 }}
                        >
                          {d.slice(0, 2)}
                        </button>
                      );
                    })}
                  </div>
                </MField>

                {/* Time */}
                <div style={{ display: 'flex', gap: 12 }}>
                  <MField label="Starts" style={{ flex: 1 }}>
                    <input
                      type="time"
                      value={actStart}
                      onChange={(e) => {
                        const v = e.target.value;
                        setActStart(v);
                        if (v && actEnd && actEnd <= v) setActEnd('');
                      }}
                      style={{ ...mInput, WebkitAppearance: 'none', appearance: 'none' }}
                    />
                  </MField>
                  <MField label="Ends" style={{ flex: 1 }}>
                    <input
                      type="time"
                      value={actEnd}
                      onChange={(e) => setActEnd(e.target.value)}
                      style={{ ...mInput, WebkitAppearance: 'none', appearance: 'none' }}
                    />
                  </MField>
                </div>

                {/* Term - the child's real school terms + Ongoing/Custom.
                    New activities inherit the window so they stop with the
                    term automatically. */}
                <MField label={actTermsLoading ? 'Term (loading…)' : 'Term'}>
                  <select
                    value={actTermKey}
                    onChange={(e) => setActTermKey(e.target.value)}
                    style={mInput}
                  >
                    {actTerms.map((t) => <option key={t.start_date} value={t.start_date}>{t.label}</option>)}
                    <option value="ongoing">Ongoing (every term)</option>
                    <option value="custom">Custom dates…</option>
                  </select>
                  {actTermKey === 'custom' ? (
                    <div className="flex items-center gap-2 mt-2">
                      <input type="date" value={actCustomStart} onChange={(e) => setActCustomStart(e.target.value)} style={{ ...mInput, minWidth: 0, flex: 1 }} />
                      <span style={{ fontSize: 12, color: M_INK3 }}>to</span>
                      <input type="date" value={actCustomEnd} onChange={(e) => setActCustomEnd(e.target.value)} min={actCustomStart || undefined} style={{ ...mInput, minWidth: 0, flex: 1 }} />
                    </div>
                  ) : (
                    <p style={{ fontSize: 12, color: M_INK3, margin: '8px 0 0' }}>
                      {actTermKey === 'ongoing'
                        ? 'Repeats every selected day, every week, until you remove it.'
                        : 'Repeats every selected day this term, then stops automatically.'}
                    </p>
                  )}
                </MField>

                {/* Pickup - adults only; a child can't collect a child. */}
                <MField label="Pickup">
                  <select
                    value={actPickup}
                    onChange={(e) => setActPickup(e.target.value)}
                    style={mInput}
                  >
                    <option value="">Choose who collects {members.find((m) => m.id === actKid)?.name || 'them'}</option>
                    {members.filter((m) => m.member_type !== 'dependent').map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </MField>
              </div>
              )}

              {/* ── 7. Bottom bar - same button treatment as the task
                     modal: right-aligned white Cancel + solid primary. ── */}
              <div className="flex items-center justify-between mt-2">
                <div className="flex items-center gap-2">
                  {(editingEvent || createKind === 'event') && (
                  <button
                    type="button"
                    onClick={() => setShowMoreOptions(!showMoreOptions)}
                    style={{ background: 'transparent', border: 0, padding: 0, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: M_BRAND }}
                  >
                    {showMoreOptions ? 'Less options \u2227' : 'More options \u2228'}
                  </button>
                  )}
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
                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    type="button"
                    onClick={() => { setShowForm(false); resetForm(); }}
                    style={{ ...mInput, width: 'auto', padding: '10px 18px', cursor: 'pointer', fontWeight: 600, background: '#fff' }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving || !formTitle.trim() || (!editingEvent && createKind === 'activity' && (!actKid || actDays.length === 0))}
                    style={{ padding: '10px 22px', borderRadius: 10, border: 0, cursor: 'pointer', fontWeight: 600, fontSize: 14, fontFamily: 'inherit', background: M_BRAND, color: '#fff', opacity: (saving || !formTitle.trim() || (!editingEvent && createKind === 'activity' && (!actKid || actDays.length === 0))) ? 0.5 : 1 }}
                  >
                    {saving ? 'Saving…' : editingEvent ? 'Save' : createKind === 'activity' ? 'Add activity' : 'Save'}
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
              <h2 className="text-lg font-medium text-charcoal" style={{ fontFamily: 'var(--font-display)' }}>Edit To-do</h2>
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
                  placeholder="To-do title"
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
                  disabled={!taskTitle.trim()}
                  className="h-10 px-5 rounded-xl bg-plum hover:bg-plum-dark disabled:opacity-50 text-white text-sm font-semibold transition-colors"
                >
                  Save changes
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
              {syncedEvent.location && (
                <button
                  type="button"
                  onClick={() => openInMaps(syncedEvent.location)}
                  className="text-sm text-plum mt-1 underline decoration-plum/30 underline-offset-2 text-left"
                >
                  📍 {syncedEvent.location}
                </button>
              )}
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
              {syncedEvent._school && (
                <div className="mt-4 bg-plum-light rounded-xl px-3 py-2.5">
                  <p className="text-xs font-medium text-plum">📚 School term dates</p>
                  <p className="text-[11px] text-plum/70 mt-0.5">
                    Read-only here - term dates (and each school&apos;s colour) are managed on the School page.
                  </p>
                </div>
              )}
              {/* Party invites: "read-only" applies to the event CONTENT -
                  the RSVP link hangs off the row id, which a synced event has
                  like any native one. The editor's invite card lives in the
                  edit modal this event can never open, so the sheet carries
                  its own copy (keep in step with the modal's, same file).
                  Child Mode reuses this sheet for native events - no invite
                  actions for kids. Not for _school entries (no row behind
                  them). */}
              {!childMode && syncedEvent.external_feed_id && (
                (inviteRoster?.hasLink || inviteRoster?.rsvps?.length > 0) ? (
                  <div className="mt-4" style={{ borderRadius: 12, border: `1px solid ${M_LINE_STRONG}`, background: '#FBF8F3', padding: '12px 14px' }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: M_INK }}>
                      {inviteRoster.going > 0
                        ? `${inviteRoster.going} going${(inviteRoster.kids + inviteRoster.adults) > 0 ? ` · ${inviteRoster.adults} adult${inviteRoster.adults === 1 ? '' : 's'}, ${inviteRoster.kids} kid${inviteRoster.kids === 1 ? '' : 's'}` : ''}`
                        : inviteRoster.hasLink
                          ? 'No RSVPs yet — share the link below'
                          : 'RSVPs received'}
                      {inviteRoster.declined > 0 && (
                        <span style={{ fontWeight: 400, color: M_INK3 }}> · {inviteRoster.declined} can’t make it</span>
                      )}
                    </div>
                    {inviteRoster.dietary?.length > 0 && (
                      <div style={{ marginTop: 8, borderRadius: 10, background: '#EDF5EE', border: '1px solid rgba(125,174,130,0.3)', padding: '8px 10px' }}>
                        {inviteRoster.dietary.map((d, i) => (
                          <div key={i} style={{ fontSize: 12.5, color: M_INK2, lineHeight: 1.5 }}>
                            <strong>{d.family}:</strong> {d.note}
                          </div>
                        ))}
                      </div>
                    )}
                    {inviteRoster.rsvps?.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setInviteRosterOpen(o => !o)}
                        style={{ marginTop: 8, background: 'transparent', border: 0, padding: 0, cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: M_BRAND }}
                      >
                        {inviteRosterOpen ? 'Hide replies' : `See all replies (${inviteRoster.rsvps.length})`}
                      </button>
                    )}
                    {inviteRosterOpen && (
                      <ul style={{ margin: '6px 0 0', padding: 0, listStyle: 'none' }}>
                        {inviteRoster.rsvps.map((r, i) => (
                          <li key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12.5, color: M_INK2, padding: '3px 0' }}>
                            <span>{r.family_name}</span>
                            <span style={{ color: r.status === 'yes' ? '#5B8A60' : M_INK3, fontWeight: 600 }}>
                              {r.status === 'yes' ? `Yes · ${(r.kids_count || 0) + (r.adults_count || 0)} coming` : 'No'}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {inviteRoster.hasLink ? (
                      <>
                        <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
                          <input
                            readOnly
                            value={inviteUrl}
                            onFocus={(e) => e.target.select()}
                            style={{ ...mInput, flex: 1, width: 'auto', fontSize: 12.5, color: M_INK3, background: '#fff' }}
                          />
                          <button
                            type="button"
                            onClick={() => (navigator.share ? navigator.share({ title: syncedEvent.title || 'You’re invited', url: inviteUrl }).catch(() => {}) : copyInviteUrl(inviteUrl))}
                            style={{ flexShrink: 0, padding: '9px 14px', borderRadius: 10, border: 0, cursor: 'pointer', fontWeight: 600, fontSize: 13, fontFamily: 'inherit', background: M_BRAND, color: '#fff' }}
                          >
                            {inviteCopied ? 'Copied!' : 'Share'}
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={revokeInviteLink}
                          disabled={inviteBusy}
                          style={{ marginTop: 8, background: 'transparent', border: 0, padding: 0, cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#C0562F', fontFamily: 'inherit' }}
                        >
                          Turn off link
                        </button>
                      </>
                    ) : (
                      <div style={{ display: 'flex', gap: 10, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 12.5, color: M_INK3 }}>The invite link is turned off.</span>
                        <button
                          type="button"
                          onClick={createInviteLink}
                          disabled={inviteBusy}
                          style={{ background: 'transparent', border: 0, padding: 0, cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: M_BRAND, fontFamily: 'inherit' }}
                        >
                          {inviteBusy ? 'Creating…' : 'Create a new link'}
                        </button>
                      </div>
                    )}
                  </div>
                ) : looksLikeGathering(syncedEvent.title) ? (
                  <div className="mt-4" style={{ borderRadius: 12, border: '1px solid rgba(107,63,160,0.25)', background: M_BRAND_SOFT, padding: '12px 14px' }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: M_INK }}>🎈 Hosting a party?</div>
                    <div style={{ fontSize: 12.5, color: M_INK2, marginTop: 3, lineHeight: 1.5 }}>
                      Share one link with your guests — you’ll get RSVPs, headcounts and allergy notes back here.
                    </div>
                    <button
                      type="button"
                      onClick={createInviteLink}
                      disabled={inviteBusy}
                      style={{ marginTop: 10, padding: '9px 16px', borderRadius: 10, border: 0, cursor: 'pointer', fontWeight: 600, fontSize: 13, fontFamily: 'inherit', background: M_BRAND, color: '#fff', opacity: inviteBusy ? 0.6 : 1 }}
                    >
                      {inviteBusy ? 'Creating…' : 'Create invite link'}
                    </button>
                  </div>
                ) : (
                  <div className="mt-4">
                    <button
                      type="button"
                      onClick={createInviteLink}
                      disabled={inviteBusy}
                      style={{ background: 'transparent', border: 0, padding: 0, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: M_BRAND, fontFamily: 'inherit' }}
                    >
                      {inviteBusy ? 'Creating link…' : '+ Invite guests'}
                    </button>
                  </div>
                )
              )}
            </div>
          </div>
        );
      })()}

      {/* Activity occurrence sheet - tap on a weekly extracurricular. The
          series is editable via the shared ActivityModal; "Skip this day"
          hides just this date everywhere (calendar, Kids Mode, digest,
          subscribed feeds). */}
      {/* ── Recurring-event delete choice: just this day vs the series ── */}
      {recurDeleteOpen && editingEvent && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center"
          style={{ background: 'rgba(26,22,32,0.45)', padding: 20 }}
          onClick={() => setRecurDeleteOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Delete repeating event"
        >
          <div
            className="w-full"
            style={{ maxWidth: 380, background: '#fff', borderRadius: 20, padding: 20, boxShadow: '0 18px 50px rgba(26,22,32,0.25)' }}
            onClick={e => e.stopPropagation()}
          >
            <h2 className="serif-display" style={{ margin: 0, fontFamily: M_SERIF, fontSize: 20, fontWeight: 400, color: M_INK }}>
              This event repeats
            </h2>
            <div style={{ fontSize: 14, color: M_INK2, marginTop: 6 }}>
              “{editingEvent.title}” happens {(RECURRENCE_LABELS[editingEvent.recurrence] || 'regularly').toLowerCase()}.
              Delete just this day, or the whole series?
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
              <button
                type="button"
                onClick={skipEventOccurrence}
                style={{ ...mInput, cursor: 'pointer', fontWeight: 600, color: M_INK, textAlign: 'center' }}
              >
                Delete just this day
                {' '}({new Date(editingEvent.start_time).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })})
              </button>
              <button
                type="button"
                onClick={() => { const id = editingEvent.id; setRecurDeleteOpen(false); performEventDelete(id); }}
                style={{ padding: '10px 12px', borderRadius: 10, border: 0, background: 'var(--color-coral, #E8724A)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
              >
                Delete the whole series
              </button>
              <button
                type="button"
                onClick={() => setRecurDeleteOpen(false)}
                style={{ padding: '9px 12px', borderRadius: 10, border: 0, background: 'transparent', color: M_INK3, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {activitySheet && (() => {
        const { activity, child, date } = activitySheet;
        const [y, m, d] = date.split('-').map(Number);
        const dateLabel = new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
        // The tapped OCCURRENCE's effective values: an existing per-date
        // override wins over the series.
        const ov = activity.overrides?.[date] || null;
        const effTimeStart = ov ? ov.time_start : activity.time_start;
        const effTimeEnd = ov ? ov.time_end : activity.time_end;
        const effPickupId = ov ? ov.pickup_member_id : activity.pickup_member_id;
        const timeLabel = effTimeStart
          ? `${String(effTimeStart).slice(0, 5)}${effTimeEnd ? ` – ${String(effTimeEnd).slice(0, 5)}` : ''}`
          : 'All day';
        const pickupName = effPickupId
          ? members.find((mem) => mem.id === effPickupId)?.name
          : null;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setActivitySheet(null)}>
            <div className="absolute inset-0 bg-black/40" />
            <div className="relative bg-white rounded-2xl shadow-lg border border-light-grey p-5 sm:p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-start justify-between gap-3 mb-1">
                <h2 className="text-base md:text-lg font-medium text-charcoal">
                  {child ? `${child.name} - ` : ''}{activity.activity}
                </h2>
                <button onClick={() => setActivitySheet(null)} className="text-warm-grey hover:text-charcoal p-1 shrink-0">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
              <p className="text-sm text-warm-grey">{dateLabel} · {timeLabel}</p>
              {pickupName && <p className="text-sm text-warm-grey mt-1">🚗 Pickup: {pickupName}</p>}
              {activity.term_label && <p className="text-xs text-warm-grey mt-1">{activity.term_label}</p>}
              <div className="mt-4 bg-plum-light rounded-xl px-3 py-2.5">
                <p className="text-[11px] text-plum/80">
                  {ov
                    ? 'This day has been changed - the rest of the week runs as usual.'
                    : `Repeats weekly${child ? ` for ${child.name}` : ''} - skipping or changing only affects this date.`}
                </p>
              </div>

              {/* "Change just this day" mini-form: one-off time/pickup for
                  this occurrence, stored as a per-date override. */}
              {actChangeOpen && (
                <div className="mt-4">
                  <div style={{ display: 'flex', gap: 12 }}>
                    <MField label="Starts" style={{ flex: 1, marginBottom: 10 }}>
                      <input type="time" value={ovStart} onChange={(e) => setOvStart(e.target.value)} style={{ ...mInput, WebkitAppearance: 'none', appearance: 'none' }} />
                    </MField>
                    <MField label="Ends" style={{ flex: 1, marginBottom: 10 }}>
                      <input type="time" value={ovEnd} onChange={(e) => setOvEnd(e.target.value)} style={{ ...mInput, WebkitAppearance: 'none', appearance: 'none' }} />
                    </MField>
                  </div>
                  <MField label="Pickup (this day only)" style={{ marginBottom: 10 }}>
                    <select value={ovPickup} onChange={(e) => setOvPickup(e.target.value)} style={mInput}>
                      <option value="">No pickup set</option>
                      {members.filter((mem) => mem.member_type !== 'dependent').map((mem) => (
                        <option key={mem.id} value={mem.id}>{mem.name}</option>
                      ))}
                    </select>
                  </MField>
                </div>
              )}

              <div className="flex flex-col gap-2 mt-4">
                {actChangeOpen ? (
                  <button
                    type="button"
                    disabled={activityBusy}
                    onClick={handleOverrideActivityDay}
                    className="w-full text-sm font-semibold text-white bg-primary hover:bg-primary-pressed disabled:opacity-50 rounded-xl px-4 py-2.5"
                  >
                    {activityBusy ? 'Working…' : 'Save for this day'}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={activityBusy}
                    onClick={handleSkipActivityDay}
                    className="w-full text-sm font-semibold text-white bg-primary hover:bg-primary-pressed disabled:opacity-50 rounded-xl px-4 py-2.5"
                  >
                    {activityBusy ? 'Working…' : 'Skip this day'}
                  </button>
                )}
                <button
                  type="button"
                  disabled={activityBusy}
                  onClick={() => setActChangeOpen((v) => !v)}
                  className="w-full text-sm font-semibold text-plum bg-white border border-plum/40 hover:bg-plum-light disabled:opacity-50 rounded-xl px-4 py-2.5"
                >
                  {actChangeOpen ? 'Cancel change' : 'Change just this day'}
                </button>
                {ov && !actChangeOpen && (
                  <button
                    type="button"
                    disabled={activityBusy}
                    onClick={handleResetActivityDay}
                    className="w-full text-sm font-semibold text-plum bg-white border border-plum/40 hover:bg-plum-light disabled:opacity-50 rounded-xl px-4 py-2.5"
                  >
                    Back to the usual time
                  </button>
                )}
                {!actChangeOpen && (
                  <button
                    type="button"
                    disabled={activityBusy}
                    onClick={() => { setActivityEdit({ child, activity }); setActivitySheet(null); }}
                    className="w-full text-sm font-semibold text-plum bg-white border border-plum/40 hover:bg-plum-light disabled:opacity-50 rounded-xl px-4 py-2.5"
                  >
                    Edit activity
                  </button>
                )}
                {!actChangeOpen && (
                  <button
                    type="button"
                    disabled={activityBusy}
                    onClick={handleDeleteActivitySeries}
                    className="w-full text-sm font-semibold text-coral hover:text-coral/80 disabled:opacity-50 px-4 py-1.5"
                  >
                    Delete activity
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Shared activity form (same component the Family page uses) - opened
          from the sheet's "Edit activity" or the New Event form's
          "extracurricular" shortcut (create mode with a child picker). */}
      {activityEdit && (
        <ActivityModal
          child={activityEdit.child}
          childOptions={activityEdit.childOptions || []}
          activity={activityEdit.activity}
          presetDay={activityEdit.presetDay ?? 0}
          members={members}
          onClose={() => setActivityEdit(null)}
          onChanged={refresh}
        />
      )}

      {/* Creation-moment invite offer for a just-saved gathering. Fixed
          above the tab bar; one link taps straight into the share sheet. */}
      {gatherOffer && (
        <div className="fixed inset-x-4 z-40 md:left-auto md:right-6 md:w-[360px]" style={{ bottom: 'calc(96px + env(safe-area-inset-bottom, 0px))' }}>
          <div className="bg-white rounded-2xl p-4" style={{ boxShadow: 'var(--shadow-lg)', border: '1px solid rgba(107,63,160,0.2)' }}>
            <div className="text-[13.5px] font-semibold text-charcoal">🎈 Sounds like a gathering!</div>
            <div className="text-[12.5px] text-warm-grey mt-1 leading-relaxed">
              Share one link and the other families can RSVP - no app needed. Headcounts and allergy notes come back to you.
            </div>
            <div className="flex items-center gap-3 mt-3">
              <button
                type="button"
                disabled={gatherBusy}
                onClick={async () => {
                  setGatherBusy(true);
                  try {
                    const { data } = await api.post(`/calendar/events/${gatherOffer.id}/invite-link`);
                    if (navigator.share) {
                      try { await navigator.share({ title: gatherOffer.title || 'You’re invited', url: data.url }); } catch { /* sheet closed */ }
                    } else {
                      await copyInviteUrl(data.url);
                    }
                    setGatherOffer(null);
                  } catch {
                    alert('Could not create the invite link — you can also do it from the event itself.');
                  } finally {
                    setGatherBusy(false);
                  }
                }}
                className="h-10 px-4 rounded-xl bg-plum text-white text-[13px] font-semibold disabled:opacity-60"
              >
                {gatherBusy ? 'Creating…' : 'Create invite link'}
              </button>
              <button type="button" onClick={() => setGatherOffer(null)} className="text-[13px] font-semibold text-warm-grey">
                Not now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
