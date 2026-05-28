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

  // Status bar - Capacitor's Style naming is the opposite of intuition:
  //   Style.Light = "light theme" = DARK text/icons (for light backgrounds)
  //   Style.Dark  = "dark theme"  = LIGHT/WHITE text/icons (for dark backgrounds)
  // We want black system text against our cream #FBF8F3 background,
  // so Style.Light. (A previous version of this file used Style.Dark
  // and the clock + battery rendered white-on-cream, unreadable.)
  // overlaysWebView=true lets the SPA draw under the bar so
  // safe-area-inset-top still applies.
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setStyle({ style: Style.Light });
    await StatusBar.setOverlaysWebView({ overlay: true });
  } catch (err) {
    console.warn('[native-shell] status bar setup failed:', err?.message || err);
  }

  // Splash screen - hide as soon as JS is alive. Capacitor by default
  // waits 2-3s before fading; we'd rather the UI appear the moment
  // it's mounted. Auto-hide is configured in capacitor.config too;
  // this is the belt-and-braces explicit call.
  try {
    const { SplashScreen } = await import('@capacitor/splash-screen');
    // Small delay so the React tree has a frame to mount - otherwise
    // we briefly flash white between splash and first render.
    setTimeout(() => SplashScreen.hide().catch(() => {}), 80);
  } catch (err) {
    console.warn('[native-shell] splash hide failed:', err?.message || err);
  }

  // Keyboard - resize the WebView instead of overlaying, so bottom-
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
  // List" shortcuts). Registered once per launch - idempotent.
  //
  // startShortcutListener has to fire HERE at boot, not later from
  // Layout.jsx, because the plugin's click event fires within
  // milliseconds of cold launch - long before React mounts. The
  // listener buffers the route at module scope and drains it once
  // Layout.jsx calls onShortcutTapped(). Without this, the first
  // cold-launch tap is silently lost and the user lands on the
  // dashboard with no idea why "Add Task" did nothing.
  try {
    const { registerShortcuts, startShortcutListener } = await import('./app-shortcuts.js');
    await Promise.all([registerShortcuts(), startShortcutListener()]);
  } catch (err) {
    console.warn('[native-shell] app shortcuts setup failed:', err?.message || err);
  }
}
