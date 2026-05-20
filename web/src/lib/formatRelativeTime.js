/**
 * Format an ISO timestamp as a short relative-time string for admin tables.
 * Returns 'just now', '12m ago', '3h ago', '5d ago', '2w ago', or '6mo ago'.
 * Returns 'Never' for null/undefined.
 */
export function formatRelativeTime(iso) {
  if (!iso) return 'Never';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '-';
  const diffMs = Date.now() - then;
  if (diffMs < 0) return 'just now';

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 8) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(days / 365);
  return `${years}y ago`;
}

/**
 * Returns a Tailwind class for the colour to render a relative timestamp in,
 * based on staleness thresholds. Useful to flag idle households/users.
 */
export function staleness(iso) {
  if (!iso) return 'text-warm-grey';
  const days = (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24);
  if (days < 2) return 'text-sage';
  if (days < 14) return 'text-charcoal';
  return 'text-coral';
}
