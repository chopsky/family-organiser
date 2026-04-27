/**
 * Format a byte count as a human-readable string (B / KB / MB / GB).
 * Uses 1024-based units. Returns "0 B" for null/0/undefined.
 */
export function formatBytes(bytes) {
  if (!bytes || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  // 1 decimal for MB+, none for B/KB
  const formatted = unit >= 2 ? value.toFixed(1) : Math.round(value).toString();
  return `${formatted} ${units[unit]}`;
}
