/**
 * Onboarding v4 — flow shell (Phase 0).
 *
 * Value-first 12-screen flow from design_handoff_onboarding. Sign-up stays at
 * step 11 by design: everything before it is held client-side (see
 * lib/onboardingDraft) and replayed once the account exists, because a calendar
 * feed needs user_id + household_id and a WhatsApp link is a column on users.
 *
 * Phase 0 wires the frame only: tokens, draft persistence, routing, Reduce
 * Motion. The Step frame and primitives land in Phase 1, screens in Phase 3.
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import usePrefersReducedMotion from '../../hooks/usePrefersReducedMotion';
import { loadDraft, saveDraft } from '../../lib/onboardingDraft';
import { T } from './tokens';

// Spec: STEPS drives the progress bar; advancing past the last sets phase
// 'signup'. The per-provider calendar connect view lives INSIDE the 'cals'
// step, deliberately not in this array, so progress doesn't jump to 100%.
export const STEPS = ['pains', 'plan', 'shape', 'you', 'role', 'house', 'cals', 'ask', 'reminders'];

export default function OnboardingV4() {
  const navigate = useNavigate();
  const reduced = usePrefersReducedMotion();

  const [phase, setPhase] = useState('splash'); // splash | flow | login | signup | done
  const [i, setI] = useState(0);
  const [d, setD] = useState(loadDraft);

  // Mirror answers to localStorage so a backgrounded webview doesn't lose ten
  // screens of input. Calendar URLs are deliberately excluded - see the module
  // note in onboardingDraft.js.
  useEffect(() => { saveDraft(d); }, [d]);

  const pct = Math.round((i / (STEPS.length)) * 100);

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{
        background: T.bg,
        paddingTop: 'env(safe-area-inset-top, 0px)',
        color: T.ink,
      }}
    >
      <main className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <p
          style={{
            fontFamily: T.title, fontSize: 34, lineHeight: 1.08,
            letterSpacing: '-.015em', color: T.ink,
          }}
        >
          Onboarding <em style={{ color: T.purple, fontStyle: 'italic' }}>v4</em>
        </p>
        <p style={{ color: T.ink2, fontSize: 15, marginTop: 10, maxWidth: 320 }}>
          Phase 0 shell. Tokens, draft persistence and routing are wired; screens
          land in Phase 3.
        </p>

        {/* Progress bar - the real one moves to the shared Step header in Phase 1. */}
        <div
          style={{
            height: 5, borderRadius: 99, background: 'rgba(26,22,32,.09)',
            width: '100%', maxWidth: 320, marginTop: 22, overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%', borderRadius: 99, width: `${pct}%`,
              background: 'linear-gradient(90deg,#A97FFF,#6D38AD)',
              transition: reduced ? 'none' : 'width .55s cubic-bezier(.32,.72,0,1)',
            }}
          />
        </div>

        <p style={{ color: T.ink3, fontSize: 12.5, marginTop: 14 }}>
          step {i + 1} of {STEPS.length} · {STEPS[i]} · phase: {phase}
          {reduced ? ' · reduce-motion' : ''}
        </p>

        <div className="flex gap-2 mt-6">
          <button
            type="button"
            onClick={() => setI((n) => Math.max(0, n - 1))}
            style={{
              minHeight: 44, padding: '0 18px', borderRadius: 17, border: 0,
              background: 'rgba(26,22,32,.05)', color: T.ink2, fontWeight: 600,
            }}
          >
            Back
          </button>
          <button
            type="button"
            onClick={() => setI((n) => Math.min(STEPS.length - 1, n + 1))}
            style={{
              minHeight: 44, padding: '0 22px', borderRadius: 17, border: 0,
              background: T.purple, color: '#fff', fontWeight: 700,
            }}
          >
            Next
          </button>
        </div>

        <button
          type="button"
          onClick={() => { setD({ ...d, you: 'Sam', house: 'The Carters' }); }}
          style={{ marginTop: 18, background: 'none', border: 0, color: T.purple, fontWeight: 600, fontSize: 14 }}
        >
          Write a test draft
        </button>
        <p style={{ color: T.ink3, fontSize: 12, marginTop: 6 }}>
          draft: {d.you || '—'} / {d.house || '—'}
        </p>

        <button
          type="button"
          onClick={() => navigate('/signup')}
          style={{ marginTop: 26, background: 'none', border: 0, color: T.ink3, fontSize: 13 }}
        >
          ← current /signup flow
        </button>
      </main>
    </div>
  );
}
