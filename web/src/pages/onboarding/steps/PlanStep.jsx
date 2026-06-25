import { Title, Em, Kicker, PrimaryButton } from './_ui';
import { benefitsFor } from '../../../lib/onboardingContent';

// Step 3. Benefit cards generated from the chosen pain points.
export default function PlanStep({ form, next }) {
  const bens = benefitsFor(form.pains);
  return (
    <div>
      <Kicker>Here's the plan</Kicker>
      <Title>Housemait's <Em>got this.</Em></Title>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, margin: '22px 0 4px', textAlign: 'left' }}>
        {bens.map((b) => (
          <div key={b.id} style={{ display: 'flex', gap: 13, alignItems: 'flex-start' }}>
            <span style={{ width: 42, height: 42, borderRadius: 12, flexShrink: 0, background: 'var(--color-plum-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 21 }}>{b.icon}</span>
            <div>
              <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--color-charcoal)' }}>{b.title}</div>
              <div style={{ fontSize: 13, color: 'var(--color-cocoa)', lineHeight: 1.45, marginTop: 3 }}>{b.sub}</div>
            </div>
          </div>
        ))}
      </div>

      <PrimaryButton onClick={next} style={{ marginTop: 22 }}>Set up my home →</PrimaryButton>
    </div>
  );
}
