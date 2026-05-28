/**
 * Standalone WhatsApp pairing surface, reachable at /connect-whatsapp.
 *
 * Built for the T+24h re-engagement email's CTA - users who signed up
 * but never linked WhatsApp click the email button and need to land
 * on a pairing UI regardless of whether they finished onboarding or
 * skipped through it. The existing /onboarding route either re-runs
 * the wizard from Welcome (annoying for users who saw it yesterday)
 * or bounces to /dashboard with no WhatsApp prompt (dead-end for the
 * post-onboarding cohort). This page sidesteps both by reusing the
 * existing ConnectWhatsApp onboarding step inside a stripped-down
 * wizard chrome.
 *
 * Routing: protected by RequireAuthOnly (no needs-onboarding guard),
 * so users in either state can reach it. If the user is ALREADY
 * linked when they arrive, we bounce to /dashboard immediately - no
 * point showing the pairing UI to someone who already paired.
 *
 * After a successful pair OR a skip, the step's next() callback fires.
 * We then:
 *   1. POST /auth/mark-onboarded - idempotent, safe for both case 1
 *      (never finished wizard) and case 2 (finished wizard but skipped
 *      WhatsApp). For case 1 this stops RequireAuth from bouncing them
 *      back to /onboarding when they hit /dashboard.
 *   2. Update the cached user object with the server's authoritative
 *      onboarded_at + whatsapp_linked state.
 *   3. Navigate to /dashboard.
 */

import { useEffect, useState, Suspense, lazy } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../lib/api';
import ErrorBanner from '../components/ErrorBanner';

const ConnectWhatsApp = lazy(() => import('./onboarding/ConnectWhatsApp'));

export default function ConnectWhatsAppStandalone() {
  const { user, updateUser } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');

  // Already linked? Bounce. No point showing the form to someone who
  // doesn't need it (eg. they clicked the email link from a different
  // device than the one they linked on, then bounced back here).
  useEffect(() => {
    if (user?.whatsapp_linked) {
      navigate('/dashboard', { replace: true });
    }
  }, [user, navigate]);

  // Called by ConnectWhatsApp on either successful pair or skip. Both
  // paths land the user at /dashboard; the mark-onboarded call ensures
  // the post-skip case 1 user doesn't get bounced right back here.
  async function handleNext() {
    try {
      const { data } = await api.post('/auth/mark-onboarded');
      if (data?.user) updateUser(data.user);
    } catch (err) {
      // Soft-fail. Even if mark-onboarded errors, navigating to
      // /dashboard is still the right move - worst case the user
      // sees the onboarding wizard one more time on next login.
      console.error('[connect-whatsapp standalone] mark-onboarded failed:', err?.response?.data?.error || err.message);
    } finally {
      navigate('/dashboard');
    }
  }

  return (
    <div
      className="relative min-h-screen overflow-hidden flex flex-col"
      style={{ background: 'radial-gradient(120% 80% at 50% 0%, #EFE9FB 0%, #FAF7F2 55%, #F3EEE5 100%)' }}
    >
      {/* Decorative ambient blobs - same as the onboarding wizard so
          the surface feels of-a-piece for users arriving here from the
          re-engagement email. */}
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

      <main className="relative z-10 flex-1 flex items-start justify-center px-4 pt-10 pb-8 md:pt-12 md:pb-10">
        <div
          className="relative w-full max-w-[480px]"
          style={{
            background: 'rgba(255,253,250,0.86)',
            backdropFilter: 'blur(18px) saturate(140%)',
            WebkitBackdropFilter: 'blur(18px) saturate(140%)',
            border: '1px solid rgba(255,255,255,0.9)',
            borderRadius: 24,
            boxShadow: '0 30px 80px -20px rgba(26,22,32,0.25), inset 0 2px 0 rgba(255,255,255,0.6)',
            padding: '32px 28px 28px',
          }}
        >
          {/* Logomark chip - matches the onboarding wizard header. */}
          <div
            className="mx-auto mb-5"
            style={{
              width: 56, height: 56,
              borderRadius: 16,
              background: '#EFE9FB',
              border: '1px solid rgba(107,63,160,0.18)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            aria-hidden="true"
          >
            <img src="/housemait-logomark.png" alt="" style={{ width: 34, height: 34, objectFit: 'contain' }} />
          </div>

          <ErrorBanner message={error} onDismiss={() => setError('')} />
          <Suspense fallback={<div className="text-center text-sm text-cocoa py-8">Loading…</div>}>
            <ConnectWhatsApp next={handleNext} setError={setError} />
          </Suspense>
        </div>
      </main>
    </div>
  );
}
