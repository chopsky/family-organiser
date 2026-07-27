/**
 * Onboarding v4 — flow shell.
 *
 * Value-first 12-screen flow from design_handoff_onboarding. Sign-up stays at
 * step 11 by design: everything before it is held client-side (see
 * lib/onboardingDraft) and replayed once the account exists, because a calendar
 * feed needs user_id + household_id and a WhatsApp link is a column on users.
 *
 * Phase 3 batch 1 (here): splash and the pickers are the designed screens.
 * The chat beats (03, 09), calendars (08), reminders (10), sign-up (11) and
 * welcome (12) are still stand-ins and land in the next batches.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import usePrefersReducedMotion from '../../hooks/usePrefersReducedMotion';
import { T } from './tokens';
import { skipLabelAt, autoAdvances } from './machine';
import useOnboardingFlow from './useOnboardingFlow';
import { Step, Cta, Ghost } from './ui';
import {
  Splash, PainPicker, ShapePicker, NameStep, RoleStep, HouseStep, HouseSignOverlay,
} from './screens';

export default function OnboardingV4() {
  const navigate = useNavigate();
  const reduced = usePrefersReducedMotion();
  const f = useOnboardingFlow();
  const { phase, step, pct, d, update, next, back, skip, goPhase, pickAndAdvance, canAdvance } = f;

  // The house-sign reward sits between submitting the name and advancing, so
  // it's local to the shell rather than a step in its own right.
  const [sign, setSign] = useState(false);

  if (phase === 'splash') {
    return <Splash reduced={reduced} onStart={() => goPhase('flow', 0)} onLogin={() => goPhase('login')} />;
  }

  if (phase === 'login' || phase === 'signup' || phase === 'done') {
    return (
      <StandIn
        title={phase === 'login' ? 'Welcome back.' : phase === 'done' ? 'Welcome home.' : `${d.house || 'Your household'} is ready.`}
        note={`${phase} screen — Phase 3 batch ${phase === 'login' ? '3' : '3'}`}
        d={d}
        primary={phase === 'signup' ? { label: 'Create account (stand-in)', onClick: f.finish } : null}
        ghost={{ label: phase === 'signup' ? '← Back to the last step' : '← Back', onClick: phase === 'done' ? () => navigate('/signup') : back }}
      />
    );
  }

  const skipLabel = skipLabelAt(f.i);
  // Submitting the household name shows the sign, which then advances.
  const advance = () => { if (step === 'house') setSign(true); else next(); };

  return (
    <>
      {sign && (
        <HouseSignOverlay
          name={d.house}
          reduced={reduced}
          onDone={() => { setSign(false); next(); }}
        />
      )}
      <Step
        pct={pct}
        reduced={reduced}
        onBack={back}
        footer={(
          <>
            {!autoAdvances(f.i) && (
              <Cta disabled={!canAdvance} onClick={advance}>
                {step === 'pains'
                  ? ((d.pains || []).length === 0 ? 'Pick at least one' : `That’s my list (${d.pains.length})`)
                  : step === 'house' ? 'Put the sign up' : 'Continue'}
              </Cta>
            )}
            {skipLabel && <Ghost onClick={skip}>{skipLabel}</Ghost>}
          </>
        )}
      >
        {step === 'pains' && (
          <PainPicker
            d={d}
            toggle={(id) => update((prev) => ({
              pains: prev.pains.includes(id) ? prev.pains.filter((x) => x !== id) : [...prev.pains, id],
            }))}
          />
        )}
        {step === 'shape' && <ShapePicker d={d} pick={pickAndAdvance} />}
        {step === 'you' && <NameStep d={d} update={update} onEnter={() => canAdvance && next()} />}
        {step === 'role' && <RoleStep d={d} pick={pickAndAdvance} />}
        {step === 'house' && <HouseStep d={d} update={update} onEnter={() => canAdvance && advance()} />}

        {(step === 'plan' || step === 'cals' || step === 'ask' || step === 'reminders') && (
          <>
            <p style={{ font: '700 11.5px Inter, sans-serif', letterSpacing: '.16em', textTransform: 'uppercase', color: T.purple }}>
              {step}
            </p>
            <h1 style={{ fontFamily: T.title, fontWeight: 400, fontSize: 34, lineHeight: 1.08, letterSpacing: '-.015em', marginTop: 8 }}>
              {step} screen
            </h1>
            <p style={{ fontSize: 15, color: T.ink2, marginTop: 8 }}>Stand-in — arrives in the next batch.</p>
          </>
        )}
      </Step>
    </>
  );
}

/** Placeholder frame for the phases still to be built. */
function StandIn({ title, note, d, primary, ghost }) {
  return (
    <div
      className="ob-v4"
      style={{
        height: '100dvh', display: 'flex', flexDirection: 'column', justifyContent: 'center',
        background: T.bg, color: T.ink, padding: '0 26px 30px',
        paddingTop: 'env(safe-area-inset-top, 0px)',
      }}
    >
      <h1 style={{ fontFamily: T.title, fontWeight: 400, fontSize: 34, lineHeight: 1.08, letterSpacing: '-.015em' }}>{title}</h1>
      <p style={{ fontSize: 15, color: T.ink2, marginTop: 8 }}>{note}</p>
      <div style={{ marginTop: 18, background: T.surface, borderRadius: 16, padding: 14 }}>
        {['pains', 'shape', 'you', 'role', 'house'].map((k) => (
          <p key={k} style={{ fontSize: 13, display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
            <span style={{ color: T.ink3 }}>{k}</span>
            <b style={{ color: T.ink }}>{Array.isArray(d[k]) ? (d[k].length || '—') : (d[k] || '—')}</b>
          </p>
        ))}
      </div>
      <div style={{ marginTop: 20 }}>
        {primary && <Cta onClick={primary.onClick}>{primary.label}</Cta>}
        {ghost && <Ghost onClick={ghost.onClick}>{ghost.label}</Ghost>}
      </div>
    </div>
  );
}
