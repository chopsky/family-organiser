// Desktop Tasks — "Week" view. One member at a time: their tasks (grouped by
// time of day) down the left, the 7 days of the week across the top, each cell
// showing that task's state on that day (per recurrence + REAL completion
// history). Only today is interactive. Rebuilt from design_handoff_tasks_week.
import Avatar from '../../components/ui/Avatar';
import { hexFor } from '../../lib/memberColors';
import { appliesOnDate, weekRowsForMember, completionSet, skipSet } from '../../lib/choreRecurrence';

// Page-local design tokens (match Chores.jsx; member colours come from records).
const INK = '#1A1620', INK2 = '#4A4453', INK3 = '#8A8493';
const LINE = 'rgba(26,22,32,0.07)', LINE_STRONG = 'rgba(26,22,32,0.12)';
const BG_SOFT = '#F3EEE5', STAR = '#D89B3A', BG_APP = '#FBF8F3';
const INTER = '"Inter", system-ui, sans-serif';
const SERIF = '"Instrument Serif", serif';

const SLOT_META = {
  morning: { label: 'Morning', emoji: '☀️' },
  afternoon: { label: 'Afternoon', emoji: '⛅' },
  evening: { label: 'Evening', emoji: '🌙' },
  chores: { label: 'Chores', emoji: '🧹' },
};
const SECTIONS = ['morning', 'afternoon', 'evening', 'chores'];
const TASK_COL = 248; // px — the task column; the 7 day columns share the rest.
const GRID = `${TASK_COL}px repeat(7, minmax(0, 1fr))`;
const isKid = (m) => m?.member_type === 'dependent';

// hex + alpha (0..1) → rgba, for member-colour tints.
function tint(hex, a) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

// One task × day cell. `mc` = member colour.
function Cell({ row, day, memberId, mc, doneSet, skipped, onToggle }) {
  const applies = !skipped && appliesOnDate(row.def, day.str);
  if (!applies) {
    return <span style={{ width: 14, height: 2, borderRadius: 2, background: INK3, opacity: 0.3 }} aria-hidden="true" />;
  }
  const done = doneSet.has(`${row.def.id}|${row.slot}|${memberId}|${day.str}`);
  const ring = (extra) => ({ width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box', ...extra });
  const Check = <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 6" /></svg>;

  if (day.isToday) {
    return (
      <button
        type="button"
        onClick={() => onToggle(row.def, row.slot, day.str, memberId, !done)}
        aria-pressed={done}
        aria-label={done ? 'Done today — tap to undo' : 'Tap to mark done'}
        style={{ ...ring({ cursor: 'pointer', border: done ? 'none' : `2px solid ${mc}`, background: done ? mc : '#fff', boxShadow: `0 0 0 3px ${tint(mc, 0.16)}` }), padding: 0 }}
      >
        {done && Check}
      </button>
    );
  }
  if (day.isPast) {
    // Real history: completed → filled check; not completed → muted empty ring.
    return done
      ? <span style={ring({ background: mc })}>{Check}</span>
      : <span style={ring({ border: `1.5px solid ${LINE_STRONG}`, opacity: 0.5 })} title="Not done" />;
  }
  // Future, applies → upcoming outline.
  return <span style={ring({ border: `1.5px solid ${LINE_STRONG}` })} aria-label="Upcoming" />;
}

function DueChips({ def }) {
  if (!def.due_time && !(def.reward && def.stars)) return null;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 8 }}>
      {def.due_time && (
        <span style={{ fontSize: 11, fontWeight: 700, color: INK3, fontVariantNumeric: 'tabular-nums' }}>{def.due_time.slice(0, 5)}</span>
      )}
      {def.reward && def.stars > 0 && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 11, fontWeight: 800, color: '#A9772A', background: '#FBF1DE', borderRadius: 6, padding: '1px 5px' }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill={STAR}><path d="M12 2l2.9 6.3 6.9.7-5.1 4.6 1.4 6.8L12 17.6 5.9 21l1.4-6.8L2.2 9.6l6.9-.7z" /></svg>
          {def.stars}
        </span>
      )}
    </span>
  );
}

function SummaryStat({ dot, label, value }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      {dot}
      <span style={{ fontSize: 13, color: INK2, fontWeight: 600 }}>{value} {label}</span>
    </span>
  );
}

