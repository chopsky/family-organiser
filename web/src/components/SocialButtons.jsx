import { useEffect, useRef, useState, useCallback } from 'react';
import api from '../lib/api';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const APPLE_CLIENT_ID = import.meta.env.VITE_APPLE_CLIENT_ID;

export default function SocialButtons({ inviteToken, onSuccess, onError }) {
  const googleRef = useRef(null);
  const [googleLoaded, setGoogleLoaded] = useState(false);
  const [googleButtonRendered, setGoogleButtonRendered] = useState(false);

  const handleGoogleResponse = useCallback(async (response) => {
    try {
      const { data } = await api.post('/auth/google', {
        idToken: response.credential,
        inviteToken: inviteToken || undefined,
      });
      onSuccess(data);
    } catch (err) {
      onError(err.response?.data?.error || 'Google sign-in failed.');
    }
  }, [inviteToken, onSuccess, onError]);

  // Load Google Sign-In SDK
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    if (window.google?.accounts?.id) { setGoogleLoaded(true); return; }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => setGoogleLoaded(true);
    script.onerror = () => console.error('Failed to load Google Sign-In SDK');
    document.head.appendChild(script);
  }, []);

  // Initialize Google button when SDK is ready
  useEffect(() => {
    if (!googleLoaded || !GOOGLE_CLIENT_ID || !googleRef.current) return;

    try {
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleGoogleResponse,
      });

      window.google.accounts.id.renderButton(googleRef.current, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        width: Math.max(googleRef.current.offsetWidth, 300),
        text: 'continue_with',
      });

      // Check if the Google iframe actually rendered after a moment
      setTimeout(() => {
        const iframe = googleRef.current?.querySelector('iframe');
        if (iframe) {
          setGoogleButtonRendered(true);
        }
      }, 1500);
    } catch (err) {
      console.error('Google Sign-In init error:', err);
    }
  }, [googleLoaded, handleGoogleResponse]);

  // Fallback: trigger Google One Tap prompt
  function handleGoogleFallback() {
    if (!window.google?.accounts?.id) {
      onError('Google Sign-In is not available. Please try again.');
      return;
    }
    // Re-initialize to ensure the callback is fresh
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleGoogleResponse,
    });
    window.google.accounts.id.prompt();
  }

  async function handleApple() {
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
      });
      onSuccess(data);
    } catch (err) {
      if (err.error === 'popup_closed_by_user') return;
      onError(err.response?.data?.error || 'Apple sign-in failed.');
    }
  }

  const showGoogle = !!GOOGLE_CLIENT_ID;
  const showApple = !!APPLE_CLIENT_ID;

  if (!showGoogle && !showApple) return null;

  return (
    <div className="space-y-3">
      {showGoogle && (
        <>
          {/* Google's rendered button (iframe-based) */}
          <div ref={googleRef} className="flex justify-center" />

          {/* Fallback custom button — shown if Google's iframe didn't load */}
          {googleLoaded && !googleButtonRendered && (
            <button
              type="button"
              onClick={handleGoogleFallback}
              className="w-full flex items-center justify-center gap-2 border border-cream-border rounded-lg px-4 py-2.5 text-sm font-medium text-bark hover:bg-oat transition-colors"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Continue with Google
            </button>
          )}
        </>
      )}
      {showApple && (
        <button
          type="button"
          onClick={handleApple}
          className="w-full flex items-center justify-center gap-2 border border-cream-border rounded-lg px-4 py-2.5 text-sm font-medium text-bark hover:bg-oat transition-colors"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
          </svg>
          Continue with Apple
        </button>
      )}
    </div>
  );
}
