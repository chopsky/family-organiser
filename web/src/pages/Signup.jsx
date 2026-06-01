import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../lib/api';
import ErrorBanner from '../components/ErrorBanner';
import SocialButtons from '../components/SocialButtons';
import TurnstileWidget from '../components/TurnstileWidget';
import { localeHomePath } from '../hooks/useLocale';

export default function Signup() {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [name, setName]         = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [turnstileToken, setTurnstileToken] = useState(null);
  // Email form is hidden by default - Continue with Email button reveals it.
  // SSO-first surface matches Login.jsx and reduces visual clutter.
  const [showEmailForm, setShowEmailForm] = useState(false);
  const turnstileRef            = useRef(null);
  const { login }               = useAuth();
  const navigate                = useNavigate();
  const [searchParams]          = useSearchParams();
  const inviteToken             = searchParams.get('invite');

  useEffect(() => {
    document.title = 'Sign up | Housemait';
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password || !name.trim()) {
      setError('All fields are required.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.post('/auth/register', {
        email: email.trim(),
        password,
        name: name.trim(),
        inviteToken: inviteToken || undefined,
        turnstile_token: turnstileToken,
      });

      if (data.token) {
        // Invite flow - auto-joined
        login(data);
        navigate('/dashboard');
      } else {
        // Normal flow - needs email verification
        navigate('/check-email');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong.');
      // Turnstile tokens are single-use. The backend already consumed
      // ours validating this submission - even though the request
      // ultimately failed (weak password, email taken, etc), the token
      // is dead and re-submitting with it would trip "Bot verification
      // failed". Clear and reset so the next submit gets a fresh one.
      setTurnstileToken(null);
      turnstileRef.current?.reset();
    } finally {
      setLoading(false);
    }
  }

  function handleSocialSuccess(data) {
    login(data);
    navigate(data.household ? '/dashboard' : '/setup');
  }

  return (
    <div
      className="relative min-h-screen overflow-hidden flex items-center justify-center px-4 py-8"
      style={{
        background: 'radial-gradient(120% 80% at 50% 0%, #EFE9FB 0%, #FAF7F2 55%, #F3EEE5 100%)',
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 2rem)',
      }}
    >
      {/* Decorative ambient blobs - same as Login.jsx. Kept inline rather
          than extracted so each page can live as a single file. */}
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

      <div
        id="signup-concierge-card"
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
        <Link to={localeHomePath()} aria-label="Housemait home" className="block mx-auto mb-[18px]" style={{ width: 60, height: 60 }}>
          <div
            className="flex items-center justify-center"
            style={{
              width: 60, height: 60,
              borderRadius: 18,
              background: '#EFE9FB',
              border: '1px solid rgba(107,63,160,0.18)',
            }}
          >
            <img src="/housemait-logomark.png" alt="" aria-hidden="true" style={{ width: 36, height: 36, objectFit: 'contain' }} />
          </div>
        </Link>

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
          Your calmer family life<br />
          <em style={{ fontStyle: 'italic', color: '#6B3FA0' }}>starts here.</em>
        </h1>

        {inviteToken && (
          <p
            className="text-center"
            style={{
              marginTop: 12,
              fontFamily: 'var(--font-sans)',
              fontSize: 13,
              color: '#6B3FA0',
              fontWeight: 500,
            }}
          >
            You&apos;ve been invited to join a household!
          </p>
        )}

        <div style={{ marginTop: 24 }}>
          <ErrorBanner message={error} onDismiss={() => setError('')} />

          <div className="signup-concierge-auth">
            <SocialButtons inviteToken={inviteToken} onSuccess={handleSocialSuccess} onError={setError} />

            {!showEmailForm ? (
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
                    <label htmlFor="signup-name" className="block text-xs font-medium mb-1" style={{ color: '#4A4453' }}>Name</label>
                    <input
                      id="signup-name"
                      name="name"
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Sarah"
                      autoComplete="given-name"
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
                    <label htmlFor="signup-email" className="block text-xs font-medium mb-1" style={{ color: '#4A4453' }}>Email</label>
                    <input
                      id="signup-email"
                      name="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@household.com"
                      autoComplete="email"
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
                    <label htmlFor="signup-password" className="block text-xs font-medium mb-1" style={{ color: '#4A4453' }}>Password</label>
                    <input
                      id="signup-password"
                      name="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="At least 8 characters"
                      autoComplete="new-password"
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
                    {loading ? 'Creating account…' : 'Create account'}
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
          Already have an account?{' '}
          <Link
            to="/login"
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
            Log in →
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
          By creating an account, you agree to our{' '}
          <Link to="/terms" style={{ color: '#4A4453', textDecoration: 'none' }}>Terms</Link>
          {' '}and{' '}
          <Link to="/privacy" style={{ color: '#4A4453', textDecoration: 'none' }}>Privacy Policy</Link>.
        </p>
      </div>

      {/* Same scoped SocialButtons re-skin as Login.jsx. See that file
          for rationale - primary purple Google button + ghost Apple. */}
      <style>{`
        .signup-concierge-auth > div.space-y-3 > * + * { margin-top: 10px !important; }
        .signup-concierge-auth button[disabled] { cursor: wait; }
        .signup-concierge-auth > div.space-y-3 > button {
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
        .signup-concierge-auth > div.space-y-3 > button:first-child {
          background: #6B3FA0 !important;
          color: #FFFFFF !important;
          border: 1px solid transparent !important;
          box-shadow: 0 6px 16px -8px rgba(107,63,160,0.45) !important;
        }
        .signup-concierge-auth > div.space-y-3 > button:first-child:hover {
          background: #5A3488 !important;
        }
        .signup-concierge-auth > div.space-y-3 > button:nth-child(n+2) {
          background: #FFFFFF !important;
          color: #1A1620 !important;
          border: 1px solid rgba(26,22,32,0.10) !important;
          box-shadow: 0 1px 0 rgba(26,22,32,0.04) !important;
        }
        @media (max-width: 480px) {
          #signup-concierge-card { padding: 28px 22px 22px !important; }
          #signup-concierge-card h1 { font-size: 34px !important; }
        }
      `}</style>
    </div>
  );
}
