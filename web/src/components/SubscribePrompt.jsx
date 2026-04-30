/**
 * SubscribePrompt + WriteGate — Phase 6.
 *
 * Drop-in UI for the read-only expired state. Two public exports:
 *
 *   <SubscribePrompt />     — inline "Subscribe to unlock this feature"
 *                             message with a CTA. Use when you want to
 *                             replace a specific interactive element
 *                             (e.g. an "Add item" form).
 *
 *   <WriteGate>...</WriteGate>
 *                           — wrapper that renders its children when the
 *                             household can write (active / trialing /
 *                             internal) or a SubscribePrompt when they
 *                             can't. Use when wrapping a component is
 *                             simpler than replacing it.
 *
 * Both reach into SubscriptionContext via useCanWrite() — no per-page
 * status logic required.
 *
 * Size variants so the prompt can slot into chunky empty states OR into
 * slim toolbars without looking out of scale.
 */

import { Link } from 'react-router-dom';
import { useCanWrite } from '../context/SubscriptionContext';
import { isIos } from '../lib/platform';

/**
 * Inline prompt. Renders regardless of subscription state — the caller
 * decides when to show it (via `{canWrite ? <Form /> : <SubscribePrompt />}`
 * or by using <WriteGate>).
 *
 * Props:
 *   size    — 'sm' | 'md' | 'lg' (default 'md')
 *   message — override the default "Subscribe to unlock this feature" copy
 *   ctaLabel — override the default "Subscribe" button label
 *   className — extra tailwind classes on the outer wrapper
 */
export default function SubscribePrompt({
  size = 'md',
  message = 'Subscribe to unlock this feature',
  ctaLabel = 'Subscribe',
  className = '',
}) {
  // App Store guideline 3.1.1: never surface a "Subscribe" CTA on iOS.
  // Defence-in-depth — the SubscriptionContext already forces
  // canWrite=true on iOS so callers' `{!canWrite && <SubscribePrompt/>}`
  // patterns won't render this, but any caller that renders us
  // unconditionally would still get blocked here.
  if (isIos()) return null;

  const { padding, text, button } = SIZES[size] || SIZES.md;

  return (
    <div
      className={
        'flex items-center justify-between gap-3 flex-wrap ' +
        'rounded-xl border border-plum/20 bg-plum-light/50 ' +
        padding + ' ' + className
      }
      role="status"
      aria-label="Subscribe prompt"
    >
      <div className="flex items-center gap-2 min-w-0">
        {/* Lock icon — signals the action is gated without being scary.
            Using a stroke icon inline so we don't pull in a new icon dep. */}
        <svg
          className="text-plum shrink-0"
          width="16" height="16" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        <p className={`text-charcoal font-medium ${text}`}>{message}</p>
      </div>
      <Link
        to="/subscribe"
        className={
          `inline-flex items-center rounded-lg bg-plum hover:bg-plum-pressed ` +
          `text-white font-semibold transition-colors shrink-0 ${button}`
        }
      >
        {ctaLabel}
      </Link>
    </div>
  );
}

const SIZES = {
  sm: { padding: 'px-3 py-2', text: 'text-xs',  button: 'text-xs px-3 py-1.5' },
  md: { padding: 'px-4 py-3', text: 'text-sm',  button: 'text-sm px-4 py-2' },
  lg: { padding: 'px-5 py-4', text: 'text-base', button: 'text-sm px-5 py-2.5' },
};

/**
 * Wrapper: renders children when the household can write, otherwise
 * renders a SubscribePrompt. Pass `fallback` to provide a custom
 * read-only UI; otherwise the default inline prompt is used.
 *
 * Example:
 *   <WriteGate size="sm" message="Subscribe to add more items">
 *     <button onClick={addItem}>Add</button>
 *   </WriteGate>
 */
export function WriteGate({
  children,
  fallback,
  size = 'md',
  message,
  ctaLabel,
  className = '',
}) {
  const canWrite = useCanWrite();
  if (canWrite) return children;
  if (fallback !== undefined) return fallback;
  return (
    <SubscribePrompt
      size={size}
      message={message}
      ctaLabel={ctaLabel}
      className={className}
    />
  );
}
