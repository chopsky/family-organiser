// Kids mode — Me (settings). Kids pick their profile colour (8 bright
// presets that re-theme the whole app live) and their avatar emoji; both
// persist to their member record so the theme follows them across devices.
// The two grown-up actions at the bottom are PIN-gated: Exit Child Mode
// (turns Child Mode off on this device) and Grown-up settings (unlocks the
// adult Settings page behind the existing ChildGate escape hatch).
import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { useChildMode } from '../../context/ChildModeContext';
import { KID_COLOR_PRESETS, KID_AVATARS, KIDS_INK } from '../../lib/kidsTheme';

export default function MeScreen({ kid, theme, onSaved }) {
  const { verifyPin, disable, pinIsSet } = useChildMode();
  const navigate = useNavigate();
  const [gate, setGate] = useState(null); // null | 'exit' | 'settings'

  const save = (patch) => {
    // Optimistic: the shell re-themes instantly; the PATCH persists to the
    // member record in the background (the device is a household login, so
    // the existing profile route authorises it).
    onSaved(kid.id, patch);
    api.patch('/household/profile', { user_id: kid.id, ...patch }).catch(() => {});
  };

  const openGate = (mode) => {
    // No PIN configured (edge: enabled before the PIN was cleared) - don't
    // dead-bolt the device; both actions just work.
    if (!pinIsSet) { finishGate(mode); return; }
    setGate(mode);
  };
  const finishGate = (mode) => {
    if (mode === 'exit') {
      disable();
      navigate('/dashboard', { replace: true });
    } else {
      // verifyPin already flipped settingsUnlocked; ChildGate now renders the
      // adult Settings for this path.
      navigate('/settings');
    }
  };

  return (
    <div style={{ padding: '20px 18px 0' }}>
      <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: -0.5, margin: '16px 0' }}>
        My Profile <span className="kids-wobble">⚙️</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, marginBottom: 24 }}>
        <div style={{ width: 112, height: 112, borderRadius: '50%', background: theme.grad, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 62, boxShadow: '0 12px 28px rgba(49,43,75,0.22)' }}>{theme.emoji}</div>
        <div style={{ fontSize: 22, fontWeight: 700 }}>{kid.name}</div>
      </div>

      <div style={{ fontSize: 19, fontWeight: 700, padding: '0 4px 12px' }}>My colour 🎨</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 28, padding: '0 2px' }}>
        {KID_COLOR_PRESETS.map((c) => {
          const on = theme.key === c.key;
          return (
            <button key={c.key} aria-label={c.key} onClick={() => save({ kid_color: c.key })}
              style={{ width: 52, height: 52, borderRadius: '50%', border: on ? '4px solid #fff' : '4px solid transparent', cursor: 'pointer',
                boxShadow: on ? `0 0 0 3px ${c.accent}, 0 6px 14px rgba(49,43,75,0.2)` : '0 4px 10px rgba(49,43,75,0.12)', background: `linear-gradient(160deg, ${c.c1}, ${c.c2})` }} />
          );
        })}
      </div>

      <div style={{ fontSize: 19, fontWeight: 700, padding: '0 4px 12px' }}>My avatar 😀</div>
      <div className="grid grid-cols-5 md:grid-cols-8" style={{ gap: 10 }}>
        {KID_AVATARS.map((a) => {
          const on = theme.emoji === a;
          return (
            <button key={a} onClick={() => save({ kid_avatar: a })} style={{ aspectRatio: '1', borderRadius: 18, fontSize: 30, cursor: 'pointer', fontFamily: 'inherit',
              background: on ? theme.soft : '#fff', border: on ? `3px solid ${theme.accent}` : '2px solid rgba(49,43,75,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{a}</button>
          );
        })}
      </div>

      <button onClick={() => openGate('exit')} style={{ width: '100%', marginTop: 28, padding: 15, borderRadius: 18, border: '2px solid rgba(49,43,75,0.12)', background: '#fff', cursor: 'pointer',
        fontFamily: 'inherit', fontSize: 15, fontWeight: 700, color: KIDS_INK.ink2, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 9 }}>
        <LockIcon />
        Exit Child Mode
      </button>
      <button onClick={() => openGate('settings')} style={{ width: '100%', marginTop: 12, padding: 13, borderRadius: 18, border: 0, background: 'transparent', cursor: 'pointer',
        fontFamily: 'inherit', fontSize: 13.5, fontWeight: 600, color: KIDS_INK.ink3 }}>
        Grown-up settings
      </button>
      <div style={{ height: 20 }} />

      {gate && <PinSheet mode={gate} theme={theme} verifyPin={verifyPin} onSuccess={() => { const m = gate; setGate(null); finishGate(m); }} onClose={() => setGate(null)} />}
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
function PinSheet({ mode, theme, verifyPin, onSuccess, onClose }) {
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
        <div style={{ fontSize: 21, fontWeight: 700, marginTop: 6, color: KIDS_INK.ink }}>Grown-ups only</div>
        <div style={{ fontSize: 14, fontWeight: 500, color: KIDS_INK.ink2, marginTop: 4 }}>
          {mode === 'exit' ? 'Enter the PIN to exit Child Mode.' : 'Enter the PIN to open settings.'}
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
          style={{ width: '100%', marginTop: 16, padding: '13px 14px', borderRadius: 16, border: `2.5px solid ${error ? '#E84B75' : theme.accent}`, fontSize: 24, fontWeight: 700, textAlign: 'center', letterSpacing: 10, fontFamily: 'inherit', color: KIDS_INK.ink, outline: 'none' }}
        />
        {error && <div style={{ fontSize: 13, fontWeight: 600, color: '#E84B75', marginTop: 8 }}>{error}</div>}
        <button type="submit" disabled={busy || pin.length < 4} style={{ width: '100%', marginTop: 14, padding: 13, borderRadius: 16, border: 0, cursor: 'pointer', fontFamily: 'inherit',
          background: theme.grad, color: '#fff', fontSize: 15, fontWeight: 700, opacity: busy || pin.length < 4 ? .6 : 1 }}>
          {busy ? 'Checking…' : 'Unlock'}
        </button>
        <button type="button" onClick={onClose} style={{ width: '100%', marginTop: 8, padding: 10, borderRadius: 14, border: 0, background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13.5, fontWeight: 600, color: KIDS_INK.ink3 }}>
          Never mind
        </button>
      </form>
    </div>
  );
}
