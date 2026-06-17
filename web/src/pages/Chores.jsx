// Tasks page — chores & routines, Skylight-style member columns, recurring +
// multi-person, kids earn stars. Rebuilt from design_handoff_tasks_rewards_lists.
// Wired to /api/chores (day-view + per-person/day completion) and /api/household
// (members). Mounted at /chores for now; the nav cutover to /tasks lands in P6
// once Lists houses the old to-dos.
import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import PageHeader from '../components/ui/PageHeader';
import PillBtn from '../components/ui/PillBtn';
import Avatar from '../components/ui/Avatar';
import { hexFor } from '../lib/memberColors';
import { CHORE_EMOJI_CATS, searchChoreEmojis } from '../lib/choreIcons';

// Design-handoff tokens (page-local; member colours come from each record).
const INK = '#1A1620', INK2 = '#4A4453', INK3 = '#8A8493';
const LINE = 'rgba(26,22,32,0.07)', LINE_STRONG = 'rgba(26,22,32,0.12)';
const BRAND = '#6C3DD9', BRAND_SOFT = '#EFE9FB';
const BG_SOFT = '#F3EEE5', STAR = '#D89B3A', STAR_BG = '#FBF1DE';
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
const Tick = ({ s = 12 }) => <svg width={s} height={s} viewBox="0 0 12 12" fill="none"><path d="M2.5 6.5l2.5 2.5 4.5-5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;

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

