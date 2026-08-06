/**
 * useSwipeNavigate - horizontal swipe → prev/next navigation for paged
 * views (the Calendar's day/week/month). Touch-only, so desktop mice are
 * unaffected, and deliberately passive: it never calls preventDefault, so
 * vertical scrolling inside the view keeps its native feel - the gesture
 * only resolves on release, and only when the movement was clearly
 * horizontal.
 *
 *   const swipe = useSwipeNavigate({ onPrev: navigatePrev, onNext: navigateNext });
 *   <div {...swipe.bindings}>…view…</div>
 *
 * Direction follows the platform convention: swipe LEFT (content pushed
 * off to the left) moves FORWARD to the next day/week/month, swipe right
 * goes back - same as the iOS Calendar app.
 *
 * Guards: ≥56px of horizontal travel AND at least 1.5× the vertical
 * travel (a diagonal scroll never navigates); multi-touch (pinch) is
 * ignored. A light haptic tick confirms each page turn on device.
 */
import { useRef } from 'react';
import { select as hapticSelect } from '../lib/haptics';

const MIN_DX = 56;
const DOMINANCE = 1.5;

export default function useSwipeNavigate({ onPrev, onNext, enabled = true }) {
  const start = useRef(null);

  const bindings = {
    onTouchStart: (e) => {
      if (!enabled || e.touches.length !== 1) {
        start.current = null;
        return;
      }
      start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    },
    onTouchEnd: (e) => {
      const s = start.current;
      start.current = null;
      if (!s || !enabled) return;
      const t = e.changedTouches && e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      if (Math.abs(dx) < MIN_DX || Math.abs(dx) < Math.abs(dy) * DOMINANCE) return;
      hapticSelect();
      if (dx < 0) onNext();
      else onPrev();
    },
    onTouchCancel: () => {
      start.current = null;
    },
  };

  return { bindings };
}
