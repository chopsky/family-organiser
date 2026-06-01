import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { localeHomePath } from '../hooks/useLocale';

// Landed on after clicking the "Verify email" link in a welcome email.
// Renders regardless of auth state - the user may be on a browser where
// another account is already logged in (especially admins testing new
// signups), and we want them to see the confirmation before any route
// guard bounces them off to a dashboard.
export default function Verified() {
  const { token } = useAuth();
  const continueTo = token ? '/dashboard' : '/login';
  const continueLabel = token ? 'Continue to dashboard' : 'Log in';

  return (
    <div
      // Concierge stage - matches the rest of the auth flow.
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
          Email <em style={{ fontStyle: 'italic', color: '#6B3FA0' }}>verified.</em>
        </h1>

        <p
          className="text-center"
          style={{
            marginTop: 16,
            fontFamily: 'var(--font-sans)',
            fontSize: 14,
            color: '#4A4453',
            lineHeight: 1.5,
          }}
        >
          Your account is all set up and ready to use.
        </p>

        <Link
          to={continueTo}
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
          {continueLabel}
        </Link>
      </div>
    </div>
  );
}
