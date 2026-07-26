/**
 * Onboarding v4 — flow shell.
 *
 * Value-first 12-screen flow from design_handoff_onboarding. Sign-up stays at
 * step 11 by design: everything before it is held client-side (see
 * lib/onboardingDraft) and replayed once the account exists, because a calendar
 * feed needs user_id + household_id and a WhatsApp link is a column on users.
 *
 * Phase 2 (here): the real state machine wired to the Step frame - navigation,
 * back-preserves-input, auto-advance, skip paths. Screens are still stand-ins
 * so the machine can be exercised on its own; Phase 3 replaces the body of each
 * step with the designed screen.
 */
import usePrefersReducedMotion from '../../hooks/usePrefersReducedMotion';
import { useNavigate } from 'react-router-dom';
import { T } from './tokens';
import { STEPS } from './flow';
import { skipLabelAt, autoAdvances, isRequired } from './machine';
import useOnboardingFlow from './useOnboardingFlow';
import { Step, Cta, Ghost, OptionRow, ChipGrid, Field } from './ui';

const SHAPES = [
  { id: 'couple', emoji: '💞', label: 'Just us two', note: 'Two calendars, one home' },
  { id: 'kids', emoji: '🧸', label: 'Family with kids', note: 'The full house' },
  { id: 'single', emoji: '💪', label: 'Single-parent crew', note: 'Doing it all, brilliantly' },
];
const ROLES = ['Mum', 'Dad', 'Parent', 'Guardian', 'Grandparent', 'Carer'];
const PAINS = [
  { id: 'calendar', emoji: '📅', label: 'Calendar chaos', note: "Clashes, pickups, who's where" },
  { id: 'chores', emoji: '🧹', label: 'Chore wars', note: 'Whose turn is it, again' },
  { id: 'mental', emoji: '🧠', label: 'The mental load', note: 'It all lives in your head' },
];

