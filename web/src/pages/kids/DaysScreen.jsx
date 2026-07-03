// Kids mode — My Days (calendar). A List / Month toggle plus the countdown
// hero ("🏖️ 24 sleeps to go!") and "Also coming up" chips.
//
// Events come from the real calendar API (kid's own + family-wide); "big
// days" come from /api/kids/big-days (school holidays from the term-dates
// import, member birthdays, parent-pinned countdown events). List view keeps
// Today expanded and collapses future days to a tappable emoji-cluster row;
// Month view crosses off past days and shows an "in N sleeps" counter for
// the tapped day.
import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../../lib/api';
import { KIDS_INK } from '../../lib/kidsTheme';
import { kidsEventEmoji } from '../../lib/kidsEventEmoji';

const dayMs = 86400000;
const toLocalDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const ymd = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
const monthParam = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
const todayStr = () => ymd(new Date());
const sleepsTo = (dateStr) => Math.round((toLocalDate(dateStr) - toLocalDate(todayStr())) / dayMs);
const sleepText = (n) => (n === 0 ? 'today' : n === 1 ? '1 sleep' : `${n} sleeps`);
function dayName(dateStr) {
  const n = sleepsTo(dateStr);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  return toLocalDate(dateStr).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
}
const fmtTime = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

// An event belongs on the kid's calendar when they're an assignee or it's a
// family-wide one (no assignees) — same visibility a kid gets on the adult
// calendar, minus other members' personal items.
const forKid = (e, kidId) => {
  const a = e.assignees || [];
  return a.length === 0 || a.some((x) => (x.user_id || x.id) === kidId);
};

export default function DaysScreen({ kid, theme }) {
  const [view, setView] = useState('list');
  const [bigDays, setBigDays] = useState([]);
  const [monthEvents, setMonthEvents] = useState({}); // 'YYYY-MM' → events[]
  const [open, setOpen] = useState({});
  const monthsLoading = useRef(new Set());

  const loadMonth = useCallback(async (mp) => {
    if (monthsLoading.current.has(mp)) return;
    monthsLoading.current.add(mp);
    try {
      const { data } = await api.get('/calendar/events', { params: { month: mp } });
      setMonthEvents((m) => ({ ...m, [mp]: data.events || data || [] }));
    } catch {
      setMonthEvents((m) => ({ ...m, [mp]: m[mp] || [] }));
      monthsLoading.current.delete(mp); // allow a retry on next visit
    }
  }, []);

  useEffect(() => {
    const now = new Date();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch; state lands after the await
    loadMonth(monthParam(now));
    loadMonth(monthParam(new Date(now.getFullYear(), now.getMonth() + 1, 1)));
    api.get('/kids/big-days').then(({ data }) => setBigDays(data.bigDays || [])).catch(() => {});
  }, [loadMonth]);

  const myBigs = bigDays.filter((b) => sleepsTo(b.date) >= 0);
  const hero = myBigs.find((b) => b.big) || myBigs[0] || null;

  // Flatten the fetched months into upcoming per-day groups for the list.
  const items = [];
  for (const evs of Object.values(monthEvents)) {
    for (const e of evs) {
      if (!forKid(e, kid.id)) continue;
      const date = String(e.start_time).slice(0, 10);
      if (date < todayStr()) continue;
      const sub = [e.all_day ? '' : fmtTime(e.start_time), e.location].filter(Boolean).join(' · ');
      items.push({ id: `${e.id}:${date}`, date, emoji: kidsEventEmoji(e), title: e.title, sub, family: (e.assignees || []).length === 0 });
    }
  }
  for (const b of myBigs) {
    items.push({ id: `big:${b.date}:${b.title}`, date: b.date, emoji: b.emoji || '🎉', title: b.title, sub: '', family: true, big: true });
  }
  const seen = new Set();
  const deduped = items.filter((it) => { if (seen.has(it.id)) return false; seen.add(it.id); return true; });
  const groups = {};
  for (const it of deduped) (groups[it.date] = groups[it.date] || []).push(it);
  const days = Object.keys(groups).sort().slice(0, 21);

  return (
    <div style={{ padding: '20px 18px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '16px 0 14px' }}>
        <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: -0.5 }}>My Days <span className="kids-wobble">📅</span></div>
        <div style={{ display: 'flex', gap: 4, background: '#fff', padding: 4, borderRadius: 14, border: '2px solid rgba(49,43,75,0.06)' }}>
          {[['list', 'List'], ['month', 'Month']].map(([k, l]) => (
            <button key={k} onClick={() => setView(k)} style={{ padding: '6px 13px', borderRadius: 10, border: 0, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, background: view === k ? theme.grad : 'transparent', color: view === k ? '#fff' : KIDS_INK.ink3 }}>{l}</button>
          ))}
        </div>
      </div>

      {hero && <Countdown hero={hero} theme={theme} />}

      {view === 'list' && myBigs.filter((b) => b !== hero).length > 0 && (
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8, margin: '4px 0 8px' }}>
          {myBigs.filter((b) => b !== hero).slice(0, 6).map((b) => (
            <div key={`${b.date}:${b.title}`} style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 8, background: '#fff', border: '2px solid rgba(49,43,75,0.06)', borderRadius: 999, padding: '7px 14px 7px 9px' }}>
              <span style={{ fontSize: 20 }}>{b.emoji || '🎉'}</span>
              <span>
                <b style={{ fontSize: 13, display: 'block', lineHeight: 1.1 }}>{b.title}</b>
                <span style={{ fontSize: 11.5, fontWeight: 600, color: theme.accent }}>in {sleepText(sleepsTo(b.date))}</span>
              </span>
            </div>
          ))}
        </div>
      )}

      {view === 'month' && <MonthView theme={theme} kid={kid} monthEvents={monthEvents} loadMonth={loadMonth} bigDays={myBigs} />}

      {view === 'list' && days.length === 0 && (
        <div className="kids-card-in" style={{ textAlign: 'center', padding: '40px 20px' }}>
          <div style={{ fontSize: 64 }}>🎈</div>
          <div style={{ fontSize: 18, fontWeight: 600, color: KIDS_INK.ink2, marginTop: 10 }}>Nothing coming up yet</div>
        </div>
      )}

      {view === 'list' && days.map((k) => {
        const g = groups[k];
        const today = sleepsTo(k) === 0;
        const isOpen = today || open[k];
        return (
          <div key={k}>
            <button onClick={() => { if (!today) setOpen((o) => ({ ...o, [k]: !o[k] })); }} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', background: 'transparent', border: 0, cursor: today ? 'default' : 'pointer', fontFamily: 'inherit', padding: '14px 4px 8px', textAlign: 'left' }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: today ? theme.accent : KIDS_INK.ink }}>{dayName(k)}</span>
              {sleepsTo(k) > 1 && <span style={{ fontSize: 12.5, fontWeight: 600, color: KIDS_INK.ink3 }}>· in {sleepText(sleepsTo(k))}</span>}
              <span style={{ flex: 1 }} />
              {!isOpen && (
                <span style={{ display: 'flex', gap: 3, marginRight: 4 }}>
                  {g.slice(0, 4).map((it, i) => <span key={i} style={{ fontSize: 17 }}>{it.emoji}</span>)}
                  {g.length > 4 && <span style={{ fontSize: 12, fontWeight: 700, color: KIDS_INK.ink3, alignSelf: 'center' }}>+{g.length - 4}</span>}
                </span>
              )}
              {!today && <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={KIDS_INK.ink3} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}><path d="M6 9l6 6 6-6" /></svg>}
            </button>
            {isOpen && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {g.map((it) => <EventCard key={it.id} it={it} theme={theme} />)}
              </div>
            )}
          </div>
        );
      })}
      <div style={{ height: 20 }} />
    </div>
  );
}

