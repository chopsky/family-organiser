import { useState, useEffect, useCallback } from 'react';
import api from '../lib/api';
import Spinner from '../components/Spinner';
import ErrorBanner from '../components/ErrorBanner';
import { IconCheck, IconUser, IconCalendar } from '../components/Icons';

const PRIORITY_COLORS = { high: 'bg-[#d76353]', medium: 'bg-[#e5ad57]', low: 'bg-[#9db36c]' };
const PRIORITY_LABELS = { high: 'High', medium: 'Medium', low: 'Low' };
const PRIORITY_CYCLE = { low: 'medium', medium: 'high', high: 'low' };
const RECURRENCES = ['', 'daily', 'weekly', 'biweekly', 'monthly', 'yearly'];

function PriorityDot({ priority, className = 'w-3 h-3' }) {
  return <span className={`${className} rounded-full inline-block ${PRIORITY_COLORS[priority] || PRIORITY_COLORS.medium}`} />;
}

function daysOverdue(dueDate) {
  const due  = new Date(dueDate + 'T00:00:00');
  const now  = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.floor((now - due) / 86400000);
}

export default function Tasks() {
  const [tasks, setTasks]       = useState([]);
  const [recentDone, setRecentDone] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [showAll, setShowAll]   = useState(false);
  const [toggling, setToggling] = useState(new Set());
  const [restoring, setRestoring] = useState(new Set());
  const [deleting, setDeleting] = useState(new Set());
  const [updating, setUpdating] = useState(new Set());

  // Add form
  const [title, setTitle]         = useState('');
  const [dueDate, setDueDate]     = useState(today());
  const [assignee, setAssignee]   = useState('');
  const [recurrence, setRecurrence] = useState('');
  const [priority, setPriority]   = useState('medium');
  const [adding, setAdding]       = useState(false);
  const [members, setMembers]     = useState([]);
  const [showForm, setShowForm]   = useState(false);

  function today() {
    return new Date().toISOString().split('T')[0];
  }

  const load = useCallback(async () => {
    try {
      const params = showAll ? { all: 'true' } : {};
      const [tasksRes, recentRes] = await Promise.all([
        api.get('/tasks', { params }),
        api.get('/tasks/recent'),
      ]);
      setTasks(tasksRes.data.tasks ?? []);
      setRecentDone(recentRes.data.tasks ?? []);
    } catch {
      setError('Could not load tasks.');
    } finally {
      setLoading(false);
    }
  }, [showAll]);

  useEffect(() => {
    setLoading(true);
    load();
    // Load members for assignee dropdown
    api.get('/household').then(({ data }) => setMembers(data.members ?? [])).catch(() => {});
  }, [load]);

  // Group tasks by assignee
  const groupedTasks = (() => {
    const groups = {};
    const memberNames = members.map((m) => m.name);
    for (const name of memberNames) groups[name] = [];
    for (const task of tasks) {
      const key = task.assigned_to_name || 'Unassigned';
      if (!groups[key]) groups[key] = [];
      groups[key].push(task);
    }
    // Return entries: member groups first (in order), then Unassigned last
    const entries = memberNames.filter((n) => groups[n]?.length > 0).map((n) => [n, groups[n]]);
    if (groups['Unassigned']?.length > 0) entries.push(['Unassigned', groups['Unassigned']]);
    return entries;
  })();

  async function addTask(e) {
    e.preventDefault();
    if (!title.trim()) return;
    setAdding(true);
    try {
      const payload = { title: title.trim(), due_date: dueDate, priority };
      if (assignee) payload.assigned_to_name = assignee;
      if (recurrence) payload.recurrence = recurrence;
      await api.post('/tasks', payload);
      setTitle(''); setAssignee(''); setRecurrence(''); setPriority('medium'); setDueDate(today());
      setShowForm(false);
      await load();
    } catch {
      setError('Could not add task.');
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

  async function cyclePriority(task) {
    const next = PRIORITY_CYCLE[task.priority] || 'medium';
    setUpdating((s) => new Set([...s, task.id]));
    try {
      await api.patch(`/tasks/${task.id}`, { priority: next });
      await load();
    } catch {
      setError('Could not update priority.');
    } finally {
      setUpdating((s) => { const n = new Set(s); n.delete(task.id); return n; });
    }
  }

  function timeAgo(dateStr) {
    const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}h ago`;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-bark flex items-center gap-2">
          <IconCheck className="h-6 w-6" /> Tasks
        </h1>
        <div className="flex gap-3">
          <button
            onClick={() => setShowAll((v) => !v)}
            className="text-sm text-primary hover:underline"
          >
            {showAll ? 'Due today' : 'All tasks'}
          </button>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="bg-primary hover:bg-primary-pressed text-white text-sm font-medium px-3 py-1.5 rounded-2xl transition-colors"
          >
            + Add
          </button>
        </div>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError('')} />

      {/* Add task form */}
      {showForm && (
        <form onSubmit={addTask} className="bg-linen rounded-2xl shadow-sm border border-cream-border p-4 space-y-3">
          <h2 className="font-semibold text-bark">New task</h2>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Task title"
            required
            className="w-full border border-cream-border rounded-2xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-cocoa mb-1 block">Due date</label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full border border-cream-border rounded-2xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
            <div>
              <label className="text-xs text-cocoa mb-1 block">Assign to</label>
              <select
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                className="w-full border border-cream-border rounded-2xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent"
              >
                <option value="">Everyone</option>
                {members.map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-cocoa mb-1 block">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="w-full border border-cream-border rounded-2xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-cocoa mb-1 block">Repeats</label>
              <select
                value={recurrence}
                onChange={(e) => setRecurrence(e.target.value)}
                className="w-full border border-cream-border rounded-2xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent"
              >
                {RECURRENCES.map((r) => <option key={r} value={r}>{r || 'Never'}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="text-sm text-cocoa hover:text-bark px-3 py-2"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={adding || !title.trim()}
              className="bg-primary hover:bg-primary-pressed disabled:bg-primary/50 text-white text-sm font-medium px-4 py-2 rounded-2xl transition-colors"
            >
              {adding ? 'Adding...' : 'Add task'}
            </button>
          </div>
        </form>
      )}

      {loading ? <Spinner /> : tasks.length === 0 ? (
        <p className="text-center text-cocoa py-10">
          {showAll ? 'All tasks complete!' : 'Nothing due today!'}
        </p>
      ) : (
        <div className="space-y-5">
          {groupedTasks.map(([groupName, groupTasks]) => (
            <div key={groupName}>
              <h2 className="text-sm font-semibold text-cocoa uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <IconUser className="h-3.5 w-3.5" /> {groupName}
              </h2>
              <ul className="space-y-2">
                {groupTasks.map((task) => {
                  const overdue = daysOverdue(task.due_date);
                  const dueToday = overdue === 0;
                  return (
                    <li key={task.id} className="bg-linen rounded-2xl shadow-sm border border-cream-border px-4 py-3 flex items-start gap-3">
                      <button
                        onClick={() => toggle(task)}
                        disabled={toggling.has(task.id)}
                        className={`mt-0.5 w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                          task.completed
                            ? 'bg-success border-success text-white'
                            : 'border-cream-border hover:border-primary'
                        }`}
                      >
                        {task.completed && '✓'}
                      </button>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium flex items-center gap-1.5 ${task.completed ? 'line-through text-cocoa' : 'text-bark'}`}>
                          <button
                            onClick={(e) => { e.stopPropagation(); cyclePriority(task); }}
                            disabled={updating.has(task.id) || task.completed}
                            className="inline-flex items-center hover:scale-125 transition-transform disabled:hover:scale-100"
                            title={`Priority: ${PRIORITY_LABELS[task.priority]} (tap to change)`}
                          >
                            {updating.has(task.id)
                              ? <span className="w-3 h-3 rounded-full bg-cocoa animate-pulse" />
                              : <PriorityDot priority={task.priority} />
                            }
                          </button>
                          {task.title}
                        </p>
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                          <span className={`text-xs font-medium flex items-center gap-1 ${
                            task.completed ? 'text-cocoa' :
                            overdue > 0   ? 'text-error' :
                            dueToday      ? 'text-warn' : 'text-cocoa'
                          }`}>
                            {task.completed ? 'Done' :
                             overdue > 0   ? <><span className="w-2 h-2 rounded-full bg-[#d76353] inline-block" /> {overdue}d overdue</> :
                             dueToday      ? <><span className="w-2 h-2 rounded-full bg-[#e5ad57] inline-block" /> Due today</> :
                             <><IconCalendar className="h-3 w-3" /> {task.due_date}</>}
                          </span>
                          {task.recurrence && (
                            <span className="text-xs text-cocoa">[{task.recurrence}]</span>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}

      {/* Recently Completed (last 24h) */}
      {!loading && recentDone.length > 0 && (
        <div className="mt-6">
          <h2 className="text-sm font-semibold text-cocoa uppercase tracking-wide mb-2">
            Recently completed
          </h2>
          <ul className="space-y-2">
            {recentDone.map((task) => (
              <li key={task.id} className="bg-oat rounded-2xl border border-cream-border px-4 py-3 flex items-center gap-3">
                <div className="w-6 h-6 rounded-full bg-success/20 text-success flex items-center justify-center shrink-0 text-xs font-bold">
                  ✓
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-cocoa line-through">{task.title}</p>
                  <div className="flex gap-x-3 mt-0.5">
                    {task.assigned_to_name && (
                      <span className="text-xs text-cocoa flex items-center gap-1">
                        <IconUser className="h-3 w-3" /> {task.assigned_to_name}
                      </span>
                    )}
                    <span className="text-xs text-cocoa">{timeAgo(task.completed_at)}</span>
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => restore(task)}
                    disabled={restoring.has(task.id)}
                    className="text-xs font-medium text-warn hover:text-warn bg-warn/10 hover:bg-warn/20 px-3 py-1.5 rounded-2xl transition-colors"
                  >
                    {restoring.has(task.id) ? '...' : 'Restore'}
                  </button>
                  <button
                    onClick={() => confirmDelete(task)}
                    disabled={deleting.has(task.id)}
                    className="text-xs text-error hover:text-error hover:bg-error/10 p-1.5 rounded-2xl transition-colors"
                    title="Delete permanently"
                  >
                    {deleting.has(task.id) ? '...' : (
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                    )}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
