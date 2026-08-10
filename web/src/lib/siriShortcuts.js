/**
 * Siri shortcut token sync - iOS native only.
 *
 * The "Hey Siri, add to Housemait" App Intent (ios/App/App/
 * ShoppingIntents.swift) runs outside the WebView, so it can't use the 1h
 * access token in localStorage, and the rotating refresh token is
 * single-use (consuming it from Swift would log the app out). Instead we
 * mint a long-lived scope:'siri' token from the backend - it can ONLY add
 * shopping items, rejected everywhere else - and mirror it into
 * UserDefaults via SiriBridgePlugin for the intent to read.
 *
 * Re-minted weekly (tracked in localStorage) so the 180-day token never
 * gets near expiry on any device that opens the app at all. Cleared on
 * logout so Siri stops working the moment the account does.
 *
 * Every call is guarded + try/caught: web and Android no-op, and an older
 * native shell without the plugin just rejects harmlessly.
 */
import { useEffect } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import api from './api';

const SiriBridge = registerPlugin('SiriBridge');

const MINTED_AT_KEY = 'housemait_siri_token_at';
const REMINT_MS = 7 * 24 * 60 * 60 * 1000;

function isIosNative() {
  try { return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios'; } catch { return false; }
}

export async function syncSiriToken() {
  if (!isIosNative()) return;
  try {
    const mintedAt = Number(localStorage.getItem(MINTED_AT_KEY) || 0);
    if (Date.now() - mintedAt < REMINT_MS) return;
    const { data } = await api.post('/auth/siri-token');
    if (!data?.token) return;
    await SiriBridge.setToken({ token: data.token });
    localStorage.setItem(MINTED_AT_KEY, String(Date.now()));
  } catch {
    // Offline, signed out, or a shell predating the plugin - retry next open.
  }
}

export async function clearSiriToken() {
  if (!isIosNative()) return;
  try { localStorage.removeItem(MINTED_AT_KEY); } catch { /* private browsing */ }
  try { await SiriBridge.clearToken(); } catch { /* shell predating the plugin */ }
}

/** Mount alongside useAdAttribution in Layout: sync once per signed-in user. */
export function useSiriTokenSync(user) {
  useEffect(() => {
    if (user?.id) syncSiriToken();
  }, [user?.id]);
}
