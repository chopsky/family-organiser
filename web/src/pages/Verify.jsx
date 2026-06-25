/**
 * /verify - landing page for the email-verification link.
 *
 * The verification email points at https://housemait.com/verify?token=…
 * which is registered as a Universal Link in apple-app-site-association,
 * so on iOS the Housemait app opens directly here. On web it's just a
 * normal React route. Either way we POST the token to the server, which
 * flips email_verified + issues a session JWT, then we drop the user
 * into the right next step (household setup or the onboarding wizard).
 *
 * No "click here to continue" button - this is purely a handoff page;
 * the user has already expressed intent by clicking the email link.
 */

import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { localeHomePath } from '../hooks/useLocale';

export default function Verify() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const navigate = useNavigate();
  const { login } = useAuth();
  const [error, setError] = useState('');
  // React 18 StrictMode mounts effects twice in dev. The verify endpoint
  // is single-use - second call returns "Invalid link" and the user
  // sees an error even though the first call succeeded. Guard with a ref.
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    if (!token) {
      setError('Missing verification token. Try the link in your email again.');
      return;
    }
    (async () => {
      try {
        const { data } = await api.post('/auth/verify-email-and-login', { token });
        // login() stores the JWT and household + member context. After
        // this, RequireAuth routes will recognise the user as authed.
        login(data);
        // Resume the unified onboarding flow at /signup - entryIndex picks up at
        // the right step from auth state (no household -> household step;
        // household but not onboarded -> invite onward). Fully-onboarded users
        // (e.g. a re-verify) go straight to the dashboard.
        if (!data.household || !data.user?.onboarded_at) {
          navigate('/signup', { replace: true });
        } else {
          navigate('/dashboard', { replace: true });
        }
      } catch (err) {
        setError(err.response?.data?.error || 'Could not verify your email.');
      }
    })();
  }, [token, login, navigate]);

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
          {error ? (
            <>Something <em style={{ fontStyle: 'italic', color: '#6B3FA0' }}>went wrong.</em></>
          ) : (
            <>Verifying your <em style={{ fontStyle: 'italic', color: '#6B3FA0' }}>account…</em></>
          )}
        </h1>

        {error ? (
          <>
            <p className="text-center" style={{ marginTop: 16, fontFamily: 'var(--font-sans)', fontSize: 14, color: '#4A4453', lineHeight: 1.5 }}>
              {error}
            </p>
            <Link
              to="/login"
              className="block text-center w-full transition-all"
              style={{
                marginTop: 24,
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
                textDecoration: 'none',
              }}
            >
              Go to login
            </Link>
          </>
        ) : (
          <p className="text-center" style={{ marginTop: 16, fontFamily: 'var(--font-sans)', fontSize: 14, color: '#4A4453', lineHeight: 1.5 }}>
            One moment - signing you in.
          </p>
        )}
      </div>
    </div>
  );
}
