import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../lib/api';
import ErrorBanner from '../components/ErrorBanner';
import SocialButtons from '../components/SocialButtons';
import TurnstileWidget from '../components/TurnstileWidget';
import AuthHeader from '../components/AuthHeader';

export default function Login() {
  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const [resendState, setResendState] = useState('idle'); // idle | sending | sent
  const [turnstileToken, setTurnstileToken] = useState(null);
  // Email form is hidden by default - Continue with Email button reveals it.
  // Keeps the initial surface focused on the SSO options (the cleaner /
  // less data-entry path) and removes the visual clutter of all the
  // email/password fields stacked next to the SSO buttons.
  const [showEmailForm, setShowEmailForm] = useState(false);
  const turnstileRef              = useRef(null);
  const { login }                 = useAuth();
  const navigate                  = useNavigate();
  const [searchParams]            = useSearchParams();

  const verified = searchParams.get('verified') === 'true';
  const tokenError = searchParams.get('error');
  const needsVerification = error.toLowerCase().includes('verify your email');

  useEffect(() => {
    document.title = 'Log in | Housemait';
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setResendState('idle');
    if (!email.trim() || !password) {
      setError('Email and password are required.');
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', {
        email: email.trim(),
        password,
        turnstile_token: turnstileToken,
      });
      login(data);
      navigate(postLoginRoute(data));
    } catch (err) {
      // Surface a more useful message than "Something went wrong" when
      // axios fails before getting a response - typically CORS, network,
      // or wrong API URL.
      setError(err.response?.data?.error || 'Something went wrong.');
      // Turnstile tokens are single-use - the backend already consumed
      // ours validating this submission. Re-submitting with the same
      // token would trip "Bot verification failed" on the second try.
      // Clear and reset so the next submit gets a fresh challenge.
      setTurnstileToken(null);
      turnstileRef.current?.reset();
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    if (!email.trim() || resendState === 'sending') return;
    setResendState('sending');
    try {
      await api.post('/auth/resend-verification', { email: email.trim() });
      setResendState('sent');
    } catch {
      // Endpoint always returns 200 to prevent enumeration, so only network errors land here
      setResendState('sent');
    }
  }

  function handleSocialSuccess(data) {
    login(data);
    navigate(postLoginRoute(data));
  }

  // Shared router for every post-login path. A half-finished account (no
  // household yet, or onboarding not marked done) resumes the unified flow at
  // /signup, which entryIndex() picks up at the right step from auth state -
  // the same target RequireAuth and Verify use. Routing to the legacy
  // /setup + /onboarding pages here was the one spot the cutover missed, and
  // it dropped logged-in half-finished users back onto the OLD signup.
  function postLoginRoute(data) {
    if (!data.household || !data.user?.onboarded_at) return '/signup';
    return '/dashboard';
  }

  return (
    <div
      // Full-bleed "concierge" stage. The blobs + radial fade fill the
      // viewport; the card sits centered. paddingTop on the stage
      // accounts for the iOS status bar (env(safe-area-inset-top)).
      className="relative min-h-screen overflow-hidden flex items-center justify-center px-4 py-8"
      style={{
        background: 'radial-gradient(120% 80% at 50% 0%, #EFE9FB 0%, #FAF7F2 55%, #F3EEE5 100%)',
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 5rem)',
      }}
    >
      <AuthHeader cta={{ label: 'Sign up free', to: '/signup' }} />
      {/* Coral blob (bottom-left) - purely decorative ambient lighting. */}
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
      {/* Purple blob (top-right). */}
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

      {/* Glass card. backdrop-filter has -webkit- prefix via the
          WebkitBackdropFilter style (Safari/iOS). max-w-[420px] hits the
          spec width on desktop and collapses gracefully on phones. */}
      <div
        id="login-concierge-card"
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
        <h1
          className="text-center"
          style={{
            fontFamily: 'var(--font-serif-display)',
            fontWeight: 400,
            fontSize: 32,
            lineHeight: 1.08,
            letterSpacing: '-0.02em',
            color: '#1A1620',
            margin: 0,
          }}
        >
          Welcome <em style={{ fontStyle: 'normal', color: '#6B3FA0' }}>home.</em>
        </h1>

        {/* Sub-copy slot. We don't have the household-preview endpoint
            described in the design handoff, so the line is intentionally
            hidden (the handoff says: omit rather than show a placeholder). */}

        {/* Status / error banners - placed inside the card above the
            auth controls so they sit where the user is looking. */}
        <div style={{ marginTop: 24 }}>
          {verified && (
            <p className="text-sm text-success bg-success/10 rounded-lg px-3 py-2 mb-3">Email verified! You can now log in.</p>
          )}
          {tokenError === 'invalid-token' && (
            <p className="text-sm text-error bg-error/10 rounded-lg px-3 py-2 mb-3">Invalid or expired verification link.</p>
          )}

          <ErrorBanner message={error} onDismiss={() => setError('')} />

          {needsVerification && resendState !== 'sent' && (
            <button
              type="button"
              onClick={handleResend}
              disabled={resendState === 'sending' || !email.trim()}
              className="text-sm hover:underline disabled:opacity-50 disabled:no-underline mb-3"
              style={{ color: '#6B3FA0' }}
            >
              {resendState === 'sending' ? 'Sending…' : 'Resend verification email'}
            </button>
          )}
          {resendState === 'sent' && (
            <p className="text-sm text-success bg-success/10 rounded-lg px-3 py-2 mb-3">
              If that email is registered and unverified, a new verification link has been sent. Check your inbox.
            </p>
          )}

          {/* Auth controls - stacked, gap 10px per design. SocialButtons
              renders the Google (and on iOS native, Apple) buttons with
              the existing wiring. The design-skin styling is applied via
              the wrapper class below. */}
          <div className="login-concierge-auth">
            <SocialButtons onSuccess={handleSocialSuccess} onError={setError} />

            {!showEmailForm ? (
              // "Continue with Email" reveals the existing email/password
              // form. We don't have a magic-link backend, so this stays as
              // the existing email/password flow (per user instruction).
              <button
                type="button"
                onClick={() => setShowEmailForm(true)}
                className="w-full flex items-center justify-center gap-2 transition-all"
                style={{
                  padding: '14px 18px',
                  borderRadius: 12,
                  background: '#FFFFFF',
                  color: '#1A1620',
                  border: '1px solid rgba(26,22,32,0.10)',
                  boxShadow: '0 1px 0 rgba(26,22,32,0.04)',
                  fontFamily: 'var(--font-sans)',
                  fontWeight: 600,
                  fontSize: 14,
                  lineHeight: 1.45,
                  marginTop: 10,
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="5" width="18" height="14" rx="2" />
                  <path d="M3 7l9 6 9-6" />
                </svg>
                Continue with Email
              </button>
            ) : (
              <>
                {/* OR divider */}
                <div className="flex items-center gap-3" style={{ margin: '14px 0 4px' }}>
                  <div className="flex-1" style={{ height: 1, background: 'rgba(26,22,32,0.12)' }} />
                  <span
                    style={{
                      fontFamily: 'var(--font-sans)',
                      fontSize: 11,
                      fontWeight: 400,
                      letterSpacing: '0.08em',
                      color: '#8A8493',
                      textTransform: 'uppercase',
                    }}
                  >Or</span>
                  <div className="flex-1" style={{ height: 1, background: 'rgba(26,22,32,0.12)' }} />
                </div>

                <form onSubmit={handleSubmit} autoComplete="on" className="space-y-3 mt-3">
                  <div>
                    <label htmlFor="login-email" className="block text-xs font-medium mb-1" style={{ color: '#4A4453' }}>Email</label>
                    <input
                      id="login-email"
                      name="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@household.com"
                      autoComplete="username"
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
                  </div>
                  <div>
                    <label htmlFor="login-password" className="block text-xs font-medium mb-1" style={{ color: '#4A4453' }}>Password</label>
                    <input
                      id="login-password"
                      name="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Your password"
                      autoComplete="current-password"
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
                    <div className="text-right mt-1">
                      <Link to="/forgot-password" className="text-xs hover:underline" style={{ color: '#6B3FA0' }}>Forgot password?</Link>
                    </div>
                  </div>
                  <TurnstileWidget ref={turnstileRef} onChange={setTurnstileToken} />
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
                    {loading ? 'Logging in…' : 'Log in'}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>

        <p
          className="text-center"
          style={{
            marginTop: 20,
            fontFamily: 'var(--font-sans)',
            fontSize: 13,
            fontWeight: 400,
            color: '#4A4453',
            lineHeight: 1.45,
          }}
        >
          New to Housemait?{' '}
          <Link
            to="/signup"
            style={{
              fontFamily: 'var(--font-sans)',
              fontWeight: 700,
              fontSize: 13,
              color: '#6B3FA0',
              textDecoration: 'none',
              borderBottom: '1.5px solid #6B3FA0',
              paddingBottom: 1,
            }}
          >
            Create an account →
          </Link>
        </p>

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
          By continuing, you agree to our{' '}
          <Link to="/terms" style={{ color: '#4A4453', textDecoration: 'none' }}>Terms</Link>
          {' '}and{' '}
          <Link to="/privacy" style={{ color: '#4A4453', textDecoration: 'none' }}>Privacy Policy</Link>.
        </p>
      </div>

      {/* Scoped overrides for the SocialButtons component inside the
          concierge card. SocialButtons ships its own utility classes (a
          bordered pill, cream-border, etc.) that don't match this
          design's primary-Google + ghost-Apple composition. Rather than
          fork the component, we restyle its children via a parent class.
          The first SSO button (Google, when shown) becomes the primary
          purple CTA; subsequent buttons (Apple on iOS native) stay
          white/ghost. */}
      <style>{`
        /* Scope to the SocialButtons wrapper (a <div>) - not the email
           <form>, which also has space-y-3 but whose Log-in button has
           its own inline styling. */
        .login-concierge-auth > div.space-y-3 > * + * { margin-top: 10px !important; }
        .login-concierge-auth button[disabled] { cursor: wait; }
        .login-concierge-auth > div.space-y-3 > button {
          padding: 14px 18px !important;
          border-radius: 12px !important;
          font-family: var(--font-sans) !important;
          font-weight: 600 !important;
          font-size: 14px !important;
          line-height: 1.45 !important;
          width: 100% !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          gap: 10px !important;
          transition: transform .15s ease, box-shadow .15s ease;
        }
        .login-concierge-auth > div.space-y-3 > button:first-child {
          background: #6B3FA0 !important;
          color: #FFFFFF !important;
          border: 1px solid transparent !important;
          box-shadow: 0 6px 16px -8px rgba(107,63,160,0.45) !important;
        }
        .login-concierge-auth > div.space-y-3 > button:first-child:hover {
          background: #5A3488 !important;
        }
        .login-concierge-auth > div.space-y-3 > button:nth-child(n+2) {
          background: #FFFFFF !important;
          color: #1A1620 !important;
          border: 1px solid rgba(26,22,32,0.10) !important;
          box-shadow: 0 1px 0 rgba(26,22,32,0.04) !important;
        }
        /* Mobile (< 481px): shrink card padding + headline so it fits
           a narrow phone without horizontal scroll. Tagged by id since
           the card uses inline styles that need !important to beat. */
        @media (max-width: 480px) {
          #login-concierge-card { padding: 28px 22px 22px !important; }
          #login-concierge-card h1 { font-size: 34px !important; }
        }
      `}</style>
    </div>
  );
}
