/**
 * Tiny inline bar chart for daily counts. Bars are proportional to the
 * busiest day in the supplied window; zero-count days show a faint
 * placeholder so the axis stays continuous. Pure CSS - no chart library.
 *
 * Each datum: { date: 'YYYY-MM-DD', calls: number }
 */
export default function DailyChart({ data, height = 'h-20' }) {
  if (!data || data.length === 0) return null;
  const max = Math.max(1, ...data.map((d) => d.calls));

  return (
    <div className={`flex items-end gap-1 ${height}`}>
      {data.map((d) => {
        const heightPct = d.calls > 0 ? Math.max(8, (d.calls / max) * 100) : 0;
        const dayLabel = new Date(d.date + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
        return (
          <div
            key={d.date}
            className="flex-1 flex flex-col items-center gap-1"
            title={`${dayLabel}: ${d.calls} call${d.calls === 1 ? '' : 's'}`}
          >
            <div className="flex-1 w-full flex items-end">
              <div
                className={`w-full rounded-t-sm ${d.calls > 0 ? 'bg-plum' : 'bg-light-grey'}`}
                style={{ height: d.calls > 0 ? `${heightPct}%` : '2px' }}
              />
            </div>
            <span className="text-[9px] text-warm-grey font-medium leading-tight text-center">{d.calls}</span>
          </div>
        );
      })}
    </div>
  );
}
