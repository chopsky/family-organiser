/**
 * Clickable table header that toggles sort. Active column shows an arrow
 * indicating direction. Pass `column` (the API sort key), the current
 * `sort`/`sortDir` state, and an `onSort(column, direction)` handler.
 *
 * `defaultDir` overrides the first-click direction when the convention below
 * gets it wrong for a particular column.
 */

// Which way a column should sort on its FIRST click. Driven by the key's
// suffix rather than a hand-maintained list of column names, so new sortable
// columns get sensible behaviour without touching this file:
//   *_at                  timestamps  -> newest first
//   *_count / *_bytes     magnitudes  -> largest first
// Everything else (names, codes, timezones, categorical badges) reads more
// naturally A→Z / lowest-rank-first, so it defaults to ascending.
const DESC_FIRST = /(_at|_count|_bytes)$/;

export default function SortableHeader({ column, label, sort, sortDir, onSort, className = '', defaultDir }) {
  const isActive = sort === column;
  const arrow = isActive ? (sortDir === 'asc' ? '↑' : '↓') : '';

  function handleClick() {
    if (isActive) {
      onSort(column, sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      onSort(column, defaultDir || (DESC_FIRST.test(column) ? 'desc' : 'asc'));
    }
  }

  return (
    <th className={`px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider ${className}`}>
      <button
        type="button"
        onClick={handleClick}
        className={`inline-flex items-center gap-1 uppercase tracking-wider text-xs font-semibold hover:text-plum transition-colors ${isActive ? 'text-plum' : 'text-warm-grey'}`}
      >
        {label}
        <span className="text-[10px] w-2 inline-block">{arrow}</span>
      </button>
    </th>
  );
}
