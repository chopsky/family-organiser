import { useState, useEffect, useCallback } from 'react';
import api from '../lib/api';
import Spinner from '../components/Spinner';
import ErrorBanner from '../components/ErrorBanner';

const PRIORITIES = { high: '🔴', medium: '🟡', low: '🟢' };
const RECURRENCES = ['', 'daily', 'weekly', 'biweekly', 'monthly', 'yearly'];

function daysOverdue(dueDate) {
  const due  = new Date(dueDate + 'T00:00:00');
  const now  = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.floor((now - due) / 86400000);
}

export default function Tasks() {
  const [tasks, setTasks]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [showAll, setShowAll]   = useState(false);
  const [toggling, setToggling] = useState(new Set());

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
      const { data } = await api.get('/tasks', { params });
      setTasks(data.tasks ?? []);
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

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">✅ Tasks</h1>
        <div className="flex gap-3">
          <button
            onClick={() => setShowAll((v) => !v)}
            className="text-sm text-emerald-600 hover:underline"
          >
            {showAll ? 'Due today' : 'All tasks'}
          </button>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium px-3 py-1.5 rounded-lg transition-colors"
          >
            + Add
          </button>
        </div>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError('')} />

      {/* Add task form */}
      {showForm && (
        <form onSubmit={addTask} className="bg-white rounded-xl shadow-sm border border-emerald-100 p-4 space-y-3">
          <h2 className="font-semibold text-gray-800">New task</h2>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Task title"
            required
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Due date</label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Assign to</label>
              <select
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                <option value="">Everyone</option>
                {members.map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                <option value="low">🟢 Low</option>
                <option value="medium">🟡 Medium</option>
                <option value="high">🔴 High</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Repeats</label>
              <select
                value={recurrence}
                onChange={(e) => setRecurrence(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                {RECURRENCES.map((r) => <option key={r} value={r}>{r || 'Never'}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="text-sm text-gray-500 hover:text-gray-700 px-3 py-2"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={adding || !title.trim()}
              className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              {adding ? 'Adding…' : 'Add task'}
            </button>
          </div>
        </form>
      )}

      {loading ? <Spinner /> : tasks.length === 0 ? (
        <p className="text-center text-gray-400 py-10">
          {showAll ? '🎉 All tasks complete!' : '✅ Nothing due today!'}
        </p>
      ) : (
        <ul className="space-y-2">
          {tasks.map((task) => {
            const overdue = daysOverdue(task.due_date);
            const dueToday = overdue === 0;
            return (
              <li key={task.id} className="bg-white rounded-xl shadow-sm border border-gray-100 px-4 py-3 flex items-start gap-3">
                <button
                  onClick={() => toggle(task)}
                  disabled={toggling.has(task.id)}
                  className={`mt-0.5 w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                    task.completed
                      ? 'bg-green-500 border-green-500 text-white'
                      : 'border-gray-300 hover:border-emerald-400'
                  }`}
                >
                  {task.completed && '✓'}
                </button>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${task.completed ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                    {PRIORITIES[task.priority]} {task.title}
                  </p>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                    {task.assigned_to_name && (
                      <span className="text-xs text-gray-400">👤 {task.assigned_to_name}</span>
                    )}
                    <span className={`text-xs font-medium ${
                      task.completed ? 'text-gray-400' :
                      overdue > 0   ? 'text-red-500' :
                      dueToday      ? 'text-amber-500' : 'text-gray-400'
                    }`}>
                      {task.completed ? `Done` :
                       overdue > 0   ? `🔴 ${overdue}d overdue` :
                       dueToday      ? '🟡 Due today' :
                       `📅 ${task.due_date}`}
                    </span>
                    {task.recurrence && (
                      <span className="text-xs text-gray-400">[{task.recurrence}]</span>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
