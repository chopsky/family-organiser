// Lists page — multiple shared household lists. Rebuilt from
// design_handoff_tasks_rewards_lists. Unifies two backends behind one UI:
//   • To-dos  → the existing tasks table (assignees + done), via /api/tasks
//   • Groceries / custom → the shopping system, via /api/shopping(+lists)
// Grocery item emojis are derived client-side; To-do assignees come from the
// task's assigned_to_ids. Mounted at /lists.
import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../lib/api';
import PageHeader from '../components/ui/PageHeader';
import PillBtn from '../components/ui/PillBtn';
import Avatar from '../components/ui/Avatar';
import { hexFor } from '../lib/memberColors';
import { useIsMobile } from '../hooks/useMediaQuery';

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
const IcPeople = (p) => <Svg {...p}><circle cx="9" cy="8" r="3" /><path d="M3 20c0-3 3-5 6-5s6 2 6 5" /><path d="M16 5a3 3 0 0 1 0 6M22 20c0-2.5-2-4.3-4.5-4.8" /></Svg>;
const Tick = ({ s = 12, c = '#fff' }) => <svg width={s} height={s} viewBox="0 0 12 12" fill="none"><path d="M2.5 6.5l2.5 2.5 4.5-5" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;

// Derive a grocery emoji tile from the item text.
const GROCERY_EMOJI = [[/milk|yogh|yogurt|cream|butter|cheese|dairy/, '🥛'], [/egg/, '🥚'], [/bread|sourdough|loaf|bagel|bun/, '🍞'], [/apple/, '🍎'], [/banana/, '🍌'], [/orange|mandarin|clementine/, '🍊'], [/mango/, '🥭'], [/pear/, '🍐'], [/grape/, '🍇'], [/strawber|blueber|berr/, '🍓'], [/spinach|lettuce|salad|greens|kale|rocket/, '🥬'], [/carrot/, '🥕'], [/potato/, '🥔'], [/tomato/, '🍅'], [/onion/, '🧅'], [/garlic/, '🧄'], [/pepper|capsicum/, '🫑'], [/broccoli/, '🥦'], [/corn/, '🌽'], [/chicken|turkey/, '🍗'], [/beef|steak|mince|sausage|bacon|ham|pork|lamb/, '🥩'], [/fish|salmon|tuna|cod|prawn/, '🐟'], [/rice/, '🍚'], [/pasta|spaghetti|noodle/, '🍝'], [/coffee/, '☕'], [/\btea\b/, '🫖'], [/water|juice|squash|drink|cola|lemonade/, '🧃'], [/oil|olive/, '🫒'], [/salt|sugar|flour|spice|season/, '🧂'], [/choc|biscuit|cookie|digestive|sweet|candy/, '🍪'], [/crisp|\bchips?\b/, '🥫'], [/frozen|\bpeas\b|ice/, '🧊'], [/flower|bouquet/, '💐'], [/wine/, '🍷'], [/beer|lager|ale/, '🍺'], [/cake/, '🍰'], [/pizza/, '🍕'], [/cereal|oats|granola/, '🥣'], [/nappy|nappies|diaper|wipes/, '🍼'], [/soap|shampoo|toothpaste|detergent|cleaner|roll/, '🧴']];
function emojiFor(name) { const n = (name || '').toLowerCase(); for (const [re, em] of GROCERY_EMOJI) if (re.test(n)) return em; return '🛒'; }

