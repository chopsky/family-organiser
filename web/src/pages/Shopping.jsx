import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../lib/api';
import Spinner from '../components/Spinner';
import ErrorBanner from '../components/ErrorBanner';
import { IconCart } from '../components/Icons';

const CATEGORIES = ['groceries', 'clothing', 'household', 'school', 'pets', 'party', 'gifts', 'other'];

const CATEGORY_EMOJI = {
  groceries: '🥦', clothing: '👕', household: '🏠',
  school: '🎒', pets: '🐾', party: '🎉', gifts: '🎁', other: '📦',
};

export default function Shopping() {
  const [items, setItems]           = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');
  const [filter, setFilter]         = useState('');          // category filter
  const [showCompleted, setShowCompleted] = useState(true);

  // Add form state
  const [addText, setAddText]       = useState('');
  const [addCat, setAddCat]         = useState('groceries');
  const [adding, setAdding]         = useState(false);
  const [toggling, setToggling]     = useState(new Set());
  const [restoring, setRestoring]   = useState(new Set());
  const [deleting, setDeleting]     = useState(new Set());

  // Edit popup state
  const [editItem, setEditItem]     = useState(null);
  const [editName, setEditName]     = useState('');
  const [editQty, setEditQty]       = useState('');
  const [editUnit, setEditUnit]     = useState('');
  const [editDesc, setEditDesc]     = useState('');
  const [editCat, setEditCat]       = useState('');
  const [saving, setSaving]         = useState(false);
  const popupRef = useRef(null);

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

  // Close popup on outside click
  useEffect(() => {
    if (!editItem) return;
    function handleClick(e) {
      if (popupRef.current && !popupRef.current.contains(e.target)) {
        setEditItem(null);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [editItem]);

  function openEdit(item) {
    setEditItem(item);
    setEditName(item.item || '');
    setEditQty(item.quantity || '');
    setEditUnit(item.unit || '');
    setEditDesc(item.description || '');
    setEditCat(item.category || 'other');
  }

  async function saveEdit() {
    if (!editItem || !editName.trim()) return;
    setSaving(true);
    try {
      await api.patch(`/shopping/${editItem.id}`, {
        item: editName.trim(),
        quantity: editQty.trim() || null,
        unit: editUnit.trim() || null,
        description: editDesc.trim() || null,
        category: editCat,
      });
      setEditItem(null);
      await load();
    } catch {
      setError('Could not update item.');
    } finally {
      setSaving(false);
    }
  }

  async function deleteFromEdit() {
    if (!editItem) return;
    if (!window.confirm(`Delete "${editItem.item}"? This can't be undone.`)) return;
    try {
      await api.delete(`/shopping/${editItem.id}`);
      setEditItem(null);
      await load();
    } catch {
      setError('Could not delete item.');
    }
  }

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
      <form onSubmit={addItem} className="bg-linen rounded-2xl shadow-sm border border-cream-border p-4 flex flex-wrap gap-2">
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
            className="bg-primary hover:bg-primary-pressed disabled:bg-primary/50 text-white rounded-2xl px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap"
          >
            {adding ? '…' : '+ Add'}
          </button>
        </div>
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
              <ItemRow key={item.id} item={item} toggle={toggle} loading={toggling.has(item.id)} onEdit={openEdit} />
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
                    <button onClick={() => openEdit(item)} className="flex-1 min-w-0 text-left">
                      <p className="text-sm text-cocoa">{item.item}</p>
                      <div className="flex gap-x-3 mt-0.5">
                        <span className="text-xs text-cocoa">
                          {CATEGORY_EMOJI[item.category]} {item.category}
                        </span>
                        {item.completed_at && (
                          <span className="text-xs text-cocoa">Last purchased: {formatDate(item.completed_at)}</span>
                        )}
                      </div>
                    </button>
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

      {/* Edit item popup */}
      {editItem && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div
            ref={popupRef}
            className="bg-linen w-full sm:w-[420px] sm:rounded-2xl rounded-t-2xl shadow-lg border border-cream-border p-5 space-y-4 max-h-[80vh] overflow-y-auto"
          >
            {/* Item name */}
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="w-full text-lg font-semibold text-bark bg-transparent border-b border-cream-border pb-2 focus:outline-none focus:border-primary"
              placeholder="Item name"
            />

            {/* Qty + Unit row */}
            <div className="flex items-center gap-3">
              <span className="text-cocoa shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><line x1="3" x2="21" y1="6" y2="6" />
                </svg>
              </span>
              <input
                type="text"
                inputMode="numeric"
                value={editQty}
                onChange={(e) => setEditQty(e.target.value)}
                placeholder="Qty"
                className="flex-1 border border-cream-border rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent"
              />
              <input
                type="text"
                value={editUnit}
                onChange={(e) => setEditUnit(e.target.value)}
                placeholder="Unit (kg, litres, packs…)"
                className="flex-1 border border-cream-border rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>

            {/* Category */}
            <div className="flex items-center gap-3">
              <span className="text-cocoa shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 9h16" /><path d="M4 15h16" /><path d="M10 3 8 21" /><path d="M16 3l-2 18" />
                </svg>
              </span>
              <select
                value={editCat}
                onChange={(e) => setEditCat(e.target.value)}
                className="flex-1 border border-cream-border rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{CATEGORY_EMOJI[c]} {c}</option>
                ))}
              </select>
            </div>

            {/* Description */}
            <div className="flex items-start gap-3">
              <span className="text-cocoa shrink-0 mt-2.5">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" /><polyline points="14 2 14 8 20 8" /><line x1="16" x2="8" y1="13" y2="13" /><line x1="16" x2="8" y1="17" y2="17" />
                </svg>
              </span>
              <textarea
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                placeholder="Add description"
                rows={2}
                className="flex-1 border border-cream-border rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent resize-none"
              />
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between pt-2">
              <button
                onClick={deleteFromEdit}
                className="flex items-center gap-1.5 text-sm text-error hover:text-error/80 transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                Delete
              </button>
              <div className="flex gap-2">
                <button
                  onClick={() => setEditItem(null)}
                  className="px-4 py-2 text-sm font-medium text-cocoa bg-oat hover:bg-cream-border rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={saveEdit}
                  disabled={saving || !editName.trim()}
                  className="px-5 py-2 text-sm font-medium text-white bg-primary hover:bg-primary-pressed disabled:bg-primary/50 rounded-xl transition-colors"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ItemRow({ item, toggle, loading, onEdit }) {
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
      <button onClick={() => onEdit(item)} className="flex-1 min-w-0 text-left">
        <div className="flex items-baseline gap-1.5">
          <span className={`text-sm ${item.completed ? 'line-through text-cocoa' : 'text-bark'}`}>
            {item.item}
          </span>
          {(item.quantity || item.unit) && (
            <span className="text-cocoa text-xs">
              ({[item.quantity, item.unit].filter(Boolean).join(' ')})
            </span>
          )}
        </div>
        {item.description && (
          <p className="text-xs text-cocoa mt-0.5 truncate">{item.description}</p>
        )}
      </button>
      <span className="text-xs text-cocoa shrink-0">
        {CATEGORY_EMOJI[item.category]} {item.category}
      </span>
    </li>
  );
}
