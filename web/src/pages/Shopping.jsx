import { useState, useEffect, useCallback } from 'react';
import api from '../lib/api';
import Spinner from '../components/Spinner';
import ErrorBanner from '../components/ErrorBanner';

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

  const load = useCallback(async () => {
    try {
      const params = {};
      if (filter) params.category = filter;
      if (showCompleted) params.completed = 'true';
      const { data } = await api.get('/shopping', { params });
      setItems(data.items ?? []);
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
  const complete   = items.filter((i) => i.completed);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">🛒 Shopping</h1>
        <button
          onClick={() => setShowCompleted((v) => !v)}
          className="text-sm text-emerald-600 hover:underline"
        >
          {showCompleted ? 'Hide done' : 'Show done'}
        </button>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError('')} />

      {/* Add item */}
      <form onSubmit={addItem} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex gap-2">
        <input
          type="text"
          value={addText}
          onChange={(e) => setAddText(e.target.value)}
          placeholder="Add item…"
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
        <select
          value={addCat}
          onChange={(e) => setAddCat(e.target.value)}
          className="border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{CATEGORY_EMOJI[c]} {c}</option>
          ))}
        </select>
        <button
          type="submit"
          disabled={adding || !addText.trim()}
          className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors"
        >
          {adding ? '…' : '+ Add'}
        </button>
      </form>

      {/* Category filter */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        <button
          onClick={() => setFilter('')}
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            !filter ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          All
        </button>
        {CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => setFilter(c === filter ? '' : c)}
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              filter === c ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
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
            <p className="text-center text-gray-400 py-8">✅ All done! Nothing left to buy.</p>
          )}
          <ul className="space-y-2">
            {incomplete.map((item) => (
              <ItemRow key={item.id} item={item} toggle={toggle} loading={toggling.has(item.id)} />
            ))}
          </ul>

          {/* Completed items */}
          {showCompleted && complete.length > 0 && (
            <>
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mt-4">Completed</h2>
              <ul className="space-y-2 opacity-60">
                {complete.map((item) => (
                  <ItemRow key={item.id} item={item} toggle={toggle} loading={toggling.has(item.id)} />
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
    <li className="bg-white rounded-xl shadow-sm border border-gray-100 px-4 py-3 flex items-center gap-3">
      <button
        onClick={() => toggle(item)}
        disabled={loading}
        className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
          item.completed
            ? 'bg-green-500 border-green-500 text-white'
            : 'border-gray-300 hover:border-emerald-400'
        }`}
      >
        {item.completed && '✓'}
      </button>
      <div className="flex-1 min-w-0">
        <span className={`text-sm ${item.completed ? 'line-through text-gray-400' : 'text-gray-800'}`}>
          {item.item}
        </span>
        {item.quantity && (
          <span className="text-gray-400 text-xs ml-1">({item.quantity})</span>
        )}
      </div>
      <span className="text-xs text-gray-400 shrink-0">
        {CATEGORY_EMOJI[item.category]} {item.category}
      </span>
    </li>
  );
}
