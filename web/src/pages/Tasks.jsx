import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../lib/api';
import { useAuth } from '../context/AuthContext';
import Spinner from '../components/Spinner';
import ErrorBanner from '../components/ErrorBanner';
import { IconCheck, IconPlus } from '../components/Icons';

/* ─── Constants ─── */

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

const COLOR_TINTS = {
  red: '#FDF0EB', 'burnt-orange': '#FDF0EB', amber: '#FFF6E9', gold: '#FFF6E9',
  leaf: '#EDF5EE', emerald: '#EDF5EE', teal: '#E6F5F3', sky: '#E6F1FB',
  cobalt: '#E6F1FB', indigo: '#F3EDFC', purple: '#F3EDFC', magenta: '#FDF0EB',
  rose: '#FDF0EB', terracotta: '#FDF0EB', moss: '#EDF5EE', slate: '#F0F0F2',
  coral: '#FDF0EB', plum: '#F3EDFC', sage: '#EDF5EE',
};

const MEMBER_COLORS = {
  red: '#E25555', 'burnt-orange': '#E07A3A', amber: '#E8A040', gold: '#C5A833',
  leaf: '#7BAE4E', emerald: '#3A9E6E', teal: '#3AADA0', sky: '#4A9FCC',
  cobalt: '#3A6FD4', indigo: '#6558C7', purple: '#9050B5', magenta: '#C74E95',
  rose: '#E06888', terracotta: '#C47A5E', moss: '#7C8A6E', slate: '#7A8694',
  coral: '#E8724A', plum: '#6B3FA0', sage: '#7DAE82',
};

const PRIORITY_COLORS = { high: '#E24B4A', medium: '#E0A458', low: '#7DAE82' };

/* ─── Helpers ─── */

function today() {
  return new Date().toISOString().split('T')[0];
}

function getDueBadge(task) {
  if (!task.due_date) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const due = new Date(task.due_date + 'T00:00:00');
  const diff = Math.floor((due - now) / 86400000);
  if (diff < 0) return { label: `${Math.abs(diff)} day${Math.abs(diff) > 1 ? 's' : ''} overdue`, bg: '#FCEBEB', text: '#A32D2D' };
  if (diff === 0) return { label: 'Today', bg: 'var(--coral-light, #FDF0EB)', text: '#993C1D' };
  if (diff === 1) return { label: 'Tomorrow', bg: '#FAEEDA', text: '#854F0B' };
  const d = new Date(task.due_date + 'T00:00:00');
  return { label: d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' }), bg: 'var(--plum-light, #F3EDFC)', text: 'var(--plum, #6B3FA0)' };
}

function notificationLabel(value) {
  return NOTIFICATION_OPTIONS.find((o) => o.value === value)?.label || '';
}

/* ─── Inline SVG Icons ─── */

function DotsVerticalIcon({ className = 'h-4 w-4' }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 20 20" fill="currentColor">
      <circle cx="10" cy="4" r="1.5" />
      <circle cx="10" cy="10" r="1.5" />
      <circle cx="10" cy="16" r="1.5" />
    </svg>
  );
}

function PencilIcon({ className = 'h-4 w-4' }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 20 20" fill="currentColor">
      <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
    </svg>
  );
}

function TrashIcon({ className = 'h-4 w-4' }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
    </svg>
  );
}

function BellIcon({ className = 'h-3 w-3' }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 20 20" fill="currentColor">
      <path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z" />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
    </svg>
  );
}

function CheckmarkSVG() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" className="w-3 h-3">
      <path d="M3.5 8.5L6.5 11.5L12.5 4.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ─── useMediaQuery Hook ─── */

function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' ? window.matchMedia(query).matches : false);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = (e) => setMatches(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);
  return matches;
}

/* ─── TaskCard Component ─── */

