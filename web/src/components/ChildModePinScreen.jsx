import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useChildMode } from '../context/ChildModeContext';

// Full-screen gate shown in place of Settings while Child Mode is on. A correct
// PIN flips `settingsUnlocked` in the context, which re-renders the route to the
// real Settings page (see ChildGate in App.jsx).
export default function ChildModePinScreen() {
  const { verifyPin } = useChildMode();
  const navigate = useNavigate();
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
    if (!ok) {
      setError('Incorrect PIN. Try again.');
      setPin('');
      inputRef.current?.focus();
    }
    // On success the context unlocks Settings and ChildGate swaps this screen
    // out for the real page - nothing more to do here.
  }

  return (
    <div className="min-h-[100dvh] bg-cream flex items-center justify-center px-6">
      <form onSubmit={submit} className="w-full max-w-sm text-center">
        <div className="mx-auto mb-5 w-14 h-14 rounded-2xl bg-plum-light flex items-center justify-center">
          <svg className="w-7 h-7 text-plum" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <h1 className="text-2xl font-semibold text-charcoal mb-1.5">Grown-ups only</h1>
        <p className="text-sm text-warm-grey mb-6">Enter the PIN to open Settings.</p>
        <input
          ref={inputRef}
          autoFocus
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={6}
          value={pin}
          onChange={(e) => { setPin(e.target.value.replace(/\D/g, '')); setError(''); }}
          placeholder="••••"
          className={`w-full h-14 text-center text-2xl tracking-[0.5em] rounded-xl bg-white border ${error ? 'border-coral' : 'border-light-grey'} outline-none focus:border-plum`}
          aria-label="PIN"
        />
        {error && <p className="text-sm text-coral mt-3">{error}</p>}
        <button
          type="submit"
          disabled={busy || pin.length < 4}
          className="w-full h-12 mt-5 rounded-xl bg-plum text-white font-semibold disabled:opacity-50 transition-opacity"
        >
          {busy ? 'Checking…' : 'Unlock'}
        </button>
        <button
          type="button"
          onClick={() => navigate('/tasks')}
          className="mt-4 text-sm font-medium text-warm-grey hover:text-charcoal"
        >
          ← Back to Tasks
        </button>
      </form>
    </div>
  );
}
