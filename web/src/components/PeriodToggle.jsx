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
          'flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-full text-sm font-semibold transition-colors ' +
          (on ? 'bg-plum text-white' : 'text-warm-grey')
        }
      >
        {label}
        {tag && (
          <span
            className={
              'text-[10.5px] font-bold tracking-wide px-2 py-0.5 rounded-full ' +
              (on ? 'bg-white/20 text-white' : 'bg-plum-light text-plum')
            }
          >
            {tag}
          </span>
        )}
      </button>
    );
  };
  return (
    <div role="tablist" aria-label="Billing period" className="flex gap-1 p-1 bg-white border border-light-grey rounded-full shadow-[0_2px_8px_rgba(107,63,160,0.06)]">
      {seg('monthly', 'Monthly')}
      {seg('annual', 'Annually', '2 MONTHS FREE')}
    </div>
  );
}