// ── a single chore card (kid = large, adult = compact, no-icon = row) ────────
function ChoreCard({ task, mid, tint, compact, onToggle, onEdit, onDelete }) {
  const [hover, setHover] = useState(false);
  const done = !!task.done?.[mid];
  const RingBox = (
    <span style={{ width: 22, height: 22, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', border: done ? `2px solid ${tint}` : `1.5px solid ${LINE_STRONG}`, background: done ? tint : 'transparent' }}>
      {done && <Tick s={12} />}
    </span>
  );
  const actions = (
    <div style={{ display: 'flex', gap: 4, opacity: hover ? 1 : 0, transition: 'opacity .12s', flexShrink: 0 }}>
      <button onClick={(e) => { e.stopPropagation(); onEdit(task); }} aria-label="Edit task" style={cardBtn}><IcPencil s={13} c={INK3} /></button>
      <button onClick={(e) => { e.stopPropagation(); onDelete(task); }} aria-label="Delete task" style={cardBtn}><IcTrash s={13} c="#C24A5E" /></button>
    </div>
  );
  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onClick={() => onToggle(task, mid)}
      style={{ position: 'relative', cursor: 'pointer', background: '#fff', borderRadius: compact ? 13 : 16, padding: compact ? '9px 12px' : '12px 14px', opacity: done ? 0.62 : 1, transition: 'opacity .12s' }}>
      {compact ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {task.emoji && <span style={{ fontSize: 19, flexShrink: 0, filter: done ? 'grayscale(.4)' : 'none' }}>{task.emoji}</span>}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: done ? INK3 : INK, textDecoration: done ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title}</div>
            <MetaChips task={task} />
          </div>
          {task.reward && task.stars ? <StarPill n={task.stars} small /> : null}
          {RingBox}{actions}
        </div>
      ) : (
        <>
          <div style={{ position: 'absolute', top: 8, left: 8 }}>{actions}</div>
          {task.emoji && <div style={{ fontSize: 36, textAlign: 'center', marginBottom: 8, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', filter: done ? 'grayscale(.4)' : 'none' }}>{task.emoji}</div>}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: done ? INK3 : INK, textDecoration: done ? 'line-through' : 'none' }}>{task.title}</div>
              <MetaChips task={task} />
            </div>
            {task.reward && task.stars ? <StarPill n={task.stars} small /> : null}
            {RingBox}
          </div>
        </>
      )}
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
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>{allDone && active ? <Tick s={20} /> : meta.emoji}</div>
      </div>
      <span style={{ fontSize: 11, fontWeight: active ? 700 : 600, color: active ? INK : INK3 }}>{meta.label}</span>
    </button>
  );
}

// ── one member column ───────────────────────────────────────────────────────
function MemberColumn({ m, balance, tasks, onToggle, onEdit, onDelete, onAdd }) {
  const hex = hexFor(m);
  const kid = isKid(m);
  // group tasks into slots
  const groups = SLOT_ORDER.map((key) => ({
    key, meta: SLOT_META[key],
    tasks: key === 'chores' ? tasks.filter((t) => t.type === 'chore') : tasks.filter((t) => t.type === 'routine' && (t.whens || []).includes(key)),
  })).filter((g) => g.tasks.length > 0);
  const sectionsPresent = groups.map((g) => g.key);
  const slotsPresent = sectionsPresent.filter((k) => k !== 'chores');
  const focusSlot = slotsPresent.includes(currentSlot()) ? currentSlot() : slotsPresent[0];
  const [active, setActive] = useState(() => {
    const init = sectionsPresent.filter((k) => k === focusSlot || k === 'chores');
    return init.length ? init : sectionsPresent;
  });
  const toggleSection = (k) => setActive((a) => (a.includes(k) ? a.filter((x) => x !== k) : [...a, k]));
  const total = tasks.length, done = tasks.filter((t) => t.done?.[m.id]).length;
  const slotStats = (k) => { const g = groups.find((x) => x.key === k); return g ? { done: g.tasks.filter((t) => t.done?.[m.id]).length, total: g.tasks.length } : { done: 0, total: 0 }; };
  const visible = groups.filter((g) => active.includes(g.key));

  return (
    <div style={{ flex: '0 0 300px', minWidth: 300, background: hex + '12', borderRadius: 24, padding: '18px 14px 14px', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* header (pinned) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 4px 14px', flexShrink: 0 }}>
        <Avatar member={m} size={48} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: SERIF, fontSize: 26, color: INK, lineHeight: 1 }}>{m.name}</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 99, background: '#fff', fontSize: 11.5, fontWeight: 700, color: INK2 }}>
              <Tick s={11} />{done}/{total}
            </span>
            {kid && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '3px 9px', borderRadius: 99, background: STAR_BG, fontSize: 11.5, fontWeight: 700, color: '#A9772A' }}><StarFill s={12} />{balance || 0}</span>}
          </div>
        </div>
      </div>
      {/* slot toggles (pinned) */}
      {sectionsPresent.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-around', gap: 4, padding: '4px 2px 14px', borderBottom: `1px solid ${hex}22`, marginBottom: 12, flexShrink: 0 }}>
          {sectionsPresent.map((k) => { const s = slotStats(k); return <SlotToggle key={k} slot={k} active={active.includes(k)} color={hex} done={s.done} total={s.total} onClick={() => toggleSection(k)} />; })}
        </div>
      )}
      {/* scroll region */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', margin: '0 -4px', padding: '0 4px 2px' }}>
        {visible.length === 0 && <div style={{ padding: '20px 4px', fontSize: 13, color: INK3, fontStyle: 'italic', textAlign: 'center' }}>Nothing here</div>}
        {visible.map((g) => (
          <div key={g.key} style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 4px 8px' }}>
              <span style={{ fontSize: 17 }}>{g.meta.emoji}</span>
              <span style={{ fontSize: 16, fontWeight: 600, color: INK2 }}>{g.meta.label}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {g.tasks.map((t) => <ChoreCard key={t.id} task={t} mid={m.id} tint={hex} compact={!kid} onToggle={onToggle} onEdit={onEdit} onDelete={onDelete} />)}
            </div>
          </div>
        ))}
        <button onClick={() => onAdd(m.id)} style={{ width: '100%', padding: 11, borderRadius: 14, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, background: 'transparent', border: `1px dashed ${hex}66`, color: hex, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <IcPlus s={14} w={2.2} c={hex} /> Add task
        </button>
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
  const [visibleIds, setVisibleIds] = useState(null); // null = everyone
  const [filterOpen, setFilterOpen] = useState(false);
  const [modal, setModal] = useState(null); // { mode, task?, defaultWho? }
  const [celebrate, setCelebrate] = useState(null); // { member, balance }
  const navigate = useNavigate();

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
    const nextTasks = tasks.map((t) => (t.id === task.id ? { ...t, done: { ...t.done, [mid]: next } } : t));
    setTasks(nextTasks);
    // Celebrate when a kid completes the LAST of their rewarded tasks for the day.
    const rewardTasks = nextTasks.filter((t) => (t.assignee_ids || []).includes(mid) && t.reward);
    const justFinishedAll = next && task.reward && isKid(member) && rewardTasks.length > 0 && rewardTasks.every((t) => t.done?.[mid]);
    try {
      const { data } = await api.post(`/chores/${task.id}/complete`, { member_id: mid, date: selDateStr, done: next });
      if (data.balances) setBalances(data.balances);
      if (justFinishedAll) setCelebrate({ member, balance: data.balances?.[mid] ?? 0 });
    } catch {
      setTasks((ts) => ts.map((t) => (t.id === task.id ? { ...t, done: { ...t.done, [mid]: !next } } : t))); // revert
    }
  }, [selDateStr, tasks, members]);

  const handleDelete = useCallback(async (task) => {
    const repeats = task.repeat === 'daily' || task.repeat === 'weekly';
    const msg = repeats ? `Delete "${task.title}" for everyone? It will stop appearing on all days.` : `Delete "${task.title}"?`;
    if (!window.confirm(msg)) return;
    setTasks((ts) => ts.filter((t) => t.id !== task.id));
    try { await api.delete(`/chores/${task.id}`); } catch { loadDay(selDateStr); }
  }, [selDateStr, loadDay]);

  const handleSave = useCallback(async (form) => {
    try {
      if (form.id) await api.patch(`/chores/${form.id}`, form);
      else await api.post('/chores', form);
      setModal(null);
      await loadDay(selDateStr);
    } catch (e) { alert(e.response?.data?.error || 'Could not save the task.'); }
  }, [selDateStr, loadDay]);

  const shown = visibleIds ? members.filter((m) => visibleIds.includes(m.id)) : members;
  const tasksFor = (mid) => tasks.filter((t) => (t.assignee_ids || []).includes(mid));
  const toggleVisible = (id) => setVisibleIds((prev) => {
    const cur = prev || members.map((m) => m.id);
    const nextArr = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    return nextArr.length === members.length ? null : nextArr;
  });

  return (
    <div style={{ padding: '32px 40px', height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', fontFamily: INTER, color: INK }}>
      <PageHeader
        kicker={kicker}
        title="Tasks"
        actions={(
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <div style={{ position: 'relative' }} onMouseLeave={() => setFilterOpen(false)}>
              <button onClick={() => setFilterOpen((o) => !o)} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 16px', borderRadius: 99, cursor: 'pointer', fontFamily: INTER, fontSize: 13.5, fontWeight: 600, background: visibleIds ? INK : BG_SOFT, color: visibleIds ? '#fff' : INK2, border: 0 }}>
                <IcPeople s={16} c={visibleIds ? '#fff' : INK2} /> {visibleIds ? `${shown.length} of ${members.length}` : 'Everyone'}
              </button>
              {filterOpen && (
                <div onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', top: '110%', right: 0, zIndex: 40, background: '#fff', borderRadius: 14, padding: 6, width: 210, border: `1px solid ${LINE}`, boxShadow: '0 14px 44px rgba(26,22,32,0.2)' }}>
                  <button onClick={() => setVisibleIds(null)} style={{ ...filterRow, color: visibleIds ? INK : BRAND, fontWeight: 700 }}><IcPeople s={18} c={visibleIds ? INK2 : BRAND} /> Everyone</button>
                  <div style={{ height: 1, background: LINE, margin: '4px 0' }} />
                  {members.map((m) => {
                    const on = !visibleIds || visibleIds.includes(m.id);
                    return (
                      <button key={m.id} onClick={() => toggleVisible(m.id)} style={filterRow}>
                        <Avatar member={m} size={26} /><span style={{ fontSize: 13.5, fontWeight: 600 }}>{m.name}</span>
                        <span style={{ marginLeft: 'auto', width: 18, height: 18, borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', background: on ? hexFor(m) : 'transparent', border: on ? `1px solid ${hexFor(m)}` : `1.5px solid ${LINE_STRONG}` }}>{on && <Tick s={12} />}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button onClick={() => setDayOffset((d) => d - 1)} aria-label="Previous day" style={dayNav}><IcChevL s={18} c={INK2} /></button>
              <button onClick={() => setDayOffset(0)} style={{ padding: '9px 20px', borderRadius: 99, border: 0, cursor: 'pointer', fontFamily: INTER, fontSize: 13.5, fontWeight: 600, background: BG_SOFT, color: INK, minWidth: 96 }}>{dayLabel}</button>
              <button onClick={() => setDayOffset((d) => d + 1)} aria-label="Next day" style={dayNav}><IcChevR s={18} c={INK2} /></button>
            </div>
            <PillBtn primary icon={<IcPlus s={14} w={2.4} c="#fff" />} onClick={() => setModal({ mode: 'add' })}>Add task</PillBtn>
          </div>
        )}
      />

      {loading ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: INK3, fontFamily: SERIF, fontSize: 24 }}>Loading…</div>
      ) : members.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: INK3, fontFamily: SERIF, fontSize: 24 }}>Add family members to start assigning tasks.</div>
      ) : (
        <div style={{ display: 'flex', gap: 16, overflowX: 'auto', paddingBottom: 4, alignItems: 'stretch', flex: 1, minHeight: 0 }}>
          {shown.map((m) => (
            <MemberColumn key={m.id} m={m} balance={balances[m.id]} tasks={tasksFor(m.id)}
              onToggle={toggle} onEdit={(t) => setModal({ mode: 'edit', task: t })} onDelete={handleDelete} onAdd={(mid) => setModal({ mode: 'add', defaultWho: mid })} />
          ))}
        </div>
      )}

      {modal && <TaskModal modal={modal} members={members} onClose={() => setModal(null)} onSave={handleSave} />}
      {celebrate && <Celebration data={celebrate} onClose={() => setCelebrate(null)} onGo={() => { setCelebrate(null); navigate('/rewards'); }} />}
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

  const anyKid = members.some((m) => assignees.includes(m.id) && isKid(m));
  const toggleIn = (arr, set, v) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  const submit = () => {
    if (!title.trim()) return;
    onSave({
      id: t.id, title: title.trim(), emoji: emoji || null, type,
      assignee_ids: assignees, whens: type === 'routine' ? whens : [],
      repeat, days: repeat === 'weekly' ? days : [],
      start_date: startDate || null, due_time: dueTime || null,
      reward: anyKid ? reward : false, stars: anyKid && reward ? stars : 0,
    });
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(26,22,32,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, fontFamily: INTER }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 22, width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto', padding: 24, boxShadow: '0 30px 80px -20px rgba(26,22,32,0.4)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <h2 style={{ margin: 0, fontFamily: SERIF, fontSize: 30, fontWeight: 400, color: INK }}>{t.id ? 'Edit task' : 'New task'}</h2>
          <button onClick={onClose} aria-label="Close" style={{ ...cardBtn, width: 34, height: 34 }}><IcClose s={18} c={INK2} /></button>
        </div>

        <Field label="Title">
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Make the bed" style={input} />
        </Field>

        <Field label="Icon"><IconPicker value={emoji} onChange={setEmoji} /></Field>

        <Field label="Who">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {members.map((m) => {
              const on = assignees.includes(m.id);
              return (
                <button key={m.id} onClick={() => toggleIn(assignees, setAssignees, m.id)} title={m.name}
                  style={{ position: 'relative', border: on ? `2px solid ${hexFor(m)}` : '2px solid transparent', borderRadius: '50%', padding: 1, background: 'transparent', cursor: 'pointer' }}>
                  <Avatar member={m} size={50} />
                  {on && <span style={{ position: 'absolute', right: -2, bottom: -2, width: 18, height: 18, borderRadius: '50%', background: hexFor(m), border: '2px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Tick s={10} /></span>}
                </button>
              );
            })}
          </div>
        </Field>

        <Field label="Type">
          <Seg options={[{ v: 'chore', l: 'Chore' }, { v: 'routine', l: 'Routine' }]} value={type} onChange={setType} />
        </Field>

        {type === 'routine' && (
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

        {anyKid && (
          <Field label="Reward">
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <button onClick={() => setReward((r) => !r)} style={{ width: 46, height: 28, borderRadius: 99, border: 0, cursor: 'pointer', background: reward ? STAR : LINE_STRONG, position: 'relative', transition: 'background .15s' }}>
                <span style={{ position: 'absolute', top: 3, left: reward ? 21 : 3, width: 22, height: 22, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
              </button>
              {reward && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button onClick={() => setStars((s) => Math.max(1, s - 5))} style={stepBtn}>−</button>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 56, justifyContent: 'center', fontWeight: 700, color: '#A9772A' }}><StarFill s={14} /> {stars}</span>
                  <button onClick={() => setStars((s) => Math.min(999, s + 5))} style={stepBtn}>+</button>
                </div>
              )}
            </div>
          </Field>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
          <button onClick={onClose} style={{ ...input, width: 'auto', padding: '10px 18px', cursor: 'pointer', fontWeight: 600, background: '#fff' }}>Cancel</button>
          <button onClick={submit} disabled={!title.trim() || assignees.length === 0} style={{ padding: '10px 22px', borderRadius: 10, border: 0, cursor: 'pointer', fontWeight: 600, fontSize: 14, fontFamily: INTER, background: BRAND, color: '#fff', opacity: (!title.trim() || assignees.length === 0) ? 0.5 : 1 }}>{t.id ? 'Save' : 'Add task'}</button>
        </div>
      </div>
    </div>
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
