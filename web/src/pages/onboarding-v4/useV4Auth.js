/**
 * Onboarding v4 — turning "signed in" into a finished household.
 *
 * Sign-up sits at step 11 by design, so by the time we get here the user has
 * already told us their name, their household name and (maybe) connected a
 * calendar and said yes to WhatsApp. None of that could be persisted without an
 * account. This is where it lands.
 *
 * The sequence after any successful provider:
 *   1. store the session (same auth.login the existing flow uses)
 *   2. name the household, if the account doesn't have one yet
 *   3. replay the queued calendar feeds, and start WhatsApp pairing
 *   4. mark onboarded, so the auth gate stops sending them back here
 *
 * Every step after (1) is best-effort. Once the session exists the user HAS an
 * account, and failing to name a household or attach a calendar must not strand
 * them on a sign-up screen with no way forward — it gets reported on the way
 * out instead.
 */
import { useCallback, useState } from 'react';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { detectCountryFromTimezone, detectCountryFromLocaleCookie } from '../../lib/country';
import { readLocaleCookie } from '../../hooks/useLocale';
import { getStorefrontCountry } from '../../lib/revenuecat';
import { clearSignupPromo } from '../../lib/signupPromo';
import { clearSignupSource } from '../../lib/signupSource';
import { isNative } from '../../lib/platform';
import { replayQueued } from './replay';

// Tells the server this sign-up is happening inside the app, so the
// verification email leads with the CODE rather than the link. In the app the
// two are not equivalent: the link navigates away from the screen holding the
// pasted calendar address, which lives in memory only.
const CLIENT = isNative() ? 'app' : undefined;

export default function useV4Auth(d) {
  const auth = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // What actually happened, for the welcome screen to speak to honestly.
  const [outcome, setOutcome] = useState(null);

  /**
   * Everything after the session exists: name the household, replay what was
   * queued, mark onboarded. Split out from completeSignup because the
   * verification LINK arrives here already logged in - Verify.jsx exchanged
   * the token and called auth.login itself - so there is no payload to log in
   * with, only an existing session.
   */
  const finishHousehold = useCallback(async (existingHousehold) => {
    clearSignupPromo();
    clearSignupSource();

    // The household name was collected at step 07 and has been sitting in the
    // draft ever since. A brand-new account has no household yet; one created
    // through an invite already does, and must not be given a second.
    //
    // Same endpoint and same country cascade as the existing household step -
    // storefront > locale cookie > timezone - because country drives pricing
    // and holidays, and a v4 signup must not land somewhere different from a
    // v3 one.
    const wanted = (d.house || '').trim();
    if (!existingHousehold && wanted) {
      try {
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/London';
        const country = (await getStorefrontCountry())
          || detectCountryFromLocaleCookie(readLocaleCookie())
          || detectCountryFromTimezone(timezone);
        const res = await api.post('/auth/create-household', { name: wanted, timezone, country });
        // create-household returns a fresh session carrying the household.
        if (res.data?.token) auth.login(res.data);
      } catch (err) {
        console.warn('[v4] create-household failed:', err?.response?.data?.error || err.message);
      }
    }

    const replay = await replayQueued(d).catch(() => ({ calendars: { connected: [], failed: [] }, whatsapp: null }));

    try {
      const res = await api.post('/auth/mark-onboarded');
      if (res.data?.user) auth.updateUser(res.data.user);
    } catch (err) {
      // Never trap someone who has an account. Worst case the gate sends them
      // back through onboarding once, which is annoying, not broken.
      console.warn('[v4] mark-onboarded failed:', err?.response?.data?.error || err.message);
    }

    setOutcome(replay);
    return true;
  }, [auth, d]);

  /**
   * Runs once a provider hands back a session. Returns true when the flow
   * should advance to the welcome screen.
   */
  const completeSignup = useCallback(async (data) => {
    if (!data?.token) return false;
    auth.login(data);
    return finishHousehold(data.household);
  }, [auth, finishHousehold]);

  /**
   * The verification LINK path. Verify.jsx has already redeemed the token and
   * logged the user in, then bounced them to /signup — so v4 remounts with a
   * live session and a restored draft, but nothing has been replayed. Without
   * this the flow would restart at the splash screen and everything the user
   * set up before signing up would be quietly dropped.
   *
   * Note what this CANNOT rescue: a pasted calendar address lives in memory
   * only, so it survives an in-app navigation but not a cold launch or a link
   * opened on another device. That gap is exactly why the code exists.
   */
  const resumeVerifiedSession = useCallback(async () => {
    if (!auth.token) return false;
    setBusy(true);
    try {
      return await finishHousehold(auth.household);
    } finally {
      setBusy(false);
    }
  }, [auth.token, auth.household, finishHousehold]);

  /** Email + password. Returns 'done' | 'verify' | null (error shown inline). */
  const registerWithEmail = useCallback(async ({ email, password }) => {
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post('/auth/register', {
        email: email.trim(),
        password,
        // Collected at step 05 — v4 never asks for a name twice.
        name: (d.you || '').trim() || email.trim().split('@')[0],
        client: CLIENT,
      });
      // Without an invite the backend issues no token: the account has to be
      // verified by email first. That's why email can't land on the welcome
      // screen directly the way a provider can.
      if (!data?.token) return 'verify';
      return (await completeSignup(data)) ? 'done' : 'verify';
    } catch (err) {
      setError(err?.response?.data?.error || 'Something went wrong. Please try again.');
      return null;
    } finally {
      setBusy(false);
    }
  }, [d, completeSignup]);

  /**
   * Redeem the emailed code. This is the whole reason the code exists: it
   * returns a session WITHOUT a page navigation, so the in-memory calendar
   * address survives and completeSignup can attach it. Following the link
   * instead reloads the page and silently loses it.
   */
  const verifyCode = useCallback(async ({ email: addr, code }) => {
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post('/auth/verify-email-code', { email: addr, code });
      return await completeSignup(data);
    } catch (err) {
      setError(err?.response?.data?.error || 'That code didn’t work. Try again.');
      return false;
    } finally {
      setBusy(false);
    }
  }, [completeSignup]);

  /** Another code, for when the first didn't arrive. Never reports failure —
   *  the endpoint is deliberately vague to avoid confirming who has an account. */
  const resend = useCallback(async (addr) => {
    try { await api.post('/auth/resend-verification', { email: addr, client: CLIENT }); } catch { /* silent by design */ }
  }, []);

  /** Existing account, from the login screen. */
  const logIn = useCallback(async ({ email, password }) => {
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post('/auth/login', { email: email.trim(), password });
      clearSignupPromo();
      clearSignupSource();
      auth.login(data);
      return true;
    } catch (err) {
      setError(err?.response?.data?.error || 'That email and password didn’t match.');
      return false;
    } finally {
      setBusy(false);
    }
  }, [auth]);

  return {
    busy, error, setError, outcome,
    completeSignup, resumeVerifiedSession, registerWithEmail, verifyCode, resend, logIn,
  };
}
