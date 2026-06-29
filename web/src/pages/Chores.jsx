// Tasks page — chores & routines, Skylight-style member columns, recurring +
// multi-person, kids earn stars. Rebuilt from design_handoff_tasks_rewards_lists.
// Wired to /api/chores (day-view + per-person/day completion) and /api/household
// (members). Mounted at /chores for now; the nav cutover to /tasks lands in P6
// once Lists houses the old to-dos.
import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../lib/api';
import PageHeader from '../components/ui/PageHeader';
import { BottomSheet } from '../components/BottomSheet';
import PillBtn from '../components/ui/PillBtn';
import Avatar from '../components/ui/Avatar';
import { hexFor } from '../lib/memberColors';
import { useIsMobile, useMediaQuery } from '../hooks/useMediaQuery';
import { buildWeek } from '../lib/choreRecurrence';
import DesktopChoresWeek from './chores/DesktopChoresWeek';
import { useChildMode } from '../context/ChildModeContext';
import { useAuth } from '../context/AuthContext';
import { CHORE_EMOJI_CATS, searchChoreEmojis } from '../lib/choreIcons';

// Design-handoff tokens (page-local; member colours come from each record).
const INK = '#1A1620', INK2 = '#4A4453', INK3 = '#8A8493';
const LINE = 'rgba(26,22,32,0.07)', LINE_STRONG = 'rgba(26,22,32,0.12)';
const BRAND = '#6C3DD9', BRAND_SOFT = '#EFE9FB';
const BG_SOFT = '#F3EEE5', STAR = '#D89B3A', STAR_BG = '#FBF1DE';
const BG_APP = '#FBF8F3'; // page background — the gap colour in the selected-avatar halo
const SERIF = '"Instrument Serif", serif';
const INTER = '"Inter", system-ui, sans-serif';

const SLOT_META = {
  morning: { label: 'Morning', emoji: '☀️' },
  afternoon: { label: 'Afternoon', emoji: '⛅' },
  evening: { label: 'Evening', emoji: '🌙' },
  chores: { label: 'Chores', emoji: '🧹' },
};
const SLOT_ORDER = ['morning', 'afternoon', 'evening', 'chores'];
const WEEK = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const isKid = (m) => m?.member_type === 'dependent';

function currentSlot() {
  const h = new Date().getHours();
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
}
function repeatLabel(t) {
  if (t.repeat === 'once') return 'One-time';
  if (t.repeat === 'weekly') {
    const d = t.days || [];
    if (d.length === 5 && !d.includes('SAT') && !d.includes('SUN')) return 'Weekdays';
    if (d.length === 7) return 'Daily';
    return 'Weekly';
  }
  return null;
}
function dateStrLocal(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// ── tiny inline icons ───────────────────────────────────────────────────────
const Svg = (p) => <svg width={p.s || 16} height={p.s || 16} viewBox="0 0 24 24" fill="none" stroke={p.c || 'currentColor'} strokeWidth={p.w || 2} strokeLinecap="round" strokeLinejoin="round">{p.children}</svg>;
const IcPlus = (p) => <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>;
const IcPeople = (p) => <Svg {...p}><circle cx="9" cy="8" r="3" /><path d="M3 20c0-3 3-5 6-5s6 2 6 5" /><path d="M16 5a3 3 0 0 1 0 6M22 20c0-2.5-2-4.3-4.5-4.8" /></Svg>;
const IcChevL = (p) => <Svg {...p}><path d="M15 6l-6 6 6 6" /></Svg>;
const IcChevR = (p) => <Svg {...p}><path d="M9 6l6 6-6 6" /></Svg>;
const IcChevDown = (p) => <Svg {...p}><path d="M6 9l6 6 6-6" /></Svg>;
const IcPencil = (p) => <Svg {...p}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" /></Svg>;
const IcTrash = (p) => <Svg {...p}><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></Svg>;
const IcClose = (p) => <Svg {...p}><path d="M18 6L6 18M6 6l12 12" /></Svg>;
const IcSearch = (p) => <Svg {...p}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></Svg>;
const IcClock = (p) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Svg>;
const IcRepeat = (p) => <Svg {...p}><path d="M17 2l4 4-4 4" /><path d="M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></Svg>;
const StarFill = ({ s = 12, c = STAR }) => <svg width={s} height={s} viewBox="0 0 24 24" fill={c}><path d="M12 2l3 6.3 6.9.9-5 4.8 1.2 6.8L12 17.8 5.9 20.8 7.1 14 2.1 9.2 9 8.3 12 2z" /></svg>;
const Tick = ({ s = 12, c = '#fff' }) => <svg width={s} height={s} viewBox="0 0 12 12" fill="none"><path d="M2.5 6.5l2.5 2.5 4.5-5" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;

// ── meta chips (time + repeat) ──────────────────────────────────────────────
function MetaChips({ task }) {
  const chips = [];
  if (task.due_time) chips.push({ k: 'time', label: String(task.due_time).slice(0, 5) });
  if (task.type === 'chore') chips.push({ k: 'rep', label: repeatLabel(task) || 'Daily' });
  if (!chips.length) return null;
  return (
    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 4 }}>
      {chips.map((c) => (
        <span key={c.k} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 7px', borderRadius: 99, background: BG_SOFT, fontSize: 10.5, fontWeight: 600, color: INK3 }}>
          {c.k === 'time' ? <IcClock s={10} c={INK3} /> : <IcRepeat s={10} c={INK3} />}{c.label}
        </span>
      ))}
    </div>
  );
}

function StarPill({ n, small }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: small ? '2px 7px' : '3px 9px', borderRadius: 99, background: STAR_BG, flexShrink: 0 }}>
      <StarFill s={small ? 10 : 12} /><span style={{ fontSize: small ? 10.5 : 11.5, fontWeight: 700, color: '#A9772A' }}>{n}</span>
    </span>
  );
}

// Delete control: a repeating task offers "Skip just today" vs "Delete for
// everyone"; a one-time task just deletes.
function DeleteMenu({ task, onDelete, onSkip, align = 'right' }) {
  const [open, setOpen] = useState(false);
  const repeats = task.repeat === 'daily' || task.repeat === 'weekly';
  return (
    <div style={{ position: 'relative' }} onMouseLeave={() => setOpen(false)}>
      <button onClick={(e) => { e.stopPropagation(); if (repeats) setOpen((o) => !o); else onDelete(task); }} aria-label="Delete task" style={cardBtn}><IcTrash s={13} c="#C24A5E" /></button>
      {open && (
        <div onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', top: '110%', [align]: 0, zIndex: 30, background: '#fff', borderRadius: 12, padding: 6, width: 188, border: `1px solid ${LINE}`, boxShadow: '0 14px 40px rgba(26,22,32,0.2)' }}>
          <div style={{ fontSize: 11, color: INK3, padding: '4px 8px 6px' }}>This task repeats.</div>
          <button onClick={() => { onSkip(task); setOpen(false); }} style={menuItem}><IcClock s={14} c={INK2} /> Skip just today</button>
          <button onClick={() => { onDelete(task); setOpen(false); }} style={{ ...menuItem, color: '#C24A5E' }}><IcTrash s={14} c="#C24A5E" /> Delete for everyone</button>
        </div>
      )}
    </div>
  );
}
const menuItem = { display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '9px 8px', borderRadius: 9, border: 0, background: 'transparent', cursor: 'pointer', fontFamily: INTER, fontSize: 13, fontWeight: 600, color: INK, textAlign: 'left' };