function TaskCard({ task, completed, onToggle, toggling, onOpenMenu, openMenuId, onEdit, onDelete, deleting, onRestore, restoring, isMobile }) {
  const badge = getDueBadge(task);
  const menuRef = useRef(null);

  return (
    <div className="relative group" style={{ opacity: completed ? 0.5 : 1 }}>
      <div
        className="bg-white flex items-start gap-2.5 p-3 cursor-pointer"
        style={{ borderRadius: 12, padding: '12px 14px' }}
        onClick={() => !completed && onEdit(task)}
      >
        {/* Checkbox */}
        <button
          onClick={(e) => { e.stopPropagation(); completed ? (onRestore && onRestore(task)) : onToggle(task); }}
          disabled={toggling?.has(task.id) || restoring?.has(task.id)}
          className="mt-0.5 shrink-0 flex items-center justify-center transition-colors"
          style={{
            width: 20,
            height: 20,
            borderRadius: 6,
            border: completed ? 'none' : '2px solid var(--light-grey, #E8E5EC)',
            background: completed ? 'var(--sage, #7DAE82)' : 'transparent',
          }}
        >
          {completed && <CheckmarkSVG />}
        </button>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <p
            className="leading-snug"
            style={{
              fontSize: 13,
              fontFamily: 'var(--font-sans, system-ui, sans-serif)',
              fontWeight: 500,
              color: completed ? 'var(--warm-grey, #6B6774)' : 'var(--charcoal, #2D2A33)',
              textDecoration: completed ? 'line-through' : 'none',
            }}
          >
            {task.title}
          </p>
          {/* Metadata row */}
          {!completed && (badge || task.priority) && (
            <div className="flex items-center gap-2 mt-1">
              {badge && (
                <span
                  className="inline-flex items-center px-1.5 py-0.5"
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    borderRadius: 4,
                    background: badge.bg,
                    color: badge.text,
                  }}
                >
                  {badge.label}
                </span>
              )}
              {task.priority && (
                <span
                  className="inline-block rounded-full"
                  style={{
                    width: 7,
                    height: 7,
                    background: PRIORITY_COLORS[task.priority] || 'transparent',
                  }}
                />
              )}
              {task.notification && (
                <span className="text-[var(--warm-grey,#6B6774)]" title={notificationLabel(task.notification)}>
                  <BellIcon />
                </span>
              )}
              {task.recurrence && (
                <span style={{ fontSize: 10, color: 'var(--warm-grey, #6B6774)' }}>
                  {task.recurrence}
                </span>
              )}
            </div>
          )}
        </div>

        {/* 3-dot menu */}
        {!completed && (
          <div className="relative shrink-0" ref={menuRef}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onOpenMenu(openMenuId === task.id ? null : task.id);
              }}
              className="p-1 rounded-md cursor-pointer"
              style={{
                color: 'var(--warm-grey, #6B6774)',
              }}
            >
              <DotsVerticalIcon />
            </button>

            {/* Dropdown */}
            {openMenuId === task.id && (
              <div
                className="absolute right-0 z-50"
                style={{
                  top: '100%',
                  marginTop: 4,
                  minWidth: 140,
                  background: '#fff',
                  borderRadius: 12,
                  border: '1px solid var(--light-grey, #E8E5EC)',
                  boxShadow: '0 8px 24px rgba(107,63,160,0.12)',
                  padding: 6,
                }}
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenMenu(null);
                    onEdit(task);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors"
                  style={{ borderRadius: 8, fontSize: 13, color: 'var(--charcoal, #2D2A33)' }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--cream, #FBF8F3)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  <PencilIcon className="h-3.5 w-3.5" /> Edit
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenMenu(null);
                    onDelete(task);
                  }}
                  disabled={deleting?.has(task.id)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors"
                  style={{ borderRadius: 8, fontSize: 13, color: '#A32D2D' }}
                  onMouseEnter={(e) => e.currentTarget.style.background = '#FCEBEB'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  <TrashIcon className="h-3.5 w-3.5" /> Delete
                </button>
              </div>
            )}
          </div>
        )}

        {/* Completed: restore button */}
        {completed && (
          <button
            onClick={() => onRestore && onRestore(task)}
            disabled={restoring?.has(task.id)}
            className="shrink-0 text-xs font-medium px-2 py-1 rounded-lg transition-colors"
            style={{
              color: 'var(--plum, #6B3FA0)',
              background: 'var(--plum-light, #F3EDFC)',
            }}
          >
            {restoring?.has(task.id) ? '...' : 'Undo'}
          </button>
        )}
      </div>
    </div>
  );
}

