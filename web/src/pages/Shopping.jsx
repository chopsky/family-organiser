import { useState, useEffect, useCallback } from 'react';
import api from '../lib/api';
import Spinner from '../components/Spinner';
import ErrorBanner from '../components/ErrorBanner';
import { IconCart } from '../components/Icons';

const CATEGORIES = ['groceries', 'clothing', 'household', 'school', 'pets', 'party', 'gifts', 'other'];

const CATEGORY_EMOJI = {
  groceries: '🛒', clothing: '👕', household: '🏠',
  school: '🎒', pets: '🐾', party: '🎉', gifts: '🎁', other: '📦',
};

const GROCERY_SUBCATEGORIES = [
  { key: 'dairy_eggs',         label: 'Dairy & Eggs',         emoji: '🥛' },
  { key: 'produce',            label: 'Produce',              emoji: '🥦' },
  { key: 'meat_seafood',       label: 'Meat & Seafood',       emoji: '🥩' },
  { key: 'pantry_grains',      label: 'Pantry / Grains',      emoji: '🍝' },
  { key: 'bakery',             label: 'Bakery',               emoji: '🍞' },
  { key: 'frozen',             label: 'Frozen Foods',         emoji: '🧊' },
  { key: 'beverages',          label: 'Beverages',            emoji: '☕' },
  { key: 'household_cleaning', label: 'Household / Cleaning', emoji: '🧹' },
  { key: 'personal_care',      label: 'Personal Care',        emoji: '🧴' },
  { key: 'other',              label: 'Other Groceries',      emoji: '🛒' },
];

const SUBCATEGORY_MAP = Object.fromEntries(GROCERY_SUBCATEGORIES.map(s => [s.key, s]));

