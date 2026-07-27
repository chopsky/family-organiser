/**
 * Onboarding v4 shared primitives.
 *
 * Recreated natively from the handoff prototype (design_handoff_onboarding/
 * onboarding-v4/ui.jsx) - not ported. Values match the spec; colours go through
 * ./tokens so they resolve to the app's existing CSS custom properties.
 *
 * Two deliberate deviations from the prototype, both to honour the handoff's
 * OWN non-negotiable that "every tappable element is >= 44pt":
 *   - Back button: keeps the 36px visual circle but carries a 44x44 hit area.
 *   - Ghost button: min-height 44 (the prototype's 13px padding lands at ~40).
 * Visually identical, correctly tappable.
 */
import { useEffect, useRef } from 'react';
import { T, SHADOW, R } from './tokens';
import './animations.css';

const LOCKUP = '/onboarding-v4/lockup-colour.png';
const LOGOMARK = '/onboarding-v4/logomark-purple.png';

export function Tick({ size = 13, color = '#fff' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
      strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

/** Housemait logomark inside a tinted circle - the bot's avatar in chat. */
export function Mark({ size = 28 }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: size, height: size, borderRadius: '50%', flexShrink: 0,
        background: T.purpleSoft, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <img src={LOGOMARK} alt="" style={{ width: '62%', height: '50%', objectFit: 'contain', display: 'block' }} />
    </span>
  );
}

/** Horizontal logo lockup. Aspect ratio 6.086:1 per the asset. */
export function Lockup({ width = 92 }) {
  return (
    <img
      src={LOCKUP}
      alt="Housemait"
      style={{ width, height: width / 6.086, objectFit: 'contain', display: 'block', flexShrink: 0 }}
    />
  );
}

/**
 * The gap between the status bar and the first row of UI, for every screen in
 * the flow.
 *
 * It is measured FROM the safe-area inset rather than stacked on top of a
 * second allowance for the same thing. The handoff was drawn at 375x812 with
 * the status bar painted into the mockup, so its 56px top padding already
 * INCLUDED the status bar. Applying the real inset as well double-counted it:
 * ~100px of dead space above the progress bar on a device, against ~56px in
 * the design.
 */
export const TOP_GAP = 'calc(env(safe-area-inset-top, 0px) + 24px)';

export function Header({ onBack, hideBack, pct = 0, reduced }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 13, flexShrink: 0,
      paddingTop: TOP_GAP, paddingBottom: 18,
    }}>
      <button
        type="button"
        onClick={onBack}
        aria-label="Back"
        // 44x44 hit area, 36px visual circle (see file header).
        style={{
          width: 44, height: 44, margin: -4, padding: 0, border: 0, background: 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          cursor: 'pointer', visibility: hideBack ? 'hidden' : 'visible',
        }}
      >
        <span
          style={{
            width: 36, height: 36, borderRadius: '50%', background: 'rgba(26,22,32,.05)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={T.ink2}
            strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </span>
      </button>

      <div style={{ flex: 1, height: 5, borderRadius: 99, background: 'rgba(26,22,32,.09)', overflow: 'hidden' }}>
        <div
          style={{
            height: '100%', borderRadius: 99, width: `${pct}%`,
            background: T.gradProgress,
            transition: reduced ? 'none' : 'width .55s cubic-bezier(.32,.72,0,1)',
          }}
        />
      </div>

      <Lockup width={92} />
    </div>
  );
}

/**
 * The frame every step screen shares: fixed header, scrolling body, pinned
 * footer. Page padding 0 26px 30px.
 */
export function Step({ onBack, hideBack, pct, reduced, children, footer }) {
  return (
    <div
      className="ob-v4"
      style={{
        // height, NOT minHeight: the footer is pinned, so the frame must be
        // exactly the viewport and the BODY must be the thing that scrolls.
        // With minHeight the container grows past the viewport, the inner
        // overflow never engages, and the footer scrolls away with the content.
        height: '100dvh', display: 'flex', flexDirection: 'column',
        background: T.bg, color: T.ink, padding: '0 26px 30px',
        // No paddingTop here: the header owns the whole gap (TOP_GAP), so the
        // safe-area inset is applied exactly once.
        // The scrolling body sits inside; keep momentum scrolling on iOS.
        WebkitOverflowScrolling: 'touch',
      }}
    >
      <Header onBack={onBack} hideBack={hideBack} pct={pct} reduced={reduced} />
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>{children}</div>
      {footer && <div style={{ flexShrink: 0, paddingTop: 12 }}>{footer}</div>}
    </div>
  );
}

export function Cta({ children, onClick, disabled, type = 'button' }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        width: '100%', padding: 17, borderRadius: R.cta, border: 0,
        font: '700 17px Inter, system-ui, sans-serif',
        background: disabled ? 'rgba(26,22,32,.12)' : T.purple,
        color: disabled ? 'rgba(26,22,32,.35)' : '#fff',
        boxShadow: disabled ? 'none' : SHADOW.cta,
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      {children}
    </button>
  );
}

