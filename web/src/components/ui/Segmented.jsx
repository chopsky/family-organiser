/**
 * Segmented - a single-select pill control (the design's view toggles +
 * filter bars). Rendered as a labelled group of aria-pressed buttons; the
 * active option gets a white pill + shadow. Options may carry a `count`
 * badge and a `danger` flag (turns coral once its count > 0, e.g. Overdue).
 *
 * Props:
 *   value     - the selected option value
 *   onChange  - (value) => void
 *   options   - [{ value, label, count?, danger? }]
 *   ariaLabel - group label for screen readers
 */
const SOFT = '#F3EEE5';

export default function Segmented({ value, onChange, options, ariaLabel, className = '' }) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={`inline-flex flex-wrap gap-1 p-1 rounded-xl ${className}`}
      style={{ background: SOFT }}
    >
      {options.map((opt) => {
        const on = value === opt.value;
        const danger = opt.danger && (opt.count ?? 0) > 0;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(opt.value)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold whitespace-nowrap transition-colors cursor-pointer"
            style={{
              background: on ? '#fff' : 'transparent',
              color: danger ? '#A04257' : (on ? 'var(--color-charcoal)' : 'var(--ink-2)'),
              boxShadow: on ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
            }}
          >
            {opt.label}
            {opt.count != null && (
              <span
                className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full text-[11px] font-bold"
                style={{
                  background: danger ? '#FBE6EA' : (on ? 'var(--color-plum-light)' : 'rgba(26,22,32,0.06)'),
                  color: danger ? '#A04257' : (on ? 'var(--color-plum-dark)' : 'var(--ink-2)'),
                }}
              >
                {opt.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
