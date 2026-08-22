/**
 * Keeps the iOS onboarding paywall standing after a relaunch.
 *
 * The wall used to live only in the onboarding flow's in-memory state,
 * and the household is created BEFORE it appears - so closing the app on
 * the payment screen and reopening it landed the user on the dashboard,
 * fully signed in, wall never seen again. This gate re-asserts it.
 *
 * Who it walls: households flagged `paywall_required` at creation, i.e.
 * ones that signed up through a build whose own onboarding presented a
 * paywall. Web signups and every app build before 1.13.0 promised a
 * card-free trial and are never walled retrospectively.
 *
 * When it lets go: the moment RevenueCat reports an active entitlement.
 * That's checked on the device rather than waiting for our webhook, so
 * a family isn't held at the wall for the seconds (or minutes, if Apple
 * is slow) between paying and the server hearing about it.
 *
 * Escape hatches, deliberately: the store failing means they get in
 * (PaywallScreen fails open), Restore purchases is on the screen, and
 * signing out is always available - being locked into the WRONG account
 * with no way back would be the one unforgivable version of this.
 */
import { useState } from 'react';
import { useSubscription } from '../context/SubscriptionContext';
import { useAuth } from '../context/AuthContext';
import PaywallScreen from '../pages/onboarding-v4/paywallScreen';

export default function PaywallGate({ children }) {
  const { paywallRequired, isActive, isInternal, loading, refresh } = useSubscription();
  const auth = useAuth();
  // Survives the webhook lag: once the device has confirmed a purchase
  // this session, stop re-rendering the wall while the server catches up.
  const [unlocked, setUnlocked] = useState(false);

  // Never flash a paywall at someone while we still don't know: an
  // unresolved status must read as "let them in", not "make them pay".
  // Same build-time escape as the onboarding wall, so a bypassed dev
  // build isn't stopped on relaunch by the gate instead.
  if (import.meta.env?.VITE_PAYWALL_BYPASS === '1') return children;
  if (loading || unlocked || isInternal) return children;
  if (!paywallRequired || isActive) return children;

  return (
    <PaywallScreen
      householdId={auth.household?.id}
      onDone={() => { setUnlocked(true); refresh(); }}
      onSignOut={auth.logout}
    />
  );
}
