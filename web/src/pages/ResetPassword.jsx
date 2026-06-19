import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import api from '../lib/api';
import ErrorBanner from '../components/ErrorBanner';
import { localeHomePath } from '../hooks/useLocale';

// Shared stage/card wrapper so the three render branches (invalid
// token, form, success) all sit on the same concierge background.
function Stage({ children }) {
  return (
    <div
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
            <img src="/housemait-logomark.svg" alt="" aria-hidden="true" style={{ width: 36, height: 36, objectFit: 'contain' }} />
          </div>
        </Link>
        {children}
      </div>
    </div>
  );
}

const headlineStyle = {
  fontFamily: "'Instrument Serif', serif",
  fontWeight: 400,
  fontSize: 40,
  lineHeight: 1.05,
  letterSpacing: '-0.02em',
  color: '#1A1620',
  margin: 0,
};
const labelStyle = { color: '#4A4453' };
const inputStyle = {
  width: '100%',
  padding: '12px 14px',
  borderRadius: 12,
  background: '#FFFFFF',
  border: '1px solid rgba(26,22,32,0.10)',
  fontFamily: 'var(--font-sans)',
  fontSize: 14,
  color: '#1A1620',
  outline: 'none',
};
const ctaStyle = {
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
};

export default function ResetPassword() {
  const [password, setPassword]   = useState('');
  const [confirm, setConfirm]     = useState('');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const [success, setSuccess]     = useState(false);
  const navigate                  = useNavigate();
  const [searchParams]            = useSearchParams();
  const token                     = searchParams.get('token');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!password || password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setLoading(true);
    try {
      await api.post('/auth/reset-password', { token, password });
      setSuccess(true);
      setTimeout(() => navigate('/login'), 2000);
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <Stage>
        <h1 className="text-center" style={headlineStyle}>
          Invalid <em style={{ fontStyle: 'italic', color: '#6B3FA0' }}>link.</em>
        </h1>
        <p className="text-center" style={{ marginTop: 16, fontFamily: 'var(--font-sans)', fontSize: 14, color: '#4A4453' }}>
          The reset link is missing or has expired. Request a new one to try again.
        </p>
        <Link to="/forgot-password" className="block text-center w-full transition-all" style={{ ...ctaStyle, marginTop: 24, textDecoration: 'none' }}>
          Request a new link
        </Link>
      </Stage>
    );
  }

  return (
    <Stage>
      <h1 className="text-center" style={headlineStyle}>
        Set a new <em style={{ fontStyle: 'italic', color: '#6B3FA0' }}>password.</em>
      </h1>

      <div style={{ marginTop: 24 }}>
        <ErrorBanner message={error} onDismiss={() => setError('')} />

        {success ? (
          <p className="text-success bg-success/10 rounded-xl px-3 py-3 text-sm text-center">
            Password updated! Redirecting to login…
          </p>
        ) : (
          <form onSubmit={handleSubmit} autoComplete="on" className="space-y-3">
            <div>
              <label htmlFor="reset-password" className="block text-xs font-medium mb-1" style={labelStyle}>New password</label>
              <input
                id="reset-password"
                name="new-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                autoComplete="new-password"
                style={inputStyle}
              />
            </div>
            <div>
              <label htmlFor="reset-confirm" className="block text-xs font-medium mb-1" style={labelStyle}>Confirm password</label>
              <input
                id="reset-confirm"
                name="confirm-password"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Same password again"
                autoComplete="new-password"
                style={inputStyle}
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full transition-all disabled:opacity-60"
              style={ctaStyle}
            >
              {loading ? 'Updating…' : 'Update password'}
            </button>
          </form>
        )}
      </div>
    </Stage>
  );
}
