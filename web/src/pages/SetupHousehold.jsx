import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../lib/api';
import { detectCountryFromTimezone, detectCountryFromLocaleCookie } from '../lib/country';
import { readLocaleCookie } from '../hooks/useLocale';
import { getStorefrontCountry } from '../lib/revenuecat';
import ErrorBanner from '../components/ErrorBanner';

export default function SetupHousehold() {
  // Two-mode setup. `create` runs POST /auth/create-household with a
  // name + timezone + country (current behaviour). `join` runs the new
  // POST /auth/attach-to-household with a join code. Default is
  // `create` because the typical new signup is the household founder;
  // family members already-invited-by-email don't see this screen at
  // all (the backend auto-attaches them via getInviteByEmail), so the
  // `join` mode is for the cold-start case where no invite was ever
  // sent.
  const [mode, setMode]       = useState('create');
  const [name, setName]       = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const { login, logout }     = useAuth();
  const navigate              = useNavigate();

  // Escape hatch - without this users with a half-finished signup are
  // stuck: visiting housemait.com bounces them right back here via
  // RequireAuth's needsHousehold redirect. Logging out clears the token
  // so the landing page renders normally. Hard redirect (vs navigate)
  // avoids a render race where the / route evaluates to Navigate('/dashboard')
  // before the new token=null state has propagated.
  function handleSignOut() {
    logout();
    window.location.href = '/';
  }

  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    if (!name.trim()) { setError('Please enter a household name.'); return; }
    setLoading(true);
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/London';
      // Country detection cascade:
      //   1. App Store storefront (iOS only) - the user's Apple ID
      //      Country/Region. This is the single most authoritative
      //      signal for App Store installs because it's the same
      //      country Apple uses for IAP pricing, so what we store
      //      always matches what they're paying. Travellers and
      //      expats classified correctly without us having to guess.
      //   2. Locale cookie (housemait-locale) - set by Vercel edge
      //      middleware when the web visitor lands on a country-
      //      specific marketing page (/gb, /us, /za, etc.). Reflects
      //      what we KNOW from their IP at landing time.
      //   3. Browser timezone - last-resort fallback for direct
      //      /signup visits with no cookie (and not on iOS).
      //
      // Storefront wins over cookie because the App Store country is
      // immutable per Apple ID and matches the user's purchase
      // experience. Cookie wins over timezone because the marketing
      // site IS the source of truth for what region a web visitor
      // signed up for.
      const country =
        (await getStorefrontCountry())
        || detectCountryFromLocaleCookie(readLocaleCookie())
        || detectCountryFromTimezone(timezone);
      const { data } = await api.post('/auth/create-household', { name: name.trim(), timezone, country });
      login(data);
      // Fresh signups always have onboarded_at === null here, so they
      // flow into the wizard. Existing users with old data ever end up
      // here should still get routed somewhere reasonable.
      navigate(data.user?.onboarded_at ? '/dashboard' : '/onboarding');
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  async function handleJoin(e) {
    e.preventDefault();
    setError('');
    if (!joinCode.trim()) { setError('Please enter the join code.'); return; }
    setLoading(true);
    try {
      const { data } = await api.post('/auth/attach-to-household', { code: joinCode.trim() });
      login(data);
      // Same routing as create-household above - new joiners haven't
      // been through the wizard yet, so /onboarding is correct.
      navigate(data.user?.onboarded_at ? '/dashboard' : '/onboarding');
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  function switchMode(next) {
    if (next === mode) return;
    setMode(next);
    setError('');
  }

  return (
    <div
      // Concierge stage - same shell as Login/Signup/Onboarding so the
      // path from sign-up → household creation → wizard is one
      // continuous visual experience.
      className="relative min-h-screen overflow-hidden flex items-center justify-center px-4 py-8"
      style={{
        background: 'radial-gradient(120% 80% at 50% 0%, #EFE9FB 0%, #FAF7F2 55%, #F3EEE5 100%)',
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 2rem)',
      }}
    >
      {/* Decorative ambient blobs - identical to Login.jsx. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute"
        style={{
          width: 760, height: 760, borderRadius: '50%',
          left: -180, bottom: -300,
          background: 'radial-gradient(circle, rgba(232,180,160,0.45) 0%, rgba(232,180,160,0) 70%)',
          filter: 'blur(20px)',
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute"
        style={{
          width: 600, height: 600, borderRadius: '50%',
          right: -160, top: -200,
          background: 'radial-gradient(circle, rgba(107,63,160,0.18) 0%, rgba(107,63,160,0) 70%)',
          filter: 'blur(20px)',
        }}
      />

      {/* Sign-out - floats top-right above the card. */}
      <button
        type="button"
        onClick={handleSignOut}
        className="absolute top-0 right-0 z-20 text-xs text-cocoa hover:text-bark transition-colors px-5 py-4"
        style={{ marginTop: 'env(safe-area-inset-top, 0px)' }}
      >
        Sign out
      </button>

      {/* Glass card - Login/Signup width (420px) so a brand-new user
          coming from /signup sees the same card-shape persist. */}
      <div
        className="relative w-full max-w-[420px]"
        style={{
          background: 'rgba(255,253,250,0.86)',
          backdropFilter: 'blur(18px) saturate(140%)',
          WebkitBackdropFilter: 'blur(18px) saturate(140%)',
          border: '1px solid rgba(255,255,255,0.9)',
          borderRadius: 24,
          boxShadow: '0 30px 80px -20px rgba(26,22,32,0.25), inset 0 2px 0 rgba(255,255,255,0.6)',
          padding: '40px 36px 32px',
        }}
      >
        {/* Logomark chip - same composition as Login. */}
        <div
          className="mx-auto mb-[18px]"
          style={{
            width: 60, height: 60,
            borderRadius: 18,
            background: '#EFE9FB',
            border: '1px solid rgba(107,63,160,0.18)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          aria-hidden="true"
        >
          <img src="/housemait-logomark.svg" alt="" style={{ width: 36, height: 36, objectFit: 'contain' }} />
        </div>

        <h1
          className="text-center"
          style={{
            fontFamily: "'Instrument Serif', serif",
            fontWeight: 400,
            fontSize: 40,
            lineHeight: 1.05,
            letterSpacing: '-0.02em',
            color: '#1A1620',
            margin: 0,
          }}
        >
          {mode === 'create'
            ? <>Create your <em style={{ fontStyle: 'italic', color: '#6B3FA0' }}>household.</em></>
            : <>Join your <em style={{ fontStyle: 'italic', color: '#6B3FA0' }}>household.</em></>
          }
        </h1>

        <p className="text-center text-sm text-cocoa mt-3">
          {mode === 'create'
            ? 'Give it a name - you can change it later.'
            : 'Ask the household admin for the join code.'}
        </p>

        {/* Mode toggle - pill segment, same shape as the in-app tab
            controls on Meals / Settings. Surfaces the join path
            equally to the create path so family members who weren't
            sent an invite (or signed up via a different email than
            the one invited) don't accidentally start a duplicate
            household. */}
        <div
          role="tablist"
          aria-label="Setup mode"
          style={{
            display: 'flex',
            gap: 4,
            background: '#F3EEE5',
            border: '1px solid rgba(26,22,32,0.06)',
            borderRadius: 12,
            padding: 4,
            marginTop: 20,
          }}
        >
          {[
            { key: 'create', label: 'Start new' },
            { key: 'join', label: 'Join existing' },
          ].map(({ key, label }) => {
            const active = mode === key;
            return (
              <button
                key={key}
                role="tab"
                type="button"
                aria-selected={active}
                onClick={() => switchMode(key)}
                style={{
                  flex: 1,
                  padding: '8px 10px',
                  borderRadius: 9,
                  background: active ? '#FFFFFF' : 'transparent',
                  border: 'none',
                  fontFamily: 'var(--font-sans)',
                  fontWeight: 600,
                  fontSize: 13,
                  color: active ? '#1A1620' : '#6B6774',
                  boxShadow: active ? '0 1px 2px rgba(26,22,32,0.08)' : 'none',
                  cursor: 'pointer',
                  transition: 'all 150ms ease',
                }}
              >
                {label}
              </button>
            );
          })}
        </div>

        <div style={{ marginTop: 18 }}>
          <ErrorBanner message={error} onDismiss={() => setError('')} />

          {mode === 'create' ? (
            <form onSubmit={handleCreate} className="space-y-3">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Smith"
                autoFocus
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  borderRadius: 12,
                  background: '#FFFFFF',
                  border: '1px solid rgba(26,22,32,0.10)',
                  fontFamily: 'var(--font-sans)',
                  fontSize: 14,
                  color: '#1A1620',
                  outline: 'none',
                }}
              />
              <button
                type="submit"
                disabled={loading}
                className="w-full transition-all disabled:opacity-60"
                style={{
                  padding: '14px 18px',
                  borderRadius: 12,
                  background: '#6B3FA0',
                  color: '#FFFFFF',
                  border: '1px solid transparent',
                  boxShadow: '0 6px 16px -8px rgba(107,63,160,0.45)',
                  fontFamily: 'var(--font-sans)',
                  fontWeight: 600,
                  fontSize: 14,
                  lineHeight: 1.45,
                }}
              >
                {loading ? 'Creating…' : 'Create household'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleJoin} className="space-y-3">
              <input
                type="text"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder="e.g. SMITH-FAM"
                autoFocus
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  borderRadius: 12,
                  background: '#FFFFFF',
                  border: '1px solid rgba(26,22,32,0.10)',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, "Cascadia Code", "Roboto Mono", monospace',
                  fontSize: 15,
                  color: '#1A1620',
                  outline: 'none',
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                }}
              />
              <button
                type="submit"
                disabled={loading}
                className="w-full transition-all disabled:opacity-60"
                style={{
                  padding: '14px 18px',
                  borderRadius: 12,
                  background: '#6B3FA0',
                  color: '#FFFFFF',
                  border: '1px solid transparent',
                  boxShadow: '0 6px 16px -8px rgba(107,63,160,0.45)',
                  fontFamily: 'var(--font-sans)',
                  fontWeight: 600,
                  fontSize: 14,
                  lineHeight: 1.45,
                }}
              >
                {loading ? 'Joining…' : 'Join household'}
              </button>
            </form>
          )}
        </div>

        <p
          className="text-center"
          style={{
            marginTop: 14,
            fontFamily: 'var(--font-sans)',
            fontSize: 12,
            color: '#8A8493',
            lineHeight: 1.45,
          }}
        >
          {mode === 'create'
            ? 'You can invite family members on the next step.'
            : 'The admin can find the code on their Family page.'}
        </p>
      </div>
    </div>
  );
}