function EventCard({ it, theme }) {
  return (
    <div className="kids-card-in" style={{ display: 'flex', alignItems: 'center', gap: 14, background: '#fff', borderRadius: 22, padding: '14px 16px', border: `2px solid ${it.big ? theme.accent : 'rgba(49,43,75,0.06)'}`, boxShadow: '0 5px 0 rgba(49,43,75,0.04), 0 10px 18px rgba(49,43,75,0.05)' }}>
      <span style={{ width: 52, height: 52, borderRadius: 16, flexShrink: 0, fontSize: 27, display: 'flex', alignItems: 'center', justifyContent: 'center', background: it.big ? theme.soft : '#F1EFF8' }}>{it.emoji}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 16, fontWeight: 600 }}>{it.title}</div>
        {it.sub && <div style={{ fontSize: 13.5, color: KIDS_INK.ink3, fontWeight: 500, marginTop: 1 }}>{it.sub}</div>}
      </div>
      {it.big ? <span style={{ fontSize: 20 }}>🎉</span> : it.family && <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', background: KIDS_INK.grape, padding: '3px 9px', borderRadius: 999 }}>FAMILY</span>}
    </div>
  );
}

function Countdown({ hero, theme }) {
  const n = sleepsTo(hero.date);
  return (
    <div style={{ background: theme.grad, borderRadius: 28, padding: '22px 24px', color: '#fff', marginBottom: 14, position: 'relative', overflow: 'hidden', boxShadow: '0 12px 30px rgba(49,43,75,0.2)' }}>
      <div style={{ position: 'absolute', right: -10, top: -16, fontSize: 120, opacity: .2 }}>{hero.emoji || '🎉'}</div>
      <div style={{ position: 'relative' }}>
        <div style={{ fontSize: 15, fontWeight: 600, opacity: .92 }}>Counting down to…</div>
        <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.1, margin: '2px 0 10px' }}>{hero.emoji || '🎉'} {hero.title}</div>
        <div style={{ fontSize: 46, fontWeight: 700, lineHeight: 1 }}>
          {n === 0 ? 'Today! 🎉' : n}
          {n > 0 && <span style={{ fontSize: 20, fontWeight: 600, opacity: .9 }}> {n === 1 ? 'sleep to go!' : 'sleeps to go!'}</span>}
        </div>
        <div style={{ fontSize: 14, fontWeight: 500, opacity: .9, marginTop: 6 }}>{toLocalDate(hero.date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
      </div>
    </div>
  );
}

