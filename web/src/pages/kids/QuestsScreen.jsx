// Kids mode — Quests (today's tasks for the active kid).
//
// Renders the shared chores day view (owned by KidsShell so the rail balance
// stays in sync): routines grouped Morning/Afternoon/Evening, personal chores
// under "My jobs", and "Anyone" chores as the shared "Help the family" pool
// where the first kid to finish claims the stars. Completing a rewarded quest
// flashes "+N⭐"; finishing every rewarded quest earns the trophy celebration.
import { useState } from 'react';
import api from '../../lib/api';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { KIDS_INK } from '../../lib/kidsTheme';
import { maybeRequestReview } from '../../lib/appReview';
import { StarPill, Section, Celebrate, KidsLogo } from './ui';
import { KidSwitch } from './KidsShell';

const SLOTS = [['morning', 'Morning', '☀️'], ['afternoon', 'Afternoon', '🌤️'], ['evening', 'Evening', '🌙']];
const MASCOTS = ['😴', '🙂', '😃', '🤩', '🥳'];

export default function QuestsScreen({ kid, theme, day, setDay, kids, pickKid }) {
  const isMobile = useIsMobile();
  const [celebrate, setCelebrate] = useState(null);
  const tasks = (day?.tasks || []).filter((t) => t.anyone || (t.assignee_ids || []).includes(kid.id));

  const isDone = (t) => (t.anyone ? !!t.completed : !!(t.done && t.done[kid.id]));
  const doneByOther = (t) => t.anyone && t.completed && t.completed_by !== kid.id;

  const total = tasks.length;
  const doneCount = tasks.filter(isDone).length;
  const pct = total ? doneCount / total : 0;
  const mascot = MASCOTS[Math.min(MASCOTS.length - 1, Math.round(pct * (MASCOTS.length - 1)))];

  const toggle = async (t) => {
    if (doneByOther(t)) return;
    const next = !isDone(t);

    // Optimistic flip so the tap feels instant; the response (or a reload on
    // error) reconciles balances and pool attribution.
    setDay((d) => ({
      ...d,
      tasks: d.tasks.map((x) => {
        if (x.occurrence_key !== t.occurrence_key) return x;
        if (x.anyone) return { ...x, completed: next, completed_by: next ? kid.id : null };
        return { ...x, done: { ...x.done, [kid.id]: next } };
      }),
    }));

    // All-done celebration: every rewarded quest done once this one lands.
    if (next) {
      const rewarded = tasks.filter((x) => x.reward && x.stars > 0);
      const willAllDone = rewarded.length > 0 && rewarded.every((x) => (x.occurrence_key === t.occurrence_key ? true : isDone(x)));
      if (willAllDone) setTimeout(() => setCelebrate({ emoji: '🏆', title: 'All quests done!', sub: `Awesome job, ${kid.name}!` }), 350);
    }

    try {
      const { data } = await api.post(`/chores/${t.id}/complete`, { member_id: kid.id, date: day.date, done: next, slot: t.slot || '' });
      if (data?.balances) setDay((d) => (d ? { ...d, balances: data.balances } : d));
    } catch {
      // Revert by reloading the day so we never show a tick that didn't save.
      try {
        const { data } = await api.get('/chores');
        setDay(data);
      } catch { /* keep optimistic state; next visit reconciles */ }
    }
  };

  const groups = SLOTS.map(([k, label, em]) => ({ k, label, em, tasks: tasks.filter((t) => t.type === 'routine' && t.slot === k) }))
    .filter((g) => g.tasks.length);
  // Personal chores + slotless routines both live under "My jobs".
  const jobs = tasks.filter((t) => !t.anyone && !(t.type === 'routine' && t.slot));
  const pooled = tasks.filter((t) => t.anyone);
  const sections = [...groups];
  if (jobs.length) sections.push({ k: 'jobs', label: 'My jobs', em: '🧹', tasks: jobs });
  if (pooled.length) sections.push({ k: 'pool', label: 'Help the family', em: '🤝', tasks: pooled, hint: 'First to finish gets the stars!' });

  return (
    <div style={{ padding: isMobile ? '20px 18px 0' : 0 }}>
      {/* Phone-only brand row + kid switcher + star pill. The tablet rail
          already carries all three, so the tablet content starts directly
          with the greeting (conditional render - a md:hidden class would
          lose to these rows' inline display:flex). */}
      {isMobile && (
        <>
          <div style={{ display: 'flex', justifyContent: 'center', margin: '16px 0' }}>
            <KidsLogo c1={theme.c1} c2={theme.c2} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <KidSwitch kids={kids || []} kid={kid} pickKid={pickKid} />
            <StarPill n={(day?.balances && day.balances[kid.id]) || 0} />
          </div>
        </>
      )}

      <div style={{ fontSize: isMobile ? 30 : 34, fontWeight: 600, letterSpacing: -0.6, marginBottom: 2 }}>
        Hi, {kid.name}! <span className="kids-wobble">👋</span>
      </div>
      <div style={{ fontSize: isMobile ? 16 : 17, color: KIDS_INK.ink2, fontWeight: 500, marginBottom: isMobile ? 16 : 18 }}>
        {total === 0 ? 'No quests today - enjoy it!' : doneCount === total ? 'You finished everything! 🎉' : "Here are today's quests."}
      </div>

      {total > 0 && (
        <div style={{ background: theme.grad, borderRadius: isMobile ? 30 : 28, padding: isMobile ? '20px 22px' : '22px 26px', display: 'flex', alignItems: 'center', gap: isMobile ? 18 : 22, marginBottom: isMobile ? 22 : 24, boxShadow: isMobile ? '0 10px 26px rgba(49,43,75,0.2)' : '0 12px 30px rgba(49,43,75,0.2)' }}>
          <ProgressRing pct={pct} mascot={mascot} size={isMobile ? 84 : 98} />
          <div style={{ color: '#fff' }}>
            <div style={{ fontSize: isMobile ? 15 : 16, fontWeight: 600, opacity: .92 }}>Quest progress</div>
            <div style={{ fontSize: isMobile ? 30 : 38, fontWeight: 600, lineHeight: 1.1 }}>{doneCount} <span style={{ fontSize: isMobile ? 18 : 22, opacity: .85 }}>of {total} done</span></div>
            <div style={{ fontSize: isMobile ? 14 : 16, fontWeight: 500, opacity: .92, marginTop: 2 }}>{pct === 1 ? 'Legend! ⭐' : pct >= .5 ? (isMobile ? 'Over halfway!' : 'Over halfway, keep going!') : 'You can do it!'}</div>
          </div>
        </div>
      )}

      {/* Tablet: sections flow into 2 columns (each section unbreakable);
          mobile: the same sections stack. */}
      <div style={isMobile ? undefined : { columns: 2, columnGap: 22 }}>
        {sections.map((g) => (
          <Section key={g.k} title={g.label} emoji={g.em} count={`${g.tasks.filter(isDone).length}/${g.tasks.length}`} accent={theme.accent} hint={g.hint}
            style={isMobile ? undefined : { breakInside: 'avoid', marginBottom: 22 }}>
            {g.tasks.map((t) => <Quest key={t.occurrence_key} t={t} theme={theme} done={isDone(t)} lockedBy={doneByOther(t)} onTap={() => toggle(t)} />)}
          </Section>
        ))}
      </div>

      {total === 0 && (
        <div className="kids-card-in" style={{ textAlign: 'center', padding: '40px 20px' }}>
          <div style={{ fontSize: 64 }}>🏖️</div>
          <div style={{ fontSize: 18, fontWeight: 600, color: KIDS_INK.ink2, marginTop: 10 }}>A quest-free day!</div>
        </div>
      )}

      {/* When the trophy overlay closes, ask iOS for the native App Store
          review sheet - the all-quests-done moment is the app's peak
          goodwill. Heavily guarded (14 days of use, once per version,
          Apple's own 3-per-year cap) and a silent no-op on web. */}
      {celebrate && <Celebrate data={celebrate} onDone={() => { setCelebrate(null); maybeRequestReview(); }} />}
    </div>
  );
}

