/**
 * useDragToDismiss - native-feel drag-down-to-dismiss for bottom-
 * anchored sheets. Mimics the iOS Mail compose / Music playlist /
 * Maps search behaviour: pull the sheet downwards, release past
 * the threshold and it slides off-screen + fires onDismiss.
 *
 * Web is no-op - desktop modals don't need this affordance.
 *
 * Usage in a modal component:
 *
 *   const drag = useDragToDismiss({ onDismiss: () => setOpen(false) });
 *   return (
 *     <div className="fixed inset-0 ... items-end">
 *       <div {...drag.sheetBindings} style={drag.sheetStyle}>
 *         <div {...drag.handleBindings} className="...top of sheet...">
 *           <div className="w-10 h-1 rounded-full bg-light-grey mx-auto" />
 *         </div>
 *         ...sheet content...
 *       </div>
 *     </div>
 *   );
 *
 * The `handleBindings` should go on the area that's draggable
 * (typically the top 40-60px of the sheet - header / drag handle).
 * The `sheetBindings` + `sheetStyle` go on the actual sheet element
 * (the rounded-top container).
 *
 * Threshold: 120px or 35% of sheet height - whichever is smaller -
 * triggers dismissal. Below threshold, the sheet snaps back.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';

const TRIGGER_PX = 120;
const TRIGGER_PCT = 0.35;

function isNative() {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
}

export function useDragToDismiss({ onDismiss, enabled = true } = {}) {
  const native = isNative();
  const active = native && enabled !== false;
  const [offset, setOffset] = useState(0);
  const [dismissing, setDismissing] = useState(false);
  const startYRef = useRef(null);
  const sheetHeightRef = useRef(0);
  const sheetElRef = useRef(null);

  const onHandleTouchStart = useCallback((e) => {
    if (!active || dismissing) return;
    startYRef.current = e.touches?.[0]?.clientY ?? null;
    sheetHeightRef.current = sheetElRef.current?.offsetHeight || 0;
  }, [active, dismissing]);

  const onHandleTouchMove = useCallback((e) => {
    if (!active || dismissing) return;
    if (startYRef.current == null) return;
    const y = e.touches?.[0]?.clientY ?? 0;
    const delta = y - startYRef.current;
    if (delta <= 0) {
      // Dragging up - don't fight scrolling; bail.
      setOffset(0);
      return;
    }
    // Prevent the underlying body bounce while dragging.
    e.preventDefault();
    setOffset(delta);
  }, [active, dismissing]);

  const onHandleTouchEnd = useCallback(() => {
    if (!active || dismissing) return;
    const h = sheetHeightRef.current || 1;
    const triggered = offset >= Math.min(TRIGGER_PX, h * TRIGGER_PCT);
    if (triggered) {
      setDismissing(true);
      // Animate the sheet off-screen, then call onDismiss.
      setOffset(h + 40);
      setTimeout(() => {
        try { onDismiss?.(); } catch { /* no-op */ }
        // Reset so the next mount starts clean. The parent will
        // unmount the sheet anyway in most cases, but be defensive.
        setOffset(0);
        setDismissing(false);
      }, 220);
    } else {
      setOffset(0);
    }
    startYRef.current = null;
  }, [active, dismissing, offset, onDismiss]);

  // Reset between mounts.
  useEffect(() => () => {
    startYRef.current = null;
    sheetHeightRef.current = 0;
  }, []);

  if (!active) {
    return {
      sheetBindings: { ref: sheetElRef },
      sheetStyle: {},
      handleBindings: {},
      isDragging: false,
    };
  }

  return {
    sheetBindings: { ref: sheetElRef },
    sheetStyle: {
      transform: offset > 0 ? `translateY(${offset}px)` : undefined,
      transition: dismissing
        ? 'transform 0.22s ease-out'
        : (offset === 0 ? 'transform 0.18s ease-out' : 'none'),
      willChange: 'transform',
      touchAction: 'pan-y',
    },
    handleBindings: {
      onTouchStart: onHandleTouchStart,
      onTouchMove: onHandleTouchMove,
      onTouchEnd: onHandleTouchEnd,
    },
    isDragging: offset > 0,
  };
}

/**
 * Small visual handle/grabber bar - drop near the top of a bottom
 * sheet to advertise that it's draggable. iOS-native sheets have one.
 */
export function SheetHandle({ className = '' }) {
  return (
    <div className={`flex justify-center pt-1.5 pb-1 ${className}`}>
      <div className="w-10 h-1 rounded-full bg-light-grey" />
    </div>
  );
}
