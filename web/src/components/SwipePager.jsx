/**
 * SwipePager - paged views that move with the finger.
 *
 * The Calendar's swipe used to be recognised on release and the page
 * flipped in place (useSwipeNavigate). This drags the content as the
 * thumb moves and snaps on release, the way the native Calendar turns a
 * month (founder, 3 Sep).
 *
 * Two modes:
 *   - `renderPage(offset)` given: a three-pane strip (-1, 0, +1) so the
 *     neighbouring page is visible under the finger. On commit the strip
 *     animates one pane over, the parent is told to page (onPrev/onNext),
 *     and the strip resets without animation - the pane that was "next"
 *     is now the centre, so nothing visibly jumps.
 *   - children only: the single pane follows the finger with resistance;
 *     on commit it slides out, the parent pages, and the new content
 *     slides in from the other side. For views too heavy to render
 *     three of (the week/day time grids).
 *
 * Touch-only, and `touch-action: pan-y` on the wrapper leaves vertical
 * scrolling to the browser: the axis is decided in the first 8px of
 * travel and a vertical gesture is never ours. Desktop keeps the arrows.
 * Direction follows the platform: swipe left = forward.
 */
import { useEffect, useRef, useState } from 'react';
import { select as hapticSelect } from '../lib/haptics';
import usePrefersReducedMotion from '../hooks/usePrefersReducedMotion';

const AXIS_LOCK_PX = 8;
const COMMIT_FRACTION = 0.28;
const COMMIT_VELOCITY = 0.35; // px per ms
const SETTLE_MS = 240;
const RESISTANCE = 0.55; // single-pane follow: less than 1:1 so it reads as a peek

export default function SwipePager({ renderPage, onPrev, onNext, enabled = true, children, className, style }) {
  const reduced = usePrefersReducedMotion();
  const wrapRef = useRef(null);
  const trackRef = useRef(null);
  const gesture = useRef(null);
  const settling = useRef(false);
  const [dragging, setDragging] = useState(false);
  const paged = typeof renderPage === 'function';

  // Base position: the centre pane of the strip, or 0 for a single pane.
  const base = paged ? -100 / 3 : 0;
  const setX = (px, animate) => {
    const el = trackRef.current;
    if (!el) return;
    el.style.transition = animate ? `transform ${SETTLE_MS}ms cubic-bezier(.2,.7,.2,1)` : 'none';
    el.style.transform = `translate3d(calc(${base}% + ${px}px), 0, 0)`;
  };

  useEffect(() => { setX(0, false); }, [paged]); // eslint-disable-line react-hooks/exhaustive-deps

  const onTouchStart = (e) => {
    if (!enabled || settling.current || e.touches.length !== 1) { gesture.current = null; return; }
    const t = e.touches[0];
    gesture.current = { x: t.clientX, y: t.clientY, axis: null, dx: 0, lastX: t.clientX, lastT: performance.now(), v: 0 };
  };

  const onTouchMove = (e) => {
    const g = gesture.current;
    if (!g || e.touches.length !== 1) return;
    const t = e.touches[0];
    const dx = t.clientX - g.x;
    const dy = t.clientY - g.y;
    if (!g.axis) {
      if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return;
      g.axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y';
      if (g.axis === 'x') setDragging(true);
    }
    if (g.axis !== 'x') return;
    const now = performance.now();
    const dt = now - g.lastT;
    if (dt > 0) g.v = (t.clientX - g.lastX) / dt;
    g.lastX = t.clientX; g.lastT = now;
    g.dx = dx;
    if (reduced) return; // decide on release, no motion
    setX(paged ? dx : dx * RESISTANCE, false);
  };

  const finish = (commit) => {
    const g = gesture.current;
    gesture.current = null;
    setDragging(false);
    if (!g || g.axis !== 'x') return;
    const width = wrapRef.current?.clientWidth || 360;
    const forward = g.dx < 0;
    const go = commit && (Math.abs(g.dx) > width * COMMIT_FRACTION || Math.abs(g.v) > COMMIT_VELOCITY && Math.abs(g.dx) > AXIS_LOCK_PX * 3);
    if (!go) { setX(0, !reduced); return; }
    hapticSelect();
    const page = () => (forward ? onNext() : onPrev());
    if (reduced) { page(); setX(0, false); return; }
    settling.current = true;
    if (paged) {
      // Slide one pane over, page, then reset instantly: the new centre is
      // the pane already on screen.
      setX(forward ? -width : width, true);
      setTimeout(() => { page(); setX(0, false); settling.current = false; }, SETTLE_MS + 20);
    } else {
      // Slide the old page out, page, bring the new one in from the far side.
      setX(forward ? -width * 0.6 : width * 0.6, true);
      setTimeout(() => {
        page();
        setX(forward ? width * 0.6 : -width * 0.6, false);
        // Next frame: animate home.
        requestAnimationFrame(() => requestAnimationFrame(() => { setX(0, true); setTimeout(() => { settling.current = false; }, SETTLE_MS); }));
      }, SETTLE_MS);
    }
  };

  const bindings = {
    onTouchStart,
    onTouchMove,
    onTouchEnd: () => finish(true),
    onTouchCancel: () => finish(false),
  };

  if (paged) {
    return (
      <div ref={wrapRef} className={className} style={{ overflow: 'hidden', touchAction: 'pan-y', ...style }} {...bindings}>
        <div ref={trackRef} style={{ display: 'flex', width: '300%', willChange: dragging ? 'transform' : 'auto' }}>
          {[-1, 0, 1].map((offset) => (
            <div key={offset} style={{ width: `${100 / 3}%`, flexShrink: 0, minWidth: 0 }} aria-hidden={offset !== 0 || undefined}>
              {renderPage(offset)}
            </div>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div ref={wrapRef} className={className} style={{ overflow: 'hidden', touchAction: 'pan-y', ...style }} {...bindings}>
      <div ref={trackRef} style={{ willChange: dragging ? 'transform' : 'auto' }}>{children}</div>
    </div>
  );
}
