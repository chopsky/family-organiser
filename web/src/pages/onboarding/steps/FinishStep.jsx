import { Title, Em, Kicker, PrimaryButton } from './_ui';

const AVATAR_COLOURS = ['#6C3DD9', '#D8788A', '#5B8DE0', '#D89B3A', '#6BA368', '#B05B9E'];
const initialOf = (s) => (s || '?').trim().charAt(0).toUpperCase() || '?';

// Step 9. Personalised wrap-up: the first name, the household, the people just
// added. The button marks onboarding complete and lands on the dashboard.
export default function FinishStep({ firstName, householdName, invited = [], finishing, onFinish }) {
  // The current user leads the avatar stack, then everyone invited.
  const people = [{ label: firstName }, ...invited];
  return (
    <div>
      <div style={{ width: 60, height: 60, borderRadius: 18, margin: '4px auto 0', position: 'relative', background: 'var(--color-plum-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28 }}>
        🏡<span style={{ position: 'absolute', top: -9, right: -12, fontSize: 26 }}>🎉</span>
      </div>

      <div style={{ marginTop: 22 }}><Kicker>All set</Kicker></div>
      <Title>You're ready, <Em>{firstName}.</Em></Title>

      <p style={{ fontSize: 15, color: 'var(--color-cocoa)', lineHeight: 1.55, margin: '14px auto 0', maxWidth: 380 }}>
        {householdName
          ? <><strong style={{ color: 'var(--color-charcoal)' }}>{householdName}</strong> is live. Add your first task, list item or event, and everyone you invited sees it the moment they sign in.</>
          : <>Your household is live. Add your first task, list item or event, and everyone you invited sees it the moment they sign in.</>}
      </p>

      <div style={{ display: 'flex', justifyContent: 'center', margin: '22px 0 4px' }}>
        {people.slice(0, 6).map((m, i) => (
          <span key={`${m.label}-${i}`} title={m.label}
            style={{ width: 46, height: 46, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 18, fontWeight: 700, background: AVATAR_COLOURS[i % AVATAR_COLOURS.length], border: '3px solid #fff', marginLeft: i === 0 ? 0 : -12 }}>
            {initialOf(m.label)}
          </span>
        ))}
      </div>

      <PrimaryButton onClick={onFinish} disabled={finishing} style={{ marginTop: 26 }}>
        {finishing ? 'Taking you in…' : 'Go to dashboard →'}
      </PrimaryButton>
    </div>
  );
}
