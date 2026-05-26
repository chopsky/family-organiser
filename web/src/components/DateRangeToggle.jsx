/**
 * Pill-style date-range selector. Three or four options depending on the
 * endpoint - some queries (per-household activity timeline) are capped
 * server-side at 90 days, so "All" doesn't make sense there.
 *
 * "All" is implemented as days=36500 (~100 years) so the backend doesn't
 * need a separate code path for it - the same `since = now - days * day`
 * subtraction just produces a date in 1925 that's older than any record.
 *
 * Usage:
 *   const [days, setDays] = useState(30);
 *   <DateRangeToggle value={days} onChange={setDays} />
 */
export const DAYS_ALL = 36500;

const OPTIONS_WITH_ALL = [
  { value: 7, label: '7d' },
  { value: 30, label: '30d' },
  { value: 90, label: '90d' },
  { value: DAYS_ALL, label: 'All' },
];

const OPTIONS_CAPPED = OPTIONS_WITH_ALL.slice(0, 3);

export default function DateRangeToggle({ value, onChange, includeAll = true, className = '' }) {
  const options = includeAll ? OPTIONS_WITH_ALL : OPTIONS_CAPPED;

  return (
    <div className={`inline-flex bg-cream rounded-xl p-0.5 gap-0.5 ${className}`}>
      {options.map(({ value: v, label }) => {
        const active = value === v;
        return (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
              active
                ? 'bg-white text-plum shadow-sm'
                : 'text-warm-grey hover:text-charcoal'
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