const DEFAULT_TINTS = ['#6C3DD9', '#6BA368', '#5B8DE0', '#D8788A', '#D89B3A', '#3AADA0'];

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
  const [counts, setCounts] = useState({}); // listId -> open count, for the rail
  const [addWho, setAddWho] = useState(null); // To-dos: assignee for the next add
  const [searchParams] = useSearchParams();
  const quickAdd = !!searchParams.get('quickAdd'); // iOS "Add to list" shortcut
  const isMobile = useIsMobile();

  const active = lists.find((l) => l.id === activeId) || lists[0];
  const isTodos = active?.id === TODOS_ID;

  const buildDescriptors = useCallback((shoppingLists) => {
    const todos = { id: TODOS_ID, name: 'To-dos', emoji: '✅', color: '#6C3DD9', protected: true, kind: 'todos' };
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
        const map = (t, isDone) => ({ id: t.id, text: t.title, done: isDone, section: null, who: (t.assigned_to_ids || [])[0] || null });
        setItems([...(open.tasks || []).map((t) => map(t, false)), ...(done.tasks || []).map((t) => map(t, true))]);
      } else {
        const { data } = await api.get('/shopping', { params: { list_id: list.id, completed: true } });
        setItems((data.items || []).map((i) => ({
          id: i.id, text: i.quantity ? `${i.item} · ${i.quantity}` : i.item, done: !!i.completed,
          section: i.aisle_category || 'Other', who: null, emoji: emojiFor(i.item),
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

  const addItem = useCallback(async () => {
    const text = draft.trim();
    if (!text || !active) return;
    setDraft('');
    try {
      if (isTodos) {
        const m = members.find((x) => x.id === addWho);
        await api.post('/tasks', { title: text, ...(m ? { assigned_to_names: [m.name] } : {}) });
      } else {
        await api.post('/shopping', { item: text, list_id: active.id });
      }
      setCounts((c) => ({ ...c, [active.id]: (c[active.id] || 0) + 1 }));
      await loadItems(active);
    } catch { /* keep draft cleared; reload */ loadItems(active); }
  }, [draft, active, isTodos, loadItems, members, addWho]);

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

  const deleteList = useCallback(async () => {
    if (!active || active.protected) return;
    if (!window.confirm(`Delete the "${active.name}" list and everything on it?`)) return;
    try {
      await api.delete(`/shopping-lists/${active.id}`);
      const sl = (await api.get('/shopping-lists')).data.lists;
      setLists(buildDescriptors(sl));
      setActiveId(TODOS_ID);
    } catch { /* ignore */ }
  }, [active, buildDescriptors]);

  // visible items (To-dos filter by assignee) + grouping
  const filtered = isTodos && toFilter ? items.filter((i) => i.who === toFilter) : items;
  const openItems = filtered.filter((i) => !i.done);
  const doneItems = filtered.filter((i) => i.done);
  const sections = isTodos ? [{ name: null, items: openItems }]
    : Object.entries(openItems.reduce((acc, i) => { (acc[i.section] ||= []).push(i); return acc; }, {})).map(([name, its]) => ({ name, items: its }));
  const memberOf = (id) => members.find((m) => m.id === id);

  return (
    <div style={{ height: '100%', minHeight: 0, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', fontFamily: INTER, color: INK }}>
      <PageHeader kicker={active ? `${openItems.length} open` : ''} title="Lists"
        actions={<PillBtn primary icon={<IcPlus s={14} w={2.4} c="#fff" />} onClick={() => setNewList(true)}>New list</PillBtn>} />

      {loading ? (
        <Center>Loading…</Center>
      ) : (
        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 12 : 20, flex: 1, minHeight: 0 }}>
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
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ background: (active?.color || BRAND) + '12', borderRadius: 22, padding: '20px 22px', display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexShrink: 0 }}>
                <span style={{ fontSize: 26 }}>{active?.emoji}</span>
                <h2 style={{ margin: 0, fontFamily: SERIF, fontSize: 30, fontWeight: 400, color: INK }}>{active?.name}</h2>
              </div>

              {/* To-dos assignee filter */}
              {isTodos && members.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap', flexShrink: 0 }}>
                  <button onClick={() => setToFilter(null)} title="Everyone"
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 16px 4px 4px', borderRadius: 99, border: 0, cursor: 'pointer', background: '#fff', fontFamily: INTER, boxShadow: !toFilter ? `0 0 0 2px #fff, 0 0 0 4px ${BRAND}` : `inset 0 0 0 1px ${LINE_STRONG}` }}>
                    <span style={{ width: 50, height: 50, borderRadius: '50%', background: BRAND, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <IcPeople s={24} c="#fff" />
                    </span>
                    <span style={{ fontSize: 18, fontWeight: 700, color: !toFilter ? BRAND : INK2 }}>{items.filter((i) => !i.done).length}</span>
                  </button>
                  {members.map((m) => (
                    <button key={m.id} onClick={() => setToFilter(toFilter === m.id ? null : m.id)} title={m.name}
                      style={{ border: toFilter === m.id ? `2px solid ${hexFor(m)}` : '2px solid transparent', borderRadius: '50%', padding: 1, background: 'transparent', cursor: 'pointer' }}>
                      <Avatar member={m} size={50} />
                    </button>
                  ))}
                </div>
              )}

              {/* quick add */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexShrink: 0 }}>
                <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addItem(); }}
                  autoFocus={quickAdd}
                  placeholder={isTodos ? 'Add a to-do…' : 'Add an item…'} style={{ flex: 1, padding: '11px 14px', borderRadius: 12, border: `1px solid ${LINE_STRONG}`, fontFamily: INTER, fontSize: 14, outline: 'none', background: '#fff' }} />
                <button onClick={addItem} disabled={!draft.trim()} style={{ padding: '0 18px', borderRadius: 12, border: 0, cursor: 'pointer', background: active?.color || BRAND, color: '#fff', fontWeight: 700, fontFamily: INTER, opacity: draft.trim() ? 1 : 0.5 }}>Add</button>
              </div>

              {/* To-dos: optionally assign the new item to someone */}
              {isTodos && members.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexShrink: 0, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, color: INK3, fontWeight: 600 }}>Assign to</span>
                  {members.map((m) => {
                    const on = addWho === m.id;
                    return (
                      <button key={m.id} onClick={() => setAddWho(on ? null : m.id)} title={m.name}
                        style={{ border: on ? `2px solid ${hexFor(m)}` : '2px solid transparent', borderRadius: '50%', padding: 1, background: 'transparent', cursor: 'pointer', opacity: on ? 1 : 0.65 }}>
                        <Avatar member={m} size={28} />
                      </button>
                    );
                  })}
                  {addWho && <span style={{ fontSize: 12, color: INK2, fontWeight: 600 }}>{members.find((m) => m.id === addWho)?.name}</span>}
                </div>
              )}

              {/* items */}
              <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', margin: '0 -4px', padding: '0 4px' }}>
                {loadingItems ? <div style={{ padding: 20, color: INK3, fontSize: 13 }}>Loading…</div>
                  : openItems.length === 0 && doneItems.length === 0 ? <div style={{ padding: '30px 4px', textAlign: 'center', color: INK3, fontStyle: 'italic' }}>Nothing here yet — add the first item.</div>
                    : (
                      <>
                        {sections.map((sec) => (
                          <div key={sec.name || 'all'} style={{ marginBottom: 14 }}>
                            {sec.name && <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: INK3, padding: '0 4px 8px' }}>{sec.name}</div>}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                              {sec.items.map((it) => <Row key={it.id} it={it} isTodos={isTodos} color={active?.color || BRAND} member={memberOf(it.who)} onToggle={toggle} onDelete={removeItem} />)}
                            </div>
                          </div>
                        ))}
                        {doneItems.length > 0 && (
                          <div style={{ marginTop: 6 }}>
                            <button onClick={() => setDoneOpen((o) => !o)} style={{ display: 'flex', alignItems: 'center', gap: 6, border: 0, background: 'transparent', cursor: 'pointer', fontFamily: INTER, fontSize: 12, fontWeight: 700, color: INK3, padding: '4px' }}>
                              <span style={{ transform: doneOpen ? 'none' : 'rotate(-90deg)', transition: 'transform .15s', display: 'flex' }}><IcChevDown s={14} c={INK3} /></span>
                              Done · {doneItems.length}
                            </button>
                            {doneOpen && <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>{doneItems.map((it) => <Row key={it.id} it={it} isTodos={isTodos} color={active?.color || BRAND} member={memberOf(it.who)} onToggle={toggle} onDelete={removeItem} />)}</div>}
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
    </div>
  );
}

function Center({ children }) { return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: INK3, fontFamily: SERIF, fontSize: 24 }}>{children}</div>; }

