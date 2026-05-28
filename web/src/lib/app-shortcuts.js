/**
 * Home-screen quick actions for the Housemait app icon.
 *
 * On iOS, long-press the app icon to reveal a context menu with these
 * shortcuts (legacy 3D Touch / Haptic Touch). Tapping any opens the
 * app directly to the relevant route.
 *
 * Registered once at app boot (main.jsx → native-shell.js). The
 * actions are static - we don't change them per-user state because
 * iOS caches the shortcut list from before the app launched and
 * dynamic updates would feel inconsistent.
 *
 * ── Cold-launch buffering ─────────────────────────────────────────
 * The plugin's `click` event can fire BEFORE any React tree mounts
 * and registers a listener - that's the cold-launch case where the
 * user kills the app, then taps a shortcut from the home screen. To
 * avoid losing that tap we register the listener at boot
 * (startShortcutListener) and buffer the most recent route in a
 * module-level variable. onShortcutTapped() then drains the buffer
 * to its handler as soon as one is registered. Live taps (app
 * already running) bypass the buffer and call the handler directly.
 *
 * On web / Android: no-op.
 */

import { Capacitor } from '@capacitor/core';

function isNative() {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
}

const SHORTCUTS = [
  {
    id: 'add-task',
    title: 'Add Task',
    subtitle: 'Quickly add a to-do',
    iconType: 'Compose', // iOS SF Symbol
    data: { route: '/tasks?quickAdd=1' },
  },
  {
    id: 'add-shopping',
    title: 'Add to Shopping',
    subtitle: 'Drop something on the list',
    iconType: 'Add',
    data: { route: '/shopping?quickAdd=1' },
  },
  {
    id: 'view-calendar',
    title: 'View Calendar',
    iconType: 'Date',
    data: { route: '/calendar' },
  },
  {
    id: 'shopping-list',
    title: 'Open Shopping List',
    iconType: 'Bookmark',
    data: { route: '/shopping' },
  },
];

// ── Module-level state ────────────────────────────────────────────
let pendingRoute = null;          // route buffered between listener fire and handler registration
let liveHandler = null;           // currently-active handler (Layout.jsx provides it)
let listenerStarted = false;      // guard so startShortcutListener is idempotent

/** Set the home-screen shortcuts. Idempotent - calling repeatedly is fine. */
export async function registerShortcuts() {
  if (!isNative()) return;
  try {
    const { AppShortcuts } = await import('@capawesome/capacitor-app-shortcuts');
    await AppShortcuts.set({ shortcuts: SHORTCUTS });
  } catch (err) {
    console.warn('[app-shortcuts] register failed:', err?.message || err);
  }
}

/**
 * Register the native click listener at app boot. Must be called as
 * early as possible (native-shell.js) so cold-launch taps don't get
 * lost between plugin event-emit and React mount.
 *
 * Routes received before a live handler exists are buffered in
 * pendingRoute and drained on the next onShortcutTapped() call.
 */
export async function startShortcutListener() {
  if (!isNative()) return;
  if (listenerStarted) return;
  listenerStarted = true;
  try {
    const { AppShortcuts } = await import('@capawesome/capacitor-app-shortcuts');
    await AppShortcuts.addListener('click', (event) => {
      const route = event?.shortcut?.data?.route;
      if (!route) return;
      if (liveHandler) {
        // App is already running - dispatch immediately.
        liveHandler(route);
      } else {
        // Cold launch - buffer until Layout.jsx registers its handler.
        pendingRoute = route;
      }
    });
  } catch (err) {
    console.warn('[app-shortcuts] listener registration failed:', err?.message || err);
  }
}

/**
 * Register a handler for shortcut taps. Returns an unsubscribe
 * function. If a cold-launch route is buffered, it's drained to the
 * handler on the next tick (giving the caller a moment to finish
 * mounting / set up any state the handler depends on).
 */
export function onShortcutTapped(handler) {
  if (!isNative()) return () => {};
  liveHandler = handler;
  if (pendingRoute) {
    const r = pendingRoute;
    pendingRoute = null;
    // Defer so the caller's useEffect has finished and any router /
    // navigate function it captured is stable.
    setTimeout(() => {
      try { handler(r); } catch (err) { console.warn('[app-shortcuts] pending route dispatch failed:', err?.message || err); }
    }, 0);
  }
  return () => {
    if (liveHandler === handler) liveHandler = null;
  };
}
