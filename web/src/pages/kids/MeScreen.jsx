// Kids mode — Me (settings). Kids pick their profile colour (8 bright
// presets that re-theme the whole app live) and their avatar emoji; both
// persist to their member record so the theme follows them across devices.
// The two grown-up actions at the bottom are PIN-gated: Exit Child Mode
// (turns Child Mode off on this device) and Grown-up settings (unlocks the
// adult Settings page behind the existing ChildGate escape hatch).
import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { useChildMode } from '../../context/ChildModeContext';
import { KID_COLOR_PRESETS, KID_AVATARS, KIDS_INK } from '../../lib/kidsTheme';
import { BADGE_META, BADGE_ORDER } from '../../lib/kidsBadges';

export default function MeScreen({ kid, theme, onSaved }) {
  const isMobile = useIsMobile();
  const { verifyPin, disable, pinIsSet } = useChildMode();
  const navigate = useNavigate();
  const [gate, setGate] = useState(false); // PIN sheet open for Exit Child Mode
  const [stats, setStats] = useState(null); // streak + earned badges

  // Load this kid's streak + earned badges for the badge shelf.
  useEffect(() => {
    let alive = true;
    api.get(`/chores/streak?member_id=${kid.id}`).then(({ data }) => { if (alive) setStats(data); }).catch(() => {});
    return () => { alive = false; };
  }, [kid.id]);
  const earned = new Set((stats?.badges || []).map((b) => b.badge_key));

  const save = (patch) => {
    // Optimistic: the shell re-themes instantly; the PATCH persists to the
    // member record in the background (the device is a household login, so
    // the existing profile route authorises it).
    onSaved(kid.id, patch);
    api.patch('/household/profile', { user_id: kid.id, ...patch }).catch(() => {});
  };

  const openGate = () => {
    // No PIN configured (edge: enabled before the PIN was cleared) - don't
    // dead-bolt the device; exiting just works.
    if (!pinIsSet) { exit(); return; }
    setGate(true);
  };
  const exit = () => {
    disable();
    navigate('/dashboard', { replace: true });
  };

  return (
    <div style={{ padding: isMobile ? '20px 18px 0' : 0, maxWidth: isMobile ? undefined : 680 }}>
      <div style={{ fontSize: isMobile ? 30 : 34, fontWeight: 600, letterSpacing: -0.6, margin: isMobile ? '0 0 16px' : '0 0 20px' }}>
        My Profile <span className="kids-wobble">⚙️</span>
      </div>

      {/* Identity header: centred column on mobile, avatar + name side by
          side on tablet (per the tablet spec). */}
      {isMobile ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, marginBottom: 24 }}>
          <div style={{ width: 112, height: 112, borderRadius: '50%', background: theme.grad, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 62, boxShadow: '0 12px 28px rgba(49,43,75,0.22)' }}>{theme.emoji}</div>
          <div style={{ fontSize: 22, fontWeight: 600 }}>{kid.name}</div>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 28 }}>
          <div style={{ width: 120, height: 120, borderRadius: '50%', background: theme.grad, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 66, boxShadow: '0 12px 28px rgba(49,43,75,0.22)', flexShrink: 0 }}>{theme.emoji}</div>
          <div>
            <div style={{ fontSize: 26, fontWeight: 600 }}>{kid.name}</div>
            <div style={{ fontSize: 15, color: KIDS_INK.ink2, fontWeight: 500 }}>Pick your colour and avatar!</div>
          </div>
        </div>
      )}

      {/* Badge shelf: the four streak milestones, earned or locked (a locked
          one shows what to aim for). Streaks are earned by daily quests - never
          bought - so these live here, next to identity, not in the Star Shop. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: isMobile ? '0 4px 12px' : '0 2px 14px' }}>
        <span style={{ fontSize: isMobile ? 19 : 20, fontWeight: 600 }}>My badges 🏅</span>
        {stats?.current > 0 && <span style={{ fontSize: 14, fontWeight: 600, color: theme.accent }}>🔥 {stats.current}-day streak</span>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: isMobile ? 10 : 12, marginBottom: isMobile ? 28 : 32, padding: '0 2px' }}>
        {BADGE_ORDER.map((key) => {
          const meta = BADGE_META[key];
          const on = earned.has(key);
          return (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 13px', borderRadius: 18,
              background: on ? theme.soft : '#fff', border: on ? `2px solid ${theme.accent}` : '2px solid rgba(49,43,75,0.06)' }}>
              <span style={{ fontSize: 26, flexShrink: 0, filter: on ? 'none' : 'grayscale(1) opacity(.5)' }}>{meta.emoji}</span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: on ? KIDS_INK.ink : KIDS_INK.ink3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{meta.label}</span>
                <span style={{ display: 'block', fontSize: 12, fontWeight: 500, color: on ? theme.accent : KIDS_INK.ink3 }}>{on ? 'Earned!' : meta.blurb}</span>
              </span>
            </div>
          );
        })}
      </div>

      <div style={{ fontSize: isMobile ? 19 : 20, fontWeight: 600, padding: isMobile ? '0 4px 12px' : '0 2px 14px' }}>My colour 🎨</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: isMobile ? 14 : 16, marginBottom: isMobile ? 28 : 30, padding: '0 2px' }}>
        {KID_COLOR_PRESETS.map((c) => {
          const on = theme.key === c.key;
          const size = isMobile ? 52 : 58;
          return (
            <button key={c.key} aria-label={c.key} onClick={() => save({ kid_color: c.key })}
              style={{ width: size, height: size, borderRadius: '50%', border: on ? '4px solid #fff' : '4px solid transparent', cursor: 'pointer',
                boxShadow: on ? `0 0 0 3px ${c.accent}, 0 6px 14px rgba(49,43,75,0.2)` : '0 4px 10px rgba(49,43,75,0.12)', background: `linear-gradient(160deg, ${c.c1}, ${c.c2})` }} />
          );
        })}
      </div>

      <div style={{ fontSize: isMobile ? 19 : 20, fontWeight: 600, padding: isMobile ? '0 4px 12px' : '0 2px 14px' }}>My avatar 😀</div>
      <div className="grid grid-cols-5 md:grid-cols-8" style={{ gap: isMobile ? 10 : 12 }}>
        {KID_AVATARS.map((a) => {
          const on = theme.emoji === a;
          return (
            <button key={a} onClick={() => save({ kid_avatar: a })} style={{ aspectRatio: '1', borderRadius: 18, fontSize: isMobile ? 30 : 32, cursor: 'pointer', fontFamily: 'inherit',
              background: on ? theme.soft : '#fff', border: on ? `3px solid ${theme.accent}` : '2px solid rgba(49,43,75,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{a}</button>
          );
        })}
      </div>

      {/* PIN-gated exit. One button only: leaving Child Mode already gives a
          grown-up the full adult app, Settings included. */}
      <button onClick={openGate} style={{ width: isMobile ? '100%' : undefined, marginTop: isMobile ? 28 : 32, padding: isMobile ? 15 : '14px 26px', borderRadius: 18, border: '2px solid rgba(49,43,75,0.12)', background: '#fff', cursor: 'pointer',
        fontFamily: 'inherit', fontSize: 15, fontWeight: 600, color: KIDS_INK.ink2, display: isMobile ? 'inline-flex' : 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 9 }}>
        <LockIcon />
        Exit Child Mode
      </button>
      <div style={{ height: 20 }} />

      {gate && <PinSheet theme={theme} verifyPin={verifyPin} onSuccess={() => { setGate(false); exit(); }} onClose={() => setGate(false)} />}
    </div>
  );
}

function LockIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

// A kid-styled "grown-ups only" PIN sheet over the current screen. Verifies
// against the household Child Mode PIN (rate-limited server-side).
function PinSheet({ theme, verifyPin, onSuccess, onClose }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  async function submit(e) {
    e.preventDefault();
    if (busy || pin.length < 4) return;
    setBusy(true);
    setError('');
    const ok = await verifyPin(pin);
    setBusy(false);
    if (ok) { onSuccess(); return; }
    setError('Hmm, that PIN isn\'t right. Try again!');
    setPin('');
    inputRef.current?.focus();
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(49,43,75,0.5)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit} className="kids-anim" style={{ background: '#fff', borderRadius: 32, padding: '30px 26px', textAlign: 'center', width: '100%', maxWidth: 320, boxShadow: '0 20px 60px rgba(49,43,75,0.4)', animation: 'kids-burst-pop .4s ease forwards' }}>
        <div style={{ fontSize: 44 }}>🔒</div>
        <div style={{ fontSize: 21, fontWeight: 600, marginTop: 6, color: KIDS_INK.ink }}>Grown-ups only</div>
        <div style={{ fontSize: 14, fontWeight: 500, color: KIDS_INK.ink2, marginTop: 4 }}>
          Enter the PIN to exit Child Mode.
        </div>
        <input
          ref={inputRef}
          autoFocus
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={6}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          style={{ width: '100%', marginTop: 16, padding: '13px 14px', borderRadius: 16, border: `2.5px solid ${error ? '#E84B75' : theme.accent}`, fontSize: 24, fontWeight: 600, textAlign: 'center', letterSpacing: 10, fontFamily: 'inherit', color: KIDS_INK.ink, outline: 'none' }}
        />
        {error && <div style={{ fontSize: 13, fontWeight: 600, color: '#E84B75', marginTop: 8 }}>{error}</div>}
        <button type="submit" disabled={busy || pin.length < 4} style={{ width: '100%', marginTop: 14, padding: 13, borderRadius: 16, border: 0, cursor: 'pointer', fontFamily: 'inherit',
          background: theme.grad, color: '#fff', fontSize: 15, fontWeight: 600, opacity: busy || pin.length < 4 ? .6 : 1 }}>
          {busy ? 'Checking…' : 'Unlock'}
        </button>
        <button type="button" onClick={onClose} style={{ width: '100%', marginTop: 8, padding: 10, borderRadius: 14, border: 0, background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13.5, fontWeight: 600, color: KIDS_INK.ink3 }}>
          Never mind
        </button>
      </form>
    </div>
  );
}
