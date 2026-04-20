import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../lib/api';
import { AISLE_CATEGORIES, AISLE_CONFIG, getItemEmoji } from '../lib/shopping-constants';
import Spinner from '../components/Spinner';
import ErrorBanner from '../components/ErrorBanner';

function AisleIcon({ aisle, stroke }) {
  const props = {
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke,
    strokeWidth: 1.5,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  };

  switch (aisle) {
    case 'Meat & Seafood':
      return (
        <svg {...props}>
          <path d="M6 12c0-4 2-8 6-9 4 1 6 5 6 9s-2 8-6 9c-4-1-6-5-6-9z" />
          <path d="M12 3v18" />
        </svg>
      );
    case 'Produce':
      return (
        <svg {...props}>
          <path d="M7 20c0 0 1-6 5-10s10-5 10-5-1 6-5 10-10 5-10 5z" />
          <path d="M7 20L17 5" />
        </svg>
      );
    case 'Dairy & Eggs':
      return (
        <svg {...props}>
          <path d="M8 2h8l2 6v10a2 2 0 01-2 2H8a2 2 0 01-2-2V8l2-6z" />
          <path d="M6 8h12" />
        </svg>
      );
    case 'Pantry & Grains':
      return (
        <svg {...props}>
          <path d="M12 2v8m0 0c-3 0-8 1-8 6v4a2 2 0 002 2h12a2 2 0 002-2v-4c0-5-5-6-8-6z" />
        </svg>
      );
    case 'Bakery':
      return (
        <svg {...props}>
          <path d="M5 12c0-4 3-7 7-7s7 3 7 7" />
          <rect x="4" y="12" width="16" height="8" rx="2" />
        </svg>
      );
    case 'Frozen Foods':
      return (
        <svg {...props}>
          <path d="M12 2v20M2 12h20M4.93 4.93l14.14 14.14M19.07 4.93L4.93 19.07" />
        </svg>
      );
    case 'Beverages':
      return (
        <svg {...props}>
          <path d="M17 8h1a4 4 0 010 8h-1M3 8h14v9a4 4 0 01-4 4H7a4 4 0 01-4-4V8z" />
        </svg>
      );
    case 'Household & Cleaning':
      return (
        <svg {...props}>
          <path d="M12 2L2 7l10 5 10-5-10-5z" />
          <path d="M2 17l10 5 10-5M2 12l10 5 10-5" />
        </svg>
      );
    case 'Personal Care':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
        </svg>
      );
    case 'Other':
    default:
      return (
        <svg {...props}>
          <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
        </svg>
      );
  }
}

