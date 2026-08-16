import { APP_STORE_URL, PLAY_STORE_URL } from '../../../lib/app-store';
import { Title, Em, Kicker, Lead, PrimaryButton, Ghost } from './_ui';

// "Get the app" nudge. Shown ONLY to someone finishing onboarding in a mobile
// BROWSER (gated by SHOW_GET_APP in OnboardingFlow) - never inside the native
// app or on desktop. Platform-aware: iPhones get the App Store badge, Android
// gets Google Play (listing live 2026-08-05). Pure value-led: it sells what the
// web can't do, deep-links to the right store, and "I'll download it later"
// skips on so it never blocks the finish.

// Google's official badge SVG isn't in /assets, so the Play badge is drawn
// inline to the brand layout (dark pill, coloured glyph, GET IT ON / Google
// Play) at the same 54px height as the App Store badge image beside it in
// the flow. Glyph paths match the landing page's.
function PlayBadge() {
  return (
    <a
      href={PLAY_STORE_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Get Housemait on Google Play"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 12,
        margin: '26px 0 2px', height: 54, padding: '0 20px 0 16px',
        background: '#000', border: '1px solid #a6a6a6', borderRadius: 9,
        textDecoration: 'none',
      }}
    >
      <svg width="26" height="26" viewBox="0 0 512 512" aria-hidden="true">
        <path fill="#EA4335" d="M47 20.4C41.6 26.1 38.5 34.9 38.5 46.3v419.4c0 11.4 3.1 20.2 8.5 25.9l1.4 1.3 234.9-234.9v-5.5L48.4 19.1z" />
        <path fill="#FBBC04" d="M361.2 340.5l-78.3-78.4v-5.5l78.4-78.4 1.8 1 92.8 52.7c26.5 15 26.5 39.7 0 54.8l-92.8 52.7z" />
        <path fill="#34A853" d="M362.9 339.5L282.9 259.4 47 495.6c8.7 9.2 23.2 10.4 39.5 1.2z" />
        <path fill="#4285F4" d="M362.9 179.3L86.5 22.5C70.2 13.3 55.7 14.5 47 23.7l236 235.7z" />
      </svg>
      <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.2 }}>
        <span style={{ color: '#fff', fontSize: 10, fontWeight: 600, letterSpacing: '.09em' }}>GET IT ON</span>
        <span style={{ color: '#fff', fontSize: 19, fontWeight: 600, letterSpacing: '-.01em' }}>Google Play</span>
      </span>
    </a>
  );
}

export default function GetAppStep({ next, platform = 'ios' }) {
  const android = platform === 'android';
  return (
    <div>
      <Kicker>One last thing</Kicker>
      <Title>Get the <Em>full Housemait.</Em></Title>
      <Lead>
        You&apos;re on {android ? 'Android' : 'an iPhone'}. The app gives you everything the
        website can&apos;t: reminders that reach you, add things in a tap, your week at a glance.
      </Lead>

      {android ? (
        <PlayBadge />
      ) : (
        <a href={APP_STORE_URL} target="_blank" rel="noopener noreferrer"
          aria-label="Download Housemait on the App Store"
          style={{ display: 'inline-block', margin: '26px 0 2px' }}>
          <img src="/assets/app-store-badge.svg" alt="Download on the App Store" style={{ height: 54, width: 'auto', display: 'block' }} />
        </a>
      )}

      <PrimaryButton onClick={next} style={{ marginTop: 22 }}>Continue</PrimaryButton>
      <Ghost onClick={next}>I&apos;ll download it later</Ghost>
    </div>
  );
}
