/**
 * Monthly/Annually segmented toggle for the subscribe pages - one plan
 * card shown at a time so both plans are visible on a phone without
 * scrolling. The "2 months free" tag rides the Annually segment (the
 * standard placement: it pulls the eye toward annual before the price
 * is read).
 */
export default function PeriodToggle({ period, onChange }) {
  const seg = (key, label, tag) => {
    const on = period === key;
    return (
      <button
        type="button"
        role="tab"
        aria-selected={on}
        onClick={() => onChange(key)}
        className={
          'flex-1 h-11 inline-flex items-center justify-center gap-1.5 px-3 rounded-full text-sm transition-all ' +
          (on
            ? 'bg-white text-plum font-semibold shadow-[0_2px_8px_rgba(45,42,51,0.10)]'
            : 'text-warm-grey font-medium')
        }
      >
        {label}
        {tag && (
          <span
            className={
              'text-[9.5px] font-bold tracking-[0.04em] px-1.5 py-[3px] rounded-full whitespace-nowrap ' +
              (on ? 'bg-plum-light text-plum' : 'bg-charcoal/[0.06] text-warm-grey')
            }
          >
            {tag}
          </span>
        )}
      </button>
    );
  };
  return (
    <div role="tablist" aria-label="Billing period" className="flex gap-1 p-1 bg-charcoal/[0.06] rounded-full">
      {seg('monthly', 'Monthly')}
      {seg('annual', 'Annually', '2 MONTHS FREE')}
    </div>
  );
}