/* ─── MemberColumn Component ─── */

function MemberColumn({ member, incompleteTasks, completedTasks, onAddTask, onToggle, toggling, openMenuId, onOpenMenu, onEdit, onDelete, deleting, onRestore, restoring, isMobile }) {
  const colorTheme = member?.color_theme || 'plum';
  const bgTint = COLOR_TINTS[colorTheme] || '#F3EDFC';
  const avatarColor = MEMBER_COLORS[colorTheme] || '#6B3FA0';
  const initial = (member?.name || 'U').charAt(0).toUpperCase();
  const displayName = member?.name || 'Unassigned';
  const totalCount = incompleteTasks.length;

  return (
    <div
      className="flex flex-col shrink-0"
      style={{
        minWidth: isMobile ? '100%' : 250,
        width: isMobile ? '100%' : 250,
        background: bgTint,
        borderRadius: 16,
        padding: 16,
        gap: 10,
      }}
    >
      {/* Column header */}
      <div className="flex items-center gap-2.5">
        <div
          className="shrink-0 flex items-center justify-center"
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            background: avatarColor,
            color: '#fff',
            fontSize: 15,
            fontWeight: 600,
            fontFamily: 'var(--font-sans, system-ui, sans-serif)',
            border: '2px solid #fff',
          }}
        >
          {initial}
        </div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, fontFamily: 'var(--font-display, "Lora", Georgia, serif)', color: 'var(--charcoal, #2D2A33)', letterSpacing: '-0.02em' }}>
            {displayName}
          </div>
          <div style={{ fontSize: 12, color: 'var(--warm-grey, #6B6774)' }}>
            {totalCount} task{totalCount !== 1 ? 's' : ''}
          </div>
        </div>
      </div>

      {/* Add a task button */}
      <button
        onClick={onAddTask}
        className="w-full flex items-center justify-center gap-1.5 py-2.5 transition-colors"
        style={{
          border: '1.5px dashed var(--light-grey, #E8E5EC)',
          borderRadius: 10,
          background: 'transparent',
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--warm-grey, #6B6774)',
          cursor: 'pointer',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = 'var(--plum, #6B3FA0)';
          e.currentTarget.style.color = 'var(--plum, #6B3FA0)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = 'var(--light-grey, #E8E5EC)';
          e.currentTarget.style.color = 'var(--warm-grey, #6B6774)';
        }}
      >
        <IconPlus className="h-3.5 w-3.5" /> Add a task
      </button>

      {/* Incomplete tasks */}
      <div className="flex flex-col gap-2">
        {incompleteTasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            completed={false}
            onToggle={onToggle}
            toggling={toggling}
            openMenuId={openMenuId}
            onOpenMenu={onOpenMenu}
            onEdit={onEdit}
            onDelete={onDelete}
            deleting={deleting}
            isMobile={isMobile}
          />
        ))}
      </div>

      {/* Completed divider + tasks */}
      {completedTasks.length > 0 && (
        <>
          <div className="flex items-center gap-2 my-1">
            <div className="flex-1" style={{ height: 1, background: 'var(--light-grey, #E8E5EC)' }} />
            <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--warm-grey, #6B6774)' }}>
              Done &middot; {completedTasks.length}
            </span>
            <div className="flex-1" style={{ height: 1, background: 'var(--light-grey, #E8E5EC)' }} />
          </div>
          <div className="flex flex-col gap-2">
            {completedTasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                completed={true}
                onToggle={onToggle}
                toggling={toggling}
                openMenuId={openMenuId}
                onOpenMenu={onOpenMenu}
                onEdit={onEdit}
                onDelete={onDelete}
                deleting={deleting}
                onRestore={onRestore}
                restoring={restoring}
                isMobile={isMobile}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ─── Main Component ─── */

export default function Tasks() {
  const { user } = useAuth();
  const isMobile = useMediaQuery('(max-width: 767px)');

  // Data state
  const [tasks, setTasks] = useState([]);
  const [recentDone, setRecentDone] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [members, setMembers] = useState([]);

  // UI state
  const [showAll, setShowAll] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [activeMobileTab, setActiveMobileTab] = useState(null);

  // Scroll state (desktop columns)
  const scrollRef = useRef(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  // Form fields
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState(today());
  const [dueTime, setDueTime] = useState('');
  const [assignee, setAssignee] = useState('');
  const [recurrence, setRecurrence] = useState('');
  const [description, setDescription] = useState('');
  const [notification, setNotification] = useState('');
  const [priority, setPriority] = useState('');
  const [adding, setAdding] = useState(false);

  // Operation sets
  const [toggling, setToggling] = useState(new Set());
  const [restoring, setRestoring] = useState(new Set());
  const [deleting, setDeleting] = useState(new Set());

  /* ─ Form helpers ─ */

  function resetForm() {
    setTitle('');
    setDueDate(today());
    setDueTime('');
    setAssignee('');
    setRecurrence('');
    setDescription('');
    setNotification('');
    setPriority('');
    setEditingTask(null);
  }

  function openAddForm(preAssignee = '') {
    resetForm();
    if (preAssignee) setAssignee(preAssignee);
    setShowForm(true);
  }

  function openEditForm(task) {
    setTitle(task.title);
    setDueDate(task.due_date || today());
    setDueTime(task.due_time ? task.due_time.substring(0, 5) : '');
    setAssignee(task.assigned_to_name || '');
    setRecurrence(task.recurrence || '');
    setDescription(task.description || '');
    setNotification(task.notification || '');
    setPriority(task.priority || '');
    setEditingTask(task);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    resetForm();
  }

  /* ─ Data loading ─ */

  const load = useCallback(async () => {
    try {
      const params = showAll ? { all: 'true' } : {};
      const [tasksRes, recentRes] = await Promise.all([
        api.get('/tasks', { params }),
        api.get('/tasks/recent'),
      ]);
      const rawTasks = tasksRes.data?.tasks ?? tasksRes.data;
      const rawRecent = recentRes.data?.tasks ?? recentRes.data;
      setTasks(Array.isArray(rawTasks) ? rawTasks : []);
      setRecentDone(Array.isArray(rawRecent) ? rawRecent : []);
    } catch {
      setError('Could not load tasks.');
    } finally {
      setLoading(false);
    }
  }, [showAll]);

  useEffect(() => {
    setLoading(true);
    load();
    api.get('/household').then(({ data }) => {
      const m = data.members ?? [];
      setMembers(m);
      // Set default mobile tab to current user or first member
      if (m.length > 0 && !activeMobileTab) {
        const me = m.find((mem) => mem.id === user?.id);
        setActiveMobileTab(me?.name || m[0].name);
      }
    }).catch(() => {});
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ─ Scroll tracking ─ */

  const updateScrollButtons = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || isMobile) return;
    updateScrollButtons();
    el.addEventListener('scroll', updateScrollButtons, { passive: true });
    const ro = new ResizeObserver(updateScrollButtons);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', updateScrollButtons);
      ro.disconnect();
    };
  }, [isMobile, updateScrollButtons, members, tasks]);

  /* ─ Click outside to close menu ─ */

  useEffect(() => {
    if (openMenuId === null) return;
    const handler = () => setOpenMenuId(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [openMenuId]);

  /* ─ Group tasks by member ─ */

  const columnData = (() => {
    const memberNames = members.map((m) => m.name);
    const currentUserName = user?.name;

    // Sort: current user first, then alphabetical
    const sorted = [...memberNames].sort((a, b) => {
      if (a === currentUserName) return -1;
      if (b === currentUserName) return 1;
      return 0;
    });

    // Build groups: all tasks (incomplete + recently done) by assigned_to_name
    const allTasks = [...tasks, ...recentDone];
    const groups = {};
    for (const name of sorted) groups[name] = { incomplete: [], completed: [] };
    groups['Unassigned'] = { incomplete: [], completed: [] };

    for (const task of allTasks) {
      const key = task.assigned_to_name || 'Unassigned';
      if (!groups[key]) groups[key] = { incomplete: [], completed: [] };
      if (task.completed) {
        groups[key].completed.push(task);
      } else {
        groups[key].incomplete.push(task);
      }
    }

    // Build column entries: all members first (even if empty), then unassigned if it has tasks
    const columns = sorted.map((name) => {
      const member = members.find((m) => m.name === name) || null;
      return { name, member, ...groups[name] };
    });

    const unassigned = groups['Unassigned'];
    if (unassigned.incomplete.length > 0 || unassigned.completed.length > 0) {
      columns.push({ name: 'Unassigned', member: null, ...unassigned });
    }

    return columns;
  })();

  /* ─ Actions ─ */

  async function handleSubmit(e) {
    e.preventDefault();
    if (!title.trim()) return;
    setAdding(true);
    try {
      if (editingTask) {
        const payload = {
          title: title.trim(),
          due_date: dueDate,
          due_time: dueTime || null,
          assigned_to_name: assignee || null,
          recurrence: recurrence || null,
          description: description || null,
          notification: notification || null,
          priority: priority || null,
        };
        await api.patch(`/tasks/${editingTask.id}`, payload);
      } else {
        const payload = { title: title.trim(), due_date: dueDate };
        if (dueTime) payload.due_time = dueTime;
        if (assignee) payload.assigned_to_name = assignee;
        if (recurrence) payload.recurrence = recurrence;
        if (description) payload.description = description;
        if (notification) payload.notification = notification;
        if (priority) payload.priority = priority;
        await api.post('/tasks', payload);
      }
      closeForm();
      await load();
    } catch {
      setError(editingTask ? 'Could not update task.' : 'Could not add task.');
    } finally {
      setAdding(false);
    }
  }

  async function toggle(task) {
    setToggling((s) => new Set([...s, task.id]));
    try {
      await api.patch(`/tasks/${task.id}`, { completed: !task.completed });
      await load();
    } catch {
      setError('Could not update task.');
    } finally {
      setToggling((s) => { const n = new Set(s); n.delete(task.id); return n; });
    }
  }

  async function restore(task) {
    setRestoring((s) => new Set([...s, task.id]));
    try {
      await api.patch(`/tasks/${task.id}`, { completed: false });
      await load();
    } catch {
      setError('Could not restore task.');
    } finally {
      setRestoring((s) => { const n = new Set(s); n.delete(task.id); return n; });
    }
  }

  async function confirmDelete(task) {
    if (!window.confirm(`Delete "${task.title}"? This can't be undone.`)) return;
    setDeleting((s) => new Set([...s, task.id]));
    try {
      await api.delete(`/tasks/${task.id}`);
      await load();
    } catch {
      setError('Could not delete task.');
    } finally {
      setDeleting((s) => { const n = new Set(s); n.delete(task.id); return n; });
    }
  }

  /* ─ Render ─ */

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1
          className="hidden md:flex items-center gap-2"
          style={{
            fontSize: 38,
            fontWeight: 400,
            lineHeight: 1,
            fontFamily: 'var(--font-display, "Lora", Georgia, serif)',
            color: 'var(--charcoal, #2D2A33)',
            letterSpacing: '-0.02em',
          }}
        >
          <IconCheck className="h-6 w-6" style={{ color: 'var(--plum, #6B3FA0)' }} />
          Tasks
        </h1>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowAll((v) => !v)}
            className="text-sm hover:underline"
            style={{ color: 'var(--plum, #6B3FA0)', fontWeight: 500 }}
          >
            {showAll ? 'Due today' : 'All tasks'}
          </button>
          <button
            onClick={() => openAddForm()}
            className="flex items-center gap-1 text-white text-sm font-semibold px-4 transition-colors"
            style={{
              background: 'var(--plum, #6B3FA0)',
              height: 40,
              borderRadius: 12,
            }}
          >
            <IconPlus className="h-4 w-4" /> Add task
          </button>
        </div>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError('')} />

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={closeForm}>
          <div className="absolute inset-0 bg-black/40" />
          <form
            onSubmit={handleSubmit}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-md max-h-[90vh] overflow-y-auto space-y-3"
            style={{
              background: '#FFFFFF',
              borderRadius: 16,
              boxShadow: 'var(--shadow-lg, 0 8px 24px rgba(107,63,160,0.10))',
              padding: 24,
            }}
          >
            <div className="flex items-center justify-between mb-1">
              <h2
                style={{
                  fontSize: 18,
                  fontWeight: 600,
                  fontFamily: 'var(--font-display, "Lora", Georgia, serif)',
                  color: 'var(--charcoal, #2D2A33)',
                }}
              >
                {editingTask ? 'Edit task' : 'New task'}
              </h2>
              <button type="button" onClick={closeForm} className="p-1" style={{ color: 'var(--warm-grey, #6B6774)' }}>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>

            <div>
              <label className="block mb-1" style={{ fontSize: 13, fontWeight: 500, color: 'var(--charcoal, #2D2A33)' }}>Task title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="What needs to be done?"
                required
                className="w-full focus:outline-none"
                style={{
                  border: '1.5px solid var(--light-grey, #E8E5EC)',
                  borderRadius: 10,
                  height: 48,
                  padding: '0 14px',
                  fontSize: 14,
                  background: '#FFFFFF',
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = 'var(--plum, #6B3FA0)';
                  e.currentTarget.style.boxShadow = '0 0 0 3px rgba(107,63,160,0.1)';
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = 'var(--light-grey, #E8E5EC)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              />
            </div>

            <div>
              <label className="block mb-1" style={{ fontSize: 13, fontWeight: 500, color: 'var(--charcoal, #2D2A33)' }}>Description (optional)</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Add a description..."
                rows={2}
                className="w-full focus:outline-none resize-none"
                style={{
                  border: '1.5px solid var(--light-grey, #E8E5EC)',
                  borderRadius: 10,
                  padding: '10px 14px',
                  fontSize: 14,
                  background: '#FFFFFF',
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = 'var(--plum, #6B3FA0)';
                  e.currentTarget.style.boxShadow = '0 0 0 3px rgba(107,63,160,0.1)';
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = 'var(--light-grey, #E8E5EC)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block mb-1" style={{ fontSize: 13, fontWeight: 500, color: 'var(--charcoal, #2D2A33)' }}>Due date</label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full focus:outline-none"
                  style={{
                    border: '1.5px solid var(--light-grey, #E8E5EC)',
                    borderRadius: 10,
                    height: 48,
                    padding: '0 14px',
                    fontSize: 14,
                    background: '#FFFFFF',
                  }}
                />
              </div>
              <div>
                <label className="block mb-1" style={{ fontSize: 13, fontWeight: 500, color: 'var(--charcoal, #2D2A33)' }}>Time (optional)</label>
                <input
                  type="time"
                  value={dueTime}
                  onChange={(e) => setDueTime(e.target.value)}
                  className="w-full focus:outline-none"
                  style={{
                    border: '1.5px solid var(--light-grey, #E8E5EC)',
                    borderRadius: 10,
                    height: 48,
                    padding: '0 14px',
                    fontSize: 14,
                    background: '#FFFFFF',
                  }}
                />
              </div>
              <div>
                <label className="block mb-1" style={{ fontSize: 13, fontWeight: 500, color: 'var(--charcoal, #2D2A33)' }}>Assign to</label>
                <select
                  value={assignee}
                  onChange={(e) => setAssignee(e.target.value)}
                  className="w-full focus:outline-none"
                  style={{
                    border: '1.5px solid var(--light-grey, #E8E5EC)',
                    borderRadius: 10,
                    height: 48,
                    padding: '0 14px',
                    fontSize: 14,
                    background: '#fff',
                  }}
                >
                  <option value="">Everyone</option>
                  {members.map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block mb-1" style={{ fontSize: 13, fontWeight: 500, color: 'var(--charcoal, #2D2A33)' }}>Priority</label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  className="w-full focus:outline-none"
                  style={{
                    border: '1.5px solid var(--light-grey, #E8E5EC)',
                    borderRadius: 10,
                    height: 48,
                    padding: '0 14px',
                    fontSize: 14,
                    background: '#fff',
                  }}
                >
                  <option value="">None</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </div>
              <div>
                <label className="block mb-1" style={{ fontSize: 13, fontWeight: 500, color: 'var(--charcoal, #2D2A33)' }}>Repeats</label>
                <select
                  value={recurrence}
                  onChange={(e) => setRecurrence(e.target.value)}
                  className="w-full focus:outline-none"
                  style={{
                    border: '1.5px solid var(--light-grey, #E8E5EC)',
                    borderRadius: 10,
                    height: 48,
                    padding: '0 14px',
                    fontSize: 14,
                    background: '#fff',
                  }}
                >
                  {RECURRENCES.map((r) => <option key={r} value={r}>{r || 'Never'}</option>)}
                </select>
              </div>
              <div>
                <label className="block mb-1" style={{ fontSize: 13, fontWeight: 500, color: 'var(--charcoal, #2D2A33)' }}>Notification</label>
                <select
                  value={notification}
                  onChange={(e) => setNotification(e.target.value)}
                  className="w-full focus:outline-none"
                  style={{
                    border: '1.5px solid var(--light-grey, #E8E5EC)',
                    borderRadius: 10,
                    height: 48,
                    padding: '0 14px',
                    fontSize: 14,
                    background: '#fff',
                  }}
                >
                  {NOTIFICATION_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex gap-2 justify-end pt-2">
              <button
                type="button"
                onClick={closeForm}
                className="px-4 py-2 text-sm font-medium transition-colors"
                style={{ color: 'var(--warm-grey, #6B6774)', borderRadius: 12 }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={adding || !title.trim()}
                className="text-white text-sm font-semibold px-5 py-2.5 transition-colors disabled:opacity-50"
                style={{ background: 'var(--plum, #6B3FA0)', borderRadius: 12 }}
              >
                {adding ? (editingTask ? 'Saving...' : 'Adding...') : (editingTask ? 'Save changes' : 'Add task')}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Main content */}
      {loading ? (
        <Spinner />
      ) : (
        <>
          {/* ─── MOBILE: Tabbed view ─── */}
          {isMobile && (
            <div>
              {/* Member tab pills */}
              <div className="flex gap-2 overflow-x-auto pb-3 -mx-1 px-1" style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
                {columnData.map((col) => {
                  const isActive = activeMobileTab === col.name;
                  const colorTheme = col.member?.color_theme || 'plum';
                  const avatarColor = MEMBER_COLORS[colorTheme] || '#6B3FA0';
                  const initial = (col.name).charAt(0).toUpperCase();

                  return (
                    <button
                      key={col.name}
                      onClick={() => setActiveMobileTab(col.name)}
                      className="shrink-0 flex items-center gap-1.5 px-3 py-2 transition-colors"
                      style={{
                        borderRadius: 24,
                        border: isActive ? 'none' : '1.5px solid var(--light-grey, #E8E5EC)',
                        background: isActive ? avatarColor : '#fff',
                        color: isActive ? '#fff' : 'var(--charcoal, #2D2A33)',
                        fontSize: 13,
                        fontWeight: 600,
                      }}
                    >
                      <div
                        className="flex items-center justify-center shrink-0"
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: '50%',
                          background: isActive ? 'rgba(255,255,255,0.3)' : avatarColor,
                          color: '#fff',
                          fontSize: 11,
                          fontWeight: 600,
                        }}
                      >
                        {initial}
                      </div>
                      {col.name}
                      <span
                        className="inline-flex items-center justify-center"
                        style={{
                          minWidth: 18,
                          height: 18,
                          borderRadius: 9,
                          background: isActive ? 'rgba(255,255,255,0.25)' : 'var(--light-grey, #E8E5EC)',
                          fontSize: 10,
                          fontWeight: 700,
                          padding: '0 5px',
                        }}
                      >
                        {col.incomplete.length}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Active tab content */}
              {columnData.filter((col) => col.name === activeMobileTab).map((col) => (
                <MemberColumn
                  key={col.name}
                  member={col.member}
                  incompleteTasks={col.incomplete}
                  completedTasks={col.completed}
                  onAddTask={() => openAddForm(col.name !== 'Unassigned' ? col.name : '')}
                  onToggle={toggle}
                  toggling={toggling}
                  openMenuId={openMenuId}
                  onOpenMenu={setOpenMenuId}
                  onEdit={openEditForm}
                  onDelete={confirmDelete}
                  deleting={deleting}
                  onRestore={restore}
                  restoring={restoring}
                  isMobile={true}
                />
              ))}
            </div>
          )}

          {/* ─── DESKTOP: Column view ─── */}
          {!isMobile && (
            <div className="relative">
              {/* Scroll left arrow */}
              {canScrollLeft && (
                <button
                  onClick={() => scrollRef.current?.scrollBy({ left: -300, behavior: 'smooth' })}
                  className="absolute left-2 top-1/2 -translate-y-1/2 z-10 flex items-center justify-center transition-colors cursor-pointer"
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: '50%',
                    background: '#fff',
                    border: '1px solid var(--light-grey, #E8E5EC)',
                    color: 'var(--warm-grey, #6B6774)',
                    boxShadow: '0 4px 16px rgba(107,63,160,0.08)',
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.color = 'var(--plum, #6B3FA0)'}
                  onMouseLeave={(e) => e.currentTarget.style.color = 'var(--warm-grey, #6B6774)'}
                >
                  <ChevronLeftIcon />
                </button>
              )}

              {/* Scroll right arrow */}
              {canScrollRight && (
                <button
                  onClick={() => scrollRef.current?.scrollBy({ left: 300, behavior: 'smooth' })}
                  className="absolute right-2 top-1/2 -translate-y-1/2 z-10 flex items-center justify-center transition-colors cursor-pointer"
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: '50%',
                    background: '#fff',
                    border: '1px solid var(--light-grey, #E8E5EC)',
                    color: 'var(--warm-grey, #6B6774)',
                    boxShadow: '0 4px 16px rgba(107,63,160,0.08)',
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.color = 'var(--plum, #6B3FA0)'}
                  onMouseLeave={(e) => e.currentTarget.style.color = 'var(--warm-grey, #6B6774)'}
                >
                  <ChevronRightIcon />
                </button>
              )}

              {/* Scrollable columns container */}
              <div
                ref={scrollRef}
                className="flex gap-4 pb-4 overflow-x-auto"
                style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}
              >
                {columnData.map((col) => (
                  <MemberColumn
                    key={col.name}
                    member={col.member}
                    incompleteTasks={col.incomplete}
                    completedTasks={col.completed}
                    onAddTask={() => openAddForm(col.name !== 'Unassigned' ? col.name : '')}
                    onToggle={toggle}
                    toggling={toggling}
                    openMenuId={openMenuId}
                    onOpenMenu={setOpenMenuId}
                    onEdit={openEditForm}
                    onDelete={confirmDelete}
                    deleting={deleting}
                    onRestore={restore}
                    restoring={restoring}
                    isMobile={false}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Empty state */}
          {!loading && columnData.every((col) => col.incomplete.length === 0 && col.completed.length === 0) && (
            <p className="text-center py-10" style={{ color: 'var(--warm-grey, #6B6774)', fontSize: 15 }}>
              {showAll ? 'No tasks yet. Add one to get started!' : 'Nothing due today!'}
            </p>
          )}
        </>
      )}
    </div>
  );
}