// ── a single chore card — one unified compact layout for every member ───────
function ChoreCard({ task, mid, tint, onToggle, onEdit, onDelete, onSkip, onReorder, anyone, members }) {
  const { enabled: childMode } = useChildMode();
  const [hover, setHover] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  // No hover = touch device. There we swipe a card left to reveal the actions
  // instead of showing them inline / on hover.
  const noHover = useMediaQuery('(hover: none)');
  // "Anyone" chores have a single shared done state plus an attributed
  // completer; assigned chores are done per-member.
  const done = anyone ? !!task.completed : !!task.done?.[mid];
  const completer = (anyone && done && members) ? members.find((m) => m.id === task.completed_by) : null;
  // Drag-to-reorder is a desktop (mouse) affordance; keep it off the touch
  // swipe path so the two gestures don't fight. Child Mode is complete-only.
  const dragProps = (onReorder && !childMode && !noHover) ? {
    draggable: true,
    onDragStart: (e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/chore', task.id); },
    onDragOver: (e) => { if (e.dataTransfer.types.includes('text/chore')) { e.preventDefault(); setDragOver(true); } },
    onDragLeave: () => setDragOver(false),
    onDrop: (e) => { e.preventDefault(); setDragOver(false); const id = e.dataTransfer.getData('text/chore'); if (id && id !== task.id) onReorder(id, task.id); },
  } : {};

  // Card content, shared by the desktop and the swipe render paths.
  const inner = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      {/* 44x44 emoji tile to the left of the title; no-icon tasks drop it entirely */}
      {task.emoji && (
        <span style={{ width: 44, height: 44, borderRadius: 12, flexShrink: 0, fontSize: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', background: done ? BG_SOFT : `${tint}1F`, filter: done ? 'grayscale(.4)' : 'none' }}>{task.emoji}</span>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: done ? INK3 : INK, textDecoration: done ? 'line-through' : 'none', lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <MetaChips task={task} />
          {task.reward && task.stars ? <span style={{ marginTop: 4, display: 'inline-flex' }}><StarPill n={task.stars} small /></span> : null}
        </div>
      </div>
      {completer && <Avatar member={completer} size={26} bg="#fff" />}
      <span style={{ width: 24, height: 24, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', border: done ? `2px solid ${tint}` : `1.5px solid ${LINE_STRONG}`, background: done ? tint : 'transparent' }}>
        {done && <Tick s={13} />}
      </span>
    </div>
  );

  // ── Touch: swipe the card left to reveal Edit / Delete ──
  if (noHover && !childMode) {
    return <SwipeChoreCard task={task} mid={mid} done={done} inner={inner} onToggle={onToggle} onEdit={onEdit} onDelete={onDelete} />;
  }

  // ── Desktop / Child Mode: tap toggles; desktop reveals actions on hover ──
  const hoverProps = noHover ? {} : { onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false) };
  return (
    <div {...dragProps} {...hoverProps} onClick={() => onToggle(task, mid)}
      style={{ position: 'relative', cursor: 'pointer', background: '#fff', borderRadius: 16, padding: '12px 14px', opacity: done ? 0.62 : 1, transition: 'opacity .12s, box-shadow .12s', boxShadow: dragOver ? `inset 0 2px 0 ${tint}` : 'none' }}>
      {inner}
      {/* Desktop hover actions — absolutely positioned top-left so they never
          squeeze the title. Hidden in Child Mode, which is complete-only. */}
      {!noHover && !childMode && (
        <div style={{ position: 'absolute', top: 8, left: 8, display: 'flex', gap: 4, opacity: hover ? 1 : 0, transition: 'opacity .12s', background: '#fff', borderRadius: 9, padding: 2, boxShadow: '0 2px 8px rgba(26,22,32,0.12)' }}>
          <button onClick={(e) => { e.stopPropagation(); onEdit(task); }} aria-label="Edit task" style={cardBtn}><IcPencil s={13} c={INK3} /></button>
          <DeleteMenu task={task} onDelete={onDelete} onSkip={onSkip} align="left" />
        </div>
      )}
    </div>
  );
}

// Touch chore card: swipe left to reveal Edit / Delete.
// A plain tap toggles completion; tapping while open just closes the reveal.
function SwipeChoreCard({ task, mid, done, inner, onToggle, onEdit, onDelete }) {
  const BTN = 64;
  const swipeActions = [
    { key: 'edit', label: 'Edit', bg: '#EAE7E0', color: INK2, icon: <IcPencil s={16} c={INK2} />, run: () => onEdit(task) },
    { key: 'del', label: 'Delete', bg: '#D7556A', color: '#fff', icon: <IcTrash s={16} c="#fff" />, run: () => onDelete(task) },
  ];
  const REVEAL = swipeActions.length * BTN;
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dxRef = useRef(0);
  const start = useRef(null); // { x, y, tx }
  const axis = useRef(null);  // 'h' | 'v' | null
  const moved = useRef(false); // a horizontal swipe happened this gesture
  const setTx = (v) => { dxRef.current = v; setDx(v); };

  const onDown = (e) => { start.current = { x: e.clientX, y: e.clientY, tx: dxRef.current }; axis.current = null; moved.current = false; };
  const onMove = (e) => {
    const s = start.current; if (!s) return;
    const ddx = e.clientX - s.x, ddy = e.clientY - s.y;
    if (!axis.current) {
      if (Math.abs(ddx) < 10 && Math.abs(ddy) < 10) return; // slop
      axis.current = Math.abs(ddx) > Math.abs(ddy) ? 'h' : 'v';
      if (axis.current === 'h') { setDragging(true); moved.current = true; try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* unsupported */ } }
    }
    if (axis.current === 'h') setTx(Math.max(-REVEAL, Math.min(0, s.tx + ddx)));
  };
  const onUp = () => {
    const s = start.current; start.current = null; setDragging(false);
    if (s && axis.current === 'h') setTx(dxRef.current < -REVEAL / 2 ? -REVEAL : 0); // snap open/closed
    axis.current = null;
  };
  const onCancel = () => { start.current = null; axis.current = null; setDragging(false); setTx(dxRef.current < -REVEAL / 2 ? -REVEAL : 0); };
  const onCardClick = () => {
    if (dxRef.current !== 0) { setTx(0); return; } // open → tap closes (no toggle)
    if (moved.current) return;                      // just swiped → ignore
    onToggle(task, mid);
  };

  return (
    <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 16 }}>
      {/* Revealed actions, behind the card on the right. Kept fully hidden until
          the card is actually pulled open (dx !== 0) so they can't bleed through
          a completed card's translucent (opacity .62) background. */}
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, display: 'flex', opacity: dx === 0 ? 0 : 1, pointerEvents: dx === 0 ? 'none' : 'auto', transition: dragging ? 'none' : 'opacity .18s ease' }}>
        {swipeActions.map((a) => (
          <button key={a.key} onClick={(e) => { e.stopPropagation(); setTx(0); a.run(); }} aria-label={a.label}
            style={{ width: BTN, border: 0, cursor: 'pointer', background: a.bg, color: a.color, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, fontFamily: INTER, fontSize: 11, fontWeight: 700 }}>
            {a.icon}{a.label}
          </button>
        ))}
      </div>
      <div onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onCancel} onClick={onCardClick}
        style={{ position: 'relative', background: '#fff', cursor: 'pointer', opacity: done ? 0.62 : 1, padding: '12px 14px', transform: `translateX(${dx}px)`, transition: dragging ? 'none' : 'transform .22s ease, opacity .12s', touchAction: 'pan-y' }}>
        {inner}
      </div>
    </div>
  );
}
const cardBtn = { width: 26, height: 26, borderRadius: 7, border: 0, background: BG_SOFT, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' };

// ── circular slot toggle with completion ring ───────────────────────────────
function SlotToggle({ slot, active, color, done, total, onClick }) {
  const meta = SLOT_META[slot];
  const has = total > 0, pct = has ? done / total : 0, allDone = has && done === total;
  const R = 21, C = 2 * Math.PI * R;
  return (
    <button onClick={onClick} title={active ? `Hide ${meta.label}` : `Show ${meta.label}`}
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, border: 0, background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', padding: 0, opacity: active ? 1 : 0.45, transition: 'opacity .12s' }}>
      <div style={{ position: 'relative', width: 50, height: 50 }}>
        <svg width="50" height="50" viewBox="0 0 50 50" style={{ position: 'absolute', inset: 0, transform: 'rotate(-90deg)' }}>
          <circle cx="25" cy="25" r={R} fill={active ? '#fff' : 'rgba(255,255,255,0.4)'} stroke="rgba(26,22,32,0.10)" strokeWidth="2" />
          {has && <circle cx="25" cy="25" r={R} fill="none" stroke={allDone ? '#6BA368' : color} strokeWidth="3.2" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - pct)} style={{ transition: 'stroke-dashoffset .3s ease' }} />}
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>{allDone && active ? <Tick s={20} c="#6BA368" /> : meta.emoji}</div>
      </div>
      <span style={{ fontSize: 11, fontWeight: active ? 700 : 600, color: active ? INK : INK3 }}>{meta.label}</span>
    </button>
  );
}

