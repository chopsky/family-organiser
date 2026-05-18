/**
 * Home-screen quick actions for the Housemait app icon.
 *
 * On iOS, long-press the app icon to reveal a context menu with these
 * shortcuts (legacy 3D Touch / Haptic Touch). Tapping any opens the
 * app directly to the relevant route.
 *
 * Registered once at app boot (main.jsx → native-shell.js). The
 * actions are static — we don't change them per-user state because
 * iOS caches the shortcut list from before the app launched and
 * dynamic updates would feel inconsistent.
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

/** Set the home-screen shortcuts. Idempotent — calling repeatedly is fine. */
export async function registerShortcuts() {
  if (!isNative()) return;
  try {
    const { AppShortcuts } = await import('@capawesome/capacitor-app-shortcuts');
    await AppShortcuts.set({ shortcuts: SHORTCUTS });
  } catch (err) {
    console.warn('[app-shortcuts] register failed:', err?.message || err);
  }
}

/** Listen for a user tapping one of the shortcuts. Resolves the data
 *  payload (above), which the caller can use to navigate. Returns
 *  an unsubscribe function. */
export async function onShortcutTapped(handler) {
  if (!isNative()) return () => {};
  try {
    const { AppShortcuts } = await import('@capawesome/capacitor-app-shortcuts');
    const listener = await AppShortcuts.addListener('click', (event) => {
      // event.shortcutId + event.shortcut.data are surfaced by the plugin.
      const route = event?.shortcut?.data?.route;
      if (route) handler(route);
    });
    return () => { try { listener.remove?.(); } catch { /* no-op */ } };
  } catch (err) {
    console.warn('[app-shortcuts] listener failed:', err?.message || err);
    return () => {};
  }
}
