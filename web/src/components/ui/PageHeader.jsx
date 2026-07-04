/**
 * PageHeader - the opening block every redesigned desktop page shares:
 * a brand-coloured kicker, a large Instrument Serif title, an optional
 * subtitle, and right-aligned action buttons.
 *
 * Ported from the desktop design handoff and mapped to our theme tokens
 * (plum kicker, charcoal title, warm-grey subtitle). Instrument Serif is
 * loaded in web/index.html.
 *
 * Props:
 *   kicker   - small uppercase line above the title (e.g. "12 files · 6 folders")
 *   title    - the page title (serif)
 *   subtitle - one-line description under the title
 *   actions  - node(s) rendered top-right (usually PillBtn)
 *   className - overrides the default bottom-margin spacing (default mb-7)
 */
export default function PageHeader({ kicker, title, subtitle, actions, className = 'mb-7' }) {
  // The kicker (small plum uppercase line above the title) is deliberately
  // not rendered (founder call, 2026-07-04): page headers go straight to
  // the serif title. Callers still pass the prop, so restoring it is a
  // one-line change here. The dashboard's date/event-count line is its own
  // component and unaffected.
  void kicker;
  return (
    <div className={`flex items-end justify-between gap-4 flex-wrap ${className}`}>
      <div className="min-w-0">
        <h1
          className="m-0 text-[34px] md:text-[44px] leading-[1.05] font-normal text-charcoal"
          style={{ fontFamily: '"Instrument Serif", serif', letterSpacing: '-0.01em' }}
        >
          {title}
        </h1>
        {subtitle && (
          <div className="text-sm text-[var(--ink-2)] mt-1.5">{subtitle}</div>
        )}
      </div>
      {actions && <div className="flex gap-2.5 shrink-0">{actions}</div>}
    </div>
  );
}