function Row({ it, isTodos, color, member, onToggle, onDelete }) {
  const [hover, setHover] = useState(false);
  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#fff', borderRadius: 13, padding: '11px 14px', opacity: it.done ? 0.6 : 1 }}>
      <button onClick={() => onToggle(it)} aria-label={it.done ? 'Mark not done' : 'Mark done'}
        style={{ width: 22, height: 22, borderRadius: '50%', flexShrink: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', border: it.done ? `2px solid ${color}` : `1.5px solid ${LINE_STRONG}`, background: it.done ? color : 'transparent' }}>
        {it.done && <Tick s={12} />}
      </button>
      {!isTodos && <span style={{ width: 32, height: 32, borderRadius: 9, flexShrink: 0, fontSize: 17, display: 'flex', alignItems: 'center', justifyContent: 'center', background: BG_SOFT }}>{it.emoji}</span>}
      <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 500, color: it.done ? INK3 : INK, textDecoration: it.done ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.text}</span>
      {isTodos && member && <Avatar member={member} size={26} />}
      <button onClick={() => onDelete(it)} aria-label="Delete" style={{ width: 28, height: 28, borderRadius: 8, border: 0, background: BG_SOFT, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: hover ? 1 : 0, transition: 'opacity .12s' }}><IcTrash s={14} c="#C24A5E" /></button>
    </div>
  );
}

const LIST_EMOJIS = ['📋', '🛒', '🧳', '🔧', '🎒', '🎁', '🏖️', '🎄', '📦', '🧺', '🛠️', '🐶'];
function NewListModal({ onClose, onSave }) {
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('📋');
  const [color, setColor] = useState(DEFAULT_TINTS[0]);
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(26,22,32,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, fontFamily: INTER }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 22, width: '100%', maxWidth: 440, padding: 24, boxShadow: '0 30px 80px -20px rgba(26,22,32,0.4)' }}>
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
    </div>
  );
}