export default function OnboardingV4() {
  const navigate = useNavigate();
  const reduced = usePrefersReducedMotion();
  const f = useOnboardingFlow();
  const { phase, step, pct, d, update, next, back, skip, goPhase, pickAndAdvance, canAdvance } = f;

  // ── Non-step phases ──────────────────────────────────────────────────────
  if (phase === 'splash') {
    return (
      <Shell>
        <h1 style={H1}>Phase 2 · <em style={EM}>state machine</em></h1>
        <p style={SUB}>Splash stand-in. The machine, not the design.</p>
        <div style={{ marginTop: 24 }}>
          <Cta onClick={() => goPhase('flow', 0)}>Hand it over to Housemait</Cta>
          <Ghost onClick={() => goPhase('login')}>I already have an account</Ghost>
        </div>
      </Shell>
    );
  }
  if (phase === 'login') {
    return (
      <Shell>
        <h1 style={H1}>Welcome <em style={EM}>back.</em></h1>
        <p style={SUB}>Login stand-in.</p>
        <div style={{ marginTop: 24 }}><Ghost onClick={back}>← Back to splash</Ghost></div>
      </Shell>
    );
  }
  if (phase === 'signup' || phase === 'done') {
    const rows = Object.entries({
      pains: (d.pains || []).join(', ') || '—',
      shape: d.shape || '—', you: d.you || '—', role: d.role || '—', house: d.house || '—',
    });
    return (
      <Shell>
        <h1 style={H1}>{phase === 'done' ? 'Welcome home.' : `${d.house || 'Your household'} is `}<em style={EM}>{phase === 'done' ? '' : 'ready.'}</em></h1>
        <p style={SUB}>
          {phase === 'signup'
            ? 'Sign-up stand-in — step 11, exactly where the spec puts it.'
            : 'Done stand-in.'}
        </p>
        <div style={{ marginTop: 18, background: T.surface, borderRadius: 16, padding: 14 }}>
          {rows.map(([k, v]) => (
            <p key={k} style={{ fontSize: 13, color: T.ink2, display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
              <span style={{ color: T.ink3 }}>{k}</span><b style={{ color: T.ink }}>{v}</b>
            </p>
          ))}
        </div>
        <div style={{ marginTop: 20 }}>
          {phase === 'signup' && <Cta onClick={f.finish}>Create account (stand-in)</Cta>}
          <Ghost onClick={phase === 'signup' ? back : () => navigate('/signup')}>
            {phase === 'signup' ? '← Back to the last step' : 'Leave'}
          </Ghost>
        </div>
      </Shell>
    );
  }

  // ── Step phase ───────────────────────────────────────────────────────────
  const skipLabel = skipLabelAt(f.i);

  return (
    <Step
      pct={pct}
      reduced={reduced}
      onBack={back}
      footer={(
        <>
          {/* Auto-advance steps have no CTA - selection moves the flow. */}
          {!autoAdvances(f.i) && (
            <Cta disabled={!canAdvance} onClick={next}>
              {step === 'pains' && (d.pains || []).length === 0 ? 'Pick at least one' : 'Continue'}
            </Cta>
          )}
          {skipLabel && <Ghost onClick={skip}>{skipLabel}</Ghost>}
        </>
      )}
    >
      <p style={EYEBROW}>{step} · step {f.i + 1} of {STEPS.length}{isRequired(f.i) ? ' · required' : ''}</p>
      <h1 style={H1}>{step}</h1>

      {step === 'pains' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 16 }}>
          {PAINS.map((p, n) => (
            <OptionRow
              key={p.id} i={n} compact emoji={p.emoji} label={p.label} note={p.note}
              selected={(d.pains || []).includes(p.id)}
              onClick={() => update((prev) => ({
                pains: prev.pains.includes(p.id) ? prev.pains.filter((x) => x !== p.id) : [...prev.pains, p.id],
              }))}
            />
          ))}
        </div>
      )}

      {step === 'shape' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 16 }}>
          {SHAPES.map((s, n) => (
            <OptionRow
              key={s.id} i={n} emoji={s.emoji} label={s.label} note={s.note}
              selected={d.shape === s.id}
              onClick={() => pickAndAdvance({ shape: s.id })}
            />
          ))}
        </div>
      )}

      {step === 'you' && (
        <div style={{ marginTop: 16 }}>
          <Field value={d.you} onChange={(v) => update({ you: v })} onEnter={() => canAdvance && next()} placeholder="Your first name" />
        </div>
      )}

      {step === 'role' && (
        <div style={{ marginTop: 16 }}>
          <ChipGrid options={ROLES} value={d.role} onPick={(r) => pickAndAdvance({ role: r })} />
        </div>
      )}

      {step === 'house' && (
        <div style={{ marginTop: 16 }}>
          <Field
            value={d.house} onChange={(v) => update({ house: v })} onEnter={() => canAdvance && next()}
            placeholder="e.g. The Carters"
            suggestions={['The Nest', 'Base Camp', d.you ? `Casa ${d.you}` : 'Home HQ']}
            onSuggest={(s) => update({ house: s })}
          />
        </div>
      )}

      {(step === 'plan' || step === 'cals' || step === 'ask' || step === 'reminders') && (
        <p style={{ ...SUB, marginTop: 16 }}>Stand-in for the {step} screen (Phase 3).</p>
      )}

      <p style={{ fontSize: 12, color: T.ink3, marginTop: 24 }}>
        draft — pains: {(d.pains || []).length} · shape: {d.shape || '—'} · you: {d.you || '—'} · role: {d.role || '—'} · house: {d.house || '—'}
      </p>
    </Step>
  );
}

/** Minimal frame for the non-step phases, which don't use the Step header. */
function Shell({ children }) {
  return (
    <div
      className="ob-v4"
      style={{
        height: '100dvh', display: 'flex', flexDirection: 'column', justifyContent: 'center',
        background: T.bg, color: T.ink, padding: '0 26px 30px',
        paddingTop: 'env(safe-area-inset-top, 0px)',
      }}
    >
      {children}
    </div>
  );
}

const H1 = { fontFamily: T.title, fontWeight: 400, fontSize: 34, lineHeight: 1.08, letterSpacing: '-.015em', marginTop: 8, textWrap: 'balance' };
const EM = { color: T.purple, fontStyle: 'italic' };
const SUB = { fontSize: 15, color: T.ink2, marginTop: 8, lineHeight: 1.45 };
const EYEBROW = { font: '700 11.5px Inter, sans-serif', letterSpacing: '.16em', textTransform: 'uppercase', color: T.purple };
