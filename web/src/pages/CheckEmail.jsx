import { Link } from 'react-router-dom';
import { localeHomePath } from '../hooks/useLocale';

export default function CheckEmail() {
  return (
    <div
      // Concierge stage — matches Login, Signup, SetupHousehold and the
      // Onboarding wizard, so a brand-new user who just signed up and
      // got bounced here sees the same continuous visual language.
      className="relative min-h-screen overflow-hidden flex items-center justify-center px-4 py-8"
      style={{
        background: 'radial-gradient(120% 80% at 50% 0%, #EFE9FB 0%, #FAF7F2 55%, #F3EEE5 100%)',
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 2rem)',
      }}
    >
      {/* Decorative ambient blobs — identical to Login.jsx. */}
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

      {/* Glass card — Login width (420px) for visual continuity. */}
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
        {/* Logomark chip — keeps the visitor anchored to the brand
            even on a transactional/transitional page like this. */}
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
          Check your <em style={{ fontStyle: 'italic', color: '#6B3FA0' }}>email.</em>
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
          We&apos;ve sent you a verification link. Click it to activate your account, then come back and log in.
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
            fontFamily: 'Inter, sans-serif',
            fontWeight: 600,
            fontSize: 14,
            lineHeight: 1.45,
            textDecoration: 'none',
          }}
        >
          Go to login
        </Link>

        <p
          className="text-center"
          style={{
            marginTop: 14,
            fontFamily: 'Inter, sans-serif',
            fontSize: 12,
            color: '#8A8493',
            lineHeight: 1.45,
          }}
        >
          Didn&apos;t get the email? Check your spam folder, then try signing up again.
        </p>
      </div>
    </div>
  );
}