export default function DesktopChoresWeek({ members, who, setWho, defs, completions, skips, weekDays, balances = {}, onToggle, onEdit }) {
  const selected = members.find((m) => m.id === who) || members[0];
  if (!selected) {
    return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: INK3, fontFamily: SERIF, fontSize: 24 }}>Add family members to start assigning tasks.</div>;
  }
  const mc = hexFor(selected);
  const doneSet = completionSet(completions);
  const skips_ = skipSet(skips);
  const rows = weekRowsForMember(defs, selected.id);
  const presentSections = SECTIONS.filter((s) => rows[s].length > 0);

  // Per-member week summary: done (completed this week), to do (today's
  // incomplete), upcoming (future applicable instances).
  let done = 0, todo = 0, upcoming = 0;
  for (const s of presentSections) {
    for (const row of rows[s]) {
      for (const day of weekDays) {
        if (skips_.has(`${row.def.id}|${day.str}`) || !appliesOnDate(row.def, day.str)) continue;
        if (day.isFuture) { upcoming += 1; continue; }
        const isDone = doneSet.has(`${row.def.id}|${row.slot}|${selected.id}|${day.str}`);
        if (isDone) done += 1;
        else if (day.isToday) todo += 1;
      }
    }
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', fontFamily: INTER, color: INK }}>
      {/* Member pills + summary */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 2px 14px', flexShrink: 0, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', flex: 1, minWidth: 0 }}>
          {members.map((m) => {
            const sel = m.id === selected.id;
            const c = hexFor(m);
            const showStar = isKid(m) || (balances[m.id] || 0) > 0;
            return (
              <button key={m.id} type="button" onClick={() => setWho(m.id)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '5px 13px 5px 5px', borderRadius: 99, cursor: 'pointer', fontFamily: INTER, background: sel ? '#fff' : 'transparent', border: sel ? `1.5px solid ${c}` : `1.5px solid ${LINE}`, boxShadow: sel ? `0 2px 10px ${tint(c, 0.18)}` : 'none' }}>
                <Avatar member={m} size={28} bg="#fff" />
                <span style={{ fontSize: 13.5, fontWeight: sel ? 700 : 600, color: sel ? INK : INK2 }}>{m.name}</span>
                {showStar && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 11, fontWeight: 800, color: '#A9772A' }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill={STAR}><path d="M12 2l2.9 6.3 6.9.7-5.1 4.6 1.4 6.8L12 17.6 5.9 21l1.4-6.8L2.2 9.6l6.9-.7z" /></svg>
                    {balances[m.id] || 0}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
          <SummaryStat value={done} label="done" dot={<span style={{ width: 11, height: 11, borderRadius: '50%', background: mc }} />} />
          <SummaryStat value={todo} label="to do" dot={<span style={{ width: 11, height: 11, borderRadius: '50%', border: `2px solid ${mc}`, boxSizing: 'border-box' }} />} />
          <SummaryStat value={upcoming} label="upcoming" dot={<span style={{ width: 11, height: 11, borderRadius: '50%', border: `1.5px solid ${LINE_STRONG}`, boxSizing: 'border-box' }} />} />
        </div>
      </div>

      {/* Scroll area: sticky day header + section panels */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingBottom: 140 }}>
        {presentSections.length === 0 ? (
          <div style={{ padding: '60px 0', textAlign: 'center', color: INK3, fontFamily: SERIF, fontSize: 22 }}>
            Nothing assigned to {selected.name} this week.
          </div>
        ) : (
          <>
            {/* Sticky day header */}
            <div style={{ position: 'sticky', top: 0, zIndex: 5, display: 'grid', gridTemplateColumns: GRID, alignItems: 'end', background: BG_APP, paddingBottom: 8, borderBottom: `1px solid ${LINE}` }}>
              <div />
              {weekDays.map((day) => (
                <div key={day.str} style={{ textAlign: 'center', padding: '4px 2px 0' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', color: day.isToday ? mc : INK3, textTransform: 'uppercase' }}>{day.label}</div>
                  <div style={{ margin: '3px auto 0', width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: day.isToday ? 800 : 600, color: day.isToday ? '#fff' : INK2, background: day.isToday ? mc : 'transparent' }}>{day.dom}</div>
                </div>
              ))}
            </div>

            {presentSections.map((s) => (
              <div key={s} style={{ background: '#fff', borderRadius: 16, margin: '14px 0', boxShadow: '0 2px 8px rgba(107,63,160,0.06)', overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 14px', background: tint(mc, 0.05), borderBottom: `1px solid ${LINE}` }}>
                  <span style={{ fontSize: 15 }}>{SLOT_META[s].emoji}</span>
                  <span style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: INK2 }}>{SLOT_META[s].label}</span>
                </div>
                {rows[s].map((row, i) => (
                  <div key={row.occurrenceKey} style={{ display: 'grid', gridTemplateColumns: GRID, alignItems: 'center', background: i % 2 ? tint(mc, 0.035) : '#fff', borderTop: i ? `1px solid ${LINE}` : 'none' }}>
                    {/* Task cell — opens the edit modal */}
                    <button type="button" onClick={() => onEdit(row.def)} title="Edit task"
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'transparent', border: 0, cursor: 'pointer', fontFamily: INTER, textAlign: 'left', minWidth: 0 }}>
                      <span style={{ flexShrink: 0, width: 30, height: 30, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, background: BG_SOFT }}>{row.def.emoji || '✅'}</span>
                      <span style={{ minWidth: 0, display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 13.5, fontWeight: 600, color: INK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.def.title}</span>
                        <DueChips def={row.def} />
                      </span>
                    </button>
                    {/* 7 day-cells */}
                    {weekDays.map((day) => (
                      <div key={day.str} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px 2px', minHeight: 44, background: day.isToday ? tint(mc, 0.06) : 'transparent' }}>
                        <Cell row={row} day={day} memberId={selected.id} mc={mc} doneSet={doneSet} skipped={skips_.has(`${row.def.id}|${day.str}`)} onToggle={onToggle} />
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
