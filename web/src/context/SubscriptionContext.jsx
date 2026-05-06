/**
 * Subscription / trial state — Phase 4.
 *
 * Fetches GET /api/subscription/status on mount and exposes the shape
 * the rest of the app needs to render trial indicators, the (coming
 * in Phase 5) subscribe modal, and the (Phase 6) read-only expired
 * overlay.
 *
 * Depends on AuthContext — we only fetch when there's a token AND a
 * household. On logout or when the user hasn't finished onboarding,
 * we hold state as loading:false, status:null so UI components can
 * short-circuit without waiting on a request that'll never fire.
 *
 * Refetches when the tab becomes visible again — covers the common
 * "user redirects to Stripe, pays, comes back" flow without needing
 * the frontend to know anything about Stripe lifecycle.
 */

import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import api from '../lib/api';
import { useAuth } from './AuthContext';
import { isIos } from '../lib/platform';

const SubscriptionContext = createContext(null);

export function SubscriptionProvider({ children }) {
  const { token, household } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [status, setStatus] = useState(null);              // 'trialing' | 'active' | 'expired' | 'cancelled' | null
  const [daysRemaining, setDaysRemaining] = useState(null); // number | null
  const [trialEndsAt, setTrialEndsAt] = useState(null);     // ISO string | null
  const [plan, setPlan] = useState(null);                   // 'monthly' | 'annual' | null
  const [provider, setProvider] = useState(null);           // 'stripe' | 'apple' | null
  const [isInternal, setIsInternal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Last fetched household id — lets us clear state cleanly on logout
  // / household switch so stale values from the previous session don't
  // leak into a new one.
  const loadedHouseholdRef = useRef(null);

  const fetchStatus = useCallback(async () => {
    if (!token || !household?.id) {
      // Nothing to fetch — reset to "unknown but not loading".
      setStatus(null);
      setDaysRemaining(null);
      setTrialEndsAt(null);
      setPlan(null);
      setProvider(null);
      setIsInternal(false);
      setLoading(false);
      setError(null);
      loadedHouseholdRef.current = null;
      return;
    }

    // On iOS we deliberately don't surface ANY subscription state to the
    // UI — see App Store guideline 3.1.1. Treating iOS as always-internal
    // (which the rest of the app already maps to "full access, no
    // billing surface") collapses every "trial / active / expired"
    // branch to a single non-rendered no-op. Skip the fetch entirely so
    // the iOS app makes one fewer round-trip on launch.
    if (isIos()) {
      setStatus(null);
      setDaysRemaining(null);
      setTrialEndsAt(null);
      setPlan(null);
      setProvider(null);
      setIsInternal(true);
      setLoading(false);
      setError(null);
      loadedHouseholdRef.current = household.id;
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get('/subscription/status');
      setStatus(data.status || null);
      setDaysRemaining(data.days_remaining ?? null);
      setTrialEndsAt(data.trial_ends_at || null);
      setPlan(data.subscription_plan || null);
      setProvider(data.subscription_provider || null);
      setIsInternal(data.is_internal === true);
      loadedHouseholdRef.current = household.id;
    } catch (err) {
      // Don't blow up the app if this fails — the trial indicators
      // will simply not render. 401s are handled by the axios
      // interceptor (refresh or logout).
      console.error('[SubscriptionContext] status fetch failed:', err);
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [token, household?.id]);

  // Initial fetch + refetch whenever token or household changes
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Listen for 402s surfaced by the axios interceptor (see web/src/lib/api.js).
  // When a mutation is rejected because the household's entitlement has
  // expired, we bounce them to the subscribe page and refresh the context
  // so the UI reflects their current billing state. Skip if we're already
  // on /subscribe or any /subscription/* page — otherwise a 402 from the
  // subscribe page's own checkout call would cause a redirect loop back
  // to itself.
  useEffect(() => {
    function onSubscriptionRequired() {
      // Never bounce iOS users to /subscribe — there is no in-app
      // payment path (Apple guideline 3.1.1) and we mustn't link to
      // external billing. The 402 will surface as a generic error
      // toast wherever the mutation was attempted; that's fine.
      if (isIos()) return;
      if (location.pathname === '/subscribe' || location.pathname.startsWith('/subscription/')) return;
      // Refresh silently so the subscribe page has fresh data when it loads.
      fetchStatus();
      navigate('/subscribe', { replace: false });
    }
    window.addEventListener('subscription:required', onSubscriptionRequired);
    return () => window.removeEventListener('subscription:required', onSubscriptionRequired);
  }, [fetchStatus, navigate, location.pathname]);

  // Refetch on tab visibility. Covers:
  //   • User goes to Stripe, pays, returns → need fresh status
  //   • User leaves the app open for hours → trial may have crossed a day boundary
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible' && loadedHouseholdRef.current) {
        fetchStatus();
      }
    }
    document.addEventListener('visibilitychange', onVisible);
    // Also fire on `focus` for edge cases (some desktop browsers fire focus
    // without visibilitychange when switching between windows).
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [fetchStatus]);

  // Derived flags — computed once per render so consumers can reference
  // them without reimplementing the logic everywhere.
  //
  // Internal accounts are treated as always-active: the backend already
  // bypasses the subscription gate for them, and the UI shouldn't show
  // trial banners / subscribe prompts to testers.
  const effectiveStatus = isInternal ? 'active' : status;
  const isActive   = effectiveStatus === 'active';
  const isTrialing = effectiveStatus === 'trialing';
  const isExpired  = effectiveStatus === 'expired' || effectiveStatus === 'cancelled';

  return (
    <SubscriptionContext.Provider value={{
      status: effectiveStatus,
      rawStatus: status, // unfiltered — useful for admin views
      daysRemaining: isInternal ? null : daysRemaining,
      trialEndsAt,
      plan,
      provider, // 'stripe' | 'apple' | null — drives Manage-button routing
      isInternal,
      isActive,
      isTrialing,
      isExpired,
      loading,
      error,
      refresh: fetchStatus,
    }}>
      {children}
    </SubscriptionContext.Provider>
  );
}

export function useSubscription() {
  const ctx = useContext(SubscriptionContext);
  if (!ctx) {
    // Defensive: if a component accidentally renders outside the
    // provider (e.g. storybook, a test), return a neutral "unknown"
    // shape so the UI just hides trial indicators rather than crashing.
    return {
      status: null, rawStatus: null, daysRemaining: null, trialEndsAt: null,
      plan: null, provider: null, isInternal: false, isActive: false, isTrialing: false,
      isExpired: false, loading: false, error: null, refresh: () => {},
    };
  }
  return ctx;
}

/**
 * Returns true when the current household can perform mutating actions.
 * Single source of truth for the read-only UI gating across the app —
 * pages call this instead of re-implementing the "active || trialing ||
 * internal" check.
 *
 * Default-permissive during loading: the first render before the status
 * fetch resolves should NOT flash the read-only state to every user. If
 * the backend still 402s a mutation attempted in that window, the axios
 * interceptor catches it and redirects to /subscribe.
 */
export function useCanWrite() {
  const { isActive, isTrialing, loading, status } = useSubscription();
  // Allow writes while status is still loading to avoid the read-only
  // flash on first paint. Internal accounts surface as isActive already
  // (SubscriptionContext maps them onto active).
  if (loading && status == null) return true;
  return isActive || isTrialing;
}
