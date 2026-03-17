import { useState, useEffect, useCallback } from 'react';
import api from '../lib/api';
import Spinner from '../components/Spinner';
import ErrorBanner from '../components/ErrorBanner';
import { IconCart } from '../components/Icons';

const CATEGORIES = ['groceries', 'clothing', 'household', 'school', 'pets', 'other'];

const CATEGORY_EMOJI = {
  groceries: '🥦', clothing: '👕', household: '🏠',
  school: '🎒', pets: '🐾', other: '📦',
};

export default function Shopping() {
  const [items, setItems]           = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');
  const [filter, setFilter]         = useState('');          // category filter
  const [showCompleted, setShowCompleted] = useState(false);

  // Add form state
  const [addText, setAddText]       = useState('');
  const [addCat, setAddCat]         = useState('groceries');
  const [adding, setAdding]         = useState(false);
  const [toggling, setToggling]     = useState(new Set());
  const [restoring, setRestoring]   = useState(new Set());
  const [deleting, setDeleting]     = useState(new Set());

  const load = useCallback(async () => {
    try {
      const params = {};
      if (filter) params.category = filter;
      if (showCompleted) params.completed = 'true';
      const res = await api.get('/shopping', { params });
      setItems(res.data.items ?? []);
    } catch {
      setError('Could not load shopping list.');
    } finally {
      setLoading(false);
    }
  }, [filter, showCompleted]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  async function addItem(e) {
    e.preventDefault();
    if (!addText.trim()) return;
    setAdding(true);
    try {
      await api.post('/shopping', { item: addText.trim(), category: addCat });
      setAddText('');
      await load();
    } catch {
      setError('Could not add item.');
    } finally {
      setAdding(false);
    }
  }

  async function restore(item) {
    setRestoring((s) => new Set([...s, item.id]));
    try {
      await api.patch(`/shopping/${item.id}`, { completed: false });
      await load();
    } catch {
      setError('Could not restore item.');
    } finally {
      setRestoring((s) => { const n = new Set(s); n.delete(item.id); return n; });
    }
  }

  async function confirmDelete(item) {
    if (!window.confirm(`Delete "${item.item}"? This can't be undone.`)) return;
    setDeleting((s) => new Set([...s, item.id]));
    try {
      await api.delete(`/shopping/${item.id}`);
      await load();
    } catch {
      setError('Could not delete item.');
    } finally {
      setDeleting((s) => { const n = new Set(s); n.delete(item.id); return n; });
    }
  }

  async function toggle(item) {
    setToggling((s) => new Set([...s, item.id]));
    try {
      await api.patch(`/shopping/${item.id}`, { completed: !item.completed });
      await load();
    } catch {
      setError('Could not update item.');
    } finally {
      setToggling((s) => { const n = new Set(s); n.delete(item.id); return n; });
    }
  }

  const incomplete = items.filter((i) => !i.completed);
  const complete   = items.filter((i) => i.completed)
    .sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at));

  function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-bark flex items-center gap-2"><IconCart className="h-6 w-6" /> Shopping</h1>
        <button
          onClick={() => setShowCompleted((v) => !v)}
          className="text-sm text-primary hover:underline"
        >
          {showCompleted ? 'Hide purchased' : 'Show purchased'}
        </button>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError('')} />

      {/* Add item */}
      <form onSubmit={addItem} className="bg-linen rounded-2xl shadow-sm border border-cream-border p-4 flex gap-2">
        <input
          type="text"
          value={addText}
          onChange={(e) => setAddText(e.target.value)}
          placeholder="Add item…"
          className="flex-1 border border-cream-border rounded-2xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
        />
        <select
          value={addCat}
          onChange={(e) => setAddCat(e.target.value)}
          className="border border-cream-border rounded-2xl px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent bg-white"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{CATEGORY_EMOJI[c]} {c}</option>
          ))}
        </select>
        <button
          type="submit"
          disabled={adding || !addText.trim()}
          className="bg-primary hover:bg-primary-pressed disabled:bg-primary/50 text-white rounded-2xl px-4 py-2 text-sm font-medium transition-colors"
        >
          {adding ? '…' : '+ Add'}
        </button>
      </form>

      {/* Category filter */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        <button
          onClick={() => setFilter('')}
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            !filter ? 'bg-primary text-white' : 'bg-oat text-cocoa hover:bg-secondary/30'
          }`}
        >
          All
        </button>
        {CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => setFilter(c === filter ? '' : c)}
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              filter === c ? 'bg-primary text-white' : 'bg-oat text-cocoa hover:bg-secondary/30'
            }`}
          >
            {CATEGORY_EMOJI[c]} {c}
          </button>
        ))}
      </div>

      {loading ? <Spinner /> : (
        <>
          {/* Incomplete items */}
          {incomplete.length === 0 && !showCompleted && (
            <p className="text-center text-cocoa py-8">All done! Nothing left to buy.</p>
          )}
          <ul className="space-y-2">
            {incomplete.map((item) => (
              <ItemRow key={item.id} item={item} toggle={toggle} loading={toggling.has(item.id)} />
            ))}
          </ul>

          {/* Completed items */}
          {showCompleted && complete.length > 0 && (
            <>
              <h2 className="text-sm font-semibold text-cocoa uppercase tracking-wide mt-4">Previously purchased</h2>
              <ul className="space-y-2">
                {complete.map((item) => (
                  <li key={item.id} className="bg-oat rounded-2xl border border-cream-border px-4 py-3 flex items-center gap-3">
                    <div className="w-6 h-6 rounded-full bg-success/20 text-success flex items-center justify-center shrink-0 text-xs font-bold">
                      ✓
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-cocoa">{item.item}</p>
                      <div className="flex gap-x-3 mt-0.5">
                        <span className="text-xs text-cocoa">
                          {CATEGORY_EMOJI[item.category]} {item.category}
                        </span>
                        {item.completed_at && (
                          <span className="text-xs text-cocoa">Last purchased: {formatDate(item.completed_at)}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={() => restore(item)}
                        disabled={restoring.has(item.id)}
                        className="text-xs font-medium text-warn hover:text-warn bg-warn/10 hover:bg-warn/20 px-3 py-1.5 rounded-2xl transition-colors"
                      >
                        {restoring.has(item.id) ? '…' : 'Restore'}
                      </button>
                      <button
                        onClick={() => confirmDelete(item)}
                        disabled={deleting.has(item.id)}
                        className="text-xs text-error hover:text-error hover:bg-error/10 p-1.5 rounded-2xl transition-colors"
                        title="Delete permanently"
                      >
                        {deleting.has(item.id) ? '…' : (
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                          </svg>
                        )}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}

function ItemRow({ item, toggle, loading }) {
  return (
    <li className="bg-linen rounded-2xl shadow-sm border border-cream-border px-4 py-3 flex items-center gap-3">
      <button
        onClick={() => toggle(item)}
        disabled={loading}
        className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
          item.completed
            ? 'bg-success border-success text-white'
            : 'border-cream-border hover:border-primary'
        }`}
      >
        {item.completed && '✓'}
      </button>
      <div className="flex-1 min-w-0">
        <span className={`text-sm ${item.completed ? 'line-through text-cocoa' : 'text-bark'}`}>
          {item.item}
        </span>
        {item.quantity && (
          <span className="text-cocoa text-xs ml-1">({item.quantity})</span>
        )}
      </div>
      <span className="text-xs text-cocoa shrink-0">
        {CATEGORY_EMOJI[item.category]} {item.category}
      </span>
    </li>
  );
}
