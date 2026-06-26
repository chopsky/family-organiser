// Lists page — multiple shared household lists. Rebuilt from
// design_handoff_tasks_rewards_lists. Unifies two backends behind one UI:
//   • To-dos  → the existing tasks table (assignees + done), via /api/tasks
//   • Groceries / custom → the shopping system, via /api/shopping(+lists)
// Grocery item emojis are derived client-side; To-do assignees come from the
// task's assigned_to_ids. Mounted at /lists.
import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../lib/api';
import PageHeader from '../components/ui/PageHeader';
import { BottomSheet } from '../components/BottomSheet';
import PillBtn from '../components/ui/PillBtn';
import Avatar from '../components/ui/Avatar';
import { hexFor } from '../lib/memberColors';
import { getItemEmoji, AISLE_CATEGORIES } from '../lib/shopping-constants';
import { useIsMobile } from '../hooks/useMediaQuery';
import { usePullToRefresh, PullIndicator } from '../hooks/usePullToRefresh';
import { isIos } from '../lib/platform';

const INK = '#1A1620', INK2 = '#4A4453', INK3 = '#8A8493';
const LINE = 'rgba(26,22,32,0.07)', LINE_STRONG = 'rgba(26,22,32,0.12)';
const BRAND = '#6C3DD9', BG_SOFT = '#F3EEE5';
const SERIF = '"Instrument Serif", serif';
const INTER = '"Inter", system-ui, sans-serif';
const TODOS_ID = '__todos__';

const Svg = (p) => <svg width={p.s || 16} height={p.s || 16} viewBox="0 0 24 24" fill="none" stroke={p.c || 'currentColor'} strokeWidth={p.w || 2} strokeLinecap="round" strokeLinejoin="round">{p.children}</svg>;
const IcPlus = (p) => <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>;
const IcClose = (p) => <Svg {...p}><path d="M18 6L6 18M6 6l12 12" /></Svg>;
const IcTrash = (p) => <Svg {...p}><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></Svg>;
const IcChevDown = (p) => <Svg {...p}><path d="M6 9l6 6 6-6" /></Svg>;
const Tick = ({ s = 12, c = '#fff' }) => <svg width={s} height={s} viewBox="0 0 12 12" fill="none"><path d="M2.5 6.5l2.5 2.5 4.5-5" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;

const DEFAULT_TINTS = ['#6C3DD9', '#6BA368', '#5B8DE0', '#D8788A', '#D89B3A', '#3AADA0'];

