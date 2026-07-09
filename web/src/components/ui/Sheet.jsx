import { useState, useEffect } from 'react';

/**
 * Bottom-sheet primitive (design_handoff_ai_chat spec): scrim fades in, panel
 * slides up on a spring curve, grab handle at the top, capped at `maxHeight`,
 * tap the scrim to close. Mobile-first — the desktop assistant keeps its own
 * docked panel, so this is only mounted on small screens.
 *
 * The panel is a flex column; children fill the space below the handle so a
 * consumer can pin a header/composer and scroll the middle.
 */
export default function Sheet({ open, onClose, children, maxHeight = '88%' }) {
  // Starts off-screen; the next frame flips `show` so the enter transition
  // runs. The sheet mounts fresh each time it opens (parent gates on `open`),
  // so no reset branch is needed.
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!open) return undefined;
    const r = requestAnimationFrame(() => setShow(true));
    return () => cancelAnimationFrame(r);
  }, [open]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[60] flex items-end"
      style={{ background: show ? 'rgba(45,42,51,0.4)' : 'rgba(45,42,51,0)', transition: 'background .25s ease' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full bg-cream flex flex-col overflow-hidden safe-bottom"
        style={{
          borderTopLeftRadius: 28,
          borderTopRightRadius: 28,
          maxHeight,
          transform: show ? 'translateY(0)' : 'translateY(100%)',
          transition: 'transform .32s cubic-bezier(0.32,0.72,0,1)',
        }}
      >
        <div className="flex justify-center pt-2.5 pb-1 shrink-0">
          <div className="w-10 h-[5px] rounded-full" style={{ background: 'rgba(45,42,51,0.14)' }} />
        </div>
        <div className="flex-1 min-h-0 flex flex-col">{children}</div>
      </div>
    </div>
  );
}