function ProgressRing({ pct, mascot, size = 84 }) {
  const stroke = size > 90 ? 9 : 8;
  const R = (size / 2) - stroke, C = 2 * Math.PI * R, c = size / 2;
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={c} cy={c} r={R} fill="rgba(255,255,255,0.25)" stroke="rgba(255,255,255,0.35)" strokeWidth={stroke} />
        <circle cx={c} cy={c} r={R} fill="none" stroke="#fff" strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C * (1 - pct)} style={{ transition: 'stroke-dashoffset .5s cubic-bezier(.22,1,.36,1)' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.42 }}>{mascot}</div>
    </div>
  );
}

function Quest({ t, theme, done, lockedBy, onTap }) {
  const [flash, setFlash] = useState(false);
  const [anim, setAnim] = useState(false);
  const tap = () => {
    if (lockedBy) return;
    if (!done && t.reward && t.stars > 0) { setFlash(true); setTimeout(() => setFlash(false), 900); }
    setAnim(true); setTimeout(() => setAnim(false), 260);
    onTap();
  };
  return (
    <button onClick={tap} disabled={lockedBy} className="kids-anim" style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 14, width: '100%', textAlign: 'left', cursor: lockedBy ? 'default' : 'pointer',
      background: '#fff', border: done ? `2px solid ${theme.accent}` : '2px solid rgba(49,43,75,0.06)', borderRadius: 22, padding: '14px 16px', fontFamily: 'inherit',
      boxShadow: done ? 'none' : '0 6px 0 rgba(49,43,75,0.05), 0 10px 20px rgba(49,43,75,0.06)', opacity: (done || lockedBy) ? 0.66 : 1,
      animation: anim ? 'kids-pop .26s ease' : 'none', transition: 'border-color .2s' }}>
      <span style={{ width: 52, height: 52, borderRadius: 16, flexShrink: 0, fontSize: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: done ? '#EFEDF6' : theme.soft, filter: done ? 'grayscale(.5)' : 'none' }}>{t.emoji || '⭐'}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 17, fontWeight: 600, textDecoration: done ? 'line-through' : 'none', color: done ? KIDS_INK.ink3 : KIDS_INK.ink }}>{t.title}</span>
        {lockedBy
          ? <span style={{ fontSize: 13, fontWeight: 600, color: KIDS_INK.ink3 }}>✓ A family member did this</span>
          : (t.reward && t.stars > 0) ? <span style={{ display: 'inline-flex', marginTop: 4 }}><StarPill n={`+${t.stars}`} /></span> : null}
      </span>
      <span style={{ width: 38, height: 38, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: done ? theme.accent : '#fff', border: done ? `2px solid ${theme.accent}` : '3px solid #E4E1EE' }}>
        {done && <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12l5 5L20 6" /></svg>}
      </span>
      {flash && <span className="kids-anim" style={{ position: 'absolute', right: 44, top: 6, fontSize: 16, fontWeight: 600, color: '#B77B10', animation: 'kids-float-up .9s ease forwards', pointerEvents: 'none' }}>+{t.stars}⭐</span>}
    </button>
  );
}