// Shopping items display capitalised (first letter), e.g. "milk" -> "Milk".
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export default function Lists() {
  const [members, setMembers] = useState([]);
  const [lists, setLists] = useState([]); // descriptors
  const [activeId, setActiveId] = useState(TODOS_ID);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingItems, setLoadingItems] = useState(false);
  const [draft, setDraft] = useState('');
  const [toFilter, setToFilter] = useState(null); // member id for To-dos filter
  const [doneOpen, setDoneOpen] = useState(false);
  const [newList, setNewList] = useState(false);
  const [editItem, setEditItem] = useState(null); // grocery item being edited
  const [counts, setCounts] = useState({}); // listId -> open count, for the rail
  const [draftWho, setDraftWho] = useState(null); // To-dos: single assignee for the next add (mobile + desktop)
  const [whoPickerOpen, setWhoPickerOpen] = useState(false); // mobile quick-add assignee picker
  const [confirmDel, setConfirmDel] = useState(false); // mobile inline delete-list confirm
  const [searchParams] = useSearchParams();
  const quickAdd = !!searchParams.get('quickAdd'); // iOS "Add to list" shortcut
  const isMobile = useIsMobile();
  const iosNative = isIos(); // native iOS → swipe-to-delete; else a delete button

  const active = lists.find((l) => l.id === activeId) || lists[0];
  const isTodos = active?.id === TODOS_ID;

  // Switching lists clears the filter + transient mobile UI.
  useEffect(() => { setToFilter(null); setConfirmDel(false); setWhoPickerOpen(false); }, [activeId]);
  // Mobile coupling: the next item's assignee mirrors the active filter —
  // picking a member defaults new items to them, "All" clears it (items added
  // under All are unassigned). The picker can still override independently.
  useEffect(() => { setDraftWho(toFilter); }, [toFilter]);

  const buildDescriptors = useCallback((shoppingLists) => {
    // Brand plum (= var(--color-plum)); kept as hex because the list colour is
    // concatenated with alpha suffixes (e.g. color + '1F') for tinted fills.
    const todos = { id: TODOS_ID, name: 'To-dos', emoji: '✅', color: '#6d38ad', protected: true, kind: 'todos' };
    const isStaple = (name) => /shopping|grocer/i.test(name) || name === 'Default';
    const shopping = (shoppingLists || []).map((l, i) => ({
      id: l.id, name: l.name, emoji: l.emoji || (isStaple(l.name) ? '🛒' : '📋'),
      color: l.color || DEFAULT_TINTS[(i + 1) % DEFAULT_TINTS.length], protected: !!l.protected || isStaple(l.name), kind: 'shopping',
    }));
    // To-dos first, then the Shopping staple, then the rest.
    shopping.sort((a, b) => (isStaple(b.name) ? 1 : 0) - (isStaple(a.name) ? 1 : 0));
    return [todos, ...shopping];
  }, []);

  // Open-item count per list for the rail (one light fetch each, on load).
  const loadCounts = useCallback(async (descriptors) => {
    const entries = await Promise.all((descriptors || []).map(async (l) => {
      try {
        if (l.kind === 'todos') { const { data } = await api.get('/tasks', { params: { all: true } }); return [l.id, (data.tasks || []).length]; }
        const { data } = await api.get('/shopping', { params: { list_id: l.id } }); return [l.id, (data.items || []).length];
      } catch { return [l.id, 0]; }
    }));
    setCounts(Object.fromEntries(entries));
  }, []);

  const loadItems = useCallback(async (list) => {
    if (!list) return;
    setLoadingItems(true);
    try {
      if (list.kind === 'todos') {
        const [{ data: open }, { data: done }] = await Promise.all([
          api.get('/tasks', { params: { all: true } }),
          api.get('/tasks/recent'),
        ]);
        const map = (t, isDone) => ({ id: t.id, text: t.title, done: isDone, section: null, whoIds: t.assigned_to_ids || [] });
        setItems([...(open.tasks || []).map((t) => map(t, false)), ...(done.tasks || []).map((t) => map(t, true))]);
      } else {
        const { data } = await api.get('/shopping', { params: { list_id: list.id, completed: true } });
        setItems((data.items || []).map((i) => ({
          id: i.id, done: !!i.completed, section: i.aisle_category || 'Other', emoji: getItemEmoji(i.item, i.aisle_category),
          text: i.quantity ? `${cap(i.item)} · ${i.quantity}${i.unit ? ` ${i.unit}` : ''}` : cap(i.item),
          // raw fields kept so the Edit-item form can prefill
          item: i.item, quantity: i.quantity || '', unit: i.unit || '', description: i.description || '', aisle_category: i.aisle_category || 'Other',
        })));
      }
    } catch { setItems([]); } finally { setLoadingItems(false); }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [{ data: hh }, { data: sl }] = await Promise.all([api.get('/household'), api.get('/shopping-lists')]);
        if (cancelled) return;
        setMembers(hh.members || []);
        const descriptors = buildDescriptors(sl.lists);
        setLists(descriptors);
        loadCounts(descriptors);
      } catch { /* empty */ } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [buildDescriptors, loadCounts]);

  useEffect(() => {
    if (active) loadItems(active);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, lists.length]);

  // Pull-to-refresh (iOS native only; no-op on web). Re-fetches the list
  // rail + counts and the active list's items, so a change made elsewhere
  // (another member, or the WhatsApp bot adding "juice") can be pulled in
  // on demand. Resolves the active descriptor from the freshly-fetched
  // lists in case it was deleted while we were looking at it.
  const refreshAll = useCallback(async () => {
    try {
      const [{ data: hh }, { data: sl }] = await Promise.all([api.get('/household'), api.get('/shopping-lists')]);
      setMembers(hh.members || []);
      const descriptors = buildDescriptors(sl.lists);
      setLists(descriptors);
      loadCounts(descriptors);
      await loadItems(descriptors.find((l) => l.id === activeId) || descriptors[0]);
    } catch { /* keep existing data on a failed pull */ }
  }, [activeId, buildDescriptors, loadCounts, loadItems]);
  const ptr = usePullToRefresh(refreshAll);

  const addItem = useCallback(async () => {
    const text = draft.trim();
    if (!text || !active) return;
    setDraft('');
    try {
      if (isTodos) {
        const names = draftWho ? [members.find((x) => x.id === draftWho)?.name].filter(Boolean) : [];
        await api.post('/tasks', { title: text, ...(names.length ? { assigned_to_names: names } : {}) });
      } else {
        await api.post('/shopping', { item: text, list_id: active.id });
      }
      setCounts((c) => ({ ...c, [active.id]: (c[active.id] || 0) + 1 }));
      await loadItems(active);
    } catch { /* keep draft cleared; reload */ loadItems(active); }
  }, [draft, active, isTodos, loadItems, members, draftWho]);

  // Edit a grocery item (name, quantity, unit, aisle, notes) via PATCH /shopping/:id.
  const saveEdit = useCallback(async (fields) => {
    if (!editItem || !fields.item?.trim()) return;
    try {
      await api.patch(`/shopping/${editItem.id}`, {
        item: fields.item.trim(),
        quantity: fields.quantity || null,
        unit: fields.unit || null,
        aisle_category: fields.aisle_category,
        description: fields.description || null,
      });
    } catch { /* fall through to reload */ }
    setEditItem(null);
    if (active) loadItems(active);
  }, [editItem, active, loadItems]);

  const toggle = useCallback(async (it) => {
    const next = !it.done;
    setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, done: next } : x)));
    try { await api.patch(`${isTodos ? '/tasks' : '/shopping'}/${it.id}`, { completed: next }); }
    catch { setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, done: !next } : x))); }
  }, [isTodos]);

  const removeItem = useCallback(async (it) => {
    setItems((xs) => xs.filter((x) => x.id !== it.id));
    try { await api.delete(`${isTodos ? '/tasks' : '/shopping'}/${it.id}`); } catch { loadItems(active); }
  }, [isTodos, active, loadItems]);

  const createList = useCallback(async ({ name, emoji, color }) => {
    try {
      const { data } = await api.post('/shopping-lists', { name, emoji, color });
      const sl = (await api.get('/shopping-lists')).data.lists;
      setLists(buildDescriptors(sl));
      if (data.list?.id) setActiveId(data.list.id);
      setNewList(false);
    } catch (e) { alert(e.response?.data?.error || 'Could not create the list.'); }
  }, [buildDescriptors]);

  const deleteListRaw = useCallback(async () => {
    if (!active || active.protected) return;
    try {
      await api.delete(`/shopping-lists/${active.id}`);
      const sl = (await api.get('/shopping-lists')).data.lists;
      setLists(buildDescriptors(sl));
      setActiveId(TODOS_ID);
    } catch { /* ignore */ }
  }, [active, buildDescriptors]);

  // Desktop confirms with the browser dialog; mobile uses the inline confirm.
  const deleteList = useCallback(() => {
    if (!active || active.protected) return;
    if (!window.confirm(`Delete the "${active.name}" list and everything on it?`)) return;
    deleteListRaw();
  }, [active, deleteListRaw]);

  // visible items (To-dos filter by assignee) + grouping
  const filtered = isTodos && toFilter ? items.filter((i) => (i.whoIds || []).includes(toFilter)) : items;
  const openItems = filtered.filter((i) => !i.done);
  const doneItems = filtered.filter((i) => i.done);
  const sections = isTodos ? [{ name: null, items: openItems }]
    : Object.entries(openItems.reduce((acc, i) => { (acc[i.section] ||= []).push(i); return acc; }, {})).map(([name, its]) => ({ name, items: its }));
  const memberOf = (id) => members.find((m) => m.id === id);

  // Shared To-do controls (mobile + desktop): the quick-add bar with the
  // single-assignee picker, and the All-plus-members filter row.
  const quickAddBar = () => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fff', borderRadius: 13, padding: isTodos && members.length > 0 ? '4px 4px 4px 8px' : '4px 4px 4px 14px', marginBottom: 12, position: 'relative', flexShrink: 0 }}>
      {isTodos && members.length > 0 && (
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button onClick={() => setWhoPickerOpen((o) => !o)} aria-label={draftWho ? `Assign to ${memberOf(draftWho)?.name}` : 'Assign to someone'}
            style={{ border: 0, background: 'transparent', cursor: 'pointer', padding: 2, display: 'flex', alignItems: 'center', borderRadius: '50%' }}>
            {draftWho ? <Avatar member={memberOf(draftWho)} size={30} /> : <span style={{ width: 30, height: 30, borderRadius: '50%', border: `1.5px dashed ${LINE_STRONG}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><IcPlus s={14} w={2.2} c={INK3} /></span>}
          </button>
          {whoPickerOpen && (
            <>
              <div onClick={() => setWhoPickerOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 20 }} />
              <div style={{ position: 'absolute', top: 38, left: 0, zIndex: 30, background: '#fff', borderRadius: 14, padding: 6, minWidth: 172, border: `1px solid ${LINE}`, boxShadow: '0 12px 34px rgba(26,22,32,0.18)' }}>
                {members.map((m) => (
                  <button key={m.id} onClick={() => { setDraftWho(m.id); setWhoPickerOpen(false); }}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 10px', borderRadius: 10, border: 0, cursor: 'pointer', background: draftWho === m.id ? BG_SOFT : 'transparent', fontFamily: INTER, textAlign: 'left' }}>
                    <Avatar member={m} size={26} /><span style={{ fontSize: 13.5, fontWeight: 600, color: INK }}>{m.name}</span>
                    {draftWho === m.id && <span style={{ marginLeft: 'auto' }}><Tick s={13} c={active?.color || BRAND} /></span>}
                  </button>
                ))}
                {draftWho && (
                  <button onClick={() => { setDraftWho(null); setWhoPickerOpen(false); }}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 10px', borderRadius: 10, border: 0, cursor: 'pointer', background: 'transparent', fontFamily: INTER, textAlign: 'left', color: INK3, fontSize: 13, marginTop: 2, borderTop: `1px solid ${LINE}` }}>Anyone</button>
                )}
              </div>
            </>
          )}
        </div>
      )}
      <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addItem(); }} autoFocus={quickAdd}
        placeholder={isTodos && draftWho ? `Add for ${memberOf(draftWho)?.name}…` : (isTodos ? 'Add a to-do…' : 'Add an item…')}
        style={{ flex: 1, minWidth: 0, border: 0, outline: 'none', fontFamily: INTER, fontSize: 14, background: 'transparent', padding: '10px 0', color: INK }} />
      <button onClick={addItem} style={{ flexShrink: 0, padding: '8px 14px', borderRadius: 10, background: active?.color || BRAND, color: '#fff', border: 0, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: INTER, display: 'inline-flex', alignItems: 'center', gap: 4 }}><IcPlus s={14} w={2.4} c="#fff" /> Add</button>
    </div>
  );

  const assigneeFilter = () => (isTodos && members.length > 0 ? (
    <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 12, WebkitOverflowScrolling: 'touch', flexShrink: 0 }}>
      <button onClick={() => setToFilter(null)} style={{ flexShrink: 0, padding: '7px 14px', borderRadius: 99, cursor: 'pointer', fontFamily: INTER, fontSize: 13, fontWeight: 700, border: 0, background: !toFilter ? (active?.color || BRAND) : '#fff', color: !toFilter ? '#fff' : INK2 }}>All</button>
      {members.map((m) => {
        const on = toFilter === m.id; const mc = hexFor(m);
        const n = items.filter((i) => !i.done && (i.whoIds || []).includes(m.id)).length;
        return (
          <button key={m.id} onClick={() => setToFilter(on ? null : m.id)} title={m.name}
            style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px 5px 5px', borderRadius: 99, cursor: 'pointer', fontFamily: INTER, border: 0, background: on ? mc + '22' : '#fff', boxShadow: on ? `inset 0 0 0 1.5px ${mc}` : `inset 0 0 0 1px ${LINE}` }}>
            <Avatar member={m} size={26} /><span style={{ fontSize: 12, fontWeight: 700, color: on ? mc : INK3 }}>{n}</span>
          </button>
        );
      })}
    </div>
  ) : null);

  return (
    <div style={{ height: '100%', minHeight: 0, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', fontFamily: INTER, color: INK }}>
      <PageHeader kicker={isMobile ? `${lists.length} list${lists.length === 1 ? '' : 's'}` : (active ? `${openItems.length} open` : '')} title="Lists"
        actions={isMobile
          ? <PillBtn primary aria-label="New list" className="h-11 w-11 justify-center px-0! rounded-full!" icon={<IcPlus s={18} w={2.4} c="#fff" />} onClick={() => setNewList(true)} />
          : <PillBtn primary icon={<IcPlus s={14} w={2.4} c="#fff" />} onClick={() => setNewList(true)}>New list</PillBtn>} />

      {loading ? (
        <Center>Loading…</Center>
      ) : isMobile ? (
        <div {...ptr.bindings} style={{ flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: 160, touchAction: 'pan-y' }}>
          <PullIndicator state={ptr.state} />
          {/* list pills */}
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 16, WebkitOverflowScrolling: 'touch' }}>
            {lists.map((l) => {
              const on = l.id === activeId;
              const n = on ? openItems.length : (counts[l.id] ?? 0);
              return (
                <button key={l.id} onClick={() => setActiveId(l.id)} style={{ flexShrink: 0, padding: '8px 14px', borderRadius: 99, fontFamily: INTER, fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 7, background: on ? l.color : '#fff', color: on ? '#fff' : INK2, border: `1px solid ${on ? l.color : LINE}` }}>
                  <span style={{ fontSize: 14 }}>{l.emoji}</span>{l.name}
                  {n > 0 && <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9, fontSize: 10, fontWeight: 700, background: on ? 'rgba(255,255,255,0.28)' : l.color + '1F', color: on ? '#fff' : l.color }}>{n}</span>}
                </button>
              );
            })}
            <button onClick={() => setNewList(true)} aria-label="New list" style={{ flexShrink: 0, width: 36, height: 36, borderRadius: '50%', background: '#fff', border: `1px dashed ${LINE_STRONG}`, color: INK3, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><IcPlus s={16} w={2.2} c={INK3} /></button>
          </div>

          {/* active list card (tinted in the list colour) */}
          <div style={{ background: (active?.color || BRAND) + '14', borderRadius: 22, padding: '16px 14px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 4px 12px' }}>
              <span style={{ fontSize: 22 }}>{active?.emoji}</span>
              <span style={{ fontFamily: SERIF, fontSize: 24, color: INK, flex: 1, minWidth: 0 }}>{active?.name}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: active?.color || BRAND }}>{openItems.length} left</span>
            </div>

            {quickAddBar()}
            {assigneeFilter()}

            {/* items grouped by section */}
            {loadingItems ? (
              <div style={{ padding: 20, color: INK3, fontSize: 13 }}>Loading…</div>
            ) : openItems.length === 0 && doneItems.length === 0 ? (
              <div style={{ padding: '28px 0', textAlign: 'center', color: INK3, fontFamily: SERIF, fontSize: 20 }}>Nothing here yet</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {sections.filter((s) => s.items.length).map((sec) => (
                  <div key={sec.name || '_all'}>
                    {sec.name && <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: active?.color || BRAND, padding: '0 4px 6px' }}>{sec.name}</div>}
                    <div style={{ background: '#fff', borderRadius: 16, overflow: 'hidden' }}>
                      {sec.items.map((it, i, arr) => (
                        <MobileListRow key={it.id} it={it} color={active?.color || BRAND} isTodos={isTodos} assignees={(it.whoIds || []).map(memberOf).filter(Boolean)} iosNative={iosNative} last={i === arr.length - 1} onToggle={toggle} onDelete={removeItem} />
                      ))}
                    </div>
                  </div>
                ))}
                {doneItems.length > 0 && (
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: INK3, padding: '4px 4px 6px' }}>Done · {doneItems.length}</div>
                    <div style={{ background: '#fff', borderRadius: 16, overflow: 'hidden', opacity: 0.65 }}>
                      {doneItems.map((it, i, arr) => (
                        <MobileListRow key={it.id} it={it} color={active?.color || BRAND} isTodos={isTodos} iosNative={iosNative} last={i === arr.length - 1} onToggle={toggle} onDelete={removeItem} doneRow />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* delete list — inline confirm, hidden for protected lists */}
          {active && !active.protected && (
            <div style={{ paddingTop: 16 }}>
              {!confirmDel ? (
                <button onClick={() => setConfirmDel(true)} style={{ width: '100%', padding: 12, borderRadius: 14, cursor: 'pointer', fontFamily: INTER, background: 'transparent', border: '1px solid rgba(215,85,106,0.35)', color: '#C24A5E', fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
                  <IcTrash s={16} c="#C24A5E" /> Delete list
                </button>
              ) : (
                <div style={{ background: '#fff', borderRadius: 16, padding: 14, border: '1px solid rgba(215,85,106,0.3)' }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: INK, textAlign: 'center', marginBottom: 3 }}>Delete “{active.name}”?</div>
                  <div style={{ fontSize: 12.5, color: INK3, textAlign: 'center', marginBottom: 14 }}>This removes the list and its {items.length} item{items.length === 1 ? '' : 's'}.</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => setConfirmDel(false)} style={{ flex: 1, padding: 11, borderRadius: 12, cursor: 'pointer', fontFamily: INTER, background: BG_SOFT, border: 0, color: INK2, fontSize: 14, fontWeight: 600 }}>Cancel</button>
                    <button onClick={() => { deleteListRaw(); setConfirmDel(false); }} style={{ flex: 1, padding: 11, borderRadius: 12, cursor: 'pointer', fontFamily: INTER, background: '#D7556A', border: 0, color: '#fff', fontSize: 14, fontWeight: 600 }}>Delete</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'row', gap: 20, flex: 1, minHeight: 0 }}>
          {/* rail (vertical on desktop, a horizontal chip strip on mobile) */}
          <div style={{ flex: isMobile ? 'none' : '0 0 240px', display: 'flex', flexDirection: isMobile ? 'row' : 'column', gap: isMobile ? 8 : 6, overflowX: isMobile ? 'auto' : 'visible', overflowY: isMobile ? 'hidden' : 'auto', paddingBottom: isMobile ? 4 : 0 }}>
            {lists.map((l) => {
              const on = l.id === activeId;
              return (
                <button key={l.id} onClick={() => { setActiveId(l.id); setToFilter(null); setDoneOpen(false); }}
                  style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 11, padding: isMobile ? '8px 14px 8px 8px' : '11px 12px', borderRadius: 14, cursor: 'pointer', fontFamily: INTER, textAlign: 'left', flexShrink: isMobile ? 0 : undefined, whiteSpace: 'nowrap', border: on ? `1.5px solid ${l.color}` : '1px solid transparent', background: on ? '#fff' : (isMobile ? '#fff' : 'transparent'), boxShadow: on ? '0 2px 10px rgba(26,22,32,0.05)' : 'none' }}>
                  <span style={{ width: isMobile ? 28 : 34, height: isMobile ? 28 : 34, borderRadius: 10, flexShrink: 0, fontSize: isMobile ? 15 : 18, display: 'flex', alignItems: 'center', justifyContent: 'center', background: l.color + '1F' }}>{l.emoji}</span>
                  <span style={{ flex: isMobile ? 'none' : 1, fontSize: 14, fontWeight: 600, color: INK }}>{l.name}</span>
                  {!isMobile && <span style={{ fontSize: 12, fontWeight: 700, color: on ? l.color : INK3 }}>{l.id === activeId ? openItems.length : (counts[l.id] ?? '')}</span>}
                </button>
              );
            })}
          </div>

          {/* active list */}
          <div style={{ flex: isMobile ? 'none' : 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: isMobile ? undefined : 0 }}>
            <div style={{ background: (active?.color || BRAND) + '12', borderRadius: 22, padding: '20px 22px', display: 'flex', flexDirection: 'column', minHeight: isMobile ? undefined : 0, flex: isMobile ? 'none' : 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexShrink: 0 }}>
                <span style={{ fontSize: 26 }}>{active?.emoji}</span>
                <h2 style={{ margin: 0, fontFamily: SERIF, fontSize: 30, fontWeight: 400, color: INK }}>{active?.name}</h2>
              </div>

              {quickAddBar()}
              {assigneeFilter()}

              {/* items — scroll internally on desktop; on mobile let the whole
                  page scroll (only the page header stays fixed) */}
              <div style={{ flex: isMobile ? 'none' : 1, minHeight: isMobile ? undefined : 0, overflowY: isMobile ? 'visible' : 'auto', margin: '0 -4px', padding: '0 4px' }}>
                {loadingItems ? <div style={{ padding: 20, color: INK3, fontSize: 13 }}>Loading…</div>
                  : openItems.length === 0 && doneItems.length === 0 ? <div style={{ padding: '30px 4px', textAlign: 'center', color: INK3, fontStyle: 'italic' }}>Nothing here yet — add the first item.</div>
                    : (
                      <>
                        {sections.map((sec) => (
                          <div key={sec.name || 'all'} style={{ marginBottom: 14 }}>
                            {sec.name && <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: INK3, padding: '0 4px 8px' }}>{sec.name}</div>}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                              {sec.items.map((it) => <Row key={it.id} it={it} isTodos={isTodos} color={active?.color || BRAND} assignees={(it.whoIds || []).map(memberOf).filter(Boolean)} onToggle={toggle} onDelete={removeItem} onEdit={setEditItem} />)}
                            </div>
                          </div>
                        ))}
                        {doneItems.length > 0 && (
                          <div style={{ marginTop: 6 }}>
                            <button onClick={() => setDoneOpen((o) => !o)} style={{ display: 'flex', alignItems: 'center', gap: 6, border: 0, background: 'transparent', cursor: 'pointer', fontFamily: INTER, fontSize: 12, fontWeight: 700, color: INK3, padding: '4px' }}>
                              <span style={{ transform: doneOpen ? 'none' : 'rotate(-90deg)', transition: 'transform .15s', display: 'flex' }}><IcChevDown s={14} c={INK3} /></span>
                              Done · {doneItems.length}
                            </button>
                            {doneOpen && <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>{doneItems.map((it) => <Row key={it.id} it={it} isTodos={isTodos} color={active?.color || BRAND} assignees={(it.whoIds || []).map(memberOf).filter(Boolean)} onToggle={toggle} onDelete={removeItem} onEdit={setEditItem} />)}</div>}
                          </div>
                        )}
                      </>
                    )}
              </div>
            </div>
            {active && !active.protected && (
              <button onClick={deleteList} style={{ alignSelf: 'flex-start', marginTop: 12, display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 14px', borderRadius: 10, border: `1px solid ${LINE_STRONG}`, background: '#fff', cursor: 'pointer', fontFamily: INTER, fontSize: 13, fontWeight: 600, color: '#C24A5E' }}>
                <IcTrash s={14} c="#C24A5E" /> Delete list
              </button>
            )}
          </div>
        </div>
      )}

      {newList && <NewListModal onClose={() => setNewList(false)} onSave={createList} />}
      {editItem && <EditItemModal item={editItem} onClose={() => setEditItem(null)} onSave={saveEdit} />}
    </div>
  );
}

function Center({ children }) { return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: INK3, fontFamily: SERIF, fontSize: 24 }}>{children}</div>; }

function Row({ it, isTodos, color, assignees = [], onToggle, onDelete, onEdit }) {
  const [hover, setHover] = useState(false);
  const editable = !isTodos && !!onEdit; // grocery items open an Edit-item form
  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#fff', borderRadius: 13, padding: '11px 14px', opacity: it.done ? 0.6 : 1 }}>
      <button onClick={() => onToggle(it)} aria-label={it.done ? 'Mark not done' : 'Mark done'}
        style={{ width: 22, height: 22, borderRadius: '50%', flexShrink: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', border: it.done ? `2px solid ${color}` : `1.5px solid ${LINE_STRONG}`, background: it.done ? color : 'transparent' }}>
        {it.done && <Tick s={12} />}
      </button>
      <div onClick={editable ? () => onEdit(it) : undefined} title={editable ? 'Edit item' : undefined}
        style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 12, cursor: editable ? 'pointer' : 'default' }}>
        {!isTodos && <span style={{ width: 32, height: 32, borderRadius: 9, flexShrink: 0, fontSize: 17, display: 'flex', alignItems: 'center', justifyContent: 'center', background: BG_SOFT }}>{it.emoji}</span>}
        <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 500, color: it.done ? INK3 : INK, textDecoration: it.done ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.text}</span>
      </div>
      {isTodos && assignees.length > 0 && (
        <div style={{ display: 'flex', flexShrink: 0 }}>
          {assignees.slice(0, 3).map((m, i) => (
            <div key={m.id} style={{ marginLeft: i ? -8 : 0, borderRadius: '50%', border: '2px solid #fff', display: 'flex' }}>
              <Avatar member={m} size={26} />
            </div>
          ))}
        </div>
      )}
      <button onClick={() => onDelete(it)} aria-label="Delete" style={{ width: 28, height: 28, borderRadius: 8, border: 0, background: BG_SOFT, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: hover ? 1 : 0, transition: 'opacity .12s' }}><IcTrash s={14} c="#C24A5E" /></button>
    </div>
  );
}

// One mobile list row. On native iOS it's a swipe-left-to-reveal Delete (the
// platform convention); on desktop + mobile web a tap-to-delete trash button
// (same affordance as desktop). Completed rows render bare (checkbox + text).
function MobileListRow({ it, color, isTodos, assignees = [], iosNative, last, onToggle, onDelete, doneRow }) {
  const REVEAL = 88; // px of Delete action revealed
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dxRef = useRef(0);
  const start = useRef(null); // { x, y, tx } while a pointer is down
  const axis = useRef(null);  // 'h' | 'v' | null (undecided)
  const setTx = (v) => { dxRef.current = v; setDx(v); };
  // Toggling completion closes any open swipe.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { dxRef.current = 0; setDx(0); }, [it.done]);
  const border = last ? 'none' : `1px solid ${LINE}`;

  if (doneRow) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderBottom: border }}>
        <button onClick={() => onToggle(it)} aria-label="Mark not done" style={{ width: 22, height: 22, borderRadius: '50%', flexShrink: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', border: `2px solid ${color}`, background: color }}><Tick s={12} /></button>
        <span style={{ flex: 1, minWidth: 0, fontSize: 14, color: INK3, textDecoration: 'line-through', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.text}</span>
      </div>
    );
  }

  const onDown = (e) => { if (!iosNative) return; start.current = { x: e.clientX, y: e.clientY, tx: dxRef.current }; axis.current = null; };
  const onMove = (e) => {
    const s = start.current; if (!s) return;
    const ddx = e.clientX - s.x, ddy = e.clientY - s.y;
    if (!axis.current) {
      if (Math.abs(ddx) < 10 && Math.abs(ddy) < 10) return;          // slop
      axis.current = Math.abs(ddx) > Math.abs(ddy) ? 'h' : 'v';      // decisive axis
      if (axis.current === 'h') { setDragging(true); try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* unsupported */ } }
    }
    if (axis.current === 'h') setTx(Math.max(-REVEAL, Math.min(0, s.tx + ddx)));
  };
  const onUp = () => {
    const s = start.current; start.current = null; setDragging(false);
    if (!s || axis.current !== 'h') { axis.current = null; return; } // vertical = scroll, do nothing
    setTx(dxRef.current < -REVEAL / 2 ? -REVEAL : 0);                // snap
    axis.current = null;
  };
  const onCancel = () => { start.current = null; axis.current = null; setDragging(false); setTx(dxRef.current < -REVEAL / 2 ? -REVEAL : 0); };

  const inner = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px' }}>
      <button onClick={() => onToggle(it)} aria-label={it.done ? 'Mark not done' : 'Mark done'}
        style={{ width: 22, height: 22, borderRadius: '50%', flexShrink: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', border: it.done ? `2px solid ${color}` : `1.5px solid ${LINE_STRONG}`, background: it.done ? color : 'transparent' }}>
        {it.done && <Tick s={12} />}
      </button>
      {!isTodos && it.emoji && <span style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0, fontSize: 18, background: color + '1A', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{it.emoji}</span>}
      <span style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 500, color: it.done ? INK3 : INK, textDecoration: it.done ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.text}</span>
      {isTodos && assignees.length > 0 && (
        <div style={{ display: 'flex', flexShrink: 0 }}>
          {assignees.slice(0, 3).map((m, i) => <div key={m.id} style={{ marginLeft: i ? -8 : 0, borderRadius: '50%', border: '2px solid #fff', display: 'flex' }}><Avatar member={m} size={26} /></div>)}
        </div>
      )}
      {!iosNative && <button onClick={() => onDelete(it)} aria-label="Delete" style={{ width: 28, height: 28, borderRadius: 8, border: 0, background: BG_SOFT, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><IcTrash s={14} c="#C24A5E" /></button>}
    </div>
  );

  if (!iosNative) return <div style={{ borderBottom: border }}>{inner}</div>;
  return (
    <div style={{ position: 'relative', borderBottom: border }}>
      <button onClick={() => onDelete(it)} aria-label="Delete" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: REVEAL, border: 0, cursor: 'pointer', background: '#D7556A', color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, fontFamily: INTER, fontSize: 12, fontWeight: 700 }}>
        <IcTrash s={18} c="#fff" /> Delete
      </button>
      <div onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onCancel}
        style={{ position: 'relative', background: '#fff', transform: `translateX(${dx}px)`, transition: dragging ? 'none' : 'transform .22s ease', touchAction: 'pan-y' }}>
        {inner}
      </div>
    </div>
  );
}

// Edit a grocery item — name, quantity + unit, aisle, notes. Restores the
// "Edit item" form the old Shopping page had (PATCH /shopping/:id).
const UNIT_OPTIONS = ['g', 'kg', 'ml', 'l', 'pcs', 'pack', 'tin', 'bunch', 'loaf'];
function EditItemModal({ item, onClose, onSave }) {
  const [f, setF] = useState({
    item: item.item || '', quantity: item.quantity || '', unit: item.unit || '',
    aisle_category: item.aisle_category || 'Other', description: item.description || '',
  });
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const field = { width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 10, border: `1px solid ${LINE_STRONG}`, fontFamily: INTER, fontSize: 14, outline: 'none', background: '#fff', color: INK };
  const label = { fontSize: 12, fontWeight: 600, color: INK2, marginBottom: 7 };
  return (
    <BottomSheet open onDismiss={onClose} desktopWidthClass="sm:w-[440px]">
      <div className="overflow-y-auto min-h-0" style={{ padding: '8px 24px 24px', fontFamily: INTER }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <h2 style={{ margin: 0, fontFamily: SERIF, fontSize: 30, fontWeight: 400, color: INK }}>Edit item</h2>
          <button onClick={onClose} aria-label="Close" style={{ width: 34, height: 34, borderRadius: 8, border: 0, background: BG_SOFT, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><IcClose s={18} c={INK2} /></button>
        </div>
        <div style={{ marginBottom: 14 }}>
          <div style={label}>Item name</div>
          <input autoFocus value={f.item} onChange={(e) => set('item', e.target.value)} style={field} />
        </div>
        <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <div style={label}>Quantity</div>
            <input value={f.quantity} onChange={(e) => set('quantity', e.target.value)} placeholder="e.g. 2" style={field} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={label}>Unit</div>
            <select value={f.unit} onChange={(e) => set('unit', e.target.value)} style={field}>
              <option value="">—</option>
              {UNIT_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
        </div>
        <div style={{ marginBottom: 14 }}>
          <div style={label}>Aisle</div>
          <select value={f.aisle_category} onChange={(e) => set('aisle_category', e.target.value)} style={field}>
            {AISLE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div style={{ marginBottom: 18 }}>
          <div style={label}>Notes</div>
          <textarea value={f.description} onChange={(e) => set('description', e.target.value)} rows={2} style={{ ...field, resize: 'none' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onClose} style={{ padding: '10px 18px', borderRadius: 10, border: `1px solid ${LINE_STRONG}`, background: '#fff', cursor: 'pointer', fontWeight: 600, fontFamily: INTER, fontSize: 14, color: INK2 }}>Cancel</button>
          <button onClick={() => f.item.trim() && onSave(f)} disabled={!f.item.trim()} style={{ padding: '10px 22px', borderRadius: 10, border: 0, cursor: 'pointer', fontWeight: 600, fontSize: 14, fontFamily: INTER, background: BRAND, color: '#fff', opacity: f.item.trim() ? 1 : 0.5 }}>Save</button>
        </div>
      </div>
    </BottomSheet>
  );
}

const LIST_EMOJIS = ['📋', '🛒', '🧳', '🔧', '🎒', '🎁', '🏖️', '🎄', '📦', '🧺', '🛠️', '🐶'];
function NewListModal({ onClose, onSave }) {
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('📋');
  const [color, setColor] = useState(DEFAULT_TINTS[0]);
  return (
    <BottomSheet open onDismiss={onClose} desktopWidthClass="sm:w-[440px]">
      <div className="overflow-y-auto min-h-0" style={{ padding: '8px 24px 24px', fontFamily: INTER }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <h2 style={{ margin: 0, fontFamily: SERIF, fontSize: 30, fontWeight: 400, color: INK }}>New list</h2>
          <button onClick={onClose} aria-label="Close" style={{ width: 34, height: 34, borderRadius: 8, border: 0, background: BG_SOFT, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><IcClose s={18} c={INK2} /></button>
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: INK2, marginBottom: 7 }}>Name</div>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Packing list" style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 10, border: `1px solid ${LINE_STRONG}`, fontFamily: INTER, fontSize: 14, outline: 'none' }} />
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: INK2, marginBottom: 7 }}>Icon</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {LIST_EMOJIS.map((em) => <button key={em} onClick={() => setEmoji(em)} style={{ width: 38, height: 38, borderRadius: 10, fontSize: 19, cursor: 'pointer', background: emoji === em ? '#EFE9FB' : '#fff', border: emoji === em ? `1.5px solid ${BRAND}` : `1px solid ${LINE}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{em}</button>)}
          </div>
        </div>
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: INK2, marginBottom: 7 }}>Colour</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {DEFAULT_TINTS.map((c) => <button key={c} onClick={() => setColor(c)} style={{ width: 30, height: 30, borderRadius: '50%', background: c, cursor: 'pointer', border: color === c ? '3px solid #fff' : '3px solid transparent', boxShadow: color === c ? `0 0 0 2px ${c}` : 'none' }} />)}
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onClose} style={{ padding: '10px 18px', borderRadius: 10, border: `1px solid ${LINE_STRONG}`, background: '#fff', cursor: 'pointer', fontWeight: 600, fontFamily: INTER, fontSize: 14, color: INK2 }}>Cancel</button>
          <button onClick={() => name.trim() && onSave({ name: name.trim(), emoji, color })} disabled={!name.trim()} style={{ padding: '10px 22px', borderRadius: 10, border: 0, cursor: 'pointer', fontWeight: 600, fontSize: 14, fontFamily: INTER, background: BRAND, color: '#fff', opacity: name.trim() ? 1 : 0.5 }}>Create</button>
        </div>
      </div>
    </BottomSheet>
  );
}