// ── Month grid: cross off past days, count sleeps to events ──
const MONTH_WD = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const mvNav = { width: 38, height: 38, borderRadius: 12, border: 0, background: '#fff', cursor: 'pointer', fontSize: 22, fontWeight: 700, color: KIDS_INK.ink2, boxShadow: '0 2px 0 rgba(49,43,75,0.06)', fontFamily: 'inherit' };

function MonthView({ theme, kid, monthEvents, loadMonth, bigDays }) {
  const now = new Date();
  const [offset, setOffset] = useState(0); // months from the current month
  const [sel, setSel] = useState(todayStr());
  const first = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const mp = monthParam(first);

   
  useEffect(() => { loadMonth(mp); }, [mp, loadMonth]);  

  const evs = (monthEvents[mp] || []).filter((e) => forKid(e, kid.id));
  const evOn = (dateStr) => {
    const out = evs
      .filter((e) => String(e.start_time).slice(0, 10) === dateStr)
      .map((e) => ({ id: e.id, emoji: kidsEventEmoji(e), title: e.title, sub: [e.all_day ? '' : fmtTime(e.start_time), e.location].filter(Boolean).join(' · '), family: (e.assignees || []).length === 0 }));
    for (const b of bigDays) {
      if (b.date === dateStr) out.push({ id: `big:${b.title}`, emoji: b.emoji || '🎉', title: b.title, sub: '', family: true, big: true });
    }
    return out;
  };

  const lead = (first.getDay() + 6) % 7;
  const dim = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= dim; d++) cells.push(d);
  const selEv = evOn(sel);
  const n = sleepsTo(sel);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '4px 2px 12px' }}>
        <button onClick={() => setOffset((m) => Math.max(0, m - 1))} disabled={offset <= 0} style={{ ...mvNav, opacity: offset <= 0 ? 0.35 : 1 }}>‹</button>
        <b style={{ fontSize: 18 }}>{first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</b>
        <button onClick={() => setOffset((m) => Math.min(6, m + 1))} disabled={offset >= 6} style={{ ...mvNav, opacity: offset >= 6 ? 0.35 : 1 }}>›</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 6, marginBottom: 6 }}>
        {MONTH_WD.map((w, i) => <div key={i} style={{ textAlign: 'center', fontSize: 12, fontWeight: 700, color: KIDS_INK.ink3 }}>{w}</div>)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 6 }}>
        {cells.map((d, i) => {
          if (!d) return <div key={i} />;
          const dateStr = ymd(new Date(first.getFullYear(), first.getMonth(), d));
          const sl = sleepsTo(dateStr), past = sl < 0, today = sl === 0, on = dateStr === sel;
          const dayEvs = evOn(dateStr);
          return (
            <button key={i} onClick={() => setSel(dateStr)} style={{ position: 'relative', aspectRatio: '1', borderRadius: 14, cursor: 'pointer', fontFamily: 'inherit',
              border: (today || on) ? `2.5px solid ${theme.accent}` : '2px solid rgba(49,43,75,0.06)', background: (today || on) ? theme.soft : '#fff',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1, opacity: past ? 0.5 : 1, overflow: 'hidden' }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: today ? theme.accent : KIDS_INK.ink }}>{d}</span>
              {dayEvs.length > 0 && !past && <span style={{ display: 'flex', gap: 1 }}>{dayEvs.slice(0, 3).map((e, j) => <span key={j} style={{ fontSize: 9 }}>{e.emoji}</span>)}</span>}
              {past && <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} viewBox="0 0 40 40" preserveAspectRatio="none"><line x1="7" y1="33" x2="33" y2="7" stroke={theme.accent} strokeWidth="3" strokeLinecap="round" opacity="0.5" /></svg>}
              {today && <span style={{ position: 'absolute', bottom: 3, fontSize: 7, fontWeight: 800, letterSpacing: .5, color: theme.accent }}>TODAY</span>}
            </button>
          );
        })}
      </div>
      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 700, padding: '0 2px 8px', color: n === 0 ? theme.accent : KIDS_INK.ink }}>
          {dayName(sel)}
          {n > 1 && <span style={{ fontSize: 12.5, fontWeight: 600, color: KIDS_INK.ink3 }}> · in {sleepText(n)}</span>}
          {n < 0 && <span style={{ fontSize: 12.5, fontWeight: 600, color: KIDS_INK.ink3 }}> · all crossed off ✓</span>}
        </div>
        {selEv.length === 0
          ? <div style={{ fontSize: 14, fontWeight: 600, color: KIDS_INK.ink3, padding: '6px 2px' }}>Nothing on this day 🎈</div>
          : <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{selEv.map((it) => <EventCard key={it.id} it={it} theme={theme} />)}</div>}
      </div>
    </div>
  );
}
