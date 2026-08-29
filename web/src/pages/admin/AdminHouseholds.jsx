import { useState, useEffect, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../../lib/api';
import { IconSearch, IconChevronLeft, IconChevronRight } from '../../components/Icons';
import Spinner from '../../components/Spinner';
import SubscriptionBadge from '../../components/SubscriptionBadge';
import SortableHeader from '../../components/SortableHeader';
import ErrorBanner from '../../components/ErrorBanner';
import { formatBytes } from '../../lib/formatBytes';
import { formatRelativeTime, staleness } from '../../lib/formatRelativeTime';

const PAGE_SIZE = 20;
const PLAN_OPTIONS = [
  { value: '', label: 'All plans' },
  { value: 'trialing', label: 'Trialing' },
  { value: 'active', label: 'Active' },
  { value: 'expired', label: 'Expired' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'internal', label: 'Internal' },
];
const ACTIVITY_OPTIONS = [
  { value: '', label: 'All activity' },
  { value: 'active', label: 'Active (within 14d)' },
  { value: 'idle', label: 'At-risk (paying, idle 14d+)' },
];

export default function AdminHouseholds() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialActivity = searchParams.get('activity') || '';
  const initialPlan = searchParams.get('plan') || '';

  const [households, setHouseholds] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  // searchInput is the live text field; search is the APPLIED term the
  // fetch depends on. Splitting them stops every keystroke refetching -
  // only the form submit applies the term. Both seed from the URL so a
  // searched view survives refresh / back-button like the filters do.
  const initialSearch = searchParams.get('q') || '';
  const [searchInput, setSearchInput] = useState(initialSearch);
  const [search, setSearch] = useState(initialSearch);
  const [planFilter, setPlanFilter] = useState(initialPlan);
  const [activityFilter, setActivityFilter] = useState(initialActivity);
  const [sort, setSort] = useState('created_at');
  const [sortDir, setSortDir] = useState('desc');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Empty households (0 users): abandoned signups + pre-fix creation-race
  // orphans. Fetched separately so the main list stays untouched; the banner
  // only renders when there is something to clean.
  const [emptyHouseholds, setEmptyHouseholds] = useState([]);
  const [purging, setPurging] = useState(false);
  const loadEmpty = useCallback(async () => {
    try {
      const { data } = await api.get('/admin/empty-households');
      setEmptyHouseholds(data.households || []);
    } catch { setEmptyHouseholds([]); }
  }, []);
  useEffect(() => { loadEmpty(); }, [loadEmpty]);

  async function purgeEmpty() {
    const names = emptyHouseholds.slice(0, 5).map((h) => h.name).join(', ');
    const more = emptyHouseholds.length > 5 ? ` and ${emptyHouseholds.length - 5} more` : '';
    if (!window.confirm(
      `Delete ${emptyHouseholds.length} empty household${emptyHouseholds.length === 1 ? '' : 's'} (${names}${more})?\n\n` +
      'Only households with zero users are deleted, each one re-checked at delete time. This cannot be undone.',
    )) return;
    setPurging(true);
    try {
      const { data } = await api.post('/admin/empty-households/purge');
      window.alert(`Deleted ${data.deleted}${data.skipped ? `, skipped ${data.skipped} (no longer empty or refused)` : ''}.`);
      await Promise.all([loadEmpty(), loadHouseholds()]);
    } catch {
      window.alert('Purge failed - nothing may have been deleted. Try again.');
    } finally {
      setPurging(false);
    }
  }

  const loadHouseholds = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = { page, limit: PAGE_SIZE, sort, sortDir };
      if (search.trim()) params.search = search.trim();
      if (planFilter) params.plan = planFilter;
      if (activityFilter) params.activity = activityFilter;
      const { data } = await api.get('/admin/households', { params });
      setHouseholds(data.households || []);
      setTotal(data.total || 0);
    } catch (err) {
      console.error('Failed to load households:', err);
      setError('Could not load households. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [page, search, planFilter, activityFilter, sort, sortDir]);

  useEffect(() => { loadHouseholds(); }, [loadHouseholds]);

  function handleSearch(e) {
    e.preventDefault();
    setPage(1);
    const term = searchInput.trim();
    setSearch(term);
    const next = new URLSearchParams(searchParams);
    if (term) next.set('q', term); else next.delete('q');
    setSearchParams(next, { replace: true });
  }

  function handleSort(column, direction) {
    setPage(1);
    setSort(column);
    setSortDir(direction);
  }

  function handlePlanChange(e) {
    setPage(1);
    setPlanFilter(e.target.value);
    const next = new URLSearchParams(searchParams);
    if (e.target.value) next.set('plan', e.target.value); else next.delete('plan');
    setSearchParams(next, { replace: true });
  }

  function handleActivityChange(e) {
    setPage(1);
    setActivityFilter(e.target.value);
    const next = new URLSearchParams(searchParams);
    if (e.target.value) next.set('activity', e.target.value); else next.delete('activity');
    setSearchParams(next, { replace: true });
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-charcoal tracking-tight">Households</h1>
      <p className="text-warm-grey text-sm mt-1">{total} total household{total !== 1 ? 's' : ''}</p>

      {emptyHouseholds.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-3 px-4 py-3 rounded-xl border border-coral/30 bg-coral/5">
          <p className="text-sm text-charcoal flex-1 min-w-[240px]">
            <span className="font-semibold">{emptyHouseholds.length} empty household{emptyHouseholds.length === 1 ? '' : 's'}</span>
            {' '}with 0 users - abandoned signups. Safe to remove; each is re-checked for emptiness at delete time.
          </p>
          <button
            onClick={purgeEmpty}
            disabled={purging}
            className="px-4 py-2 rounded-xl bg-coral text-white text-sm font-semibold hover:bg-coral/90 disabled:opacity-50"
          >
            {purging ? 'Deleting…' : `Delete ${emptyHouseholds.length}`}
          </button>
        </div>
      )}

      {/* Search + Filter */}
      <div className="mt-4 flex flex-wrap gap-2">
        <form onSubmit={handleSearch} className="flex gap-2 flex-1 min-w-[280px]">
          <div className="relative flex-1 max-w-md">
            <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-warm-grey" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search by household name..."
              className="w-full pl-10 pr-4 py-2.5 bg-cream border border-light-grey rounded-xl text-sm focus:outline-none focus:border-plum focus:ring-2 focus:ring-plum/20 transition-all"
            />
          </div>
          <button type="submit" className="px-4 py-2.5 bg-plum text-white rounded-xl text-sm font-semibold hover:bg-plum-dark transition-colors">
            Search
          </button>
        </form>
        <select
          value={planFilter}
          onChange={handlePlanChange}
          className="px-4 py-2.5 bg-cream border border-light-grey rounded-xl text-sm font-medium text-charcoal focus:outline-none focus:border-plum focus:ring-2 focus:ring-plum/20 transition-all"
        >
          {PLAN_OPTIONS.map(({ value, label }) => (
            <option key={value || 'all'} value={value}>{label}</option>
          ))}
        </select>
        <select
          value={activityFilter}
          onChange={handleActivityChange}
          className="px-4 py-2.5 bg-cream border border-light-grey rounded-xl text-sm font-medium text-charcoal focus:outline-none focus:border-plum focus:ring-2 focus:ring-plum/20 transition-all"
        >
          {ACTIVITY_OPTIONS.map(({ value, label }) => (
            <option key={value || 'all'} value={value}>{label}</option>
          ))}
        </select>
      </div>

      <div className="mt-4">
        <ErrorBanner message={error} onRetry={loadHouseholds} />
      </div>

      {/* Table - keeps previous rows visible (dimmed) during refetch; the
          full spinner only shows on the very first load. */}
      <div className={`mt-4 bg-white rounded-2xl shadow-[var(--shadow-sm)] overflow-hidden ${loading && households.length > 0 ? 'opacity-60 pointer-events-none' : ''}`}>
        {loading && households.length === 0 ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-light-grey text-left">
                  <SortableHeader column="name" label="Name" sort={sort} sortDir={sortDir} onSort={handleSort} />
                  <SortableHeader column="member_count" label="Members" sort={sort} sortDir={sortDir} onSort={handleSort} />
                  <SortableHeader column="plan" label="Plan" sort={sort} sortDir={sortDir} onSort={handleSort} className="hidden sm:table-cell" />
                  <SortableHeader column="last_seen_at" label="Last seen" sort={sort} sortDir={sortDir} onSort={handleSort} className="hidden md:table-cell" />
                  <SortableHeader column="schools_count" label="School" sort={sort} sortDir={sortDir} onSort={handleSort} className="hidden md:table-cell" />
                  <SortableHeader column="documents_bytes" label="Storage" sort={sort} sortDir={sortDir} onSort={handleSort} className="hidden lg:table-cell" />
                  <SortableHeader column="join_code" label="Join Code" sort={sort} sortDir={sortDir} onSort={handleSort} className="hidden lg:table-cell" />
                  <SortableHeader column="timezone" label="Timezone" sort={sort} sortDir={sortDir} onSort={handleSort} className="hidden lg:table-cell" />
                  <SortableHeader column="created_at" label="Created" sort={sort} sortDir={sortDir} onSort={handleSort} className="hidden lg:table-cell" />
                </tr>
              </thead>
              <tbody>
                {households.map((h) => (
                  <tr key={h.id} className="border-b border-light-grey last:border-0 hover:bg-cream/50 transition-colors">
                    <td className="px-4 py-3">
                      <Link to={`/admin/households/${h.id}`} className="font-medium text-charcoal hover:text-plum">
                        {h.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-plum-light text-plum text-xs font-semibold">
                        {h.member_count ?? 0}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <SubscriptionBadge household={h} />
                    </td>
                    <td
                      className={`px-4 py-3 text-xs hidden md:table-cell ${staleness(h.last_seen_at)}`}
                      title={h.last_seen_at ? new Date(h.last_seen_at).toLocaleString() + (h.last_seen_channel === 'whatsapp' ? ' · via WhatsApp' : '') : ''}
                    >
                      {formatRelativeTime(h.last_seen_at)}{h.last_seen_channel === 'whatsapp' && <span className="ml-1" aria-label="via WhatsApp">💬</span>}
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      {(h.schools_count ?? 0) > 0 ? (
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded-md bg-sage-light text-sage text-xs font-semibold"
                          title={`${h.schools_count} school${h.schools_count === 1 ? '' : 's'} added`}
                        >
                          {h.schools_count === 1 ? 'Yes' : `${h.schools_count} schools`}
                        </span>
                      ) : (
                        <span className="text-warm-grey text-xs">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-warm-grey text-xs hidden lg:table-cell whitespace-nowrap">
                      {(h.documents_count ?? 0)} files · {formatBytes(h.documents_bytes ?? 0)}
                    </td>
                    <td className="px-4 py-3 text-warm-grey font-mono text-xs hidden lg:table-cell">{h.join_code}</td>
                    <td className="px-4 py-3 text-warm-grey text-xs hidden lg:table-cell">{h.timezone || '-'}</td>
                    <td className="px-4 py-3 text-warm-grey hidden lg:table-cell">
                      {h.created_at ? new Date(h.created_at).toLocaleDateString() : '-'}
                    </td>
                  </tr>
                ))}
                {households.length === 0 && (
                  <tr><td colSpan="9" className="px-4 py-8 text-center text-warm-grey">No households found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-xs text-warm-grey">
            Page {page} of {totalPages}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="flex items-center gap-1 px-3 py-2 rounded-xl border border-light-grey text-sm font-medium text-charcoal hover:bg-cream disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <IconChevronLeft className="h-4 w-4" /> Prev
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="flex items-center gap-1 px-3 py-2 rounded-xl border border-light-grey text-sm font-medium text-charcoal hover:bg-cream disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Next <IconChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
