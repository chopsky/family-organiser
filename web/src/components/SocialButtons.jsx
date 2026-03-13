import { useEffect, useRef, useState } from 'react';
import api from '../lib/api';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const APPLE_CLIENT_ID = import.meta.env.VITE_APPLE_CLIENT_ID;

export default function SocialButtons({ inviteToken, onSuccess, onError }) {
  const googleRef = useRef(null);
  const [googleLoaded, setGoogleLoaded] = useState(false);

  // Load Google Sign-In SDK
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    if (window.google?.accounts?.id) { setGoogleLoaded(true); return; }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => setGoogleLoaded(true);
    document.head.appendChild(script);
  }, []);

  // Initialize Google button when SDK is ready
  useEffect(() => {
    if (!googleLoaded || !GOOGLE_CLIENT_ID || !googleRef.current) return;

    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleGoogleResponse,
    });
    window.google.accounts.id.renderButton(googleRef.current, {
      type: 'standard',
      theme: 'outline',
      size: 'large',
      width: googleRef.current.offsetWidth,
      text: 'continue_with',
    });
  }, [googleLoaded]);

  async function handleGoogleResponse(response) {
    try {
      const { data } = await api.post('/auth/google', {
        idToken: response.credential,
        inviteToken: inviteToken || undefined,
      });
      onSuccess(data);
    } catch (err) {
      onError(err.response?.data?.error || 'Google sign-in failed.');
    }
  }

  async function handleApple() {
    if (!APPLE_CLIENT_ID) return;
    try {
      // Load Apple JS SDK if not loaded
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
        <div ref={googleRef} className="flex justify-center" />
      )}
      {showApple && (
        <button
          type="button"
          onClick={handleApple}
          className="w-full flex items-center justify-center gap-2 border border-gray-300 rounded-lg px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
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
