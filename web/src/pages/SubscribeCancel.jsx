/**
 * Subscribe cancel page — Phase 5.
 *
 * Stripe Checkout redirects here when the user closes the payment page
 * or clicks "Back" before completing. No charge was made; nothing has
 * changed on our side.
 *
 * Deliberately low-pressure copy — most "abandons" are people comparison-
 * shopping or checking the trial end date, not hard rejections. Link
 * back to /subscribe for a retry and /dashboard for a bail-out.
 */

import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { isIos } from '../lib/platform';

export default function SubscribeCancel() {
  const navigate = useNavigate();

  // App Store guideline 3.1.1: this page mentions "trial" + "subscribing"
  // and links back to /subscribe — none of which should ever be visible
  // to an iOS reviewer. Bounce to /dashboard on iOS even if a deep link
  // brought us here.
  useEffect(() => {
    if (isIos()) navigate('/dashboard', { replace: true });
  }, [navigate]);

  if (isIos()) return null;

  return (
    <div className="min-h-screen bg-cream px-4 py-8 md:py-12 flex flex-col items-center">
      <div className="my-auto w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-[0_4px_16px_rgba(107,63,160,0.08)] border border-cream-border p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-plum-light flex items-center justify-center mx-auto mb-5">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#6B3FA0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {/* House icon — "nothing's changed, you're still home" */}
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
          </div>
          <h1
            className="text-[28px] text-charcoal mb-2"
            style={{ fontFamily: '"Instrument Serif", Georgia, serif', fontWeight: 600, letterSpacing: '-0.02em' }}
          >
            No worries — you're still good
          </h1>
          <p className="text-cocoa text-base mb-6">
            Nothing's been charged. Your trial is still running and all
            your household's data is right where you left it.
          </p>

          <div className="space-y-3">
            <Link
              to="/subscribe"
              className="block w-full bg-plum hover:bg-plum-pressed text-white font-semibold py-3 px-6 rounded-xl transition-colors"
            >
              Try subscribing again
            </Link>
            <Link
              to="/dashboard"
              className="block w-full border-[1.5px] border-light-grey text-charcoal font-semibold py-3 px-6 rounded-xl hover:bg-oat transition-colors"
            >
              Back to dashboard
            </Link>
          </div>

          <p className="text-xs text-warm-grey mt-6">
            Questions about pricing? Email us at{' '}
            <a href="mailto:hello@housemait.com" className="text-plum hover:underline">
              hello@housemait.com
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
