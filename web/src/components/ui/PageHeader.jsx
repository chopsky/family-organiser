/**
 * PageHeader - the opening block every redesigned desktop page shares:
 * a brand-coloured kicker, a large Instrument Serif title, an optional
 * subtitle, and right-aligned action buttons.
 *
 * Ported from the desktop design handoff and mapped to our theme tokens
 * (plum kicker, charcoal title, warm-grey subtitle). Instrument Serif is
 * loaded in web/index.html.
 *
 * The kicker + subtitle are desktop-only (`hidden md:block`): on mobile every
 * page shows just the big title, for a cleaner header. The Dashboard keeps its
 * date kicker because it renders its own header, not this component.
 *
 * Props:
 *   kicker   - small uppercase line above the title (e.g. "12 files · 6 folders")
 *   title    - the page title (serif)
 *   subtitle - one-line description under the title
 *   actions  - node(s) rendered top-right (usually PillBtn)
 *   className - overrides the default bottom-margin spacing (default mb-7)
 */
export default function PageHeader({ kicker, title, subtitle, actions, className = 'mb-7' }) {
  return (
    <div className={`flex items-end justify-between gap-4 flex-wrap ${className}`}>
      <div className="min-w-0">
        {kicker && (
          <div className="hidden md:block text-[11px] font-bold uppercase tracking-[0.1em] text-plum mb-1.5">
            {kicker}
          </div>
        )}
        <h1
          className="m-0 text-[34px] md:text-[44px] leading-[1.05] font-normal text-charcoal"
          style={{ fontFamily: '"Instrument Serif", serif', letterSpacing: '-0.01em' }}
        >
          {title}
        </h1>
        {subtitle && (
          <div className="hidden md:block text-sm text-[var(--ink-2)] mt-1.5">{subtitle}</div>
        )}
      </div>
      {actions && <div className="flex gap-2.5 shrink-0">{actions}</div>}
    </div>
  );
}
