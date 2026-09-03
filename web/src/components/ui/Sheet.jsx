import { useState, useEffect, useRef } from 'react';

/**
 * Bottom-sheet primitive (design_handoff_ai_chat spec): scrim fades in, panel
 * slides up on a spring curve, grab handle at the top, capped at `maxHeight`,
 * tap the scrim to close. Mobile-first — the desktop assistant keeps its own
 * docked panel, so this is only mounted on small screens.
 *
 * The panel is a flex column; children fill the space below the handle so a
 * consumer can pin a header/composer and scroll the middle.
 *
 * The handle is a real control, not decoration: drag it down past the
 * threshold (or flick it) and the sheet dismisses; anything less springs
 * back. Drag is scoped to the top band (handle strip + optional header) so
 * content scrolling inside the sheet keeps working. While open, the page behind is scroll-locked - on
 * iOS a fixed overlay alone doesn't stop touch scroll bleeding through to
 * the body, which read as "the drag scrolls the screen behind it".
 */
// `header` renders INSIDE the drag zone (handle strip + header row), so the
// whole top band of the sheet pulls it down - the 19px handle alone was too
// small a target to find with a thumb (founder, 2026-09-02: "quite
// difficult to pull down"). Buttons inside the header still tap: a press
// that starts on an interactive element never becomes a drag, and the
// pointer is only captured once the finger has actually moved.
export default function Sheet({ open, onClose, children, header = null, maxHeight = '88%' }) {
  // Starts off-screen; the next frame flips `show` so the enter transition
  // runs. The sheet mounts fresh each time it opens (parent gates on `open`),
  // so no reset branch is needed.
  const [show, setShow] = useState(false);
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const drag = useRef(null); // { startY, lastY, lastT, velocity }

  useEffect(() => {
    if (!open) return undefined;
    const r = requestAnimationFrame(() => setShow(true));
    return () => cancelAnimationFrame(r);
  }, [open]);

  // Scroll-lock the page while the sheet is up. overflow:hidden alone is
  // not enough on iOS WebViews; fixing the body pins it without a jump
  // (the scroll offset is restored on close).
  useEffect(() => {
    if (!open) return undefined;
    const scrollY = window.scrollY;
    const { style } = document.body;
    const prev = { position: style.position, top: style.top, left: style.left, right: style.right, overflow: style.overflow };
    style.position = 'fixed';
    style.top = `-${scrollY}px`;
    style.left = '0';
    style.right = '0';
    style.overflow = 'hidden';
    return () => {
      style.position = prev.position;
      style.top = prev.top;
      style.left = prev.left;
      style.right = prev.right;
      style.overflow = prev.overflow;
      window.scrollTo(0, scrollY);
    };
  }, [open]);

  if (!open) return null;

  const onHandleDown = (e) => {
    // A press on a button/link in the header is a tap, never a drag.
    if (e.target?.closest?.('button, a, input, textarea, select, [role="button"]')) return;
    drag.current = { startY: e.clientY, lastY: e.clientY, lastT: performance.now(), velocity: 0, captured: false, pointerId: e.pointerId, el: e.currentTarget };
  };
  const onHandleMove = (e) => {
    if (!drag.current) return;
    const now = performance.now();
    const dy = Math.max(0, e.clientY - drag.current.startY);
    // Capture only once the finger has clearly moved, so a slightly wobbly
    // tap still lands as a tap on whatever is under it.
    if (!drag.current.captured && dy > 6) {
      drag.current.captured = true;
      drag.current.el?.setPointerCapture?.(drag.current.pointerId);
      setDragging(true);
    }
    const dt = now - drag.current.lastT;
    if (dt > 0) drag.current.velocity = (e.clientY - drag.current.lastY) / dt; // px/ms
    drag.current.lastY = e.clientY;
    drag.current.lastT = now;
    if (drag.current.captured) setDragY(dy);
  };
  const onHandleUp = () => {
    if (!drag.current) return;
    const { velocity, captured } = drag.current;
    drag.current = null;
    if (!captured) return; // never became a drag
    // 80px, or a quick flick - the old 120px pull felt like it was resisting.
    const shouldClose = dragY > 80 || (velocity > 0.35 && dragY > 16);
    setDragging(false);
    if (shouldClose) onClose();
    else setDragY(0);
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[60] flex items-end"
      style={{
        background: show ? 'rgba(45,42,51,0.4)' : 'rgba(45,42,51,0)',
        transition: 'background .25s ease',
        overscrollBehavior: 'contain',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full bg-cream flex flex-col overflow-hidden safe-bottom"
        style={{
          borderTopLeftRadius: 28,
          borderTopRightRadius: 28,
          maxHeight,
          transform: show ? `translateY(${dragY}px)` : 'translateY(100%)',
          transition: dragging ? 'none' : 'transform .32s cubic-bezier(0.32,0.72,0,1)',
          overscrollBehavior: 'contain',
        }}
      >
        {/* Drag zone: the grab handle AND the header row. touch-action none
            keeps the browser from turning the drag into a scroll; buttons
            inside the header are excluded in onHandleDown. */}
        <div
          className="shrink-0"
          style={{ touchAction: 'none' }}
          onPointerDown={onHandleDown}
          onPointerMove={onHandleMove}
          onPointerUp={onHandleUp}
          onPointerCancel={onHandleUp}
        >
          <div
            className="flex justify-center pt-2.5 pb-1"
            style={{ cursor: 'grab' }}
            role="button"
            aria-label="Drag down to close"
            onDoubleClick={onClose}
          >
            <div className="w-10 h-[5px] rounded-full" style={{ background: 'rgba(45,42,51,0.14)' }} />
          </div>
          {header}
        </div>
        <div className="flex-1 min-h-0 flex flex-col">{children}</div>
      </div>
    </div>
  );
}