export default function Shopping() {
  const [lists, setLists] = useState([]);
  const [activeListId, setActiveListId] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [addText, setAddText] = useState('');
  const [addAisle, setAddAisle] = useState('auto');
  const [adding, setAdding] = useState(false);
  const [collapsedAisles, setCollapsedAisles] = useState(new Set());
  const [showPurchased, setShowPurchased] = useState(true);
  const [newListName, setNewListName] = useState('');
  const [showNewListInput, setShowNewListInput] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [editFields, setEditFields] = useState({});

  // Load lists on mount
  const loadLists = useCallback(async () => {
    try {
      const res = await api.get('/shopping-lists');
      const raw = res.data?.lists ?? res.data;
      const fetched = Array.isArray(raw) ? raw : [];
      setLists(fetched);
      if (fetched.length > 0 && !activeListId) {
        setActiveListId(fetched[0].id);
      }
    } catch {
      setError('Could not load shopping lists.');
    }
  }, []);

  useEffect(() => {
    loadLists();
  }, [loadLists]);

  // Load items when active list changes
  const loadItems = useCallback(async () => {
    if (!activeListId) return;
    setLoading(true);
    try {
      const res = await api.get('/shopping', { params: { list_id: activeListId, completed: 'true' } });
      const rawItems = res.data?.items ?? res.data;
      setItems(Array.isArray(rawItems) ? rawItems : []);
    } catch {
      setError('Could not load shopping items.');
    } finally {
      setLoading(false);
    }
  }, [activeListId]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  // Computed values
  const incompleteItems = items.filter(i => !i.completed);
  const completedItems = items.filter(i => i.completed).sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at));

  const groupedByAisle = AISLE_CATEGORIES
    .map(aisle => [aisle, incompleteItems.filter(i => (i.aisle_category || 'Other') === aisle)])
    .filter(([, aisleItems]) => aisleItems.length > 0);

  const itemCount = incompleteItems.length;

  // Handlers
  async function addItem() {
    if (!addText.trim()) return;
    setAdding(true);
    try {
      const payload = { item: addText.trim(), list_id: activeListId };
      if (addAisle !== 'auto') payload.aisle_category = addAisle;
      await api.post('/shopping', payload);
      setAddText('');
      await loadItems();
    } catch {
      setError('Could not add item.');
    } finally {
      setAdding(false);
    }
  }

  async function toggleItem(item) {
    try {
      await api.patch(`/shopping/${item.id}`, { completed: !item.completed });
      await loadItems();
    } catch {
      setError('Could not update item.');
    }
  }

  async function deleteItem(id) {
    try {
      await api.delete(`/shopping/${id}`);
      await loadItems();
    } catch {
      setError('Could not delete item.');
    }
  }

  async function restoreItem(item) {
    try {
      await api.patch(`/shopping/${item.id}`, { completed: false });
      await loadItems();
    } catch {
      setError('Could not restore item.');
    }
  }

  async function createList() {
    if (!newListName.trim()) return;
    try {
      await api.post('/shopping-lists', { name: newListName.trim() });
      setNewListName('');
      setShowNewListInput(false);
      await loadLists();
    } catch {
      setError('Could not create list.');
    }
  }

  function selectList(id) {
    setActiveListId(id);
  }

  async function deleteList(listId, listName) {
    if (!window.confirm(`Delete "${listName}" list and all its items?`)) return;
    try {
      await api.delete(`/shopping-lists/${listId}`);
      await loadLists();
    } catch {
      setError('Could not delete list.');
    }
  }

  function toggleAisle(aisle) {
    setCollapsedAisles(prev => {
      const next = new Set(prev);
      if (next.has(aisle)) {
        next.delete(aisle);
      } else {
        next.add(aisle);
      }
      return next;
    });
  }

  function openEditPopup(item) {
    setEditItem(item);
    setEditFields({
      item: item.item || '',
      quantity: item.quantity || '',
      unit: item.unit || '',
      aisle_category: item.aisle_category || 'Other',
      description: item.description || '',
    });
  }

  async function saveEdit() {
    if (!editItem || !editFields.item?.trim()) return;
    try {
      await api.patch(`/shopping/${editItem.id}`, {
        item: editFields.item.trim(),
        quantity: editFields.quantity || null,
        unit: editFields.unit || null,
        aisle_category: editFields.aisle_category,
        description: editFields.description || null,
      });
      setEditItem(null);
      await loadItems();
    } catch {
      setError('Could not update item.');
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <svg className="hidden md:block h-6 w-6 text-plum" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" /><path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6" />
        </svg>
        <h1
          className="hidden md:block text-[38px] font-normal leading-none text-bark"
          style={{ fontFamily: '"Instrument Serif", Georgia, "Times New Roman", serif' }}
        >
          Shopping
        </h1>
        <span className="text-sm font-medium text-cocoa">{itemCount} items</span>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError('')} />

      {/* List selector - horizontal pills */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {(Array.isArray(lists) ? lists : []).map(list => (
          <div key={list.id} className="shrink-0 relative group/pill">
            <button
              onClick={() => selectList(list.id)}
              className={`px-4 py-2 rounded-full text-sm font-semibold border-[1.5px] transition-all ${
                activeListId === list.id
                  ? 'bg-plum text-white border-plum'
                  : 'bg-white text-warm-grey border-light-grey hover:border-plum hover:text-plum'
              } ${list.name !== 'Default' ? 'pr-8' : ''}`}
            >
              {list.name}
            </button>
            {list.name !== 'Default' && (
              <button
                onClick={(e) => { e.stopPropagation(); deleteList(list.id, list.name); }}
                className={`absolute right-1.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full flex items-center justify-center transition-all opacity-0 group-hover/pill:opacity-100 ${
                  activeListId === list.id
                    ? 'text-white/70 hover:text-white hover:bg-white/20'
                    : 'text-warm-grey hover:text-coral hover:bg-coral-light'
                }`}
                title={`Delete ${list.name}`}
              >
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            )}
          </div>
        ))}
        {showNewListInput ? (
          <input
            type="text"
            value={newListName}
            onChange={e => setNewListName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') createList(); if (e.key === 'Escape') { setShowNewListInput(false); setNewListName(''); } }}
            onBlur={() => { if (!newListName.trim()) setShowNewListInput(false); }}
            placeholder="List name..."
            className="shrink-0 w-32 px-3 py-2 rounded-full text-sm border-[1.5px] border-plum bg-white focus:outline-none"
            autoFocus
          />
        ) : (
          <button
            onClick={() => setShowNewListInput(true)}
            className="shrink-0 w-8 h-8 rounded-full border-[1.5px] border-dashed border-light-grey flex items-center justify-center text-warm-grey hover:border-plum hover:text-plum hover:bg-plum-light transition-all"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          </button>
        )}
      </div>

      {/* Add item bar */}
      <div className="flex gap-2.5 items-center">
        <input
          type="text"
          value={addText}
          onChange={e => setAddText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') addItem(); }}
          placeholder="Add item..."
          className="flex-1 h-[46px] border-[1.5px] border-light-grey rounded-xl px-4 text-sm bg-white focus:outline-none focus:border-plum transition-colors"
        />
        {/* Desktop only: aisle dropdown */}
        <select
          value={addAisle}
          onChange={e => setAddAisle(e.target.value)}
          className="hidden md:block h-[46px] border-[1.5px] border-light-grey rounded-xl px-3 pr-8 text-sm bg-white focus:outline-none cursor-pointer min-w-[160px] appearance-none"
          style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L5 5L9 1' stroke='%236B6774' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")", backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center' }}
        >
          <option value="auto">Auto-detect aisle</option>
          {AISLE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        {/* Desktop: Add button */}
        <button
          onClick={addItem}
          disabled={adding || !addText.trim()}
          className="hidden md:flex h-[46px] px-5 bg-plum hover:bg-primary-pressed disabled:bg-plum/50 text-white rounded-xl text-sm font-semibold transition-colors items-center gap-1"
        >
          + Add
        </button>
        {/* Mobile: + button */}
        <button
          onClick={addItem}
          disabled={adding || !addText.trim()}
          className="md:hidden h-[42px] w-[42px] shrink-0 bg-plum hover:bg-primary-pressed disabled:bg-plum/50 text-white rounded-xl flex items-center justify-center transition-colors"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
        </button>
      </div>

      {loading ? <Spinner /> : (
        <>
          {/* Aisle groups */}
          {groupedByAisle.map(([aisle, aisleItems]) => {
            const config = AISLE_CONFIG[aisle] || AISLE_CONFIG.Other;
            const isCollapsed = collapsedAisles.has(aisle);
            return (
              <div key={aisle} className="mb-5">
                {/* Aisle header - clickable to collapse */}
                <button
                  onClick={() => toggleAisle(aisle)}
                  className="flex items-center gap-2.5 py-2 w-full text-left"
                >
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: config.bg }}>
                    <AisleIcon aisle={aisle} stroke={config.stroke} />
                  </div>
                  <span className="font-display text-base font-semibold text-bark">{aisle}</span>
                  <span className="text-sm font-medium text-cocoa">({aisleItems.length})</span>
                  <svg
                    className={`ml-auto h-4 w-4 text-cocoa transition-transform duration-200 ${isCollapsed ? '-rotate-90' : ''}`}
                    viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>

                {/* Items - hidden when collapsed */}
                {!isCollapsed && (
                  <div className="flex flex-col gap-1.5 py-2">
                    {aisleItems.map(item => (
                      <div
                        key={item.id}
                        className="group flex items-center gap-3 px-4 py-3 bg-white rounded-xl transition-all hover:shadow-sm border border-light-grey cursor-pointer"
                        onClick={() => openEditPopup(item)}
                      >
                        {/* Checkbox */}
                        <button
                          onClick={e => { e.stopPropagation(); toggleItem(item); }}
                          className={`w-[22px] h-[22px] rounded-[7px] border-2 shrink-0 flex items-center justify-center transition-all ${
                            item.completed ? 'bg-sage border-sage' : 'border-light-grey hover:border-sage'
                          }`}
                        >
                          {item.completed && (
                            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><path d="M20 6L9 17l-5-5" /></svg>
                          )}
                        </button>

                        {/* Emoji */}
                        <div className="w-9 h-9 md:w-10 md:h-10 rounded-lg md:rounded-[10px] bg-cream border border-light-grey flex items-center justify-center text-xl md:text-[22px] shrink-0">
                          {getItemEmoji(item.item, item.aisle_category)}
                        </div>

                        {/* Name */}
                        <span className={`flex-1 text-sm font-medium ${item.completed ? 'line-through text-warm-grey' : 'text-bark'}`}>
                          {item.item}
                        </span>

                        {/* Quantity badge */}
                        {(item.quantity || item.unit) && (
                          <span className="text-xs font-semibold text-plum bg-plum-light px-2.5 py-0.5 rounded-full">
                            {item.quantity}{item.unit ? ` ${item.unit}` : ''}
                          </span>
                        )}

                        {/* Delete button (hover only on desktop) */}
                        <button
                          onClick={e => { e.stopPropagation(); deleteItem(item.id); }}
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-warm-grey hover:bg-coral-light hover:text-coral transition-all opacity-0 group-hover:opacity-100"
                        >
                          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /></svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Empty state */}
          {incompleteItems.length === 0 && !loading && (
            <div className="text-center py-12 text-cocoa text-sm">
              No items on this list yet. Add something above!
            </div>
          )}

          {/* Previously purchased section */}
          {completedItems.length > 0 && (
            <div className="mt-8 pt-5 border-t border-light-grey">
              <button
                onClick={() => setShowPurchased(!showPurchased)}
                className="flex items-center justify-between w-full mb-3"
              >
                <span className="font-display text-base font-semibold text-warm-grey">Previously purchased</span>
                <span className="text-xs font-semibold text-plum">{showPurchased ? 'Hide' : 'Show'}</span>
              </button>
              {showPurchased && (
                <div className="flex flex-col gap-1.5">
                  {completedItems.map(item => {
                    const config = AISLE_CONFIG[item.aisle_category] || AISLE_CONFIG.Other;
                    return (
                      <div key={item.id} className="flex items-center gap-3 px-4 py-2.5 bg-white rounded-xl border border-light-grey opacity-60">
                        {/* Checked circle */}
                        <div className="w-[22px] h-[22px] rounded-[7px] bg-sage flex items-center justify-center shrink-0">
                          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><path d="M20 6L9 17l-5-5" /></svg>
                        </div>
                        {/* Name */}
                        <span className="flex-1 text-sm font-medium text-bark" style={{ opacity: 0.7 }}>{item.item}</span>
                        {/* Aisle pill */}
                        <span
                          className="text-[10px] font-bold px-2 py-0.5 rounded-md whitespace-nowrap"
                          style={{ background: config.pillBg, color: config.pillText }}
                        >
                          {(item.aisle_category || 'Other').replace(' & Cleaning', '').replace(' & Eggs', '').replace(' & Seafood', '').replace(' & Grains', '').replace(' Foods', '')}
                        </span>
                        {/* Date */}
                        <span className="text-[11px] text-cocoa whitespace-nowrap">
                          {item.completed_at ? new Date(item.completed_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''}
                        </span>
                        {/* Restore button */}
                        <button
                          onClick={() => restoreItem(item)}
                          className="text-xs font-semibold text-plum bg-plum-light px-3 py-1 rounded-lg hover:bg-plum hover:text-white transition-all whitespace-nowrap"
                        >
                          Restore
                        </button>
                        {/* Delete button */}
                        <button
                          onClick={() => deleteItem(item.id)}
                          className="w-6 h-6 rounded-md flex items-center justify-center text-coral hover:bg-coral-light transition-all"
                        >
                          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /></svg>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Edit item popup modal */}
      {editItem && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setEditItem(null)}>
          <div className="bg-linen w-full sm:w-[440px] sm:rounded-2xl rounded-t-2xl shadow-lg border border-cream-border p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-bark">Edit item</h3>
              <button onClick={() => setEditItem(null)} className="text-cocoa hover:text-bark p-1">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-bark mb-1">Item name</label>
                <input type="text" value={editFields.item} onChange={e => setEditFields(f => ({...f, item: e.target.value}))} className="w-full border border-cream-border rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent" />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-bark mb-1">Quantity</label>
                  <input type="text" value={editFields.quantity || ''} onChange={e => setEditFields(f => ({...f, quantity: e.target.value}))} className="w-full border border-cream-border rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent" />
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-medium text-bark mb-1">Unit</label>
                  <select value={editFields.unit || ''} onChange={e => setEditFields(f => ({...f, unit: e.target.value}))} className="w-full border border-cream-border rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent">
                    <option value="">—</option>
                    {['g', 'kg', 'ml', 'l', 'pcs', 'pack', 'tin', 'bunch', 'loaf'].map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-bark mb-1">Aisle</label>
                <select value={editFields.aisle_category || 'Other'} onChange={e => setEditFields(f => ({...f, aisle_category: e.target.value}))} className="w-full border border-cream-border rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent">
                  {AISLE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-bark mb-1">Notes</label>
                <textarea value={editFields.description || ''} onChange={e => setEditFields(f => ({...f, description: e.target.value}))} rows={2} className="w-full border border-cream-border rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent resize-none" />
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => setEditItem(null)} className="flex-1 py-3 bg-oat hover:bg-cream-border text-bark rounded-xl text-sm font-medium transition-colors">Cancel</button>
                <button onClick={saveEdit} className="flex-1 py-3 bg-plum hover:bg-primary-pressed text-white rounded-xl text-sm font-medium transition-colors">Save</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
