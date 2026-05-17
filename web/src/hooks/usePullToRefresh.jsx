/**
 * usePullToRefresh — native-feel pull-to-refresh for the iOS Capacitor
 * WebView. Activates only when scrolled to the very top, captures the
 * subsequent vertical drag, animates a small spinner into view, and
 * fires the callback when the user releases past the threshold.
 *
 * Web is no-op — leaves the browser's own native PTR behaviour alone.
 *
 * Returns props you spread onto the scroll container's outermost
 * element + a "pull state" object you can use to render whatever
 * indicator you want (we ship a default in the helper component below).
 *
 * Usage in a page:
 *
 *   const ptr = usePullToRefresh(async () => { await loadEverything(); });
 *   return (
 *     <div {...ptr.bindings}>
 *       <PullIndicator state={ptr.state} />
 *       <main>…page content…</main>
 *     </div>
 *   );
 *
 * Implementation notes:
 *   • Only iOS native — browsers already have their own PTR.
 *   • Uses passive: false on touchmove so we can preventDefault during
 *     the drag (stops the WebView's own overscroll bounce).
 *   • Threshold: 80px to trigger. Pull beyond that and the indicator
 *     "snaps" + the callback fires.
 *   • Haptic confirm tick fires once when the threshold is reached.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { confirm as hapticConfirm } from '../lib/haptics';

const TRIGGER_PX = 80;
const MAX_PULL_PX = 140;
// Damping coefficient: the indicator only moves at this fraction of
// finger speed, so it feels like the rubber-band slowing down at the
// top of a native UIScrollView.
const DAMPING = 0.45;

function isNative() {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
}

export function usePullToRefresh(onRefresh) {
  const native = isNative();
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startYRef = useRef(null);
  const armedRef = useRef(false);    // we've crossed the trigger threshold
  const refreshingRef = useRef(false); // mirror of refreshing for handlers

  const onTouchStart = useCallback((e) => {
    if (!native || refreshingRef.current) return;
    // Only arm if scrolled to the very top.
    const scrollEl = e.currentTarget;
    if ((scrollEl.scrollTop || 0) > 0) {
      startYRef.current = null;
      return;
    }
    startYRef.current = e.touches?.[0]?.clientY ?? null;
    armedRef.current = false;
  }, [native]);

  const onTouchMove = useCallback((e) => {
    if (!native || refreshingRef.current) return;
    if (startYRef.current == null) return;
    const y = e.touches?.[0]?.clientY ?? 0;
    const delta = y - startYRef.current;
    if (delta <= 0) {
      // Finger moved up — user is just scrolling, not pulling. Bail.
      setPull(0);
      startYRef.current = null;
      armedRef.current = false;
      return;
    }
    // We're pulling down at the top of the scroll — prevent the
    // WebView's own bounce, render our indicator instead.
    e.preventDefault();
    const damped = Math.min(delta * DAMPING, MAX_PULL_PX);
    setPull(damped);
    if (!armedRef.current && damped >= TRIGGER_PX) {
      armedRef.current = true;
      hapticConfirm(); // tick once when the threshold lands
    }
  }, [native]);

  const onTouchEnd = useCallback(async () => {
    if (!native || refreshingRef.current) return;
    if (armedRef.current) {
      // Snap to the loading position, run the callback, then release.
      refreshingRef.current = true;
      setRefreshing(true);
      setPull(TRIGGER_PX);
      try {
        await onRefresh?.();
      } catch (err) {
        console.warn('[usePullToRefresh] onRefresh failed:', err?.message || err);
      } finally {
        refreshingRef.current = false;
        setRefreshing(false);
        setPull(0);
      }
    } else {
      // Release without triggering — animate back to zero.
      setPull(0);
    }
    startYRef.current = null;
    armedRef.current = false;
  }, [native, onRefresh]);

  // Cleanup if the component unmounts mid-drag.
  useEffect(() => () => {
    refreshingRef.current = false;
    startYRef.current = null;
    armedRef.current = false;
  }, []);

  return {
    bindings: native
      ? { onTouchStart, onTouchMove, onTouchEnd, style: { touchAction: 'pan-y' } }
      : {},
    state: { pull, refreshing, threshold: TRIGGER_PX, armed: pull >= TRIGGER_PX },
  };
}

/** Tiny default indicator. Drop above your page content. */
export function PullIndicator({ state }) {
  if (!state || state.pull <= 0) return null;
  const opacity = Math.min(state.pull / state.threshold, 1);
  const rotate = (state.pull / state.threshold) * 270;
  return (
    <div
      style={{
        height: state.pull,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        paddingBottom: 8,
        pointerEvents: 'none',
        opacity,
        transition: state.refreshing ? 'height 0.2s ease-out' : undefined,
      }}
    >
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{
          color: '#6B3FA0',
          transform: state.refreshing
            ? 'rotate(0deg)'
            : `rotate(${rotate}deg)`,
          transition: state.refreshing ? 'none' : 'transform 0.05s linear',
          animation: state.refreshing ? 'ptr-spin 0.9s linear infinite' : undefined,
        }}
      >
        <path d="M21 12a9 9 0 1 1-3.5-7.1" />
        <polyline points="21 4 21 10 15 10" />
      </svg>
      <style>{`
        @keyframes ptr-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