export function Ghost({ children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: '100%', minHeight: 44, padding: 13, border: 0, background: 'transparent',
        font: '600 14.5px Inter, system-ui, sans-serif', color: T.ink2, cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

export function OptionRow({ emoji, label, note, onClick, i = 0, selected, compact }) {
  return (
    <button
      type="button"
      className="ob-in"
      onClick={onClick}
      aria-pressed={!!selected}
      style={{
        animationDelay: `${0.05 + i * 0.05}s`,
        width: '100%', minHeight: 44, textAlign: 'left', display: 'flex', alignItems: 'center',
        gap: 13, padding: compact ? '10px 14px' : '14px 15px', borderRadius: R.row, cursor: 'pointer',
        background: selected ? T.purpleSoft : T.surface,
        border: selected ? `1.5px solid ${T.purple}` : '1.5px solid rgba(26,22,32,.07)',
        boxShadow: selected ? 'none' : SHADOW.row,
      }}
    >
      <span
        style={{
          width: compact ? 36 : 40, height: compact ? 36 : 40, borderRadius: 12, flexShrink: 0,
          background: T.purpleSoft, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: compact ? 17 : 19,
        }}
      >
        {emoji}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', font: `700 ${compact ? 15 : 15.5}px Inter, system-ui, sans-serif` }}>{label}</span>
        {note && <span style={{ display: 'block', fontSize: 12.5, color: T.ink3, marginTop: 1 }}>{note}</span>}
      </span>
      {selected ? (
        <span
          style={{
            width: 24, height: 24, borderRadius: '50%', background: T.purple, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Tick size={13} />
        </span>
      ) : (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={T.ink3}
          strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          <path d="M9 6l6 6-6 6" />
        </svg>
      )}
    </button>
  );
}

export function ChipGrid({ options, value, onPick }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
      {options.map((o, i) => {
        const on = value === o;
        return (
          <button
            key={o}
            type="button"
            className="ob-in"
            onClick={() => onPick(o)}
            aria-pressed={on}
            style={{
              animationDelay: `${0.05 + i * 0.04}s`,
              minHeight: 44, padding: '15px 12px', borderRadius: R.chip, cursor: 'pointer',
              font: '600 15.5px Inter, system-ui, sans-serif',
              background: on ? T.purple : T.surface,
              color: on ? '#fff' : T.ink,
              border: on ? `1.5px solid ${T.purple}` : '1.5px solid rgba(26,22,32,.09)',
            }}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

export function Field({ value, onChange, onEnter, placeholder, suggestions, onSuggest, autoFocus = true }) {
  const ref = useRef(null);
  // 320ms: waits for the step transition so the keyboard doesn't fight the
  // entrance animation (spec, screen 05).
  useEffect(() => {
    if (!autoFocus) return undefined;
    const t = setTimeout(() => ref.current && ref.current.focus(), 320);
    return () => clearTimeout(t);
  }, [autoFocus]);

  return (
    <div>
      <input
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && value.trim()) onEnter && onEnter(); }}
        placeholder={placeholder}
        style={{
          width: '100%', padding: '17px 19px', borderRadius: R.field,
          border: `1.5px solid ${T.line2}`, background: T.surface,
          fontSize: 17, color: T.ink, outline: 'none',
        }}
      />
      {suggestions && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
          {suggestions.map((s, i) => (
            <button
              key={s}
              type="button"
              className="ob-in"
              onClick={() => onSuggest(s)}
              style={{
                animationDelay: `${0.1 + i * 0.06}s`,
                minHeight: 44, padding: '9px 14px', borderRadius: R.pill,
                border: '1.5px dashed rgba(109,56,173,.4)', background: 'rgba(242,236,250,.7)',
                color: T.purpleDeep, font: '600 13.5px Inter, system-ui, sans-serif',
                cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Bubble({ from, children, delay = 0 }) {
  const me = from === 'me';
  return (
    <div
      className="ob-bub"
      style={{
        animationDelay: `${delay}s`, display: 'flex', gap: 9,
        alignItems: 'flex-end', flexDirection: me ? 'row-reverse' : 'row',
      }}
    >
      {!me && <Mark size={28} />}
      <div
        style={{
          maxWidth: '80%', padding: '12px 15px', borderRadius: R.bubble, fontSize: 15, lineHeight: 1.42,
          background: me ? T.gradPlum : T.surface,
          color: me ? '#fff' : T.ink,
          borderBottomRightRadius: me ? R.bubbleTail : R.bubble,
          borderBottomLeftRadius: me ? R.bubble : R.bubbleTail,
          border: me ? 0 : `1px solid ${T.line}`,
          boxShadow: me ? '0 10px 22px -12px rgba(109,56,173,.6)' : '0 2px 10px -6px rgba(26,22,32,.18)',
        }}
      >
        {children}
      </div>
    </div>
  );
}

export function Typing() {
  return (
    <div className="ob-bub" style={{ display: 'flex', gap: 9, alignItems: 'flex-end' }} aria-label="Housemait is typing">
      <Mark size={28} />
      <div
        style={{
          background: T.surface, border: `1px solid ${T.line}`, borderRadius: R.bubble,
          borderBottomLeftRadius: R.bubbleTail, padding: '14px 16px', display: 'flex', gap: 5,
        }}
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            style={{
              width: 7, height: 7, borderRadius: '50%', background: T.ink3,
              animation: `obDot 1.1s ${i * 0.15}s infinite`,
            }}
          />
        ))}
      </div>
    </div>
  );
}
