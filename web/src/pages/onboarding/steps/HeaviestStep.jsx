import { Title, Em, Kicker, Lead, PrimaryButton } from './_ui';
import { PAIN_OPTIONS } from '../../../lib/onboardingContent';

// Step 2. Multi-select pain points (carried in form.pains) that tailor the plan
// screen. Selecting nothing is allowed; the plan falls back to a sensible set.
export default function HeaviestStep({ form, update, next }) {
  const toggle = (id) =>
    update({ pains: form.pains.includes(id) ? form.pains.filter((x) => x !== id) : [...form.pains, id] });

  return (
    <div>
      <Kicker>Let's make this yours</Kicker>
      <Title>What's feeling <Em>heaviest?</Em></Title>
      <Lead>Pick what's on your plate. We'll set your home up around it.</Lead>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, margin: '24px 0 6px', textAlign: 'left' }}>
        {PAIN_OPTIONS.map((o) => {
          const on = form.pains.includes(o.id);
          return (
            <button
              key={o.id} type="button" onClick={() => toggle(o.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 13, width: '100%', padding: '12px 14px', borderRadius: 14,
                cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                background: on ? 'var(--color-plum-light)' : '#fff',
                border: `1.5px solid ${on ? 'var(--color-plum)' : 'var(--color-cream-border)'}`,
                boxShadow: on ? '0 5px 14px -8px rgba(107,63,160,0.4)' : 'none',
                transition: 'background .15s, border-color .15s, box-shadow .15s',
              }}
            >
              <span style={{ width: 38, height: 38, borderRadius: 11, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, background: on ? '#fff' : 'var(--color-oat)' }}>{o.emoji}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 14.5, fontWeight: 600, color: 'var(--color-charcoal)' }}>{o.title}</span>
                <span style={{ display: 'block', fontSize: 12.5, color: 'var(--color-warm-grey)', marginTop: 2 }}>{o.sub}</span>
              </span>
              <span style={{ width: 24, height: 24, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 800, color: on ? '#fff' : 'transparent', border: `2px solid ${on ? 'var(--color-plum)' : 'var(--color-light-grey)'}`, background: on ? 'var(--color-plum)' : '#fff', transition: 'all .15s' }}>✓</span>
            </button>
          );
        })}
      </div>

      <PrimaryButton onClick={next} style={{ marginTop: 18 }}>Continue</PrimaryButton>
    </div>
  );
}
