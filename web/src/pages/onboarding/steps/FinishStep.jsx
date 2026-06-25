import { Title, Em, PrimaryButton } from './_ui';

const AVATAR_COLOURS = ['#6B3FA0', '#E8724A', '#7DAE82', '#E0A458', '#5BA3D0', '#B05B9E'];
const initialOf = (s) => (s || '?').trim().charAt(0).toUpperCase() || '?';

// Step 9. Personalised wrap-up: the first name, the household, the people just
// added. The button marks onboarding complete and lands on the dashboard.
export default function FinishStep({ firstName, householdName, invited = [], finishing, onFinish }) {
  // The current user leads the avatar stack, then everyone invited.
  const people = [{ label: firstName }, ...invited];
  return (
    <div>
      <div style={{ width: 68, height: 68, borderRadius: '50%', margin: '4px auto 22px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-sage, #7DAE82)', boxShadow: '0 10px 24px -8px rgba(125,174,130,0.6)' }}>
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5" /></svg>
      </div>

      <Title size={46}>You're ready,<Em block>{firstName}.</Em></Title>

      <p style={{ fontSize: 16, color: 'var(--color-cocoa)', lineHeight: 1.55, margin: '16px auto 0', maxWidth: 400 }}>
        {householdName
          ? <><strong style={{ color: 'var(--color-charcoal)' }}>{householdName}</strong> is set up and ready. Everything you add lives in one calm, shared place.</>
          : <>Your household is set up and ready. Everything you add lives in one calm, shared place.</>}
      </p>

      <div style={{ display: 'flex', justifyContent: 'center', margin: '24px 0 4px' }}>
        {people.slice(0, 6).map((m, i) => (
          <span key={`${m.label}-${i}`} title={m.label}
            style={{ width: 44, height: 44, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 17, fontWeight: 700, background: AVATAR_COLOURS[i % AVATAR_COLOURS.length], border: '2.5px solid var(--color-cream, #FBF8F3)', marginLeft: i === 0 ? 0 : -12 }}>
            {initialOf(m.label)}
          </span>
        ))}
      </div>

      <PrimaryButton onClick={onFinish} disabled={finishing} style={{ marginTop: 24 }}>
        {finishing ? 'Taking you in…' : 'Go to my home →'}
      </PrimaryButton>
    </div>
  );
}