export default function Shopping() {
  const [items, setItems]           = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');
  const [filter, setFilter]         = useState('');
  const [showCompleted, setShowCompleted] = useState(true);

  // Add form state
  const [addText, setAddText]       = useState('');
  const [addCat, setAddCat]         = useState('groceries');
  const [addSubcat, setAddSubcat]   = useState('');
  const [adding, setAdding]         = useState(false);
  const [toggling, setToggling]     = useState(new Set());
  const [restoring, setRestoring]   = useState(new Set());
  const [deleting, setDeleting]     = useState(new Set());

  const load = useCallback(async () => {
    try {
      const params = {};
      if (filter && filter !== 'groceries') params.category = filter;
      if (showCompleted) params.completed = 'true';
      // For groceries filter, we still fetch all and filter client-side to group by subcategory
      if (filter === 'groceries') params.category = 'groceries';
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
      const payload = { item: addText.trim(), category: addCat };
      if (addCat === 'groceries' && addSubcat) payload.subcategory = addSubcat;
      await api.post('/shopping', payload);
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

  // Group grocery items by subcategory
  const groceryItems = incomplete.filter(i => i.category === 'groceries');
  const nonGroceryItems = incomplete.filter(i => i.category !== 'groceries');

  // Build subcategory groups (only groups that have items)
  const groceryGroups = [];
  for (const sub of GROCERY_SUBCATEGORIES) {
    const groupItems = groceryItems.filter(i => (i.subcategory || 'other') === sub.key);
    if (groupItems.length > 0) {
      groceryGroups.push({ ...sub, items: groupItems });
    }
  }

  // Group non-grocery items by category
  const nonGroceryGroups = [];
  for (const cat of CATEGORIES.filter(c => c !== 'groceries')) {
    const groupItems = nonGroceryItems.filter(i => i.category === cat);
    if (groupItems.length > 0) {
      nonGroceryGroups.push({ key: cat, label: cat.charAt(0).toUpperCase() + cat.slice(1), emoji: CATEGORY_EMOJI[cat], items: groupItems });
    }
  }

  function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  const showGroceries = !filter || filter === 'groceries';
  const showNonGroceries = !filter || (filter && filter !== 'groceries');

  return (
    <div className="max-w-3xl mx-auto space-y-5">
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
      <form onSubmit={addItem} className="bg-linen rounded-2xl shadow-sm border border-cream-border p-4 space-y-2">
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            value={addText}
            onChange={(e) => setAddText(e.target.value)}
            placeholder="Add item…"
            className="flex-1 min-w-0 border border-cream-border rounded-2xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          />
          <div className="flex gap-2">
            <select
              value={addCat}
              onChange={(e) => { setAddCat(e.target.value); setAddSubcat(''); }}
              className="border border-cream-border rounded-2xl px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent bg-white"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{CATEGORY_EMOJI[c]} {c}</option>
              ))}
            </select>
            <button
              type="submit"
              disabled={adding || !addText.trim()}
              className="bg-primary hover:bg-primary-pressed disabled:bg-primary/50 text-white rounded-2xl px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap"
            >
              {adding ? '…' : '+ Add'}
            </button>
          </div>
        </div>
        {addCat === 'groceries' && (
          <select
            value={addSubcat}
            onChange={(e) => setAddSubcat(e.target.value)}
            className="border border-cream-border rounded-2xl px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent bg-white w-full"
          >
            <option value="">Auto-detect aisle</option>
            {GROCERY_SUBCATEGORIES.filter(s => s.key !== 'other').map((s) => (
              <option key={s.key} value={s.key}>{s.emoji} {s.label}</option>
            ))}
          </select>
        )}
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
          {incomplete.length === 0 && !showCompleted && (
            <p className="text-center text-cocoa py-8">All done! Nothing left to buy.</p>
          )}

          {/* Groceries grouped by aisle/subcategory */}
          {showGroceries && groceryGroups.length > 0 && (
            <div className="space-y-3">
              {!filter && <h2 className="text-sm font-semibold text-bark uppercase tracking-wide flex items-center gap-1.5">🛒 Groceries</h2>}
              {groceryGroups.map((group) => (
                <div key={group.key} className="bg-linen rounded-2xl shadow-sm border border-cream-border overflow-hidden">
                  <div className="px-4 py-2 bg-oat/50 border-b border-cream-border">
                    <h3 className="text-xs font-semibold text-bark uppercase tracking-wide">{group.emoji} {group.label}</h3>
                  </div>
                  <ul className="divide-y divide-cream-border">
                    {group.items.map((item) => (
                      <ItemRow key={item.id} item={item} toggle={toggle} loading={toggling.has(item.id)} showCategory={false} />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {/* Non-grocery items grouped by category */}
          {showNonGroceries && nonGroceryGroups.map((group) => (
            <div key={group.key} className="space-y-2">
              {!filter && <h2 className="text-sm font-semibold text-bark uppercase tracking-wide flex items-center gap-1.5">{group.emoji} {group.label}</h2>}
              <ul className="space-y-2">
                {group.items.map((item) => (
                  <ItemRow key={item.id} item={item} toggle={toggle} loading={toggling.has(item.id)} showCategory={filter ? false : false} />
                ))}
              </ul>
            </div>
          ))}

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
                          {CATEGORY_EMOJI[item.category] || '📦'} {item.category}
                          {item.subcategory && SUBCATEGORY_MAP[item.subcategory] && (
                            <> · {SUBCATEGORY_MAP[item.subcategory].label}</>
                          )}
                        </span>
                        {item.completed_at && (
                          <span className="text-xs text-cocoa">Purchased: {formatDate(item.completed_at)}</span>
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

function ItemRow({ item, toggle, loading, showCategory = true }) {
  return (
    <li className="bg-linen px-4 py-3 flex items-center gap-3">
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
      {showCategory && (
        <span className="text-xs text-cocoa shrink-0">
          {CATEGORY_EMOJI[item.category]} {item.category}
        </span>
      )}
    </li>
  );
}
