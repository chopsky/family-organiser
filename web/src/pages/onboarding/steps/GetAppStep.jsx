import { APP_STORE_URL } from '../../../lib/app-store';
import { Title, Em, Kicker, Lead, PrimaryButton, Ghost } from './_ui';

// "Get the app" nudge. Shown ONLY to someone finishing onboarding in a mobile
// BROWSER on an iPhone (gated by SHOW_GET_APP in OnboardingFlow) - never inside
// the native app, on Android/desktop, or before a live App Store listing
// exists. Pure value-led: it sells what the web can't do, deep-links to the App
// Store, and "I'll download it later" skips on so it never blocks the finish.
export default function GetAppStep({ next }) {
  return (
    <div>
      <Kicker>One last thing</Kicker>
      <Title>Get the <Em>full Housemait.</Em></Title>
      <Lead>You&apos;re on an iPhone. The app gives you everything the website can&apos;t: reminders that reach you, add things in a tap, your week at a glance.</Lead>

      <a href={APP_STORE_URL} target="_blank" rel="noopener noreferrer"
        aria-label="Download Housemait on the App Store"
        style={{ display: 'inline-block', margin: '26px 0 2px' }}>
        <img src="/assets/app-store-badge.svg" alt="Download on the App Store" style={{ height: 54, width: 'auto', display: 'block' }} />
      </a>

      <PrimaryButton onClick={next} style={{ marginTop: 22 }}>Continue</PrimaryButton>
      <Ghost onClick={next}>I&apos;ll download it later</Ghost>
    </div>
  );
}
