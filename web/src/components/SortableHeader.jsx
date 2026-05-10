/**
 * Clickable table header that toggles sort. Active column shows an arrow
 * indicating direction. Pass `column` (the API sort key), the current
 * `sort`/`sortDir` state, and an `onSort(column, direction)` handler.
 */
export default function SortableHeader({ column, label, sort, sortDir, onSort, className = '' }) {
  const isActive = sort === column;
  const arrow = isActive ? (sortDir === 'asc' ? '↑' : '↓') : '';

  function handleClick() {
    if (isActive) {
      onSort(column, sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      // First click on a new column defaults to descending for created_at,
      // ascending for everything else (names look natural A→Z first)
      onSort(column, column === 'created_at' ? 'desc' : 'asc');
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