// ── one member column ───────────────────────────────────────────────────────
function MemberColumn({ m, balance, tasks, onToggle, onEdit, onDelete, onSkip, onReorder, onAdd, mobile, bare }) {
  const { enabled: childMode } = useChildMode();
  const hex = hexFor(m);
  // group tasks into slots
  const groups = SLOT_ORDER.map((key) => ({
    key, meta: SLOT_META[key],
    tasks: key === 'chores' ? tasks.filter((t) => t.type === 'chore') : tasks.filter((t) => t.type === 'routine' && t.slot === key),
  })).filter((g) => g.tasks.length > 0);
  const sectionsPresent = groups.map((g) => g.key);
  const slotsPresent = sectionsPresent.filter((k) => k !== 'chores');
  const focusSlot = slotsPresent.includes(currentSlot()) ? currentSlot() : slotsPresent[0];
  const defaultActive = () => {
    const init = sectionsPresent.filter((k) => k === focusSlot || k === 'chores');
    return init.length ? init : sectionsPresent;
  };
  const [active, setActive] = useState(defaultActive);
  // The useState initializer runs once - if this column first mounted before
  // its tasks had loaded, re-seed the default (focused slot + Chores ON) the
  // first time sections actually appear, so Chores is on from the beginning.
  const seeded = useRef(active.length > 0);
  const sectionsKey = sectionsPresent.join(',');
  useEffect(() => {
    if (seeded.current || !sectionsKey) return;
    seeded.current = true;
    setActive(defaultActive());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionsKey]);
  const toggleSection = (k) => setActive((a) => (a.includes(k) ? a.filter((x) => x !== k) : [...a, k]));
  const total = tasks.length, done = tasks.filter((t) => t.done?.[m.id]).length;
  const slotStats = (k) => { const g = groups.find((x) => x.key === k); return g ? { done: g.tasks.filter((t) => t.done?.[m.id]).length, total: g.tasks.length } : { done: 0, total: 0 }; };
  const visible = groups.filter((g) => active.includes(g.key));

  return (
    <div style={{ flex: mobile ? 'none' : '0 0 320px', width: mobile ? '100%' : undefined, minWidth: mobile ? 0 : 320, background: bare ? 'transparent' : hex + '12', borderRadius: bare ? 0 : 24, padding: bare ? 0 : '18px 16px 14px', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* header (pinned) */}
      {!bare && (
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 4px 14px', flexShrink: 0 }}>
        <Avatar member={m} size={48} bg="#fff" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: SERIF, fontSize: 26, color: INK, lineHeight: 1 }}>{m.name}</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 99, background: '#fff', fontSize: 11.5, fontWeight: 700, color: INK2 }}>
              <Tick s={11} c={INK2} />{done}/{total}
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '3px 9px', borderRadius: 99, background: STAR_BG, fontSize: 11.5, fontWeight: 700, color: '#A9772A' }}><StarFill s={12} />{balance || 0}</span>
          </div>
        </div>
      </div>
      )}
      {bare ? (
        // Mobile: fixed-order sections (no toggles), each with its own
        // done/total + "Done" marker; swipe tiles. Empty sections drop out.
        <div>
          {groups.length === 0 && <div style={{ padding: '12px 4px 4px', fontSize: 13.5, color: INK3, fontStyle: 'italic' }}>Nothing for today.</div>}
          {groups.map((g) => {
            const sd = g.tasks.filter((t) => t.done?.[m.id]).length, st = g.tasks.length;
            const allDone = st > 0 && sd === st;
            const tiles = g.tasks;
            return (
              <div key={g.key} style={{ marginBottom: 22 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 2px 12px' }}>
                  <span style={{ fontSize: 18 }} aria-hidden="true">{g.meta.emoji}</span>
                  <span style={{ fontSize: 16, fontWeight: 700, color: INK }}>{g.meta.label}</span>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: INK3 }}>{sd}/{st}</span>
                  {allDone && <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, color: '#6BA368', fontSize: 12, fontWeight: 700 }}><Tick s={12} c="#6BA368" /> Done</span>}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {tiles.map((t) => <ChoreCard key={t.occurrence_key || t.id} task={t} mid={m.id} tint={hex} onToggle={onToggle} onEdit={onEdit} onDelete={onDelete} onSkip={onSkip} onReorder={onReorder} />)}
                </div>
              </div>
            );
          })}
          {!childMode && (
            <button onClick={() => onAdd(m.id)} style={{ width: '100%', padding: 13, borderRadius: 14, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13.5, fontWeight: 600, background: 'transparent', border: `1px dashed ${hex}66`, color: hex, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <IcPlus s={14} w={2.2} c={hex} /> Add task
            </button>
          )}
        </div>
      ) : (
        <>
          {/* slot toggles (pinned) */}
          {sectionsPresent.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-around', gap: 4, padding: '4px 2px 14px', borderBottom: `1px solid ${hex}22`, marginBottom: 12, flexShrink: 0 }}>
              {sectionsPresent.map((k) => { const s = slotStats(k); return <SlotToggle key={k} slot={k} active={active.includes(k)} color={hex} done={s.done} total={s.total} onClick={() => toggleSection(k)} />; })}
            </div>
          )}
          {/* scroll region (the column scrolls on desktop) */}
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', margin: '0 -4px', padding: '0 4px 2px' }}>
            {visible.length === 0 && <div style={{ padding: '20px 4px', fontSize: 13, color: INK3, fontStyle: 'italic', textAlign: 'center' }}>Nothing here</div>}
            {visible.map((g) => (
              <div key={g.key} style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 4px 8px' }}>
                  <span style={{ fontSize: 17 }}>{g.meta.emoji}</span>
                  <span style={{ fontSize: 16, fontWeight: 600, color: INK2 }}>{g.meta.label}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {g.tasks.map((t) => <ChoreCard key={t.occurrence_key || t.id} task={t} mid={m.id} tint={hex} onToggle={onToggle} onEdit={onEdit} onDelete={onDelete} onSkip={onSkip} onReorder={onReorder} />)}
                </div>
              </div>
            ))}
            {!childMode && (
              <button onClick={() => onAdd(m.id)} style={{ width: '100%', padding: 11, borderRadius: 14, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, background: 'transparent', border: `1px dashed ${hex}66`, color: hex, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <IcPlus s={14} w={2.2} c={hex} /> Add task
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── mobile "<name>'s day" card — progress + rewards shortcut ────────────────
function MemberDayCard({ member, done, total, balance, showRewards, onRewards }) {
  const hex = hexFor(member);
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, background: `${hex}14`, borderRadius: 18, padding: '14px 16px', marginBottom: 16, flexShrink: 0 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: INK }}>{member.name}'s day</div>
        <div style={{ height: 8, borderRadius: 99, background: '#fff', overflow: 'hidden', marginTop: 8 }}>
          <div style={{ height: '100%', width: `${pct}%`, background: hex, borderRadius: 99, transition: 'width .3s ease' }} />
        </div>
        <div style={{ fontSize: 11, color: INK3, marginTop: 6 }}>{done} of {total} done today</div>
      </div>
      {showRewards && (
        <button onClick={onRewards} aria-label="Open rewards" style={{ flexShrink: 0, background: '#fff', borderRadius: 14, padding: '10px 12px', border: 0, cursor: 'pointer', textAlign: 'center', boxShadow: '0 1px 4px rgba(26,22,32,0.08)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}><StarFill s={16} /><span style={{ fontSize: 18, fontWeight: 800, color: INK }}>{balance || 0}</span></div>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: BRAND, marginTop: 2 }}>Rewards ›</div>
        </button>
      )}
    </div>
  );
}

// ── the "Anyone" column — up-for-grabs chores any member can claim ──────────
function AnyoneColumn({ tasks, members, onClaim, onEdit, onDelete, onSkip, onAdd, mobile }) {
  const { enabled: childMode } = useChildMode();
  // Neutral "up for grabs" drop-zone: a dashed outline + muted greys, distinct
  // from the colour-tinted per-member columns. Cards get a grey tile tint.
  const tile = INK3;
  const total = tasks.length;
  const done = tasks.filter((t) => t.completed).length;
  return (
    <div style={{ flex: mobile ? 'none' : '0 0 300px', width: mobile ? '100%' : undefined, minWidth: mobile ? 0 : 300, boxSizing: 'border-box', background: 'rgba(26,22,32,0.02)', border: `1.5px dashed ${LINE_STRONG}`, borderRadius: 24, padding: '18px 14px 14px', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* header (pinned) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 4px 14px', flexShrink: 0 }}>
        <span style={{ width: 48, height: 48, borderRadius: '50%', flexShrink: 0, background: '#fff', border: `1px solid ${LINE_STRONG}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><IcPeople s={22} c={INK3} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: SERIF, fontSize: 26, color: INK, lineHeight: 1 }}>Anyone</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 99, background: '#fff', fontSize: 11.5, fontWeight: 700, color: INK2 }}>
              <Tick s={11} c={INK2} />{done}/{total}
            </span>
            <span style={{ fontSize: 12.5, fontWeight: 500, color: INK3 }}>up for grabs</span>
          </div>
        </div>
      </div>
      {/* chores list (scrolls on desktop; the page scrolls on mobile) */}
      <div style={{ flex: 1, minHeight: 0, overflowY: mobile ? 'visible' : 'auto', overflowX: 'hidden', margin: '0 -4px', padding: '0 4px 2px' }}>
        {total === 0 && <div style={{ padding: '20px 4px', fontSize: 13, color: INK3, fontStyle: 'italic', textAlign: 'center' }}>No up-for-grabs chores yet</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {tasks.map((t) => <ChoreCard key={t.id} task={t} tint={tile} anyone members={members} onToggle={onClaim} onEdit={onEdit} onDelete={onDelete} onSkip={onSkip} />)}
        </div>
        {!childMode && (
          <button onClick={() => onAdd()} style={{ width: '100%', marginTop: 10, padding: 11, borderRadius: 14, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, background: 'transparent', border: `1.5px dashed ${LINE_STRONG}`, color: INK3, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <IcPlus s={14} w={2.2} c={INK3} /> Add chore
          </button>
        )}
      </div>
    </div>
  );
}

// ── "Who completed this task?" — attribution popup for an Anyone chore ──────
function WhoCompletedModal({ task, members, currentUserId, onClose, onPick }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(26,22,32,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, fontFamily: INTER }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 22, width: '100%', maxWidth: 420, padding: 24, boxShadow: '0 30px 80px -20px rgba(26,22,32,0.4)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 4 }}>
          <h2 style={{ margin: 0, fontFamily: SERIF, fontSize: 26, fontWeight: 400, color: INK }}>Who completed this task?</h2>
          <button onClick={onClose} aria-label="Close" style={{ ...cardBtn, width: 34, height: 34, flexShrink: 0 }}><IcClose s={18} c={INK2} /></button>
        </div>
        <div style={{ fontSize: 13, color: INK3, marginBottom: 18 }}>
          {task.title}{task.reward && task.stars ? <> · <span style={{ color: '#A9772A', fontWeight: 700 }}>{task.stars} ★</span></> : null}
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {members.map((m) => {
            const me = m.id === currentUserId;
            return (
              <button key={m.id} onClick={() => onPick(m.id)} title={m.name}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, width: 78, padding: '10px 4px', borderRadius: 16, border: me ? `1.5px solid ${hexFor(m)}` : `1px solid ${LINE}`, background: '#fff', cursor: 'pointer' }}>
                <Avatar member={m} size={48} bg="#fff" />
                <span style={{ fontSize: 12.5, fontWeight: 600, color: INK, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 68 }}>{m.name}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── page ────────────────────────────────────────────────────────────────────
export default function Chores() {
  const [members, setMembers] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [balances, setBalances] = useState({});
  const [loading, setLoading] = useState(true);
  const [dayOffset, setDayOffset] = useState(0);
  // Desktop-only "Week" view: a separate mode (toggled in the header) with its
  // own week reference date, selected member, and raw /chores/week payload.
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const [view, setView] = useState('day'); // 'day' | 'week'
  const [weekRefStr, setWeekRefStr] = useState(null); // 'YYYY-MM-DD' anchor; null = today
  const [weekWho, setWeekWho] = useState(null);
  const [weekData, setWeekData] = useState(null); // { from, to, today, defs, completions, skips, balances }
  const [visibleIds, setVisibleIds] = useState(null); // null = everyone (desktop people filter)
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef(null);
  const [modal, setModal] = useState(null); // { mode, task?, defaultWho?, anyone? }
  const [celebrate, setCelebrate] = useState(null); // { member, balance }
  const [claim, setClaim] = useState(null); // anyone chore awaiting "who completed?"
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isMobile = useIsMobile();
  const { enabled: childMode } = useChildMode();
  const [activeWho, setActiveWho] = useState(null); // mobile: which member's column is shown
  const [slideDir, setSlideDir] = useState(0); // mobile: column slide-in direction (-1 prev, +1 next)
  useEffect(() => {
    if (document.getElementById('chore-swipe-css')) return;
    const s = document.createElement('style');
    s.id = 'chore-swipe-css';
    s.textContent = '@keyframes choreSlideL{from{transform:translateX(-22px);opacity:.4}to{transform:none;opacity:1}}@keyframes choreSlideR{from{transform:translateX(22px);opacity:.4}to{transform:none;opacity:1}}';
    document.head.appendChild(s);
  }, []);

  // iOS home-screen "Add Task" shortcut lands here with ?quickAdd=1.
  useEffect(() => { if (!childMode && searchParams.get('quickAdd')) setModal({ mode: 'add' }); }, [searchParams, childMode]);

  // Close the people filter on an outside click (not on mouse-leave, which
  // would snap shut the moment the cursor crossed the gap to the menu).
  useEffect(() => {
    if (!filterOpen) return undefined;
    const onDoc = (e) => { if (filterRef.current && !filterRef.current.contains(e.target)) setFilterOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [filterOpen]);

  const selDate = new Date(); selDate.setDate(selDate.getDate() + dayOffset);
  const selDateStr = dateStrLocal(selDate);
  const kicker = selDate.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const dayLabel = dayOffset === 0 ? 'Today' : selDate.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

  const loadDay = useCallback(async (dateStr) => {
    const { data } = await api.get('/chores', { params: { date: dateStr } });
    setTasks(data.tasks || []);
    setBalances(data.balances || {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [{ data: hh }] = await Promise.all([api.get('/household')]);
        if (!cancelled) setMembers(hh.members || []);
        await loadDay(selDateStr);
      } catch { /* surfaced as empty */ } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadDay(selDateStr);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selDateStr]);

  const toggle = useCallback(async (task, mid) => {
    const next = !task.done?.[mid];
    const member = members.find((m) => m.id === mid);
    // Match by occurrence_key, not id: a routine in several slots shares one id
    // but each slot is its own independent instance/tick.
    const ek = task.occurrence_key || task.id;
    const nextTasks = tasks.map((t) => ((t.occurrence_key || t.id) === ek ? { ...t, done: { ...t.done, [mid]: next } } : t));
    setTasks(nextTasks);
    // Celebrate when a member completes the LAST of their rewarded tasks for the day.
    const rewardTasks = nextTasks.filter((t) => (t.assignee_ids || []).includes(mid) && t.reward);
    const justFinishedAll = next && task.reward && rewardTasks.length > 0 && rewardTasks.every((t) => t.done?.[mid]);
    try {
      const { data } = await api.post(`/chores/${task.id}/complete`, { member_id: mid, date: selDateStr, done: next, slot: task.slot || '' });
      if (data.balances) setBalances(data.balances);
      if (justFinishedAll) setCelebrate({ member, balance: data.balances?.[mid] ?? 0 });
    } catch {
      setTasks((ts) => ts.map((t) => ((t.occurrence_key || t.id) === ek ? { ...t, done: { ...t.done, [mid]: !next } } : t))); // revert
    }
  }, [selDateStr, tasks, members]);

  const handleDelete = useCallback((task) => {
    // "Delete for everyone" - reached from the card menu (repeating) or a direct
    // trash tap (one-time), so no extra confirm.
    setTasks((ts) => ts.filter((t) => t.id !== task.id));
    api.delete(`/chores/${task.id}`).catch(() => loadDay(selDateStr));
  }, [selDateStr, loadDay]);

  const handleSkip = useCallback((task) => {
    setTasks((ts) => ts.filter((t) => t.id !== task.id));
    api.post(`/chores/${task.id}/skip`, { date: selDateStr }).catch(() => loadDay(selDateStr));
  }, [selDateStr, loadDay]);

  const handleReorder = useCallback((dragId, targetId) => {
    const from = tasks.findIndex((t) => t.id === dragId);
    const to = tasks.findIndex((t) => t.id === targetId);
    if (from < 0 || to < 0 || from === to) return;
    const arr = [...tasks];
    const [moved] = arr.splice(from, 1);
    arr.splice(to, 0, moved);
    setTasks(arr);
    api.post('/chores/reorder', { ids: [...new Set(arr.map((t) => t.id))] }).catch(() => loadDay(selDateStr));
  }, [tasks, selDateStr, loadDay]);

  const handleSave = useCallback(async (form) => {
    try {
      if (form.id) await api.patch(`/chores/${form.id}`, form);
      else await api.post('/chores', form);
      setModal(null);
      await loadDay(selDateStr);
    } catch (e) { alert(e.response?.data?.error || 'Could not save the task.'); }
  }, [selDateStr, loadDay]);

  // Anyone chores: a single shared completion attributed to the chosen member,
  // who is credited any stars. Optimistic, then persisted.
  const setAnyoneDone = useCallback(async (task, memberId, done) => {
    setTasks((ts) => ts.map((t) => (t.id === task.id ? { ...t, completed: done, completed_by: done ? memberId : null } : t)));
    try {
      const { data } = await api.post(`/chores/${task.id}/complete`, { member_id: memberId, date: selDateStr, done });
      if (data.balances) setBalances(data.balances);
    } catch { loadDay(selDateStr); }
  }, [selDateStr, loadDay]);

  // Tap an Anyone chore: if already done, uncheck it (refunds the completer);
  // otherwise open the "Who completed this task?" popup to attribute it.
  const claimAnyone = useCallback((task) => {
    if (task.completed) setAnyoneDone(task, task.completed_by, false);
    else setClaim(task);
  }, [setAnyoneDone]);

  // ── Week view (desktop) ──────────────────────────────────────────────────
  const weekMode = view === 'week' && isDesktop;
  const loadWeek = useCallback(async (refStr) => {
    const { data } = await api.get('/chores/week', { params: refStr ? { date: refStr } : {} });
    setWeekData(data);
  }, []);
  useEffect(() => { if (weekMode) loadWeek(weekRefStr); }, [weekMode, weekRefStr, loadWeek]);
  // Default the selected week-member to the first shown member.
  useEffect(() => {
    if (weekMode && !weekWho && members.length) {
      const pool = childMode ? members.filter(isKid) : members;
      setWeekWho((pool[0] || members[0]).id);
    }
  }, [weekMode, weekWho, members, childMode]);

  const weekDays = weekData ? buildWeek(weekData.from, weekData.today) : [];
  const weekIsThis = weekDays.some((d) => d.isToday);
  const fmtDay = (s, opts) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-GB', opts); };
  const weekLabel = !weekData ? 'Week' : weekIsThis ? 'This week' : `${fmtDay(weekData.from, { day: 'numeric' })}–${fmtDay(weekData.to, { day: 'numeric', month: 'short' })}`;
  const shiftWeek = (deltaDays) => {
    const base = weekRefStr || weekData?.today || dateStrLocal(new Date());
    const [y, m, d] = base.split('-').map(Number);
    const dt = new Date(y, m - 1, d); dt.setDate(dt.getDate() + deltaDays);
    setWeekRefStr(dateStrLocal(dt));
  };
  // Toggle a Week cell (today only). Optimistic over weekData.completions; the
  // write hits the same /complete endpoint with that cell's date.
  const weekToggle = useCallback(async (def, slot, dateStr, memberId, nextDone) => {
    const k = (c) => `${c.definition_id}|${c.slot || ''}|${c.member_id}|${c.date}`;
    const target = `${def.id}|${slot || ''}|${memberId}|${dateStr}`;
    setWeekData((wd) => {
      if (!wd) return wd;
      const completions = nextDone
        ? [...wd.completions, { definition_id: def.id, member_id: memberId, slot: slot || '', date: dateStr }]
        : wd.completions.filter((c) => k(c) !== target);
      return { ...wd, completions };
    });
    try {
      const { data } = await api.post(`/chores/${def.id}/complete`, { member_id: memberId, date: dateStr, done: nextDone, slot: slot || '' });
      if (data.balances) setWeekData((wd) => (wd ? { ...wd, balances: data.balances } : wd));
    } catch { loadWeek(weekRefStr); }
  }, [weekRefStr, loadWeek]);

  // Child Mode shows only dependents across the board (columns, mobile pills,
  // swipe). loadDay/tasksFor still operate on real ids.
  const baseMembers = childMode ? members.filter(isKid) : members;
  const shown = visibleIds ? baseMembers.filter((m) => visibleIds.includes(m.id)) : baseMembers;
  // The up-for-grabs "Anyone" chores get their own column. Parents always see
  // it (so they can add to it); in Child Mode it only appears once it has
  // chores to claim.
  const anyoneTasks = tasks.filter((t) => t.anyone);
  const showAnyone = true; // always offered, incl. Child Mode (kids claim up-for-grabs chores)
  // Mobile selectables = member pills + an "Anyone" pill (id 'anyone').
  const selectables = showAnyone ? [...baseMembers, { id: 'anyone' }] : baseMembers;
  const anyoneActive = activeWho === 'anyone' && showAnyone;
  const activeMember = baseMembers.find((m) => m.id === activeWho) || baseMembers[0];
  const selectedId = anyoneActive ? 'anyone' : activeMember?.id;
  // Mobile: change the shown column, remembering travel direction so the new
  // column slides in from the correct side.
  const goToMember = (id) => {
    if (!id) return;
    const cur = selectables.findIndex((m) => m.id === selectedId);
    const nxt = selectables.findIndex((m) => m.id === id);
    if (nxt === -1) return;
    setSlideDir(nxt > cur ? 1 : nxt < cur ? -1 : 0);
    setActiveWho(id);
  };
  const tasksFor = (mid) => tasks.filter((t) => !t.anyone && (t.assignee_ids || []).includes(mid));
  const toggleVisible = (id) => setVisibleIds((prev) => {
    const cur = prev || members.map((m) => m.id);
    const nextArr = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    return nextArr.length === members.length ? null : nextArr;
  });

  return (
    <div style={{ height: '100%', minHeight: 0, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', fontFamily: INTER, color: INK }}>
      <PageHeader
        className="mb-5 md:mb-7"
        kicker={kicker}
        title="Tasks"
        actions={(
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {!isMobile && !childMode && (
            <div ref={filterRef} style={{ position: 'relative' }}>
              <button onClick={() => setFilterOpen((o) => !o)} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 16px', borderRadius: 99, cursor: 'pointer', fontFamily: INTER, fontSize: 13.5, fontWeight: 600, background: visibleIds ? INK : BG_SOFT, color: visibleIds ? '#fff' : INK2, border: 0 }}>
                <IcPeople s={16} c={visibleIds ? '#fff' : INK2} /> {visibleIds ? `${shown.length} of ${members.length}` : 'Everyone'}
              </button>
              {filterOpen && (
                <div onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 40, background: '#fff', borderRadius: 14, padding: 6, width: 210, maxHeight: 340, overflowY: 'auto', border: `1px solid ${LINE}`, boxShadow: '0 14px 44px rgba(26,22,32,0.2)' }}>
                  <button onClick={() => setVisibleIds(null)} style={{ ...filterRow, color: visibleIds ? INK : BRAND, fontWeight: 700 }}><IcPeople s={18} c={visibleIds ? INK2 : BRAND} /> Everyone</button>
                  <div style={{ height: 1, background: LINE, margin: '4px 0' }} />
                  {members.map((m) => {
                    const on = !visibleIds || visibleIds.includes(m.id);
                    return (
                      <button key={m.id} onClick={() => toggleVisible(m.id)} style={filterRow}>
                        <Avatar member={m} size={26} bg="#fff" /><span style={{ fontSize: 13.5, fontWeight: 600 }}>{m.name}</span>
                        <span style={{ marginLeft: 'auto', width: 18, height: 18, borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', background: on ? hexFor(m) : 'transparent', border: on ? `1px solid ${hexFor(m)}` : `1.5px solid ${LINE_STRONG}` }}>{on && <Tick s={12} />}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            )}
            {/* Day/Week toggle — desktop only (the 7-day grid needs the width). */}
            {isDesktop && !childMode && (
              <div style={{ display: 'inline-flex', background: BG_SOFT, borderRadius: 99, padding: 3 }}>
                {['day', 'week'].map((v) => (
                  <button key={v} onClick={() => setView(v)} style={{ padding: '6px 15px', borderRadius: 99, border: 0, cursor: 'pointer', fontFamily: INTER, fontSize: 13, fontWeight: 700, textTransform: 'capitalize', background: view === v ? '#fff' : 'transparent', color: view === v ? INK : INK2, boxShadow: view === v ? '0 1px 4px rgba(26,22,32,0.12)' : 'none' }}>{v}</button>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {weekMode ? (
                <>
                  <button onClick={() => shiftWeek(-7)} aria-label="Previous week" style={dayNav}><IcChevL s={18} c={INK2} /></button>
                  <button onClick={() => setWeekRefStr(null)} style={{ padding: '9px 20px', borderRadius: 99, border: 0, cursor: 'pointer', fontFamily: INTER, fontSize: 13.5, fontWeight: 600, background: BG_SOFT, color: INK, minWidth: 112 }}>{weekLabel}</button>
                  <button onClick={() => shiftWeek(7)} aria-label="Next week" style={dayNav}><IcChevR s={18} c={INK2} /></button>
                </>
              ) : (
                <>
                  <button onClick={() => setDayOffset((d) => d - 1)} aria-label="Previous day" style={dayNav}><IcChevL s={18} c={INK2} /></button>
                  <button onClick={() => setDayOffset(0)} style={{ padding: '9px 20px', borderRadius: 99, border: 0, cursor: 'pointer', fontFamily: INTER, fontSize: 13.5, fontWeight: 600, background: BG_SOFT, color: INK, minWidth: 96 }}>{dayLabel}</button>
                  <button onClick={() => setDayOffset((d) => d + 1)} aria-label="Next day" style={dayNav}><IcChevR s={18} c={INK2} /></button>
                </>
              )}
            </div>
            {!childMode && (isMobile
              ? <PillBtn primary aria-label="Add task" className="h-11 w-11 justify-center px-0! rounded-full!" icon={<IcPlus s={18} w={2.4} c="#fff" />} onClick={() => setModal({ mode: 'add' })} />
              : <PillBtn primary aria-label="Add task" className="w-9 justify-center px-0!" icon={<IcPlus s={16} w={2.4} c="#fff" />} onClick={() => setModal({ mode: 'add' })} />
            )}
          </div>
        )}
      />

      {loading ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: INK3, fontFamily: SERIF, fontSize: 24 }}>Loading…</div>
      ) : members.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: INK3, fontFamily: SERIF, fontSize: 24 }}>Add family members to start assigning tasks.</div>
      ) : isMobile ? (
        // Mobile: a person selector + one member's column, full width, page-scrolled.
        // paddingBottom clears the floating AI chat button once scrolled to the end.
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', paddingBottom: 160 }}>
          {/* member avatars */}
          <div style={{ display: 'flex', gap: 14, overflowX: 'auto', padding: '7px 0 16px', flexShrink: 0, WebkitOverflowScrolling: 'touch' }}>
            {baseMembers.map((m) => {
              const sel = !anyoneActive && m.id === (activeMember?.id);
              const all = tasksFor(m.id); const dn = all.filter((t) => t.done?.[m.id]).length;
              const showStar = isKid(m) || (balances[m.id] || 0) > 0;
              return (
                <button key={m.id} onClick={() => goToMember(m.id)} style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, width: 64, padding: 0, background: 'transparent', border: 0, cursor: 'pointer', fontFamily: INTER }}>
                  <div style={{ position: 'relative' }}>
                    <div style={{ borderRadius: '50%', boxShadow: sel ? `0 0 0 3px ${BG_APP}, 0 0 0 5px ${hexFor(m)}` : 'none', opacity: sel ? 1 : 0.85, transition: 'all .15s ease' }}>
                      <Avatar member={m} size={52} bg="#fff" />
                    </div>
                    {showStar && (
                      <div style={{ position: 'absolute', bottom: -4, right: -8, display: 'flex', alignItems: 'center', gap: 2, background: '#fff', borderRadius: 99, padding: '2px 6px', boxShadow: '0 2px 6px rgba(26,22,32,0.15)' }}>
                        <StarFill s={10} /><span style={{ fontSize: 10, fontWeight: 800, color: '#A9772A' }}>{balances[m.id] || 0}</span>
                      </div>
                    )}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: sel ? 700 : 600, color: sel ? INK : INK3 }}>{m.name}</div>
                  <div style={{ fontSize: 10, color: INK3, fontVariantNumeric: 'tabular-nums' }}>{dn}/{all.length}</div>
                </button>
              );
            })}
            {showAnyone && (
              <button onClick={() => goToMember('anyone')} style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, width: 64, padding: 0, background: 'transparent', border: 0, cursor: 'pointer', fontFamily: INTER }}>
                <div style={{ borderRadius: '50%', boxShadow: anyoneActive ? `0 0 0 3px ${BG_APP}, 0 0 0 5px ${INK}` : 'none', opacity: anyoneActive ? 1 : 0.85, transition: 'all .15s ease' }}>
                  <span style={{ width: 52, height: 52, borderRadius: '50%', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', background: BG_SOFT, border: `1px solid ${LINE_STRONG}` }}><IcPeople s={22} c={INK3} /></span>
                </div>
                <div style={{ fontSize: 12, fontWeight: anyoneActive ? 700 : 600, color: anyoneActive ? INK : INK3 }}>Anyone</div>
                <div style={{ fontSize: 10, color: INK3, fontVariantNumeric: 'tabular-nums' }}>{anyoneTasks.filter((t) => t.completed).length}/{anyoneTasks.length}</div>
              </button>
            )}
          </div>
          {anyoneActive ? (
            <div key="anyone"
              style={{ animation: slideDir > 0 ? 'choreSlideR .2s ease' : slideDir < 0 ? 'choreSlideL .2s ease' : 'none' }}>
              <AnyoneColumn tasks={anyoneTasks} members={members} mobile onClaim={claimAnyone}
                onEdit={(t) => setModal({ mode: 'edit', task: t })} onDelete={handleDelete} onSkip={handleSkip}
                onAdd={() => setModal({ mode: 'add', anyone: true })} />
            </div>
          ) : activeMember && (
            <div key={activeMember.id}
              style={{ animation: slideDir > 0 ? 'choreSlideR .2s ease' : slideDir < 0 ? 'choreSlideL .2s ease' : 'none' }}>
              <MemberDayCard member={activeMember} done={tasksFor(activeMember.id).filter((t) => t.done?.[activeMember.id]).length} total={tasksFor(activeMember.id).length} balance={balances[activeMember.id]} showRewards={isKid(activeMember) || (balances[activeMember.id] || 0) > 0} onRewards={() => navigate(`/rewards?member=${activeMember.id}`)} />
              <MemberColumn m={activeMember} balance={balances[activeMember.id]} tasks={tasksFor(activeMember.id)} mobile bare
                onToggle={toggle} onEdit={(t) => setModal({ mode: 'edit', task: t })} onDelete={handleDelete} onSkip={handleSkip} onReorder={handleReorder} onAdd={(mid) => setModal({ mode: 'add', defaultWho: mid })} />
            </div>
          )}
        </div>
      ) : weekMode ? (
        <DesktopChoresWeek
          members={shown}
          who={weekWho}
          setWho={setWeekWho}
          defs={weekData?.defs || []}
          completions={weekData?.completions || []}
          skips={weekData?.skips || []}
          weekDays={weekDays}
          today={weekData?.today}
          balances={weekData?.balances || balances}
          onToggle={weekToggle}
          onEdit={(def) => setModal({ mode: 'edit', task: def })}
        />
      ) : (
        <div style={{ display: 'flex', gap: 16, overflowX: 'auto', paddingBottom: 4, alignItems: 'stretch', flex: 1, minHeight: 0 }}>
          {shown.map((m) => (
            <MemberColumn key={m.id} m={m} balance={balances[m.id]} tasks={tasksFor(m.id)}
              onToggle={toggle} onEdit={(t) => setModal({ mode: 'edit', task: t })} onDelete={handleDelete} onSkip={handleSkip} onReorder={handleReorder} onAdd={(mid) => setModal({ mode: 'add', defaultWho: mid })} />
          ))}
          {showAnyone && (
            <AnyoneColumn tasks={anyoneTasks} members={members} onClaim={claimAnyone}
              onEdit={(t) => setModal({ mode: 'edit', task: t })} onDelete={handleDelete} onSkip={handleSkip}
              onAdd={() => setModal({ mode: 'add', anyone: true })} />
          )}
        </div>
      )}

      {modal && <TaskModal modal={modal} members={members} onClose={() => setModal(null)} onSave={handleSave} />}
      {celebrate && <Celebration data={celebrate} onClose={() => setCelebrate(null)} onGo={() => { const mid = celebrate.member?.id; setCelebrate(null); navigate(mid ? `/rewards?member=${mid}` : '/rewards'); }} />}
      {claim && <WhoCompletedModal task={claim} members={members} currentUserId={user?.id} onClose={() => setClaim(null)} onPick={(mid) => { setAnyoneDone(claim, mid, true); setClaim(null); }} />}
    </div>
  );
}

// ── celebration overlay (confetti) ──────────────────────────────────────────
function Celebration({ data, onClose, onGo }) {
  useEffect(() => {
    if (document.getElementById('chore-confetti-css')) return;
    const s = document.createElement('style');
    s.id = 'chore-confetti-css';
    s.textContent = '@keyframes choreFall{0%{transform:translateY(-40px) rotate(0);opacity:1}100%{transform:translateY(900px) rotate(680deg);opacity:.9}}@keyframes chorePop{0%{transform:scale(.5);opacity:0}60%{transform:scale(1.06);opacity:1}100%{transform:scale(1);opacity:1}}';
    document.head.appendChild(s);
  }, []);
  const colors = ['#6C3DD9', '#D89B3A', '#6BA368', '#D8788A', '#5B8DE0'];
  const bits = Array.from({ length: 60 }, (_, i) => i);
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(26,22,32,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, overflow: 'hidden', fontFamily: INTER }}>
      {bits.map((i) => (
        <span key={i} aria-hidden="true" style={{ position: 'absolute', top: -20, left: `${(i * 37) % 100}%`, width: 9, height: 14, borderRadius: 2, background: colors[i % colors.length], animation: `choreFall ${1.8 + (i % 5) * 0.4}s linear ${(i % 7) * 0.15}s infinite` }} />
      ))}
      <div onClick={(e) => e.stopPropagation()} style={{ position: 'relative', background: '#fff', borderRadius: 24, padding: '32px 28px', width: '100%', maxWidth: 380, textAlign: 'center', boxShadow: '0 30px 80px -20px rgba(26,22,32,0.5)', animation: 'chorePop .35s ease both' }}>
        <div style={{ fontSize: 52, marginBottom: 8 }}>🎉</div>
        <h2 style={{ margin: 0, fontFamily: SERIF, fontSize: 32, fontWeight: 400, color: INK }}>Amazing, {data.member?.name}!</h2>
        <p style={{ margin: '8px 0 18px', fontSize: 14, color: INK2 }}>All your star tasks are done for today.</p>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: STAR_BG, borderRadius: 99, padding: '8px 18px', marginBottom: 20 }}>
          <StarFill s={22} /><span style={{ fontSize: 26, fontWeight: 800, color: '#A9772A' }}>{data.balance}</span>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, padding: '11px', borderRadius: 12, border: `1px solid ${LINE_STRONG}`, background: '#fff', cursor: 'pointer', fontFamily: INTER, fontWeight: 600, fontSize: 14, color: INK2 }}>Nice!</button>
          <button onClick={onGo} style={{ flex: 1, padding: '11px', borderRadius: 12, border: 0, background: BRAND, color: '#fff', cursor: 'pointer', fontFamily: INTER, fontWeight: 700, fontSize: 14 }}>Spend stars →</button>
        </div>
      </div>
    </div>
  );
}
const filterRow = { display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 10px', borderRadius: 9, border: 0, background: 'transparent', cursor: 'pointer', fontFamily: INTER, fontSize: 13.5, fontWeight: 600, color: INK, textAlign: 'left' };
const dayNav = { width: 38, height: 38, borderRadius: 99, border: 0, background: BG_SOFT, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' };

// ── Add / Edit modal ────────────────────────────────────────────────────────
function TaskModal({ modal, members, onClose, onSave }) {
  const t = modal.task || {};
  const [title, setTitle] = useState(t.title || '');
  const [emoji, setEmoji] = useState(t.emoji || '');
  const [assignees, setAssignees] = useState(t.assignee_ids || (modal.defaultWho ? [modal.defaultWho] : []));
  const [type, setType] = useState(t.type || 'chore');
  const [whens, setWhens] = useState(t.whens || []);
  const [repeat, setRepeat] = useState(t.repeat || 'daily');
  const [days, setDays] = useState(t.days || []);
  const [startDate, setStartDate] = useState(t.start_date || '');
  const [dueTime, setDueTime] = useState(t.due_time ? String(t.due_time).slice(0, 5) : '');
  const [reward, setReward] = useState(!!t.reward);
  const [stars, setStars] = useState(t.stars || 5);

  // "Anyone" chores carry no assignee and are always a chore (not a routine);
  // the completer is chosen at check-off. Adults earn stars too now, so any
  // assignee (or an anyone chore) can carry a reward.
  const isAnyone = !!(modal.anyone || t.anyone);
  const rewardable = isAnyone || assignees.length > 0;
  const toggleIn = (arr, set, v) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  const submit = () => {
    if (!title.trim()) return;
    onSave({
      id: t.id, title: title.trim(), emoji: emoji || null,
      type: isAnyone ? 'chore' : type, anyone: isAnyone,
      assignee_ids: isAnyone ? [] : assignees,
      whens: (!isAnyone && type === 'routine') ? whens : [],
      repeat, days: repeat === 'weekly' ? days : [],
      start_date: startDate || null, due_time: dueTime || null,
      reward: rewardable ? reward : false, stars: rewardable && reward ? stars : 0,
    });
  };

  return (
    <BottomSheet open onDismiss={onClose} desktopWidthClass="sm:w-[520px]">
      <div className="overflow-y-auto min-h-0" style={{ padding: '8px 24px 24px', fontFamily: INTER }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <h2 style={{ margin: 0, fontFamily: SERIF, fontSize: 30, fontWeight: 400, color: INK }}>{t.id ? 'Edit task' : (isAnyone ? 'New shared chore' : 'New task')}</h2>
          <button onClick={onClose} aria-label="Close" style={{ ...cardBtn, width: 34, height: 34 }}><IcClose s={18} c={INK2} /></button>
        </div>

        <Field label="Title">
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Make the bed" style={input} />
        </Field>

        <Field label="Icon"><IconPicker value={emoji} onChange={setEmoji} /></Field>

        {isAnyone ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 12, background: BRAND_SOFT, marginBottom: 16, fontSize: 12.5, fontWeight: 600, color: BRAND }}>
            <IcPeople s={16} c={BRAND} /> Anyone can complete this — you'll pick who did it when it's checked off.
          </div>
        ) : (
          <>
            <Field label="Who">
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {members.map((m) => {
                  const on = assignees.includes(m.id);
                  return (
                    <button key={m.id} onClick={() => toggleIn(assignees, setAssignees, m.id)} title={m.name}
                      style={{ position: 'relative', border: on ? `2px solid ${hexFor(m)}` : '2px solid transparent', borderRadius: '50%', padding: 1, background: 'transparent', cursor: 'pointer' }}>
                      <Avatar member={m} size={50} bg="#fff" />
                      {on && <span style={{ position: 'absolute', right: -2, bottom: -2, width: 18, height: 18, borderRadius: '50%', background: hexFor(m), border: '2px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Tick s={10} /></span>}
                    </button>
                  );
                })}
              </div>
            </Field>

            <Field label="Type">
              <Seg options={[{ v: 'chore', l: 'Chore' }, { v: 'routine', l: 'Routine' }]} value={type} onChange={setType} />
            </Field>
          </>
        )}

        {!isAnyone && type === 'routine' && (
          <Field label="Time of day">
            <div style={{ display: 'flex', gap: 8 }}>
              {['morning', 'afternoon', 'evening'].map((w) => (
                <Chip key={w} on={whens.includes(w)} onClick={() => toggleIn(whens, setWhens, w)}>{SLOT_META[w].emoji} {SLOT_META[w].label}</Chip>
              ))}
            </div>
          </Field>
        )}

        <Field label="Repeat">
          <Seg options={[{ v: 'daily', l: 'Daily' }, { v: 'weekly', l: 'Weekly' }, { v: 'once', l: 'One-time' }]} value={repeat} onChange={setRepeat} />
          {repeat === 'weekly' && (
            <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
              {WEEK.map((d) => <Chip key={d} on={days.includes(d)} onClick={() => toggleIn(days, setDays, d)} small>{d[0] + d[1].toLowerCase()}</Chip>)}
            </div>
          )}
        </Field>

        <div style={{ display: 'flex', gap: 12 }}>
          <Field label="Starts" style={{ flex: 1 }}><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={input} /></Field>
          <Field label="Due time (optional)" style={{ flex: 1 }}><input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} style={input} /></Field>
        </div>

        {rewardable && (
          <Field label="Reward">
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <button onClick={() => setReward((r) => !r)} style={{ width: 46, height: 28, borderRadius: 99, border: 0, cursor: 'pointer', background: reward ? STAR : LINE_STRONG, position: 'relative', transition: 'background .15s' }}>
                <span style={{ position: 'absolute', top: 3, left: reward ? 21 : 3, width: 22, height: 22, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
              </button>
              {reward && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button onClick={() => setStars((s) => Math.max(1, s - 1))} style={stepBtn}>−</button>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 56, justifyContent: 'center', fontWeight: 700, color: '#A9772A' }}><StarFill s={14} /> {stars}</span>
                  <button onClick={() => setStars((s) => Math.min(999, s + 1))} style={stepBtn}>+</button>
                </div>
              )}
            </div>
          </Field>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
          <button onClick={onClose} style={{ ...input, width: 'auto', padding: '10px 18px', cursor: 'pointer', fontWeight: 600, background: '#fff' }}>Cancel</button>
          <button onClick={submit} disabled={!title.trim() || (!isAnyone && assignees.length === 0)} style={{ padding: '10px 22px', borderRadius: 10, border: 0, cursor: 'pointer', fontWeight: 600, fontSize: 14, fontFamily: INTER, background: BRAND, color: '#fff', opacity: (!title.trim() || (!isAnyone && assignees.length === 0)) ? 0.5 : 1 }}>{t.id ? 'Save' : (isAnyone ? 'Add chore' : 'Add task')}</button>
        </div>
      </div>
    </BottomSheet>
  );
}

function Field({ label, children, style }) {
  return (
    <div style={{ marginBottom: 16, ...style }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: INK2, marginBottom: 7 }}>{label}</div>
      {children}
    </div>
  );
}
const input = { width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 10, border: `1px solid ${LINE_STRONG}`, fontFamily: INTER, fontSize: 14, color: INK, outline: 'none', background: '#fff' };
const stepBtn = { width: 30, height: 30, borderRadius: 8, border: `1px solid ${LINE_STRONG}`, background: '#fff', cursor: 'pointer', fontSize: 18, lineHeight: 1, color: INK2 };

function Seg({ options, value, onChange }) {
  return (
    <div style={{ display: 'inline-flex', background: BG_SOFT, borderRadius: 10, padding: 3, gap: 3 }}>
      {options.map((o) => (
        <button key={o.v} onClick={() => onChange(o.v)} style={{ padding: '7px 16px', borderRadius: 8, border: 0, cursor: 'pointer', fontFamily: INTER, fontSize: 13, fontWeight: 600, background: value === o.v ? '#fff' : 'transparent', color: value === o.v ? INK : INK3, boxShadow: value === o.v ? '0 1px 3px rgba(26,22,32,0.1)' : 'none' }}>{o.l}</button>
      ))}
    </div>
  );
}
function Chip({ on, onClick, children, small }) {
  return (
    <button onClick={onClick} style={{ padding: small ? '6px 10px' : '8px 14px', borderRadius: 99, cursor: 'pointer', fontFamily: INTER, fontSize: 13, fontWeight: 600, border: on ? `1.5px solid ${BRAND}` : `1px solid ${LINE_STRONG}`, background: on ? BRAND_SOFT : '#fff', color: on ? BRAND : INK2 }}>{children}</button>
  );
}

// ── searchable icon picker ──────────────────────────────────────────────────
function IconPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  const query = q.trim();
  const cats = query
    ? [{ key: 'results', label: 'Results', emojis: searchChoreEmojis(query) }]
    : (cat === 'all' ? CHORE_EMOJI_CATS : CHORE_EMOJI_CATS.filter((c) => c.key === cat));
  const pick = (em) => { onChange(em); setOpen(false); setQ(''); };
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" onClick={() => setOpen((o) => !o)} style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', boxSizing: 'border-box', padding: '8px 12px', borderRadius: 10, border: `1px solid ${LINE_STRONG}`, background: '#fff', cursor: 'pointer', fontFamily: INTER, textAlign: 'left' }}>
        <span style={{ width: 38, height: 38, borderRadius: 10, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, background: value ? BRAND_SOFT : BG_SOFT }}>{value || <IcClose s={16} c={INK3} />}</span>
        <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: value ? INK : INK3 }}>{value ? 'Change icon' : 'No icon'}</span>
        <IcChevDown s={14} c={INK3} />
      </button>
      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 90, background: '#fff', borderRadius: 14, border: `1px solid ${LINE}`, boxShadow: '0 16px 50px rgba(26,22,32,0.22)', padding: 12 }}>
          <div style={{ position: 'relative', marginBottom: 10 }}>
            <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', display: 'flex' }}><IcSearch s={15} c={INK3} /></span>
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search icons…" style={{ ...input, padding: '9px 12px 9px 34px' }} />
          </div>
          {!query && (
            <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 8 }}>
              {[['all', 'All'], ...CHORE_EMOJI_CATS.map((c) => [c.key, c.label])].map(([k, l]) => (
                <button key={k} onClick={() => setCat(k)} title={l} style={{ flexShrink: 0, padding: '6px 11px', borderRadius: 9, cursor: 'pointer', fontFamily: INTER, fontSize: 12, fontWeight: 600, background: cat === k ? INK : BG_SOFT, color: cat === k ? '#fff' : INK2, border: 0, whiteSpace: 'nowrap' }}>{l}</button>
              ))}
            </div>
          )}
          <div style={{ maxHeight: 230, overflowY: 'auto' }}>
            <button onClick={() => pick('')} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '7px 8px', borderRadius: 9, border: 0, cursor: 'pointer', background: value === '' ? BRAND_SOFT : 'transparent', fontFamily: INTER, fontSize: 13, fontWeight: 600, color: INK2, marginBottom: 4 }}>
              <span style={{ width: 30, height: 30, borderRadius: 8, background: BG_SOFT, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><IcClose s={14} c={INK3} /></span> No icon
            </button>
            {cats.map((c) => (
              <div key={c.key} style={{ marginBottom: 8 }}>
                {!query && cat === 'all' && <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: INK3, padding: '4px 4px 6px' }}>{c.label}</div>}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {c.emojis.map((em, i) => (
                    <button key={em + i} onClick={() => pick(em)} style={{ width: 36, height: 36, borderRadius: 10, fontSize: 19, cursor: 'pointer', fontFamily: INTER, background: value === em ? BRAND_SOFT : '#fff', border: value === em ? `1.5px solid ${BRAND}` : `1px solid ${LINE}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{em}</button>
                  ))}
                </div>
              </div>
            ))}
            {query && cats[0].emojis.length === 0 && <div style={{ padding: '18px 4px', textAlign: 'center', fontSize: 13, color: INK3 }}>No icons match “{query}”.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
