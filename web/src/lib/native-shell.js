/**
 * One-time native-shell configuration that runs on app boot.
 *
 * Wires the small Capacitor plugins that affect feel rather than
 * behaviour: status bar, splash screen, keyboard. All four guarded
 * by isNative() so the web bundle is unchanged.
 *
 * Called from main.jsx, fire-and-forget. Failures are non-fatal.
 */

import { Capacitor } from '@capacitor/core';

function isNative() {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
}

export async function setupNativeShell() {
  if (!isNative()) return;

  // Status bar — keep it dark-content on the cream background so the
  // system clock + battery icons stay readable. Style.Light = light
  // text (used by dark themes); Style.Dark = dark text (what we want
  // for #FBF8F3 cream). Setting overlaysWebView=true lets the SPA
  // draw under the bar so safe-area-inset-top still applies.
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setOverlaysWebView({ overlay: true });
  } catch (err) {
    console.warn('[native-shell] status bar setup failed:', err?.message || err);
  }

  // Splash screen — hide as soon as JS is alive. Capacitor by default
  // waits 2-3s before fading; we'd rather the UI appear the moment
  // it's mounted. Auto-hide is configured in capacitor.config too;
  // this is the belt-and-braces explicit call.
  try {
    const { SplashScreen } = await import('@capacitor/splash-screen');
    // Small delay so the React tree has a frame to mount — otherwise
    // we briefly flash white between splash and first render.
    setTimeout(() => SplashScreen.hide().catch(() => {}), 80);
  } catch (err) {
    console.warn('[native-shell] splash hide failed:', err?.message || err);
  }

  // Keyboard — resize the WebView instead of overlaying, so bottom-
  // anchored inputs stay visible when the keyboard appears. Also
  // smooths the animation; default 'native' style is fine, just
  // tuning resize mode.
  try {
    const { Keyboard, KeyboardResize } = await import('@capacitor/keyboard');
    await Keyboard.setResizeMode({ mode: KeyboardResize.Native });
    await Keyboard.setScroll({ isDisabled: false });
  } catch (err) {
    console.warn('[native-shell] keyboard setup failed:', err?.message || err);
  }

  // Home-screen quick actions (long-press the app icon for "Add
  // Task" / "Add to Shopping" / "View Calendar" / "Open Shopping
  // List" shortcuts). Registered once per launch — idempotent.
  try {
    const { registerShortcuts } = await import('./app-shortcuts.js');
    await registerShortcuts();
  } catch (err) {
    console.warn('[native-shell] app shortcuts setup failed:', err?.message || err);
  }
}
