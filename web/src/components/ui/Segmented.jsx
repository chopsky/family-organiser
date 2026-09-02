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

export default function Segmented({ value, onChange, options, ariaLabel, className = '', fluid = false }) {
  // One skin for every view toggle, per design_handoff_calendar: warm-sand
  // track (radius 12, 3px padding), active segment = white pill + soft
  // shadow, 12.5px/600 labels. Pages previously carried their own inline
  // copies of this control in four slightly different skins.
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={`${fluid ? 'flex w-full' : 'inline-flex flex-wrap'} ${className}`}
      style={{ background: SOFT, borderRadius: 12, padding: 3 }}
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
            className={`inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors cursor-pointer font-semibold ${fluid ? 'flex-1' : ''}`}
            style={{
              // Fluid tracks (equal-width segments, e.g. the calendar's
              // 4-up switcher) drop the side padding so long labels fit
              // between flanking chevrons on small phones.
              padding: fluid ? '7px 4px' : '7px 14px',
              borderRadius: 9,
              fontSize: 12.5,
              background: on ? '#fff' : 'transparent',
              color: danger ? '#A04257' : (on ? '#1A1620' : 'var(--ink-3, #8A8493)'),
              boxShadow: on ? '0 1px 3px rgba(26,22,32,0.12)' : 'none',
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
