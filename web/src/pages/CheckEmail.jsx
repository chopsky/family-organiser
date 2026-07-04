import { Link } from 'react-router-dom';
import { localeHomePath } from '../hooks/useLocale';

export default function CheckEmail() {
  return (
    <div
      // Concierge stage - matches Login, Signup, SetupHousehold and the
      // Onboarding wizard, so a brand-new user who just signed up and
      // got bounced here sees the same continuous visual language.
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

      {/* Glass card - Login width (420px) for visual continuity. */}
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
        {/* Logomark chip - keeps the visitor anchored to the brand
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
            <img src="/housemait-logomark.svg" alt="" aria-hidden="true" style={{ width: 36, height: 36, objectFit: 'contain' }} />
          </div>
        </Link>

        <h1
          className="text-center"
          style={{
            fontFamily: 'var(--font-serif-display)',
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
            fontFamily: 'var(--font-sans)',
            fontSize: 14,
            color: '#4A4453',
            lineHeight: 1.5,
          }}
        >
          We&apos;ve sent you a verification link. Open the email and tap the
          button - we&apos;ll bring you straight back here to finish setting up.
        </p>

        <p
          className="text-center"
          style={{
            marginTop: 24,
            fontFamily: 'var(--font-sans)',
            fontSize: 12,
            color: '#8A8493',
            lineHeight: 1.5,
          }}
        >
          Didn&apos;t get the email? Check your spam folder, then try signing up again.
        </p>

        {/* Tiny escape hatch for users who've already verified on
            another device or whose Universal Link didn't fire - they
            can still get to login manually. Demoted from a big purple
            CTA because the verify-link flow handles 99% of cases. */}
        <p
          className="text-center"
          style={{
            marginTop: 16,
            fontFamily: 'var(--font-sans)',
            fontSize: 13,
            color: '#4A4453',
            lineHeight: 1.45,
          }}
        >
          Already verified?{' '}
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
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}
