/**
 * BottomSheet — a bottom-anchored modal with native iOS feel.
 *
 * Wraps the existing "fixed inset-0 ... items-end" pattern we'd been
 * writing inline across Dashboard / Meals / etc. so every sheet
 * inherits:
 *
 *   • A subtle drag-handle bar at the top (iOS convention)
 *   • Drag-down-to-dismiss (iOS native sheets all do this)
 *   • Safe-area bottom padding (clears the home indicator)
 *   • Backdrop tap to dismiss
 *   • Centered on tablet/desktop, bottom-anchored on phones
 *
 * Usage:
 *
 *   <BottomSheet open={open} onDismiss={() => setOpen(false)}>
 *     ...your sheet content...
 *   </BottomSheet>
 *
 * Renders nothing when `open` is false — caller doesn't have to gate.
 */

import React from 'react';
import { useDragToDismiss, SheetHandle } from '../hooks/useDragToDismiss';

export function BottomSheet({
  open,
  onDismiss,
  children,
  /** Desktop width (Tailwind class). Defaults to 480px. */
  desktopWidthClass = 'sm:w-[480px]',
  /** Extra classes on the inner sheet container. */
  contentClassName = '',
  /** Show the small drag-handle bar at top. iOS convention; on by default. */
  showHandle = true,
}) {
  const drag = useDragToDismiss({ onDismiss });

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onDismiss}
      role="presentation"
    >
      <div
        {...drag.sheetBindings}
        onClick={(e) => e.stopPropagation()}
        className={`bg-linen w-full ${desktopWidthClass} sm:rounded-2xl rounded-t-2xl border border-cream-border pb-safe sm:pb-0 max-h-[85vh] flex flex-col ${contentClassName}`}
        style={{
          boxShadow: '0 -4px 24px rgba(26, 22, 32, 0.10)',
          ...drag.sheetStyle,
        }}
      >
        {showHandle && (
          <div {...drag.handleBindings} className="cursor-grab active:cursor-grabbing">
            <SheetHandle />
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
