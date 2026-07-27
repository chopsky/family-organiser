/**
 * Google / Apple sign-in, extracted from the button that used to own it.
 *
 * The flows are genuinely intricate — a web OAuth code popup, a native Capgo
 * plugin on both mobile platforms, Apple's entitlement path, and four distinct
 * shapes of "the user dismissed the sheet". Onboarding v4 needs its own
 * differently-styled buttons, and duplicating any of that would guarantee the
 * two copies drift. So the behaviour lives here and the buttons are just
 * buttons.
 *
 * Returns what a caller needs to render a control and nothing more:
 *   showGoogle / showApple  whether the provider is usable on this platform
 *   googleReady / appleReady  the SDK has initialised (else keep it disabled)
 *   signInWithGoogle / signInWithApple  start the flow
 *
 * onSuccess receives the auth payload; onError a human-readable string. A
 * dismissed sheet is neither — it's a silent no-op, deliberately.
 */
import { useEffect, useState, useCallback, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import api from '../lib/api';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const GOOGLE_IOS_CLIENT_ID = import.meta.env.VITE_GOOGLE_IOS_CLIENT_ID;
// Android's native Google Sign-In (Credential Manager) authenticates the app
// by its package name + SHA-1 (registered as an Android OAuth client) and
// takes the WEB OAuth client ID as its serverClientId - so this value is the
// web client ID, not a separate Android one. Falls back to GOOGLE_CLIENT_ID
// when the app's build exposes that (same value), so a single env var can
// serve both.
const GOOGLE_ANDROID_CLIENT_ID = import.meta.env.VITE_GOOGLE_ANDROID_CLIENT_ID || GOOGLE_CLIENT_ID;
const APPLE_CLIENT_ID = import.meta.env.VITE_APPLE_CLIENT_ID;

const isNativeIos = () => {
  try { return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios'; }
  catch { return false; }
};

const isNativeAndroid = () => {
  try { return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'; }
  catch { return false; }
};

// Both native platforms drive Google Sign-In through the Capgo plugin's
// native SDK (Google blocks its web JS SDK inside a WebView). Shared so the
// init / disabled / branch logic reads the same for iOS and Android.
const isNativeSocial = () => isNativeIos() || isNativeAndroid();

// Detect "user dismissed the native sign-in sheet" across providers and
// error shapes. Treat as a silent no-op rather than an error toast.
//
// Variants seen in the wild:
//   - Apple ASAuthorizationError.canceled = code 1001 - surfaces as
//     "The operation couldn't be completed.
//      (com.apple.AuthenticationServices.AuthorizationError error 1001.)"
//   - Google's iOS SDK: GIDSignInErrorCode.canceled = -5 - message
//     "The user canceled the sign-in flow."
//   - Capgo plugin's normalised codes: 'CANCELED' / 'CANCELLED'
//   - Apple's web JS SDK: { error: 'popup_closed_by_user' }
function isCancelError(err) {
  if (!err) return false;
  const code = String(err.code ?? '').toUpperCase();
  if (code === 'CANCELED' || code === 'CANCELLED' || code === '1001' || code === '-5') return true;
  if (err.error === 'popup_closed_by_user') return true;
  // Apple wraps the underlying NSError as "(...AuthorizationError error 1001.)"
  const msg = String(err.message ?? '').toLowerCase();
  if (msg.includes('authorizationerror') && msg.includes('1001')) return true;
  // Google iOS SDK uses 'the user canceled the sign-in flow.' - narrow
  // match to avoid swallowing real errors that incidentally contain
  // 'cancel' (e.g. 'request was cancelled mid-flight by ...').
  if (/the user canceled/i.test(msg) || /user cancelled/i.test(msg)) return true;
  return false;
}

export default function useSocialAuth({ inviteToken, promoCode, signupSource, onSuccess, onError } = {}) {
  const [googleLoaded, setGoogleLoaded] = useState(false);
  const [nativeSocialLoginInitialised, setNativeSocialLoginInitialised] = useState(false);
  // Holds Google's OAuth code client (web), initialised once the GIS SDK loads.
  const codeClientRef = useRef(null);

  // Web custom-button flow: Google's popup returns a one-time auth `code`,
  // which the backend exchanges for tokens and verifies. Using the OAuth code
  // flow (rather than the ID-token / One Tap flow) is what lets us keep our
  // own fully-styled button instead of Google's locked-down iframe button.
  const handleGoogleCode = useCallback(async (response) => {
    // User closed the popup or denied consent - silent no-op, no error toast.
    if (response?.error) {
      if (response.error === 'access_denied' || response.error === 'popup_closed') return;
      onError('Google sign-in failed. Please try again.');
      return;
    }
    if (!response?.code) {
      onError('Google sign-in failed. Please try again.');
      return;
    }
    try {
      const { data } = await api.post('/auth/google', {
        code: response.code,
        inviteToken: inviteToken || undefined,
        promoCode: promoCode || undefined,
        source: signupSource || undefined,
      });
      onSuccess(data);
    } catch (err) {
      onError(err.response?.data?.error || 'Google sign-in failed.');
    }
  }, [inviteToken, promoCode, signupSource, onSuccess, onError]);

  // On iOS native: initialise the Capgo Social Login plugin once on mount so
  // the Google SDK is ready by the time the user taps the button. The plugin
  // wraps Apple's ASWebAuthenticationSession + Google's native iOS SDK, both
  // of which are reliable inside a Capacitor WebView (unlike Google's web JS
  // SDK, which is blocked by Google in WebViews).
  //
  // On web: defer to the existing JS SDK flow.
  useEffect(() => {
    if (isNativeIos()) {
      if (!GOOGLE_IOS_CLIENT_ID) return;
      let cancelled = false;
      (async () => {
        try {
          const { SocialLogin } = await import('@capgo/capacitor-social-login');
          // Apple side: on iOS native, the SDK authenticates via the
          // com.apple.developer.applesignin entitlement + bundle ID - no
          // clientId/redirectUrl are needed (those are web-only Services ID
          // concerns). Initialising with `apple: {}` is the documented way
          // to enable the provider without configuring web fallbacks.
          await SocialLogin.initialize({
            google: { iOSClientId: GOOGLE_IOS_CLIENT_ID },
            apple: {},
          });
          if (!cancelled) setNativeSocialLoginInitialised(true);
        } catch (err) {
          console.error('[social-login] iOS plugin initialise failed:', err);
        }
      })();
      return () => { cancelled = true; };
    }

    if (isNativeAndroid()) {
      if (!GOOGLE_ANDROID_CLIENT_ID) return;
      let cancelled = false;
      (async () => {
        try {
          const { SocialLogin } = await import('@capgo/capacitor-social-login');
          // Android: Credential Manager takes the WEB client ID as its
          // serverClientId; the app is authorised by its package + SHA-1
          // registered as an Android OAuth client. No Apple provider on
          // Android.
          await SocialLogin.initialize({
            google: { webClientId: GOOGLE_ANDROID_CLIENT_ID },
          });
          if (!cancelled) setNativeSocialLoginInitialised(true);
        } catch (err) {
          console.error('[social-login] Android plugin initialise failed:', err);
        }
      })();
      return () => { cancelled = true; };
    }

    if (!GOOGLE_CLIENT_ID) return;
    if (window.google?.accounts?.id) { setGoogleLoaded(true); return; }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => setGoogleLoaded(true);
    script.onerror = () => console.error('Failed to load Google Sign-In SDK');
    document.head.appendChild(script);
  }, []);

  // Web: initialise Google's OAuth code client once the GIS SDK has loaded.
  //
  // We deliberately avoid google.accounts.id (One Tap / the rendered iframe
  // button): One Tap silently fails to display since browsers dropped
  // third-party cookies, and the rendered button can't be custom-styled. The
  // OAuth code client lets our own styled button open Google's sign-in popup
  // on click via requestCode(), returning a one-time auth code to
  // handleGoogleCode for the backend to exchange.
  useEffect(() => {
    if (isNativeSocial()) return; // native platforms use the Capgo plugin, not the web SDK
    if (!googleLoaded || !GOOGLE_CLIENT_ID || !window.google?.accounts?.oauth2) return;
    codeClientRef.current = window.google.accounts.oauth2.initCodeClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: 'openid email profile',
      ux_mode: 'popup',
      callback: handleGoogleCode,
    });
  }, [googleLoaded, handleGoogleCode]);

  // Click handler - branches on platform:
  //   • iOS native: invoke the Capgo plugin which uses Google's iOS SDK
  //     and ASWebAuthenticationSession to authenticate. Returns an idToken
  //     in the same JWT format the server already verifies.
  //   • Web: trigger Google's One Tap popup via the JS SDK.
  async function handleGoogleClick() {
    // iOS AND Android native both go through the Capgo plugin's native Google
    // SDK, which returns an idToken (the same JWT the server verifies for the
    // web code-exchange path). Google blocks its web JS SDK in a WebView, so
    // this native path is the only one that works in the apps.
    if (isNativeSocial()) {
      if (!nativeSocialLoginInitialised) {
        onError('Google sign-in is initialising. Please try again in a moment.');
        return;
      }
      try {
        const { SocialLogin } = await import('@capgo/capacitor-social-login');
        // Force the account chooser. The native SDKs cache the last-used
        // account and silently sign you back in - fine for password-manager-
        // like flows, wrong for an explicit 'Continue with Google' button
        // where the user expects to pick which account. logout() clears the
        // cached credential without affecting the user's logged-in state.
        try { await SocialLogin.logout({ provider: 'google' }); }
        catch { /* nothing cached - first sign-in, ignore */ }
        const result = await SocialLogin.login({ provider: 'google', options: {} });
        // Plugin returns { provider, result: { idToken, ...profile } }.
        // Defensive: also try a couple of other shapes Capgo has used across
        // versions, in case the documented one doesn't match what we get.
        const idToken =
          result?.result?.idToken ||
          result?.idToken ||
          result?.result?.authentication?.idToken ||
          null;
        if (!idToken) {
          onError('Google sign-in did not return a token. Please try again.');
          return;
        }
        const { data } = await api.post('/auth/google', {
          idToken,
          inviteToken: inviteToken || undefined,
          promoCode: promoCode || undefined,
          source: signupSource || undefined,
        });
        onSuccess(data);
      } catch (err) {
        if (isCancelError(err)) return;
        console.error('[social-login] native Google sign-in error:', err);
        onError(err?.response?.data?.error || err?.message || 'Google sign-in failed.');
      }
      return;
    }
    // Web: open Google's sign-in popup via the OAuth code client.
    if (!codeClientRef.current) {
      onError('Google Sign-In is loading. Please try again in a moment.');
      return;
    }
    codeClientRef.current.requestCode();
  }

  async function handleApple() {
    // iOS native: use ASAuthorizationController via the Capgo plugin.
    // The com.apple.developer.applesignin entitlement on this app's bundle
    // ID handles the credential issuance - no Services ID, no redirect URL.
    // Plugin returns { provider, result: { identityToken, user, email,
    // givenName, familyName } } on iOS.
    if (isNativeIos()) {
      if (!nativeSocialLoginInitialised) {
        onError('Apple sign-in is initialising. Please try again in a moment.');
        return;
      }
      try {
        const { SocialLogin } = await import('@capgo/capacitor-social-login');
        const result = await SocialLogin.login({
          provider: 'apple',
          options: { scopes: ['email', 'fullName'] },
        });
        // Capgo v8 returns { provider, result: { idToken, profile: { givenName,
        // familyName, email } } }. Older versions used `identityToken` with the
        // name fields at the top level - accept both so a plugin bump can't
        // silently break sign-in again.
        const idToken =
          result?.result?.idToken ||
          result?.result?.identityToken ||
          result?.idToken ||
          null;
        if (!idToken) {
          onError('Apple sign-in did not return a token. Please try again.');
          return;
        }
        // Apple gives the user's full name ONLY on the first sign-in (and
        // never again, even after revocation). Capture it now so we can
        // pre-fill the user record server-side.
        const profile = result?.result?.profile || result?.result || {};
        const givenName = profile.givenName;
        const familyName = profile.familyName;
        const name = [givenName, familyName].filter(Boolean).join(' ').trim() || undefined;
        const { data } = await api.post('/auth/apple', {
          idToken,
          name,
          inviteToken: inviteToken || undefined,
          promoCode: promoCode || undefined,
          source: signupSource || undefined,
        });
        onSuccess(data);
      } catch (err) {
        if (isCancelError(err)) return;
        console.error('[social-login] iOS Apple sign-in error:', err);
        onError(err?.response?.data?.error || err?.message || 'Apple sign-in failed.');
      }
      return;
    }

    // Web flow - Apple's JS SDK with Services ID.
    if (!APPLE_CLIENT_ID) return;
    try {
      if (!window.AppleID) {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js';
          script.onload = resolve;
          script.onerror = reject;
          document.head.appendChild(script);
        });
      }

      window.AppleID.auth.init({
        clientId: APPLE_CLIENT_ID,
        scope: 'name email',
        redirectURI: window.location.origin + '/login',
        usePopup: true,
      });

      const result = await window.AppleID.auth.signIn();
      const { data } = await api.post('/auth/apple', {
        idToken: result.authorization.id_token,
        name: result.user ? `${result.user.name.firstName} ${result.user.name.lastName}`.trim() : undefined,
        inviteToken: inviteToken || undefined,
        promoCode: promoCode || undefined,
        source: signupSource || undefined,
      });
      onSuccess(data);
    } catch (err) {
      if (isCancelError(err)) return;
      onError(err.response?.data?.error || 'Apple sign-in failed.');
    }
  }

  // Google shows on web (web client ID present), iOS native (uses its own
  // iOS client ID via the plugin), or Android native (needs the server/web
  // client ID for Credential Manager - GOOGLE_ANDROID_CLIENT_ID).
  const showGoogle = !!GOOGLE_CLIENT_ID || isNativeIos() || (isNativeAndroid() && !!GOOGLE_ANDROID_CLIENT_ID);
  // Apple Sign-In on web requires a Services ID + verified domain + signing
  // key + 4-5 env vars working in concert. iOS native uses
  // ASAuthorizationController via the entitlement and needs none of that.
  // Until the web setup is fully done, only render the button on iOS where
  // it actually works - showing a broken button on web is worse than
  // showing nothing.
  const showApple = isNativeIos();

  // NOTE: the "neither provider is available" early return belongs to the
  // CALLER, not here. A hook must always return the same shape; returning
  // null made every destructure throw the moment no provider was usable.

  return {
    showGoogle,
    showApple,
    googleReady: isNativeSocial() ? nativeSocialLoginInitialised : googleLoaded,
    appleReady: isNativeIos() ? nativeSocialLoginInitialised : true,
    signInWithGoogle: handleGoogleClick,
    signInWithApple: handleApple,
  };
}
