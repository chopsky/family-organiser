import { Title, Em, PrimaryButton, FiveStars } from './_ui';

// Step 1. Logo, the headline, a trust row, Get started. The four corner
// notifications + their choreography live at the stage level
// (WelcomeNotifications), driven by the flow container.
export default function WelcomeStep({ onContinue, navigate }) {
  return (
    <div>
      <img src="/housemait-logo-web.svg" alt="Housemait" style={{ height: 28, width: 'auto', margin: '2px auto 24px', display: 'block' }} />
      <Title>Ready to share<Em block>the mental load?</Em></Title>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, margin: '24px 0 22px', fontSize: 13, fontWeight: 600, color: 'var(--color-cocoa)' }}>
        <FiveStars />Made for busy families
      </div>

      <PrimaryButton onClick={onContinue}>Get started</PrimaryButton>

      <div style={{ marginTop: 22, fontSize: 13, color: 'var(--color-cocoa)' }}>
        Already have an account?{' '}
        <button type="button" onClick={() => navigate('/login')} style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--color-plum-dark)', fontWeight: 700, borderBottom: '1.5px solid var(--color-plum-dark)' }}>
          Log in →
        </button>
      </div>
      <div style={{ marginTop: 16, fontSize: 12, color: 'var(--color-warm-grey)', lineHeight: 1.5 }}>
        By creating an account, you agree to our{' '}
        <a href="/terms" style={{ color: 'var(--color-cocoa)', fontWeight: 500 }}>Terms</a> and{' '}
        <a href="/privacy" style={{ color: 'var(--color-cocoa)', fontWeight: 500 }}>Privacy Policy</a>.
      </div>
    </div>
  );
}
