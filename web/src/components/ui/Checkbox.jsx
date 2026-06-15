/**
 * Checkbox - round check toggle that fills brand-plum when checked. Ported
 * from the desktop design handoff and mapped to our theme. Pass an ariaLabel
 * so screen readers announce what's being toggled (the visual is icon-only).
 */
export default function Checkbox({ checked, onChange, size = 22, ariaLabel, disabled = false }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); if (!disabled) onChange?.(!checked); }}
      className="shrink-0 flex items-center justify-center rounded-full transition-colors disabled:opacity-50"
      style={{
        width: size,
        height: size,
        border: checked ? '2px solid var(--color-plum)' : '1.5px solid var(--color-light-grey)',
        background: checked ? 'var(--color-plum)' : 'transparent',
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      {checked && (
        <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M2.5 6.2l2.4 2.4 4.6-5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}
