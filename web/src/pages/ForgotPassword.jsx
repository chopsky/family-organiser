import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import ErrorBanner from '../components/ErrorBanner';
import TurnstileWidget from '../components/TurnstileWidget';
import { localeHomePath } from '../hooks/useLocale';

export default function ForgotPassword() {
  const [email, setEmail]     = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent]       = useState(false);
  const [error, setError]     = useState('');
  const [turnstileToken, setTurnstileToken] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!email.trim()) { setError('Please enter your email.'); return; }
    setLoading(true);
    try {
      await api.post('/auth/forgot-password', {
        email: email.trim(),
        turnstile_token: turnstileToken,
      });
      setSent(true);
    } catch {
      setSent(true); // Always show success to prevent email enumeration
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      // Concierge stage — matches Login / Signup / CheckEmail.
      className="relative min-h-screen overflow-hidden flex items-center justify-center px-4 py-8"
      style={{
        background: 'radial-gradient(120% 80% at 50% 0%, #EFE9FB 0%, #FAF7F2 55%, #F3EEE5 100%)',
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 2rem)',
      }}
    >
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
          {sent ? (
            <>Check your <em style={{ fontStyle: 'italic', color: '#6B3FA0' }}>inbox.</em></>
          ) : (
            <>Forgot your <em style={{ fontStyle: 'italic', color: '#6B3FA0' }}>password?</em></>
          )}
        </h1>

        <p
          className="text-center"
          style={{
            marginTop: 16,
            fontFamily: 'Inter, sans-serif',
            fontSize: 14,
            color: '#4A4453',
            lineHeight: 1.5,
          }}
        >
          {sent
            ? "If that email is registered, we've sent a reset link. It expires in an hour."
            : "Enter your email and we'll send you a link to reset it."}
        </p>

        <div style={{ marginTop: 24 }}>
          <ErrorBanner message={error} onDismiss={() => setError('')} />

          {sent ? (
            <Link
              to="/login"
              className="block text-center w-full transition-all"
              style={{
                padding: '14px 18px',
                borderRadius: 12,
                background: '#6B3FA0',
                color: '#FFFFFF',
                border: '1px solid transparent',
                boxShadow: '0 6px 16px -8px rgba(107,63,160,0.45)',
                fontFamily: 'Inter, sans-serif',
                fontWeight: 600,
                fontSize: 14,
                lineHeight: 1.45,
                textDecoration: 'none',
              }}
            >
              Back to login
            </Link>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              <input
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
                  fontFamily: 'Inter, sans-serif',
                  fontSize: 14,
                  color: '#1A1620',
                  outline: 'none',
                }}
              />
              <TurnstileWidget onChange={setTurnstileToken} />
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
                  fontFamily: 'Inter, sans-serif',
                  fontWeight: 600,
                  fontSize: 14,
                  lineHeight: 1.45,
                }}
              >
                {loading ? 'Sending…' : 'Send reset link'}
              </button>
            </form>
          )}
        </div>

        {!sent && (
          <p
            className="text-center"
            style={{
              marginTop: 20,
              fontFamily: 'Inter, sans-serif',
              fontSize: 13,
              color: '#4A4453',
            }}
          >
            Remembered it?{' '}
            <Link
              to="/login"
              style={{
                fontWeight: 700,
                color: '#6B3FA0',
                textDecoration: 'none',
                borderBottom: '1.5px solid #6B3FA0',
                paddingBottom: 1,
              }}
            >
              Back to login
            </Link>
          </p>
        )}

        <p
          className="text-center"
          style={{
            marginTop: 14,
            fontFamily: 'Inter, sans-serif',
            fontSize: 12,
            color: '#8A8493',
          }}
        >
          <Link to="/terms" style={{ color: '#4A4453', textDecoration: 'none' }}>Terms</Link>
          {' · '}
          <Link to="/privacy" style={{ color: '#4A4453', textDecoration: 'none' }}>Privacy Policy</Link>
        </p>
      </div>
    </div>
  );
}
