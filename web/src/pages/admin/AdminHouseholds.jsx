import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import api from '../../lib/api';
import { IconSearch, IconChevronLeft, IconChevronRight } from '../../components/Icons';
import Spinner from '../../components/Spinner';

const PAGE_SIZE = 20;

export default function AdminHouseholds() {
  const [households, setHouseholds] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const loadHouseholds = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: PAGE_SIZE };
      if (search.trim()) params.search = search.trim();
      const { data } = await api.get('/admin/households', { params });
      setHouseholds(data.households || []);
      setTotal(data.total || 0);
    } catch (err) {
      console.error('Failed to load households:', err);
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => { loadHouseholds(); }, [loadHouseholds]);

  function handleSearch(e) {
    e.preventDefault();
    setPage(1);
    loadHouseholds();
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-charcoal tracking-tight">Households</h1>
      <p className="text-warm-grey text-sm mt-1">{total} total household{total !== 1 ? 's' : ''}</p>

      {/* Search */}
      <form onSubmit={handleSearch} className="mt-4 flex gap-2">
        <div className="relative flex-1 max-w-md">
          <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-warm-grey" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by household name..."
            className="w-full pl-10 pr-4 py-2.5 bg-cream border border-light-grey rounded-xl text-sm focus:outline-none focus:border-plum focus:ring-2 focus:ring-plum/20 transition-all"
          />
        </div>
        <button type="submit" className="px-4 py-2.5 bg-plum text-white rounded-xl text-sm font-semibold hover:bg-plum-dark transition-colors">
          Search
        </button>
      </form>

      {/* Table */}
      <div className="mt-4 bg-white rounded-2xl shadow-[var(--shadow-sm)] overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-light-grey text-left">
                  <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider">Name</th>
                  <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider">Members</th>
                  <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider hidden sm:table-cell">Join Code</th>
                  <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider hidden md:table-cell">Timezone</th>
                  <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider hidden lg:table-cell">Created</th>
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
                    <td className="px-4 py-3 text-warm-grey font-mono text-xs hidden sm:table-cell">{h.join_code}</td>
                    <td className="px-4 py-3 text-warm-grey text-xs hidden md:table-cell">{h.timezone || '—'}</td>
                    <td className="px-4 py-3 text-warm-grey hidden lg:table-cell">
                      {h.created_at ? new Date(h.created_at).toLocaleDateString() : '—'}
                    </td>
                  </tr>
                ))}
                {households.length === 0 && (
                  <tr><td colSpan="5" className="px-4 py-8 text-center text-warm-grey">No households found</td></tr>
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
