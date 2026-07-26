/**
 * Onboarding v4 — flow shell.
 *
 * Value-first 12-screen flow from design_handoff_onboarding. Sign-up stays at
 * step 11 by design: everything before it is held client-side (see
 * lib/onboardingDraft) and replayed once the account exists, because a calendar
 * feed needs user_id + household_id and a WhatsApp link is a column on users.
 *
 * Phase 1 (here): the shared Step frame + primitives, exercised by a harness so
 * they can be verified before any screen depends on them. Phase 2 replaces the
 * harness with the real state machine; Phase 3 brings the screens.
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import usePrefersReducedMotion from '../../hooks/usePrefersReducedMotion';
import { loadDraft, saveDraft } from '../../lib/onboardingDraft';
import { T } from './tokens';
import { STEPS } from './flow';
import { Step, Cta, Ghost, OptionRow, ChipGrid, Field, Bubble, Typing } from './ui';
import useScript from './useScript';

// Real screen-02 content, used here to exercise OptionRow at production size.
const PAINS = [
  { id: 'calendar', emoji: '📅', label: 'Calendar chaos', note: "Clashes, pickups, who's where" },
  { id: 'chores', emoji: '🧹', label: 'Chore wars', note: 'Whose turn is it, again' },
  { id: 'shopping', emoji: '🛒', label: 'Shopping-list roulette', note: 'Two lots of milk, no bread' },
];
const ROLES = ['Mum', 'Dad', 'Parent', 'Guardian'];

const SCRIPT = [
  { from: 'bot', text: 'Oof, 3 of the classics.', wait: 700 },
  { from: 'bot', text: "Right then. Here's what I'll take off your hands:", wait: 900 },
];

export default function OnboardingV4() {
  const navigate = useNavigate();
  const reduced = usePrefersReducedMotion();

  const [i, setI] = useState(0);
  const [d, setD] = useState(loadDraft);
  const [name, setName] = useState('');

  // Mirror answers to localStorage so a backgrounded webview doesn't lose ten
  // screens of input. Calendar URLs are deliberately excluded - see the module
  // note in onboardingDraft.js.
  useEffect(() => { saveDraft(d); }, [d]);

  const { shown, typing } = useScript(SCRIPT, undefined, reduced);

  const togglePain = (id) => setD((p) => ({
    ...p,
    pains: p.pains.includes(id) ? p.pains.filter((x) => x !== id) : [...p.pains, id],
  }));

  const pct = Math.round((i / STEPS.length) * 100);

  return (
    <Step
      pct={pct}
      reduced={reduced}
      hideBack={i === 0}
      onBack={() => setI((n) => Math.max(0, n - 1))}
      footer={(
        <>
          <Cta disabled={d.pains.length === 0} onClick={() => setI((n) => Math.min(STEPS.length - 1, n + 1))}>
            {d.pains.length === 0 ? 'Pick at least one' : `That's my list (${d.pains.length})`}
          </Cta>
          <Ghost onClick={() => navigate('/signup')}>None of these, just looking</Ghost>
        </>
      )}
    >
      <p style={{ font: '700 11.5px Inter, sans-serif', letterSpacing: '.16em', textTransform: 'uppercase', color: T.purple }}>
        Phase 1 · primitives
      </p>
      <h1
        style={{
          fontFamily: T.title, fontWeight: 400, fontSize: 32, lineHeight: 1.08,
          letterSpacing: '-.015em', marginTop: 8, textWrap: 'balance',
        }}
      >
        Which of these <em style={{ color: T.purple, fontStyle: 'italic' }}>sound like you?</em>
      </h1>
      <p style={{ fontSize: 15, color: T.ink2, marginTop: 8, lineHeight: 1.45 }}>Pick as many as you like.</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 18 }}>
        {PAINS.map((p, n) => (
          <OptionRow
            key={p.id}
            i={n}
            compact
            emoji={p.emoji}
            label={p.label}
            note={p.note}
            selected={d.pains.includes(p.id)}
            onClick={() => togglePain(p.id)}
          />
        ))}
      </div>

      <p style={{ fontSize: 12.5, color: T.ink3, marginTop: 22, marginBottom: 8 }}>ChipGrid</p>
      <ChipGrid options={ROLES} value={d.role} onPick={(r) => setD((p) => ({ ...p, role: r }))} />

      <p style={{ fontSize: 12.5, color: T.ink3, marginTop: 22, marginBottom: 8 }}>Field + suggestions</p>
      <Field
        value={name}
        onChange={setName}
        placeholder="e.g. The Carters"
        autoFocus={false}
        suggestions={['The Nest', 'Base Camp', 'Casa Sam']}
        onSuggest={setName}
      />

      <p style={{ fontSize: 12.5, color: T.ink3, marginTop: 22, marginBottom: 8 }}>Chat beat</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        <Bubble from="me">Dentist for Arlo Tue 3pm</Bubble>
        {shown.map((s, n) => <Bubble key={n} from="bot">{s.text}</Bubble>)}
        {typing && <Typing />}
      </div>

      <p style={{ fontSize: 12, color: T.ink3, marginTop: 20 }}>
        step {i + 1}/{STEPS.length} · {STEPS[i]}{reduced ? ' · reduce-motion' : ''} · draft role: {d.role || '—'}
      </p>
    </Step>
  );
}
